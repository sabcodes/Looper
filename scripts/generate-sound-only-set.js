import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, symlink, readdir, lstat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { renderAudio, sliceAudio } from '../src/index.js';
import { hash, sourceIdentity, verifySources, measure, encodePreview } from './lib/audio-evaluation.js';

const root = new URL('../', import.meta.url), planOnly = process.argv.includes('--plan');
const folder = process.argv.slice(2).find(arg => arg !== '--plan') ?? 'set7';
assert(/^set\d+$/.test(folder), 'Use a numbered set folder.');
const fixtureBytes = await readFile(new URL('data/sound-only-listening.json', root));
const fixture = JSON.parse(fixtureBytes);
const output = fileURLToPath(new URL('generated_beats/' + folder + '/', root));
const reference = fileURLToPath(new URL('generated_beats/' + fixture.referenceFolder + '/', root));
const manifestBytes = await readFile(join(reference, 'manifest.json'));
const old = JSON.parse(manifestBytes);
const sources = await sourceIdentity(root);
const artifact = async (name, value) => writeFile(join(output, name), Buffer.isBuffer(value) || typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
async function bytes() { let n = 0; for (const f of await readdir(output)) n += (await lstat(join(output, f))).size; return n; }
const withoutProfiles = events => events.map(({ profile, ...event }) => event);
const frozenMusic = score => ({ config: Object.fromEntries(['seed','phraseSeed','bpm','root','rootName','scale','bars','timeSignature','timeline','production','groove','density','sauce','accompaniment','arrangement','development'].map(k => [k,score.config[k]])),
  drums: score.drums, chords: score.chords, sections: score.sections, automation: score.automation, sidechain: score.sidechain,
  keys: withoutProfiles(score.keys), bass: withoutProfiles(score.bass), lead: score.lead, arp: score.arp, parts: score.parts });
const json = value => JSON.stringify(value);
const prepared = [];
for (const item of fixture.cases) {
  const row = old.cases.find(c => c.id === item.id), ref = row[fixture.referenceStage];
  const compressed = await readFile(join(reference, ref.score));
  assert.equal(hash(compressed), ref.scoreSha256);
  assert.equal(hash(await readFile(join(reference, ref.audio))), ref.audioChecks.audioSha256);
  const score = JSON.parse(gunzipSync(compressed));
  assert(!score.vocals);
  const frozen = hash(json(frozenMusic(score))), variants = [];
  for (const spec of item.variants) {
    assert(['bass','keys'].includes(spec.role));
    assert(['warm_sub','electric_bass','dark_analog_bass','rhodes_stabs','acoustic_piano','organ'].includes(spec.profile));
    assert(score[spec.role].length, 'Requested voice is absent');
    const variant = structuredClone(score);
    const previousProfiles = [...new Set(variant[spec.role].map(e => e.profile))];
    assert(!previousProfiles.includes(spec.profile), 'Variant must change the sound');
    for (const event of variant[spec.role]) event.profile = spec.profile;
    const sound = variant.config.soundDesign, paletteRole = spec.role === 'bass' ? 'bass' : 'harmony';
    if (spec.role === 'bass') { variant.config.bassProfile = spec.profile; sound.bassTexture = spec.profile; }
    else { variant.config.synthProfile = spec.profile; sound.harmonyProfile = spec.profile; }
    sound.palette[paletteRole] = { profile: spec.profile, source: 'evaluation_override', candidates: [spec.profile] };
    variant.experiment = { type: 'sound-only', referenceSet: fixture.referenceFolder, referenceCase: item.id,
      referenceStage: fixture.referenceStage, role: spec.role, previousProfiles, profile: spec.profile,
      note: 'Original prompt and requestedProfiles are provenance. This evaluation intentionally overrides a named instrument after composition; notes, timing and performance controls are frozen.' };
    assert.equal(hash(json(frozenMusic(variant))), frozen, item.id + ': musical performance changed');
    variants.push({ spec, score: variant, frozenMusicSha256: frozen, previousProfiles });
  }
  prepared.push({ item, row, ref, score, variants, frozenMusicSha256: frozen });
}
const estimated = prepared.flatMap(p => p.variants).reduce((sum,v) => sum + gzipSync(Buffer.from(json(v.score))).length + 386_000, 0) + 160_000;
assert(estimated < fixture.storageLimitBytes, 'Planned output exceeds budget');
if (planOnly) {
  console.log(json({ output, groups: prepared.length, newClips: 6, reusedReferenceLinks: 3, estimatedBytes: estimated, controls: 'Frozen notes, timing, velocities, articulation, drums, arrangement and effects; one primary voice profile changed per variant.' }));
} else {
  await mkdir(output); // Never overwrite a collection.
  const manifest = { batch: folder, status: 'rendering', fixture, fixtureSha256: hash(fixtureBytes), referenceManifestSha256: hash(manifestBytes),
    sources, engineVersion: JSON.parse(await readFile(new URL('package.json', root))).version, nodeVersion: process.version,
    comparison: 'A = preferred set6 B reference; B = bass-only replacement; C = harmony-only replacement. Deliberate timbre overrides, not prompt-following tests. No lead or answering-part changes.',
    storageLimitBytes: fixture.storageLimitBytes, cases: [] };
  await artifact('plan.json', { status: 'planned', fixture, estimatedBytes: estimated });
  for (const p of prepared) {
    const baselineAudio = p.item.id + '-A-reference.mp3', baselineScore = p.item.id + '-A-reference.score.json.gz';
    await symlink('../' + fixture.referenceFolder + '/' + p.ref.audio, join(output, baselineAudio));
    await symlink('../' + fixture.referenceFolder + '/' + p.ref.score, join(output, baselineScore));
    const baselineCheck = await measure(join(output, baselineAudio));
    const group = { id: p.item.id, originalPrompt: p.row.prompt, seed: p.row.seed, options: p.row.options, excerpt: p.row.excerpt,
      frozenMusicSha256: p.frozenMusicSha256, reference: { audio: baselineAudio, score: baselineScore, sourceAudio: p.ref.audio, sourceScore: p.ref.score,
        audioSha256: p.ref.audioChecks.audioSha256, scoreSha256: p.ref.scoreSha256, audioChecks: baselineCheck,
        profiles: { bass: p.score.config.bassProfile, harmony: p.score.config.synthProfile } }, variants: [],
      humanReview: { bassPreference: null, harmonyPreference: null, overallPreference: null, notes: null } };
    for (const v of p.variants) {
      const name = p.item.id + '-' + v.spec.label, scoreFile = name + '.score.json.gz', data = gzipSync(Buffer.from(json(v.score) + '\n'), { level: 9 });
      assert(await bytes() + data.length + 386_000 < fixture.storageLimitBytes - 100_000, 'Storage reserve exceeded');
      await artifact(scoreFile, data);
      const full = renderAudio(v.score), audio = sliceAudio(full, p.row.excerpt.startSeconds, fixture.previewSeconds);
      assert.equal(audio.frames, 44100 * fixture.previewSeconds);
      assert(Number.isFinite(full.stats.rms) && full.stats.rms > .01 && full.stats.peak <= .93, 'Invalid render');
      const audioChecks = await encodePreview(join(output, name + '.mp3'), audio, { targetLufs: baselineCheck.integratedLufs });
      const differenceLu = Math.abs(audioChecks.encoded.integratedLufs - baselineCheck.integratedLufs);
      assert(differenceLu <= .3, 'Variant is too far from reference loudness; stop before presenting an unmatched comparison.');
      group.variants.push({ ...v.spec, previousProfiles: v.previousProfiles, audio: name + '.mp3', score: scoreFile, scoreSha256: hash(data),
        frozenMusicSha256: v.frozenMusicSha256, audioChecks, loudnessDifferenceFromReferenceLu: differenceLu, fullAudioStats: full.stats });
      console.log(name + ': saved, frozen performance verified, loudness difference ' + differenceLu.toFixed(2) + ' LU');
    }
    manifest.cases.push(group);
  }
  await verifySources(root, sources);
  assert.equal(hash(await readFile(new URL('data/sound-only-listening.json', root))), hash(fixtureBytes));
  const lines = ['# ' + folder + ' — sound-only comparisons', '',
    'A = the set6 B version you preferred. B changes only the bass sound; C changes only the primary harmony sound. Notes, pitch, timing, velocity, duration, articulation, glide instructions, drums, arrangement and effects stay fixed. Leads and answering instruments stay fixed.', '',
    'A files are links to existing set6 audio, not duplicates. All clips use the same 16-second excerpt and match reference loudness within 0.3 LU using attenuation only. Changing the instrument changes its inherent attack and decay even though event durations are unchanged.', '',
    'This deliberately overrides named instruments after composition to test taste. It does not evaluate ordinary prompt/seed interpretation, or prove a universal instrument preference. No new models or downloads.', '',
    '| Case | A reference | B: bass only | C: harmony only |', '|---|---|---|---|'];
  for (const g of manifest.cases) lines.push(`| ${g.id} | ${g.reference.profiles.bass} + ${g.reference.profiles.harmony} | ${g.variants[0].profile} | ${g.variants[1].profile} |`);
  for (const g of manifest.cases) {
    lines.push('', '## ' + g.id, '', 'Original prompt: ' + g.originalPrompt, '', 'Seed: ' + g.seed + '; original phrasing and excerpt preserved.');
    for (const [label,file] of [['A — preferred reference',g.reference.audio],...g.variants.map(v => [v.label + ' — ' + v.description,v.audio])]) lines.push('', '**' + label + '**', '', '![' + g.id + ' ' + label + '](<' + join(output,file) + '>)');
    lines.push('', 'Bass: A / B / tie · Harmony: A / C / tie · Overall: A / B / C / tie · Notes:');
  }
  await artifact('listening.md', lines.join('\n') + '\n');
  await artifact('scorecard.csv', 'case,bass_preference_A_or_B,harmony_preference_A_or_C,overall_preference_A_B_C,notes\n' + manifest.cases.map(g => g.id + ',,,,').join('\n') + '\n');
  for (const g of manifest.cases) {
    assert.equal(hash(await readFile(join(output,g.reference.audio))),g.reference.audioSha256);
    assert.equal(hash(await readFile(join(output,g.reference.score))),g.reference.scoreSha256);
    for (const v of g.variants) {
      assert.equal(hash(await readFile(join(output,v.audio))),v.audioChecks.audioSha256);
      const saved = await readFile(join(output,v.score)); assert.equal(hash(saved),v.scoreSha256);
      assert.equal(hash(json(frozenMusic(JSON.parse(gunzipSync(saved))))),g.frozenMusicSha256);
      assert(v.audioChecks.encoded.truePeakDbfs <= -1);
    }
  }
  manifest.status = 'complete';
  await artifact('manifest.json', manifest);
  await artifact('audit.json', { status: 'passed', groups:3, newAudioFiles:6, reusedAudioLinks:3, newScores:6, reusedScoreLinks:3, frozenPerformanceChecks:6,
    sourcesVerified:sources.length, maximumLoudnessDifferenceLu:Math.max(...manifest.cases.flatMap(g=>g.variants.map(v=>v.loudnessDifferenceFromReferenceLu))),
    temporaryFileBudgetBytes:500_000, downloads:0, caveat:'No subjective ratings filled; only the rendered instrument profile changes, apart from a global level adjustment for listening.' });
  const size = await bytes(); assert(size < fixture.storageLimitBytes);
  console.log('Complete: ' + output + ' (' + size + ' retained file/link bytes)');
}
