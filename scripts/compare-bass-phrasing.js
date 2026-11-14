import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { compose, compilePrompt, generateBass, renderAudio, sliceAudio, analyzeScore } from '../src/index.js';
import { writeJson } from '../src/export.js';
import { hash, nextBatch, measure, encodePreview, sourceIdentity, verifySources } from './lib/audio-evaluation.js';
const root = new URL('../', import.meta.url), output = fileURLToPath(new URL('generated_beats/', root));
await mkdir(output, { recursive: true });
const fixture = JSON.parse(await readFile(new URL('data/dark-synth-comparison.json', root), 'utf8'));
const prompt = fixture.cases.find((c) => c.id === 'B-distorted').prompt;
const base = compose(prompt, { seed: fixture.seed, sauce: 0 });
for (const e of base.keys) { e.note -= 12; e.velocity *= .35; e.pan *= .35; }
const sources = await sourceIdentity(root), batch = await nextBatch(output, 'bass-phrasing');
const controlsHash = hash(JSON.stringify({ drums: base.drums, keys: base.keys, chords: base.chords }));
const variants = [
  { id: 'A-held', label: 'Held foundation — original phrasing', suffix: '' },
  { id: 'B-bounce', label: 'Bouncing riff — shorter accents and gaps', suffix: ', bouncy bass riff' },
  { id: 'C-response', label: 'Call and response — long calls and short answers', suffix: ', call and response bass phrases' },
];
const manifest = { batch, status: 'rendering', createdAt: new Date().toISOString(), sources,
  controls: 'Same preferred B distorted analog synth, drive, slow filter, F minor, 100 BPM, seed 202, drums, chords, quiet pads and mix. Only bass phrasing/pitch/velocity change. All previews begin at bar 20; linear loudness matching only.',
  controlsSha256: controlsHash, reference: 'Reference envelope variation informed the phrase design; no extracted note transcription or copied audio.', cases: [] };
const previews = [];
for (const v of variants) {
  const score = structuredClone(base);
  score.config = compilePrompt(prompt + v.suffix, { seed: fixture.seed, sauce: 0 });
  score.bass = generateBass(score.drums.kick, score.chords, score.config);
  assert.equal(hash(JSON.stringify({ drums: score.drums, keys: score.keys, chords: score.chords })), controlsHash);
  assert(score.bass.every((e) => e.profile === 'dark_distorted_bass' && e.drive === 5 && e.motion === 'slow'));
  console.log('Rendering ' + v.id);
  const audio = sliceAudio(renderAudio(score), 48, 16);
  const prefix = batch + '-' + v.id;
  const row = { ...v, prompt: score.config.prompt, audio: prefix + '.mp3', score: prefix + '.score.json',
    metrics: analyzeScore(score), raw: await measure(audio), humanReview: { groove: null, bassTone: null, phrasing: null, preferred: null, notes: null } };
  await writeJson(join(output, row.score), score);
  manifest.cases.push(row); previews.push(audio);
}
const targetLufs = Math.min(-16, ...manifest.cases.map((r) => r.raw.integratedLufs - .5), ...manifest.cases.map((r) => r.raw.integratedLufs - 2 - r.raw.truePeakDbfs));
for (let i = 0; i < previews.length; i++) {
  const row = manifest.cases[i];
  row.audioChecks = await encodePreview(join(output, row.audio), previews[i], { targetLufs, raw: row.raw });
  row.scoreSha256 = hash(await readFile(join(output, row.score)));
  console.log(row.id + ': ' + row.audioChecks.encoded.integratedLufs + ' LUFS, bass coverage ' + row.metrics.bassGateCoverage.toFixed(2));
}
assert.equal(new Set(manifest.cases.map((r) => r.audioChecks.audioSha256)).size, 3);
const levels = manifest.cases.map((r) => r.audioChecks.encoded.integratedLufs);
assert(Math.max(...levels) - Math.min(...levels) <= .3);
await verifySources(root, sources);
manifest.targetLufs = targetLufs; manifest.status = 'complete';
manifest.retainedCaseBytes = (await Promise.all(manifest.cases.flatMap((r) => [r.audio, r.score]).map(async (f) => (await stat(join(output, f))).size))).reduce((a,b) => a+b,0);
await writeJson(join(output, batch + '.manifest.json'), manifest);
const lines = ['# Preferred distorted synth: three phrasing options', '', manifest.controls, '', 'Human listening ratings remain open. A is the held control; B/C explore phrasing, not alternative synth tones.', ''];
for (const row of manifest.cases) lines.push('## ' + row.label, '', '![' + row.label + '](<' + join(output, row.audio) + '>)', '', '> ' + row.prompt, '', 'Bass gate coverage: ' + (row.metrics.bassGateCoverage*100).toFixed(1) + '%; longest note: ' + row.metrics.bassLongestDurationBeats.toFixed(2) + ' beats.', '', '[Full score](<' + join(output, row.score) + '>)', '');
await writeFile(join(output, batch + '.listening.md'), lines.join('\n') + '\n', { flag: 'wx' });
console.log('Ready: ' + join(output, batch + '.listening.md'));
