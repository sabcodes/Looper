import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, symlink, readdir, lstat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';
import { renderAudio, sliceAudio } from '../src/index.js';
import { hash, sourceIdentity, verifySources, measure, encodePreview } from './lib/audio-evaluation.js';

const root = new URL('../', import.meta.url);
const parent = fileURLToPath(new URL('generated_beats/set7/', root)), output = join(parent, 'combined');
const inputBytes = await readFile(join(parent, 'manifest.json')), original = JSON.parse(inputBytes);
const feedbackBytes = await readFile(new URL('data/sound-selection-feedback.json', root)), feedback = JSON.parse(feedbackBytes);
assert.equal(hash(inputBytes), feedback.manifestSha256);
const limit = original.storageLimitBytes, temporaryReserve = 386_000, reportReserve = 35_000;
async function bytes(directory = parent) {
  let size = 0;
  for (const f of await readdir(directory)) { const path = join(directory, f), info = await lstat(path); size += info.isDirectory() ? await bytes(path) : info.size; }
  return size;
}
const artifact = (name, value) => writeFile(join(output, name), typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
const sources = await sourceIdentity(root), prepared = [];
for (const rating of feedback.cases.filter(c => c.review.bassPreference === 'B' && c.review.harmonyPreference === 'C')) {
  const row = original.cases.find(c => c.id === rating.id);
  const harmony = row.variants.find(v => v.label === 'C-harmony'), bass = row.variants.find(v => v.label === 'B-bass');
  const readScore = async variant => {
    const data = await readFile(join(parent, variant.score)); assert.equal(hash(data), variant.scoreSha256);
    assert.equal(hash(await readFile(join(parent, variant.audio))), variant.audioChecks.audioSha256);
    return JSON.parse(gunzipSync(data));
  };
  const c = await readScore(harmony), b = await readScore(bass), d = structuredClone(c);
  for (const event of d.bass) event.profile = bass.profile;
  d.config.bassProfile = bass.profile;
  d.config.soundDesign.bassTexture = bass.profile;
  d.config.soundDesign.palette.bass = structuredClone(b.config.soundDesign.palette.bass);
  d.experiment = { type: 'combined-preferred-sounds', sourceSet: 'set7', sourceCase: row.id, reference: harmony.audio,
    primaryHarmony: harmony.profile, primaryBass: bass.profile,
    note: 'C harmony plus B bass, preserving all event data and performance controls. Original prompt is provenance; instrument replacement is deliberate.' };
  assert.deepEqual(d.bass, b.bass, row.id + ': combined bass differs from preferred B');
  for (const field of ['keys','lead','arp','parts','drums','chords','sections','automation','sidechain']) assert.deepEqual(d[field], c[field], row.id + ': changed ' + field);
  const restore = structuredClone(d.config);
  restore.bassProfile = c.config.bassProfile; restore.soundDesign.bassTexture = c.config.soundDesign.bassTexture; restore.soundDesign.palette.bass = c.config.soundDesign.palette.bass;
  assert.deepEqual(restore, c.config, row.id + ': changed non-bass configuration');
  prepared.push({ row, harmony, bass, referenceBass: c.config.bassProfile, score: d, compressed: gzipSync(Buffer.from(JSON.stringify(d) + '\n'), { level:9 }) });
}
assert.deepEqual(prepared.map(p => p.row.id), ['02','09']);
const initial = await bytes(), estimatedNew = prepared.reduce((n,p) => n + p.compressed.length + 386_000, 0) + reportReserve;
assert(initial + estimatedNew + temporaryReserve < limit, 'Existing set7 allowance cannot cover the extension including codec temporaries.');
await mkdir(output); // Never overwrite an earlier comparison.
const manifest = { status: 'rendering', type:'combined-sound-extension', parentSet:'set7', wholeParentLimitBytes:limit,
  parentBytesBeforeExtension:initial, estimatedNewBytes:estimatedNew, estimatedPeakParentBytes:initial+estimatedNew+temporaryReserve,
  parentManifestSha256:hash(inputBytes), feedbackSha256:hash(feedbackBytes), sources,
  controls:'C primary harmony plus B primary bass. Exact B bass events and C harmony/other events; all phrasing, production and timing held fixed. Reference level matched by attenuation only.', cases:[] };
for (const p of prepared) {
  const prefix=p.row.id, refAudio=prefix+'-C-reference.mp3', refScore=prefix+'-C-reference.score.json.gz';
  await symlink('../'+p.harmony.audio,join(output,refAudio));
  await symlink('../'+p.harmony.score,join(output,refScore));
  const scoreFile=prefix+'-D-combined.score.json.gz', audioFile=prefix+'-D-combined.mp3';
  assert(await bytes()+p.compressed.length+386_000+temporaryReserve+reportReserve<limit);
  await artifact(scoreFile,p.compressed);
  const full=renderAudio(p.score), audio=sliceAudio(full,p.row.excerpt.startSeconds,16);
  assert.equal(audio.frames,44100*16);assert(Number.isFinite(full.stats.rms)&&full.stats.rms>.01&&full.stats.peak<=.93);
  const referenceLevel=await measure(join(output,refAudio));
  const audioChecks=await encodePreview(join(output,audioFile),audio,{targetLufs:referenceLevel.integratedLufs});
  assert(Math.abs(audioChecks.encoded.integratedLufs-referenceLevel.integratedLufs)<=.3);
  assert(audioChecks.encoded.truePeakDbfs<=-1);
  assert((await lstat(join(output,audioFile))).size<temporaryReserve);
  manifest.cases.push({id:prefix,seed:p.row.seed,originalPrompt:p.row.originalPrompt,excerpt:p.row.excerpt,
    reference:{audio:refAudio,score:refScore,audioSha256:p.harmony.audioChecks.audioSha256,scoreSha256:p.harmony.scoreSha256,bass:p.referenceBass,harmony:p.harmony.profile,level:referenceLevel},
    preferredBassSource:{audio:p.bass.audio,score:p.bass.score,audioSha256:p.bass.audioChecks.audioSha256,scoreSha256:p.bass.scoreSha256,profile:p.bass.profile},
    combined:{audio:audioFile,score:scoreFile,audioSha256:audioChecks.audioSha256,scoreSha256:hash(p.compressed),bass:p.bass.profile,harmony:p.harmony.profile,audioChecks},
    checks:{exactPreferredBassEvents:true,exactPreferredHarmonyAndOtherEvents:true,unchangedPerformanceControls:true},
    humanReview:{preference:null,notes:null}});
  console.log(prefix+': C versus D saved; preferred bass/harmony events verified');
}
await verifySources(root,sources);
assert.equal(hash(await readFile(join(parent,'manifest.json'))),hash(inputBytes));
assert.equal(hash(await readFile(new URL('data/sound-selection-feedback.json',root))),hash(feedbackBytes));
for(const c of manifest.cases)for(const stage of ['reference','combined']){
 const v=c[stage];assert.equal(hash(await readFile(join(output,v.audio))),v.audioSha256);assert.equal(hash(await readFile(join(output,v.score))),v.scoreSha256);
}
const lines=['# Combined preferred sounds — set7 extension','','C = your preferred harmony version from set7. D = the same version with your preferred B bass added. The phrasing, notes, performance controls and drums stay fixed; both sounds now appear together.','','| Case | C reference | D combined |','|---|---|---|'];
for(const c of manifest.cases)lines.push(`| ${c.id} | ${c.combined.harmony} + ${c.id==='02'?'upright bass':'acid bass'} | ${c.combined.harmony} + ${c.combined.bass} |`);
lines.push('','08 stays at its existing C version (upright bass + acoustic piano), because the two bass versions sounded the same to you. No duplicate 08 clip was rendered.','', 'All previews are 16 seconds at the original excerpt positions. References are links to existing set7 media. Levels are matched with attenuation only. This is a listening experiment, not a change to engine defaults.');
for(const c of manifest.cases){lines.push('','## '+c.id);for(const [label,stage]of[['C — reference','reference'],['D — combined','combined']])lines.push('','**'+label+'**','','!['+c.id+' '+label+'](<'+join(output,c[stage].audio)+'>)');lines.push('','Preference: C / D / tie · Bass balance · Groove · Overall feel · Notes:');}
await artifact('listening.md',lines.join('\n')+'\n');
await artifact('scorecard.csv','case,preference_C_or_D,bass_balance,groove,overall_feel,notes\n02,,,,,\n09,,,,,\n');
manifest.status='complete';await artifact('manifest.json',manifest);
const completion={status:'complete',newAudioFiles:2,newScores:2,reusedAudioLinks:2,reusedScoreLinks:2,independentPairChecks:2,sourcesVerified:sources.length,
  referenceHashesVerified:true,downloads:0,wholeSet7StorageLimitBytes:limit,wholeSet7RetainedBytes:0,temporaryReserveBytes:temporaryReserve,
  caveat:'Human preference remains unfilled; comparisons test the combination, not a global sound-selection rule.'};
const current=await bytes();for(let i=0;i<4;i++)completion.wholeSet7RetainedBytes=current+Buffer.byteLength(JSON.stringify(completion,null,2)+'\n');
assert(completion.wholeSet7RetainedBytes<limit);await artifact('completion.json',completion);
console.log('Complete: '+output+'; entire set7 '+completion.wholeSet7RetainedBytes+' bytes / '+limit);
