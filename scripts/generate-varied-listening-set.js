import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { compose, renderAudio, sliceAudio } from '../src/index.js';
import { writeJson } from '../src/export.js';
import { checkCase } from './evaluation-checks.js';
import { nextBatch, hash, encodePreview, sourceIdentity, verifySources, run } from './lib/audio-evaluation.js';
const root = new URL('../', import.meta.url), output = fileURLToPath(new URL('generated_beats/', root));
const fixturePath = new URL('data/varied-prompt-evaluation.json', root);
const fixtureBytes = await readFile(fixturePath), fixture = JSON.parse(fixtureBytes);
assert.equal(fixture.cases.length, 50);
assert.equal(fixture.previewSeconds, 16);
await mkdir(output, { recursive: true });
const batch = await nextBatch(output, 'varied-50'), sources = await sourceIdentity(root);
for (const path of ['data/varied-prompt-evaluation.json', 'scripts/evaluation-checks.js', 'scripts/generate-varied-listening-set.js', 'scripts/lib/audio-evaluation.js']) sources.push({ path, sha256: hash(await readFile(new URL(path, root))) });
const manifest = { batch, status: 'rendering', createdAt: new Date().toISOString(), nodeVersion: process.version,
  ffmpeg: (await run('ffmpeg', ['-version'])).stdout.split('\n')[0], purpose: fixture.purpose,
  fixtureSha256: hash(fixtureBytes), sources, previewSeconds: 16, previewStartBar: 20,
  storageLimitBytes: 40e6, note: 'Full 32-bar scores; only 16-second MP3 previews retained. Every excerpt starts at the drop. This does not audition full arrangement transitions. Signal checks and event checks do not certify musical quality.', cases: [] };
const manifestPath = join(output, batch + '.manifest.json');
await writeJson(manifestPath, manifest);
await writeJson(join(output, batch + '.prompts.json'), fixture);
let retainedBytes = fixtureBytes.length;
for (let i = 0; i < fixture.cases.length; i++) {
  const item = fixture.cases[i], seed = fixture.seedBase + i;
  console.log('[' + (i+1) + '/50] ' + item.id + ' ' + item.prompt);
  const score = compose(item.prompt, { seed });
  const result = checkCase(score, item.expect);
  assert(result.passed, 'Observable expectation failed for case ' + item.id);
  const prefix = batch + '-' + item.id;
  const row = { ...item, seed, audio: prefix + '.mp3', score: prefix + '.score.json', ...result,
    interpretation: { intent: score.config.intent, source: score.config.classification.source,
      needsInterpretationReview: score.config.classification.needsInterpretationReview,
      bpm: score.config.bpm, root: score.config.rootName, scale: score.config.scale,
      bassMode: score.config.bassMode, bassProfile: score.config.bassProfile, synthProfile: score.config.synthProfile,
      soundDesign: score.config.soundDesign, messages: score.config.messages },
    humanReview: { promptFit: null, genreFit: null, bassTone: null, groove: null, arrangement: null, usefulness: null, notes: null } };
  const scoreBytes = Buffer.from(JSON.stringify(score, null, 2) + '\n');
  // Budget before each audio write, including report overhead and the next preview.
  assert(retainedBytes + scoreBytes.length + 600000 < manifest.storageLimitBytes, 'Agreed 40 MB output budget would be exceeded.');
  await writeFile(join(output, row.score), scoreBytes, { flag: 'wx' });
  row.scoreSha256 = hash(scoreBytes);
  const startSeconds = fixture.previewStartBar * score.config.beatsPerBar * 60 / score.config.bpm;
  const preview = sliceAudio(renderAudio(score), startSeconds, fixture.previewSeconds);
  assert.equal(preview.frames, 16 * 44100);
  assert(preview.stats.rms > .0001 && preview.stats.peak < 1, 'Silent or clipped preview.');
  row.excerpt = { startSeconds, durationSeconds: 16 };
  row.rawPcmStats = preview.stats;
  row.audioChecks = await encodePreview(join(output, row.audio), preview);
  retainedBytes += scoreBytes.length + (await stat(join(output, row.audio))).size;
  row.status = 'ready'; manifest.cases.push(row);
  manifest.retainedCaseBytes = retainedBytes;
  await writeJson(manifestPath, manifest, true);
}
await verifySources(root, sources);
assert.equal(new Set(manifest.cases.map((r) => r.audioChecks.audioSha256)).size, 50);
manifest.status = 'complete'; manifest.completedAt = new Date().toISOString();
manifest.observableCasesPassed = manifest.cases.filter((r) => r.passed).length;
manifest.signalChecksPassed = manifest.cases.filter((r) => r.audioChecks.encoded.truePeakDbfs <= -1).length;
manifest.uniqueEncodedFiles = new Set(manifest.cases.map((r) => r.audioChecks.audioSha256)).size;
manifest.diversityCaveat = 'Unique file hashes prove different bytes, not different perceived sound. See acoustic/semantic diagnostics and human listening.';
await writeJson(manifestPath, manifest, true);
const lines = ['# 50 varied prompts — listening set', '', fixture.purpose, '',
  'All clips are 16 seconds from bar 20. Full 32-bar scores are saved; full-track audio can be regenerated from the prompt/seed. Loudness uses attenuation toward -16 LUFS with true-peak headroom; transient-heavy clips may be quieter.', '',
  'Automated event/settings checks: ' + manifest.observableCasesPassed + '/50. Signal checks: ' + manifest.signalChecksPassed + '/50. Human music-quality ratings remain unfilled.', '',
  '[Exact prompts](<' + join(output, batch + '.prompts.json') + '>) · [Manifest, measurements and checks](<' + manifestPath + '>)', '',
  'Start with 01 (beach day), 11 (held crunchy synth), 20 (bass call/response), 28 (80s synth-pop), 33 (dubstep), 35 (90s techno/no piano), 41 (bass only), 42 (drums only), and 50 (techno/not house).', ''];
let level;
for (const row of manifest.cases) {
  if (level !== row.level) { level = row.level; lines.push('# ' + level.replaceAll('_', ' '), ''); }
  const p = row.interpretation;
  lines.push('## ' + row.id + ' — ' + row.prompt, '', '![' + row.id + '](<' + join(output, row.audio) + '>)', '',
    'Interpreted as **' + p.intent + '** (' + p.source + ') · ' + p.bpm + ' BPM · ' + p.root + ' ' + p.scale + '.', '',
    'Bass: ' + p.bassProfile + '; harmony: ' + p.soundDesign.harmonyRole + '; lead: ' + p.soundDesign.leadEnabled + '; arpeggio: ' + p.soundDesign.arpEnabled + '.', '',
    ...(p.needsInterpretationReview ? ['Style choice needs listening review; no single genre label is scored for vague cases.', ''] : []),
    '[Full score](<' + join(output, row.score) + '>) · ' + row.audioChecks.encoded.integratedLufs + ' LUFS · true peak ' + row.audioChecks.encoded.truePeakDbfs + ' dBFS', '',
    'Listening: prompt fit ___ | groove ___ | bass/tone ___ | keep/change ___', '');
}
await writeFile(join(output, batch + '.listening.md'), lines.join('\n') + '\n', { flag: 'wx' });
console.log('Ready: ' + join(output, batch + '.listening.md'));
console.log('Audio/full scores: ' + (retainedBytes/1e6).toFixed(2) + ' MB');
