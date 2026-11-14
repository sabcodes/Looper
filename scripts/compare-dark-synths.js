// Reproducible listening comparison; all retained output stays in generated_beats/.
import { readFile, readdir, mkdir, writeFile, stat } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { compose, compilePrompt, renderAudio, sliceAudio, analyzeScore } from '../src/index.js';
import { clamp } from '../src/random.js';
import { writeAudio, writeJson } from '../src/export.js';
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const output = join(root, 'generated_beats');
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'));
const assert = (value, message) => { if (!value) throw new Error(message); };

async function run(executable, args, input) {
  return new Promise((accept, reject) => {
    const child = spawn(executable, args, { cwd: root, stdio: [input ? 'pipe' : 'ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', (b) => { stdout += b; }); child.stderr.on('data', (b) => { stderr += b; });
    child.on('error', reject);
    child.on('close', (code) => code === 0 ? accept({ stdout, stderr }) : reject(new Error(stderr)));
    if (input) { child.stdin.on('error', () => {}); child.stdin.end(input); }
  });
}
function parseLoudness(stderr) {
  const integrated = [...stderr.matchAll(/I:\s+(-?[\d.]+) LUFS/g)].at(-1);
  const peak = [...stderr.matchAll(/Peak:\s+(-?[\d.]+) dBFS/g)].at(-1);
  assert(integrated && peak, 'Loudness measurement is missing.');
  return { integratedLufs: Number(integrated[1]), truePeakDbfs: Number(peak[1]) };
}
async function measurePcm(audio) {
  const result = await run('ffmpeg', ['-hide_banner', '-nostats', '-f', 's16le', '-ar', String(audio.sampleRate), '-ac', '2', '-i', 'pipe:0', '-af', 'ebur128=framelog=verbose:peak=true', '-f', 'null', '-'], audio.pcm);
  return parseLoudness(result.stderr);
}
async function measureFile(path) {
  const result = await run('ffmpeg', ['-hide_banner', '-nostats', '-i', path, '-af', 'ebur128=framelog=verbose:peak=true', '-f', 'null', '-']);
  return parseLoudness(result.stderr);
}
function attenuate(audio, gainDb) {
  assert(gainDb <= 0, 'Comparison matching only attenuates; unexpected positive gain.');
  const pcm = Buffer.alloc(audio.pcm.length), gain = 10 ** (gainDb / 20);
  for (let at = 0; at < pcm.length; at += 2) pcm.writeInt16LE(Math.round(audio.pcm.readInt16LE(at) * gain), at);
  return { ...audio, pcm };
}
function noteFingerprint(score) {
  const notes = (items) => items.map(({ voice, bar, step, time, duration, note, fromNote, glide }) => ({ voice, bar, step, time, duration, note, fromNote, glide }));
  return hash(JSON.stringify({ bass: notes(score.bass), chords: notes(score.keys), lead: notes(score.lead), arp: notes(score.arp) }));
}

async function main() {
  await mkdir(output, { recursive: true });
  const fixture = await readJson(join(root, 'data/dark-synth-comparison.json'));
  const existing = await readdir(output);
  let index = 1;
  while (existing.some((f) => f.startsWith('synth-compare-' + String(index).padStart(3, '0') + '.manifest.'))) index++;
  const batch = 'synth-compare-' + String(index).padStart(3, '0');
  const sourceFiles = ['package.json', 'bin/analyzebeats.js', 'scripts/analyze_audio.py', 'scripts/compare-dark-synths.js', 'data/dark-synth-comparison.json', 'data/genre-rules.json', 'data/intent-corpus.json',
    ...(await readdir(join(root, 'src'))).filter((f) => f.endsWith('.js')).map((f) => 'src/' + f)];
  const sources = [];
  for (const path of sourceFiles.sort()) sources.push({ path, sha256: hash(await readFile(join(root, path))) });
  const baseline = compose(fixture.basePrompt, { seed: fixture.seed, sauce: fixture.sauce });
  for (const e of baseline.keys) e.note -= 12;
  const notesHash = noteFingerprint(baseline), drumsHash = hash(JSON.stringify(baseline.drums));
  const startSeconds = fixture.previewStartBar * baseline.config.beatsPerBar * 60 / baseline.config.bpm;
  const manifest = { batch, status: 'rendering', createdAt: new Date().toISOString(), engineVersion: baseline.config.version, nodeVersion: process.version,
    ffmpeg: (await run('ffmpeg', ['-version'])).stdout.split('\n')[0], fixture,
    controls: fixture.controls, sourceFiles: sources, commonNoteFingerprint: notesHash, commonDrumFingerprint: drumsHash,
    excerpt: { startSeconds, durationSeconds: fixture.previewSeconds },
    caveat: 'Same note/timing and drum-event data. Oscillators, envelopes, filter color, pad level and width vary. Loudness matching uses only linear attenuation. This is a listening comparison, not a validated quality ranking.', cases: [] };
  const manifestPath = join(output, batch + '.manifest.json');
  await writeJson(manifestPath, manifest);
  await writeJson(join(output, batch + '.prompts.json'), fixture);
  const previews = [];
  for (const variant of fixture.cases) {
    console.log('Rendering ' + variant.label + '...');
    const parsed = compilePrompt(variant.prompt, { seed: fixture.seed, sauce: fixture.sauce });
    assert(parsed.bpm === baseline.config.bpm && parsed.root === baseline.config.root && parsed.scale === baseline.config.scale, 'Musical controls changed.');
    assert(parsed.bassProfile === variant.expectedBassProfile && parsed.synthProfile === variant.expectedPadProfile, 'Unexpected sound interpretation.');
    const score = structuredClone(baseline);
    score.config = parsed;
    for (const e of score.bass) { e.profile = parsed.bassProfile; e.drive = parsed.soundDesign.bassDrive; e.motion = parsed.soundDesign.bassMotion; }
    for (const e of score.keys) { e.profile = parsed.synthProfile; e.velocity *= variant.padGain; e.pan = clamp(e.pan * variant.padWidth, -.8, .8); }
    assert(noteFingerprint(score) === notesHash && hash(JSON.stringify(score.drums)) === drumsHash, 'Notes or drums changed.');
    const structure = analyzeScore(score);
    assert(structure.pianoVoiceCount === 0 && structure.bassGateCoverage > .999, 'Unexpected instruments or bass gaps.');
    const preview = sliceAudio(renderAudio(score), startSeconds, fixture.previewSeconds);
    const rawMeasurement = await measurePcm(preview);
    const prefix = batch + '-' + variant.id;
    const row = { ...variant, audio: prefix + '.mp3', score: prefix + '.score.json', analysis: prefix + '.analysis.json', rawMeasurement,
      controlsVerified: { sameNotes: true, sameDrumEvents: true, bassCoverage: structure.bassGateCoverage, pianoEvents: structure.pianoVoiceCount },
      noteFingerprint: noteFingerprint(score), drumFingerprint: hash(JSON.stringify(score.drums)), structure,
      humanReview: { closenessToRequestedSound: null, preferred: null, notes: null } };
    await writeJson(join(output, row.score), score);
    row.scoreSha256 = hash(await readFile(join(output, row.score)));
    manifest.cases.push(row); previews.push(preview);
  }
  let target = Math.min(-16, ...manifest.cases.map((c) => c.rawMeasurement.integratedLufs - .5),
    ...manifest.cases.map((c) => c.rawMeasurement.integratedLufs - 2 - c.rawMeasurement.truePeakDbfs));
  manifest.targetIntegratedLufs = target;
  for (let round = 0; round < 3; round++) {
    for (let i = 0; i < manifest.cases.length; i++) {
      const c = manifest.cases[i];
      const correction = round && c.encodedMeasurement ? target - c.encodedMeasurement.integratedLufs : 0;
      c.linearGainDb = round ? c.linearGainDb + correction : target - c.rawMeasurement.integratedLufs;
      await writeAudio(join(output, c.audio), attenuate(previews[i], c.linearGainDb), { format: 'mp3', force: round > 0 });
      c.encodedMeasurement = await measureFile(join(output, c.audio));
    }
    const errors = manifest.cases.map((c) => Math.abs(c.encodedMeasurement.integratedLufs - target));
    const maxPeak = Math.max(...manifest.cases.map((c) => c.encodedMeasurement.truePeakDbfs));
    if (Math.max(...errors) <= .2 && maxPeak <= -1) break;
    assert(round < 2, 'Encoded loudness could not be matched within tolerance.');
    if (maxPeak > -1) target -= maxPeak + 1.3;
    manifest.targetIntegratedLufs = target;
  }
  const measured = manifest.cases.map((c) => c.encodedMeasurement.integratedLufs);
  assert(Math.max(...measured) - Math.min(...measured) <= .3, 'Loudness spread is too large.');
  let total = 0;
  for (const c of manifest.cases) {
    console.log('Measuring ' + c.label + '...');
    const probe = JSON.parse((await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=sample_rate,channels,bit_rate', '-of', 'json', join(output, c.audio)])).stdout);
    assert(Math.abs(Number(probe.format.duration) - fixture.previewSeconds) < .12 && probe.streams[0].channels === 2 && Number(probe.streams[0].sample_rate) === 44100, 'Invalid encoded preview.');
    // Deliberately do not pass the full-track score to a short excerpt analyzer:
    // its offsets/section lengths would describe the wrong audio window.
    c.analysisLog = await run(process.execPath, ['bin/analyzebeats.js', join(output, c.audio), '--output', c.analysis]);
    c.audioSha256 = hash(await readFile(join(output, c.audio)));
    c.analysisSha256 = hash(await readFile(join(output, c.analysis)));
    const report = await readJson(join(output, c.analysis));
    assert(report.source_sha256 === c.audioSha256, 'Analysis identity mismatch.');
    c.signalSummary = { spectralCentroidHz: report.spectral_centroid_hz, bandPower: report.spectral_band_power_fraction, loudness: report.loudness };
    c.status = 'ready';
    for (const name of [c.audio, c.score, c.analysis]) total += (await stat(join(output, name))).size;
    console.log(c.id + ': ' + c.encodedMeasurement.integratedLufs + ' LUFS | true peak ' + c.encodedMeasurement.truePeakDbfs + ' dBFS');
  }
  assert(new Set(manifest.cases.map((c) => c.audioSha256)).size === 3, 'Comparison files are identical.');
  for (const source of sources) assert(hash(await readFile(join(root, source.path))) === source.sha256, 'Source changed during comparison.');
  manifest.status = 'complete'; manifest.completedAt = new Date().toISOString(); manifest.retainedCaseBytes = total;
  await writeJson(manifestPath, manifest, true);
  const lines = ['# Deep dark synth — matched listening comparison', '',
    'Three 16-second excerpts: F minor, 100 BPM, seed ' + fixture.seed + ', same bass/chord notes and drum events. The chord register is lowered one octave in all three.',
    'Pad levels, spread, envelopes and oscillator/filter texture vary as declared. Loudness is matched with linear gain only; no subjective scores are assigned.', '',
    '[Manifest and exact settings](<' + manifestPath + '>)', ''];
  for (const c of manifest.cases) lines.push('## ' + c.label, '',
    '[' + c.audio + '](<' + join(output, c.audio) + '>)', '', '> ' + c.prompt, '',
    'Measured: ' + c.encodedMeasurement.integratedLufs + ' LUFS; true peak ' + c.encodedMeasurement.truePeakDbfs + ' dBFS.', '',
    '[Score](<' + join(output, c.score) + '>) · [Signal analysis](<' + join(output, c.analysis) + '>)', '',
    'Feedback: closest ___ | too soft/harsh/thin/busy ___ | what to retain ___', '');
  await writeFile(join(output, batch + '.listening.md'), lines.join('\n') + '\n', { flag: 'wx' });
  console.log('Comparison ready: ' + join(output, batch + '.listening.md'));
  console.log('Audio/scores/reports: ' + (total / 1e6).toFixed(2) + ' MB');
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
