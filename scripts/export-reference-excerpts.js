// Export small level-matched auditions from a private reference-study report.
import { readFile, writeFile, stat } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';
import { writeJson } from '../src/export.js';
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const output = join(root, 'generated_beats');
const hash = (b) => createHash('sha256').update(b).digest('hex');
const assert = (value, message) => { if (!value) throw new Error(message); };
async function run(args) {
  return new Promise((accept, reject) => {
    const child = spawn('ffmpeg', ['-nostdin', '-protocol_whitelist', 'file,pipe', ...args], { stdio: ['ignore','pipe','pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', (b) => { stdout += b; }); child.stderr.on('data', (b) => { stderr += b; });
    child.on('error', reject); child.on('close', (code) => code === 0 ? accept({ stdout, stderr }) : reject(new Error(stderr)));
  });
}
async function meter(path) {
  const result = await run(['-hide_banner','-nostats','-i',path,'-af','ebur128=framelog=verbose:peak=true','-f','null','-']);
  const i = [...result.stderr.matchAll(/I:\s+(-?[\d.]+) LUFS/g)].at(-1);
  const p = [...result.stderr.matchAll(/Peak:\s+(-?[\d.]+) dBFS/g)].at(-1);
  assert(i && p, 'Missing loudness measurement');
  return { lufs: Number(i[1]), truePeakDbfs: Number(p[1]) };
}
async function main() {
  const { values } = parseArgs({ options: { report: { type:'string' }, prefix: { type:'string', default:'reference-study-001' }, force: { type:'boolean' } } });
  assert(values.report && /^[a-zA-Z0-9-]+$/.test(values.prefix), 'Supply --report and a simple output prefix');
  const reportPath = resolve(values.report);
  const report = JSON.parse(await readFile(reportPath,'utf8'));
  const manifestPath = join(output, values.prefix + '.auditions.json');
  try { await stat(manifestPath); throw new Error('Audition set already exists'); } catch (error) { if(error.code!=='ENOENT')throw error; }
  const target = Math.min(-16, ...report.entries.map((e)=>e.source_excerpt_loudness.lufs - 2 - e.source_excerpt_loudness.true_peak_dbfs));
  const rows = [];
  for (const entry of report.entries) {
    assert(/^[a-zA-Z0-9_-]+$/.test(entry.id), 'Invalid reference identifier');
    const s = await stat(entry.source);
    assert(s.isFile() && hash(await readFile(entry.source)) === entry.source_sha256, 'Source identity changed');
    let gainDb = target-entry.source_excerpt_loudness.lufs;
    const reuse = entry.kind==='generated_baseline' && Math.abs(gainDb)<.05 && entry.selected.start_seconds===0;
    const destination = reuse ? entry.source : join(output, values.prefix+'-'+entry.id+'.mp3');
    assert(reuse || resolve(destination)!==resolve(entry.source), 'Refusing to overwrite original reference audio');
    let measurement;
    for (let attempt=0;attempt<3;attempt++) {
      if (!reuse) await run(['-hide_banner','-loglevel','error',values.force || attempt ? '-y' : '-n','-threads','1','-ss',String(entry.selected.start_seconds),'-i',entry.source,
        '-t',String(entry.selected.duration_seconds),'-map_metadata','-1','-map_chapters','-1','-af','volume='+gainDb+'dB,afade=t=in:st=0:d=0.01,afade=t=out:st='+Math.max(0,entry.selected.duration_seconds-.02)+':d=0.02',
        '-ar','44100','-ac','2','-c:a','libmp3lame','-b:a','192k',destination]);
      measurement = await meter(destination);
      if (Math.abs(measurement.lufs-target)<=.15 && measurement.truePeakDbfs<=-.5) break;
      assert(!reuse && attempt<2, 'Audition loudness/headroom mismatch');
      gainDb += target-measurement.lufs;
    }
    rows.push({ id:entry.id,label:entry.label,source:entry.source,sourceSha256:entry.source_sha256,
      startSeconds:entry.selected.start_seconds,durationSeconds:entry.selected.duration_seconds,
      audio:destination,sha256:hash(await readFile(destination)),gainDb,measurement,reusedExistingFile:reuse });
  }
  assert(Math.max(...rows.map(r=>r.measurement.lufs))-Math.min(...rows.map(r=>r.measurement.lufs))<=.3, 'Loudness spread too large');
  const manifest = { version:1, report:reportPath,reportSha256:hash(await readFile(reportPath)), targetLufs:target,
    method:'Original files read in place; volume attenuation precedes PCM conversion/MP3 encoding, then encoded loudness is checked. Existing B is reused when already at the target.',
    entries:rows };
  await writeJson(manifestPath,manifest);
  const clock = (s) => Math.floor(s/60)+':'+String(Math.floor(s%60)).padStart(2,'0');
  const lines = ['# Low, heavy, crunchy tonal sound — reference study','',
    'The user likes the existing palette for different vibes and intents. These references add another target; they do not replace A, B, C or the other working voices.','',
    'Automatic primary passages are shown below. Excerpts and generated B are level-matched to '+target.toFixed(1)+' LUFS.','',
    '[Raw calibrated report](<'+reportPath+'>) · [Audition manifest](<'+manifestPath+'>)','','## Selected passages',''];
  for(const row of rows){
    const entry = report.entries.find(e=>e.id===row.id);
    lines.push('### '+row.label,'','Source passage: **'+clock(row.startSeconds)+'–'+clock(row.startSeconds+row.durationSeconds)+'**.','',
      '[Play level-matched excerpt](<'+row.audio+'>)','','Measured '+row.measurement.lufs+' LUFS; true peak '+row.measurement.truePeakDbfs+' dBFS.','',
      'Estimated pulse: '+entry.tempo_estimate.toFixed(1)+' BPM; half/double ambiguity remains. '+(entry.knownBpm?'Generated B is known to be '+entry.knownBpm+' BPM.':''),'',
      'Full-mix spectral power: sub 20–80 Hz '+(100*entry.selected.band_power_fractions.sub).toFixed(1)+'%; low 80–250 Hz '+(100*entry.selected.band_power_fractions.low).toFixed(1)+'%; low-mid 250–1200 Hz '+(100*entry.selected.band_power_fractions.low_mid).toFixed(1)+'%.','');
  }
  lines.push('## Findings and limits','',
    '- All three selected references have substantial sustained tonal activity in the low band. They also show more low-band envelope contrast than the current B excerpt: the harmonic-low 30th/90th-percentile envelope ratio is about 0.51–0.53 in the references versus 0.88 in B. This is a mixture-level proxy, not an isolated bass measurement.',
    '- Two selected references put more full-mix energy in the 250–1200 Hz body region than B; the third is strongly sub-heavy. Preserve clean low weight and expose harmonic-body/drive balance as an independent sound control rather than imposing a single recipe.',
    '- CLAP places electric-bass and low-distorted-synth descriptions among close candidates. It does not settle the instrument identity. Full-song vocals and other layers influence these embeddings; do not optimize a bass sound to the full-mix cosine alone.',
    '- Calibration rejected spectral-flux peaks as note events: B has four known bass starts but the detector found 66 low-tonal energy changes. They include modulation/ducking and cannot certify note rhythm, swing or kick/bass alignment.',
    '- The pitch proxy is substantially less reliable in the reference mixtures than in B. Reported stable segments are not reliable note-length transcription. Exact groove/note targets still need listening or isolated/annotated parts.','',
    '## Proposed next listening round','',
    'Keep the approved distorted synth timbre and add phrase-level contour: a held foundation, deliberately shorter responses/accents, brief spaces and controlled pitch movement. Compare rhythmic variants with the same timbre and matched loudness. These are design hypotheses from the references, not changes already made to the engine.','',
    'Original WAVs were not copied or edited. Study inputs, audio excerpts, private paths and raw results remain under ignored generated_beats/. The generation runtime remains procedural Node.js.','');
  const summaryPath = join(output,values.prefix+'.summary.md');
  await writeFile(summaryPath,lines.join('\n')+'\n',{flag:'wx'});
  console.log(JSON.stringify({targetLufs:target,excerpts:rows.map(r=>({id:r.id,start:r.startSeconds,audio:r.audio,...r.measurement})),summary:summaryPath},null,2));
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
