import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, symlink, readdir, lstat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';
import { renderAudio, sliceAudio } from '../src/index.js';
import { hash, sourceIdentity, verifySources, measure, encodePreview } from './lib/audio-evaluation.js';

const root = new URL('../', import.meta.url), parent = fileURLToPath(new URL('generated_beats/set8/', root));
const output = join(parent, 'deep-bass'), planOnly = process.argv.includes('--plan');
const parentBytes = await readFile(join(parent, 'manifest.json')), baseline = JSON.parse(parentBytes);
const feedbackBytes = await readFile(new URL('data/generalization-feedback.json', root));
const sources = await sourceIdentity(root), temporaryReserve = 386_000, reportReserve = 90_000;
assert.equal(JSON.parse(feedbackBytes).set, 'set8');
for (const source of sources) assert.equal(source.sha256, baseline.sources.find(s => s.path === source.path)?.sha256, 'Engine changed since set8: ' + source.path);
async function bytes(directory = parent) {
  let n = 0;
  for (const name of await readdir(directory)) { const path = join(directory, name), info = await lstat(path); n += info.isDirectory() ? await bytes(path) : info.size; }
  return n;
}
const artifact = (name, value) => writeFile(join(output, name), typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
const stripProfile = events => events.map(({ profile, ...event }) => event);
function verifySwap(original, variant, profile) {
  assert.deepEqual(stripProfile(variant.bass), stripProfile(original.bass), 'Bass performance changed');
  assert(variant.bass.every(e => e.profile === profile));
  const restored = structuredClone(variant);
  restored.bass = original.bass;
  restored.config.bassProfile = original.config.bassProfile;
  restored.config.soundDesign.bassTexture = original.config.soundDesign.bassTexture;
  restored.config.soundDesign.palette.bass = original.config.soundDesign.palette.bass;
  delete restored.experiment;
  assert.deepEqual(restored, original, 'Non-bass data changed');
}
// Fixed before rendering: B for 09 covers its PWM harmony; A for 10/11. No seed rerolls.
const prepared = [];
for (const id of ['09-B', '10-A', '11-A']) {
  const row = baseline.cases.find(c => c.id === id); assert(row);
  const compressed = await readFile(join(parent, row.score));
  assert.equal(hash(compressed), row.scoreSha256);
  assert.equal(hash(await readFile(join(parent, row.audio))), row.audioChecks.audioSha256);
  const original = JSON.parse(gunzipSync(compressed)); assert(original.bass.length > 0); assert(!original.vocals);
  const variants = [];
  for (const [label, profile, description] of [['S', 'dark_analog_bass', 'rounded analog bass with a clean sub fundamental'], ['E', 'saturated_808', 'saturated 808']]) {
    const score = structuredClone(original);
    for (const event of score.bass) event.profile = profile;
    score.config.bassProfile = profile; score.config.soundDesign.bassTexture = profile;
    score.config.soundDesign.palette.bass = { profile, source: 'evaluation_override', candidates: [profile] };
    score.experiment = { type: 'bass-only', referenceSet: 'set8', referenceCase: id, profile,
      note: 'Deliberate sound override after composition. Original prompt remains provenance; pitch, timing, velocities, glides, durations, all other voices and effects are unchanged. Inherent envelope/gain differs by profile.' };
    verifySwap(original, score, profile);
    variants.push({ label, profile, description, score, compressed: gzipSync(Buffer.from(JSON.stringify(score) + '\n'), { level: 9 }) });
  }
  prepared.push({ row, original, variants });
}
const initial = await bytes(), estimatedNew = prepared.flatMap(p => p.variants).reduce((sum, v) => sum + v.compressed.length + temporaryReserve, 0) + reportReserve;
assert(initial + estimatedNew + temporaryReserve < baseline.storageLimitBytes, 'Existing set8 allowance insufficient including temporary space');
const plan = { output, references: prepared.map(p => p.row.id), newClips: 6, newScores: 6, seconds: 16, initialParentBytes: initial,
  estimatedAdditionalBytes: estimatedNew, estimatedPeakParentBytes: initial + estimatedNew + temporaryReserve, wholeSet8LimitBytes: baseline.storageLimitBytes,
  selection: '09-B uses PWM; 10-A and 11-A. Fixed without rerolls. 12 is drum-only and excluded from bass-only swaps.',
  limitation: 'warm_sub, sine_sub and garage_sub share the same current DSP path; selected alternatives avoid identical profile aliases. No pitch lowering or new glides.' };
if (planOnly) { console.log(JSON.stringify(plan, null, 2)); } else {
  await mkdir(output); // Refuse to overwrite a previous collection.
  await artifact('plan.json', plan);
  const manifest = { status: 'rendering', type: 'bass-only-extension', parentSet: 'set8', engineCommit: baseline.engineCommit,
    engineVersion: baseline.engineVersion, nodeVersion: process.version, sources, parentManifestSha256: hash(parentBytes), feedbackSha256: hash(feedbackBytes),
    toolingSha256: hash(await readFile(fileURLToPath(import.meta.url))), plan, controls: 'Only bass profile changes plus global attenuation for level matching. All pitches, timing, velocities, duration/glide instructions, drums, harmony, arrangement, automation and effects remain fixed.', cases: [] };
  for (const p of prepared) {
    await verifySources(root, sources);
    const prefix = p.row.promptId, refAudio = prefix + '-R-reference.mp3', refScore = prefix + '-R-reference.score.json.gz';
    await symlink('../' + p.row.audio, join(output, refAudio)); await symlink('../' + p.row.score, join(output, refScore));
    // Reproduce archived raw preview exactly on the current engine before reusing its MP3.
    const referencePcm = hash(sliceAudio(renderAudio(p.original), p.row.excerpt.startSeconds, 16).pcm);
    assert.equal(referencePcm, p.row.audioChecks.pcmSha256, 'Reference PCM changed');
    const referenceLevel = await measure(join(output, refAudio));
    const group = { id: prefix, sourceCase: p.row.id, prompt: p.row.prompt, seed: p.row.seed, excerpt: p.row.excerpt,
      reference: { audio: refAudio, score: refScore, audioSha256: p.row.audioChecks.audioSha256, scoreSha256: p.row.scoreSha256,
        bass: p.original.config.bassProfile, harmony: p.original.config.synthProfile, level: referenceLevel, exactPcmReplay: true },
      variants: [], humanReview: { bassPreference: null, overallPreference: null, metallicImpressionRemaining: null, notes: null } };
    for (const v of p.variants) {
      assert(await bytes() + v.compressed.length + temporaryReserve * 2 + reportReserve < baseline.storageLimitBytes);
      const name = prefix + '-' + v.label, scoreFile = name + '.score.json.gz', audioFile = name + '.mp3';
      await artifact(scoreFile, v.compressed);
      const full = renderAudio(v.score), clip = sliceAudio(full, p.row.excerpt.startSeconds, 16);
      assert.equal(clip.frames, 44100 * 16); assert(Number.isFinite(full.stats.rms) && full.stats.rms > .01 && full.stats.peak <= .93);
      assert.notEqual(hash(clip.pcm), referencePcm, 'Variant produces identical audio');
      const checks = await encodePreview(join(output, audioFile), clip, { targetLufs: referenceLevel.integratedLufs });
      assert(Math.abs(checks.encoded.integratedLufs - referenceLevel.integratedLufs) <= .3, 'Loudness mismatch');
      assert((await lstat(join(output, audioFile))).size < temporaryReserve);
      group.variants.push({ label: v.label, profile: v.profile, description: v.description, audio: audioFile, score: scoreFile,
        scoreSha256: hash(v.compressed), audioChecks: checks, frozenPerformanceVerified: true, fullAudioStats: full.stats });
      console.log(name + ': saved; frozen performance, changed PCM and level match verified');
    }
    manifest.cases.push(group);
  }
  await verifySources(root, sources);
  assert.equal(hash(await readFile(join(parent, 'manifest.json'))), hash(parentBytes));
  assert.equal(hash(await readFile(new URL('data/generalization-feedback.json', root))), hash(feedbackBytes));
  for (const group of manifest.cases) {
    const p = prepared.find(p => p.row.id === group.sourceCase);
    assert.equal(hash(await readFile(join(output, group.reference.audio))), group.reference.audioSha256);
    assert.equal(hash(await readFile(join(output, group.reference.score))), group.reference.scoreSha256);
    for (const v of group.variants) {
      const saved = await readFile(join(output, v.score)); assert.equal(hash(saved), v.scoreSha256);
      verifySwap(p.original, JSON.parse(gunzipSync(saved)), v.profile);
      assert.equal(hash(await readFile(join(output, v.audio))), v.audioChecks.audioSha256);
    }
  }
  const lines = ['# Set8 — deep bass comparisons', '', 'Three cases, each with the same 16-second excerpt:', '',
    '- **R** = original reference (09-B, 10-A, 11-A from set8).', '- **S** = rounded dark-analog bass with a clean sub fundamental.', '- **E** = saturated 808.', '',
    'Only the bass sound changes. Notes, register, rhythm, durations, velocities, glide instructions, drums, harmony and effects remain fixed. Inherent instrument attack, decay and gain differ; the complete mixes are level matched within 0.3 LU. This does not test new slide patterns or lower octaves.', '',
    '09 already has sine sub with PWM harmony; 10 has garage sub with organ. These harmonies remain fixed, so report whether the metallic impression survives the bass swap. 11 deliberately requested metallic bass; its alternatives test taste rather than prompt compliance. 12 is drums only and is not included.', '',
    'The original set8 A/B labels are seeds. R/S/E here are sound variants. No engine defaults changed.'];
  for (const g of manifest.cases) {
    lines.push('', '## ' + g.id, '', 'Source: **' + g.sourceCase + '** · Original bass: **' + g.reference.bass + '** · Harmony stays **' + g.reference.harmony + '**.', '', 'Original prompt: ' + g.prompt);
    for (const [label, audio] of [['R — original', g.reference.audio], ...g.variants.map(v => [v.label + ' — ' + v.description, v.audio])]) lines.push('', '**' + label + '**', '', '![' + g.id + ' ' + label + '](<' + join(output, audio) + '>)');
    lines.push('', 'Bass preference: R / S / E / tie · Overall preference: R / S / E / tie · Metallic sound remains? · Notes:');
  }
  await artifact('listening.md', lines.join('\n') + '\n');
  await artifact('scorecard.csv', 'case,bass_preference_R_S_E,overall_preference_R_S_E,metallic_impression_remaining,notes\n09,,,,\n10,,,,\n11,,,,\n');
  manifest.status = 'complete'; await artifact('manifest.json', manifest);
  const audit = { status: 'passed', references: 3, exactReferencePcmReplays: 3, newAudioFiles: 6, newScores: 6, reusedAudioLinks: 3, reusedScoreLinks: 3,
    frozenPerformanceChecks: 6, changedPcmChecks: 6, sourceFilesVerified: sources.length, maximumLevelDifferenceLu: Math.max(...manifest.cases.flatMap(g => g.variants.map(v => Math.abs(v.audioChecks.encoded.integratedLufs - g.reference.level.integratedLufs)))),
    highestTruePeakDbfs: Math.max(...manifest.cases.flatMap(g => g.variants.map(v => v.audioChecks.encoded.truePeakDbfs))),
    wholeSet8LimitBytes: baseline.storageLimitBytes, wholeSet8RetainedBytes: 0, addedBytes: 0, temporaryReserveBytes: temporaryReserve, downloads: 0, subjectiveRatings: 'unfilled' };
  const beforeAudit = await bytes(); for (let i = 0; i < 5; i++) { audit.wholeSet8RetainedBytes = beforeAudit + Buffer.byteLength(JSON.stringify(audit, null, 2) + '\n'); audit.addedBytes = audit.wholeSet8RetainedBytes - initial; }
  assert(audit.wholeSet8RetainedBytes < baseline.storageLimitBytes); await artifact('audit.json', audit);
  assert.equal(await bytes(), audit.wholeSet8RetainedBytes);
  console.log('Complete: ' + output + '; all set8 ' + audit.wholeSet8RetainedBytes + ' / ' + baseline.storageLimitBytes + ' bytes');
}
