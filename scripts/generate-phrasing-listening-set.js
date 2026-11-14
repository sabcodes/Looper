import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync, gunzipSync } from 'node:zlib';
import { compose, renderAudio, sliceAudio, analyzeScore } from '../src/index.js';
import { hash, sourceIdentity, verifySources, measure, encodePreview } from './lib/audio-evaluation.js';

const root = new URL('../', import.meta.url);
const folder = process.argv[2] ?? 'set6';
assert(/^set\d+$/.test(folder), 'Use a numbered set folder.');
const output = fileURLToPath(new URL('generated_beats/' + folder + '/', root));
const baseline = fileURLToPath(new URL('generated_beats/set5/', root));
const limit = 6_000_000, seconds = 16, ids = ['08','12','20','02','09','13'];
const baselineBytes = await readFile(join(baseline, 'manifest.json'));
const oldManifest = JSON.parse(baselineBytes);
const sources = await sourceIdentity(root);
const serial = value => JSON.parse(JSON.stringify(value));
const artifact = (path, value) => writeFile(join(output, path), typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
async function bytes() {
  let result = 0;
  for (const f of await readdir(output)) result += (await stat(join(output, f))).size;
  return result;
}
const prepared = [];
for (const id of ids) {
  const row = oldManifest.cases.find(r => r.id === id);
  const compressed = await readFile(join(baseline, row.score));
  assert.equal(hash(compressed), row.scoreSha256);
  assert.equal(hash(await readFile(join(baseline, row.audio))), row.audioChecks.audioSha256);
  const before = JSON.parse(gunzipSync(compressed));
  const after = compose(row.prompt, { seed: row.seed, ...row.options });
  assert.deepEqual(serial(after), serial(compose(row.prompt, { seed: row.seed, ...row.options })), 'After score does not replay');
  for (const field of ['chords','drums','sections','automation','sidechain']) assert.deepEqual(serial(after[field]), before[field], id + ': changed ' + field);
  for (const field of ['bpm','bars','root','rootName','scale','timeSignature','timeline','production','bassProfile','synthProfile','groove','density','sauce']) assert.deepEqual(serial(after.config[field]), before.config[field], id + ': changed ' + field);
  // All synthesis/tone controls stay fixed. Only the corrected bass phrase and
  // the accompaniment policy may differ in sound-design metadata.
  for (const [field, value] of Object.entries(before.config.soundDesign)) {
    if (field !== 'bassPhrasing') assert.deepEqual(serial(after.config.soundDesign[field]), value, id + ': changed sound control ' + field);
  }
  const parts = score => score.parts.map(({ events, accompaniment, ...part }) => part);
  assert.deepEqual(serial(parts(after)), parts(before), id + ': changed additional instrument definitions');
  const profiles = score => Object.fromEntries(['bass','keys','lead','arp'].map(role => [role, [...new Set(score[role].map(e => e.profile))].sort()]));
  assert.deepEqual(profiles(after), profiles(before), id + ': changed actual instrument profiles');
  assert(!before.vocals && !after.vocals);
  prepared.push({ row, compressed, before, after });
}
assert(prepared.reduce((sum, p) => sum + p.compressed.length + gzipSync(Buffer.from(JSON.stringify(p.after))).length + 2 * 386_000, 0) + 200_000 < limit, 'Preflight exceeds approved 6 MB budget');
await mkdir(output); // Refuse an existing collection; do not overwrite it.
const manifest = { batch: folder, status: 'rendering', engineVersion: JSON.parse(await readFile(new URL('package.json', root))).version,
  nodeVersion: process.version, previewSeconds: seconds, sampleRate: 44100, storageLimitBytes: limit,
  baselineManifestSha256: hash(baselineBytes), baselineFolder: 'set5', sources,
  controls: 'Same prompts, seeds, sounds, key, tempo, meter, chords, drums, sections, automation and production. Phrasing may change in bass, harmony, lead and additional harmony parts.',
  caveat: 'Not a test of sound-palette diversity or an isolated instrument diagnosis. Before is the archived v1.8 score rendered by the unchanged DSP; PCM must match the archived preview hash. Pair-level loudness processing is attenuation only.',
  cases: [] };
await artifact('prompts.json', prepared.map(({ row }) => ({ id: row.id, prompt: row.prompt, seed: row.seed, options: row.options, excerpt: row.excerpt })));
await artifact('in-progress.json', { status: 'rendering', ids, storageLimitBytes: limit });
for (const { row, compressed, before, after } of prepared) {
  const previews = {}, raw = {};
  const pair = { id: row.id, priorFeedback: ['08','12','20'].includes(row.id) ? 'disliked' : 'favorite', prompt: row.prompt, seed: row.seed, options: row.options,
    excerpt: row.excerpt, originalAudioSha256: row.audioChecks.audioSha256, originalScoreSha256: row.scoreSha256,
    controlsPassed: true, humanReview: { groove: null, sound: null, repetition: null, overallPreference: null, notes: null } };
  for (const [stage, score] of [['before',before],['after',after]]) {
    const scoreFile = row.id + '-' + (stage === 'before' ? 'A-before' : 'B-after') + '.score.json.gz';
    const data = stage === 'before' ? compressed : gzipSync(Buffer.from(JSON.stringify(score) + '\n'), { level: 9 });
    assert(await bytes() + data.length + 386_000 < limit - 120_000, 'Storage reserve exceeded');
    await artifact(scoreFile, data);
    const audio = renderAudio(score);
    assert(Number.isFinite(audio.stats.rms) && audio.stats.rms > .01 && audio.stats.peak <= .93, 'Invalid full render');
    previews[stage] = sliceAudio(audio, row.excerpt.startSeconds, seconds);
    assert.equal(previews[stage].frames, 44100 * seconds);
    if (stage === 'before') assert.equal(hash(previews.before.pcm), row.audioChecks.pcmSha256, row.id + ': original preview PCM differs');
    raw[stage] = await measure(previews[stage]);
    pair[stage] = { audio: row.id + '-' + (stage === 'before' ? 'A-before' : 'B-after') + '.mp3', score: scoreFile, scoreSha256: hash(data),
      fullAudioStats: audio.stats, analysis: analyzeScore(score) };
    console.log(row.id + ' ' + stage + ': rendered and checked');
  }
  // A common, conservative target gives both clips enough transient headroom.
  const target = Math.min(-18, ...Object.values(raw).map(r => r.integratedLufs), ...Object.values(raw).map(r => r.integratedLufs - 3 - r.truePeakDbfs));
  for (const stage of ['before','after']) {
    assert(await bytes() + 386_000 < limit - 120_000, 'Storage reserve exceeded');
    pair[stage].audioChecks = await encodePreview(join(output, pair[stage].audio), previews[stage], { targetLufs: target, raw: raw[stage] });
  }
  pair.loudnessDifferenceLu = Math.abs(pair.before.audioChecks.encoded.integratedLufs - pair.after.audioChecks.encoded.integratedLufs);
  assert(pair.loudnessDifferenceLu <= .3, 'Pair is not adequately loudness matched');
  pair.loudnessTargetLufs = target;
  manifest.cases.push(pair);
  console.log(row.id + ': pair saved, loudness difference ' + pair.loudnessDifferenceLu.toFixed(2) + ' LU');
}
await verifySources(root, sources);
const lines = ['# Set6 — phrasing comparison', '',
  'Six matched pairs, 16 seconds each. A = archived phrasing; B = v1.9 phrasing. Same instrument sounds, prompt, seed, key, tempo, meter, chords, drums, arrangement, automation and production. The original set5 files are unchanged.', '',
  'Listen at the same volume. Each pair is loudness matched with attenuation only. Rate groove, sound, repetition and overall preference separately. Before/after labels are visible; this is not a blinded evaluation.', '',
  'Start with 08, 12 and 20 (previously disliked), then 02, 09 and 13 (favorites). In 12, the drum response cue no longer overrides sustained bass. That is a parser fix, not proof of which voice caused the earlier dislike.', '',
  '| Case | Earlier feedback | A LUFS | B LUFS | Match difference |', '|---|---|---:|---:|---:|'];
for (const p of manifest.cases) lines.push(`| ${p.id} | ${p.priorFeedback} | ${p.before.audioChecks.encoded.integratedLufs} | ${p.after.audioChecks.encoded.integratedLufs} | ${p.loudnessDifferenceLu.toFixed(2)} LU |`);
for (const p of manifest.cases) {
  lines.push('', '## ' + p.id, '', p.prompt, '', 'Seed: ' + p.seed + '. Excerpt starts at ' + p.excerpt.startSeconds.toFixed(2) + ' seconds.');
  for (const [stage, label] of [['before','A — before'],['after','B — after']]) lines.push('', '**' + label + '**', '', '![' + p.id + ' ' + stage + '](<' + join(output, p[stage].audio) + '>)');
  lines.push('', 'Groove: A / B / tie · Sound: A / B / tie · Repetition: A / B / tie · Overall: A / B / tie · Notes:');
}
await artifact('listening.md', lines.join('\n') + '\n');
await artifact('scorecard.csv', 'case,earlier_feedback,groove_preference,sound_preference,repetition_preference,overall_preference,notes\n' + manifest.cases.map(p => p.id + ',' + p.priorFeedback + ',,,,,').join('\n') + '\n');
manifest.status = 'complete';
await artifact('manifest.json', manifest);
const audit = { status: 'passed', pairs: manifest.cases.length, originalPcmMatches: 6, unchangedControls: 6, newScoreReplays: 6,
  audioFiles: 12, scoreFiles: 12, allTruePeaksBelowMinusOneDbfs: true, maximumLoudnessDifferenceLu: Math.max(...manifest.cases.map(p => p.loudnessDifferenceLu)),
  sourcesVerified: sources.length, allOriginalAudioAndScoreHashesVerified: true, temporaryFileBudgetBytes: 500_000, downloads: 0,
  caveat: 'Structural and signal checks only. Human preference fields remain unfilled.' };
for (const p of manifest.cases) for (const stage of ['before','after']) {
  assert.equal(hash(await readFile(join(output, p[stage].audio))), p[stage].audioChecks.audioSha256);
  assert.equal(hash(await readFile(join(output, p[stage].score))), p[stage].scoreSha256);
  assert(p[stage].audioChecks.encoded.truePeakDbfs <= -1);
}
await artifact('audit.json', audit);
const actual = await bytes();
assert(actual < limit, 'Approved storage budget exceeded');
console.log('Complete: ' + output + ' (' + actual + ' bytes)');
