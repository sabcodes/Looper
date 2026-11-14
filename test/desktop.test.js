import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { listAudio, outputDirectory, resolveAudio, runJob, validateRequest } from '../desktop/backend.js';
import { chooseOutputDirectory } from '../desktop/preferences.js';
import { applyPartVariations, describeEditableScore, validateEditableScore } from '../desktop/score-editor.js';
import { compose, packWav, renderAudio } from '../src/index.js';
import { directionCandidates, keepsRequestedParts } from '../desktop/suggest-direction.js';

const prompt = 'warm deep house in F minor at 240bpm, 8 bars';
const unique = () => 'desktop-verify-' + randomBytes(8).toString('hex');

test('desktop boundary rejects invalid options and filenames before rendering', () => {
  for (const request of [null, {}, { prompt: '' }, { prompt, format: 'exe' }, { prompt, output: '../escape.wav' },
    { prompt, output: 'a\\b.wav' }, { prompt, output: '.hidden.wav' }, { prompt, output: 'wrong.mp3' },
    { prompt, options: [] }, { prompt, options: { command: 'anything' } }, { prompt, format: 'mp3', stems: true }]) {
    assert.throws(() => validateRequest(request));
  }
  assert.equal(validateRequest({ prompt, output: 'my track.wav', options: { seed: 'hello', tuning: { concertPitch: 440 } } }).format, 'wav');
});

test('arrangement inspection is deterministic and returns actual engine timing', async () => {
  const input = { prompt, options: { seed: 'desktop' } };
  const first = await runJob('preview', input);
  assert.deepEqual(first, await runJob('preview', input));
  assert.equal(first.summary.intent, 'deep_house');
  assert.equal(first.summary.key, 'F minor');
  assert.equal(first.summary.duration, 8);
  assert.equal(first.summary.sections.at(-1).endTime, 8);
  assert.equal(first.filename, undefined);
  await assert.rejects(runJob('preview', { prompt: 'house 999bpm' }), /BPM/);
});

test('Blueprint shows a choice for ambiguous prompts and protects explicit styles and exclusions', async () => {
  const prompt = 'a warm nostalgic groove in F minor at 104 bpm, no piano or lead';
  const { summary: automatic } = await runJob('preview', { prompt });
  assert.ok(automatic.alternatives.includes('indie_pop'));
  assert.ok(automatic.cues.includes('nostalgic'));
  for (const seed of ['42', '43']) {
    const { summary } = await runJob('preview', { prompt, options: { seed, intentOverride: 'indie_pop' } });
    assert.equal(summary.intent, 'indie_pop');
    assert.equal(summary.interpretation, 'locked');
    assert.equal(summary.bpm, 104);
    assert.equal(summary.key, 'F minor');
    assert.doesNotMatch(summary.sounds.harmony, /piano|rhodes|jazz_keys/);
  }
  for (const [prompt, intentOverride, error] of [
    ['deep house', 'indie_pop', /conflicts/],
    ['a warm nostalgic groove, no indie pop', 'indie_pop', /excluded/],
    ['a warm nostalgic groove', '__proto__', /Unknown Blueprint style/],
  ]) await assert.rejects(runJob('preview', { prompt, options: { intentOverride } }), error);
});

test('negated electronic parts stay out of Blueprint style inference', async () => {
  const prompt = 'A tender, nostalgic instrumental for old home movies, with a soft pulse, in G major at 104 BPM.';
  for (const exclusion of ['No lead or arpeggios.', 'Without lead synth or arpeggios.', 'No lead, arpeggios, or synth pads.']) {
    const { summary } = await runJob('preview', { prompt: prompt + ' ' + exclusion, options: { seed: 1044 } });
    assert.ok(summary.alternatives.includes('indie_pop'), exclusion);
    assert.equal(summary.cues.some((cue) => /arp|synth|pads?/.test(cue)), false);
  }
  const positive = await runJob('preview', { prompt: prompt + ' No lead, arpeggios add movement.' });
  assert.ok(positive.summary.cues.includes('arpeggios'));
  const { summary: locked } = await runJob('preview', { prompt: prompt + ' No lead or arpeggios.',
    options: { seed: 1044, intentOverride: 'indie_pop' } });
  assert.equal(locked.intent, 'indie_pop');
  assert.equal(locked.bpm, 104);
  assert.equal(locked.key, 'G major');
});

test('Liquid candidates keep requested instruments and percussion before any model call', async () => {
  const options = { seed: 42, sauce: 0 };
  const rimshots = 'A slow closing-time groove for a small room, soft rimshots, warm electric piano playing seventh chords and rounded sub bass. E flat minor, 88 BPM. No arps.';
  const fairground = 'An unhurried tune for an empty fairground after closing, acoustic guitar chords with a bowed cello melody and brushed drums. G major, 88 BPM. No arps.';
  for (const [prompt, drumless] of [[rimshots, 'classical_minimal'], [fairground, 'chamber_classical']]) {
    const baseline = compose(prompt, options);
    assert.ok(keepsRequestedParts(baseline, options));
    assert.equal(keepsRequestedParts(compose(prompt, { ...options, intentOverride: drumless }), options), false);
    const candidates = directionCandidates(baseline, options);
    assert.ok(candidates.length > 1 && !candidates.includes(drumless));
    for (const intentOverride of candidates) {
      const score = compose(prompt, { ...options, intentOverride });
      assert.ok(keepsRequestedParts(score, options));
      assert.equal(score.config.bpm, 88);
      assert.equal(score.config.root, baseline.config.root);
      assert.equal(score.config.scale, baseline.config.scale);
      assert.equal(score.config.seed, '42');
    }
  }
  assert.ok(compose(fairground, options).drums.snare.every((hit) => hit.profile === 'brush'));
  const { summary, note, suggestion } = await runJob('suggest', { prompt: 'UK garage at 132 BPM', options });
  assert.equal(summary.intent, 'uk_garage_2step');
  assert.equal(summary.canSuggest, false);
  assert.match(note, /prompt names a style/);
  assert.equal(suggestion, undefined);
  const locked = await runJob('suggest', { prompt: 'A warm nostalgic groove for old home movies',
    options: { ...options, intentOverride: 'indie_pop' } });
  assert.equal(locked.summary.interpretation, 'locked');
  assert.match(locked.note, /Choose Follow prompt/);
  assert.equal(locked.suggestion, undefined);
});

test('desktop export produces playable PCM, retains its score and protects existing files', async () => {
  const name = unique(), output = name + '.wav';
  const statuses = [];
  try {
    const input = { prompt: 'a warm nostalgic groove in F minor at 240bpm, 8 bars', output,
      options: { seed: 'desktop', intentOverride: 'indie_pop' } };
    const preview = await runJob('preview', input);
    const result = await runJob('generate', input, (stage) => statuses.push(stage));
    assert.deepEqual(result.summary, preview.summary);
    const wav = await readFile(await resolveAudio(output));
    assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
    assert.equal(wav.toString('ascii', 8, 12), 'WAVE');
    assert.equal(wav.readUInt32LE(24), 44100);
    assert.equal(wav.length, 44 + 8 * 44100 * 4);
    assert.ok(result.stats.peak > 0);
    const score = JSON.parse(await readFile(join(outputDirectory, name + '.json'), 'utf8'));
    assert.equal(score.config.seed, 'desktop');
    assert.equal(score.config.intent, 'indie_pop');
    assert.equal(score.config.classification.source, 'locked');
    assert.ok(statuses.includes('Rendering instruments'));
    assert.ok((await listAudio()).some((file) => file.name === output));
    await assert.rejects(runJob('generate', { prompt, output }), /Output exists/);
    assert.deepEqual(await readFile(join(outputDirectory, output)), wav);
  } finally {
    await Promise.all([output, name + '.json'].map((file) => rm(join(outputDirectory, file), { force: true })));
  }
});

test('audio access rejects directory traversal and symlinks outside the output root', async () => {
  await assert.rejects(runJob('inspect-score', { source: '../private.wav' }), /Invalid audio filename/);
  await mkdir(outputDirectory, { recursive: true });
  const directory = await mkdtemp(join(outputDirectory, '.verify-desktop-'));
  const name = unique() + '.wav';
  try {
    await writeFile(join(directory, 'private.wav'), 'private test fixture');
    await symlink(join(directory, 'private.wav'), join(outputDirectory, name));
    await assert.rejects(resolveAudio(name), /inside generated_beats/);
    for (const invalid of ['../private.wav', '/tmp/a.wav', 'a\\b.wav', 'score.json']) await assert.rejects(resolveAudio(invalid), /Invalid audio filename/);
    assert.ok(!(await listAudio()).some((file) => file.name === name));
  } finally {
    await rm(join(outputDirectory, name), { force: true });
    await rm(directory, { recursive: true, force: true });
  }
});

test('saved score edits render a playable revision with untouched events preserved', async () => {
  const name = unique();
  const source = name + '.wav';
  const files = [source, name + '.json'];
  try {
    await runJob('generate', { prompt, output: source, options: { sauce: 0, seed: 'part edit' } });
    const sourcePath = join(outputDirectory, name + '.json');
    const originalBytes = await readFile(sourcePath);
    const original = JSON.parse(originalBytes);
    const audio = await readFile(join(outputDirectory, source));
    const inspection = await runJob('inspect-score', { source });
    assert.ok(inspection.tracks.some((track) => track.id === 'voice:keys' && track.events.length));
    assert.ok(inspection.tracks.some((track) => track.id === 'drum:kick' && track.events.length));
    const edits = [
      { action: 'update', track: 'voice:keys', index: 0, note: 72, velocity: .2 },
      { action: 'remove', track: 'drum:kick', index: 0 },
      { action: 'duplicate', track: 'drum:kick', index: 1, bar: 0, offset: 3, duration: .1 },
    ];
    const request = { source, revision: inspection.revision, edits };
    await assert.rejects(runJob('render-edit', { ...request, revision: 'stale' }), /score changed/);
    await assert.rejects(runJob('render-edit', { ...request, edits: [{ ...edits[2], offset: 16 }] }), /within the selected bar/);
    const revision = await runJob('render-edit', request);
    files.push(...revision.files);
    const edited = JSON.parse(await readFile(join(outputDirectory, revision.files[1])));
    const pcm = await readFile(join(outputDirectory, revision.filename));
    assert.equal(pcm.toString('ascii', 0, 4), 'RIFF');
    assert.equal(pcm.length, audio.length);
    assert.notDeepEqual(pcm, audio);
    assert.deepEqual(await readFile(sourcePath), originalBytes);
    assert.deepEqual(await readFile(join(outputDirectory, source)), audio);
    const expectedKeys = original.keys.map((event, index) => index ? event : { ...event, note: 72, velocity: .2 });
    assert.deepEqual(edited.keys, expectedKeys.sort((a, b) => a.time - b.time));
    const [added, ...kicks] = edited.drums.kick;
    assert.equal(added.step, 3);
    assert.equal(added.bar, 0);
    assert.equal(added.duration, .1);
    assert.deepEqual(kicks, original.drums.kick.slice(1));
    assert.deepEqual({ ...edited, keys: original.keys, drums: { ...edited.drums, kick: original.drums.kick } }, original);
    const reopened = await runJob('inspect-score', { source: revision.filename });
    assert.ok(reopened.tracks.find((track) => track.id === 'voice:keys').events.some((event) => event.note === 72));
  } finally {
    await Promise.all(files.map((file) => rm(join(outputDirectory, file), { force: true })));
  }
});

test('audition renders only the requested parts and keeps the saved mix and score intact', async () => {
  const name = unique();
  const source = name + '.wav';
  const paths = [source, name + '.json'].map((file) => join(outputDirectory, file));
  const options = { sampleRate: 8000 };
  try {
    await runJob('generate', { prompt, output: source, options: { seed: 'audition' } }, undefined, options);
    const [originalMix, originalScore] = await Promise.all(paths.map((path) => readFile(path)));
    const { revision, tracks } = await runJob('inspect-score', { source });
    const request = { source, revision };
    const bass = 'voice:bass', keys = 'voice:keys', kick = 'drum:kick';
    assert.ok([bass, keys, kick].every((id) => tracks.some((track) => track.id === id)));
    await assert.rejects(runJob('audition', { ...request, revision: 'stale', solo: bass }), /score changed/);
    await assert.rejects(runJob('audition', { ...request, muted: ['voice:missing'] }), /available in this score/);

    const soloScore = JSON.parse(originalScore);
    for (const name of Object.keys(soloScore.drums)) soloScore.drums[name] = [];
    soloScore.keys = soloScore.lead = soloScore.arp = soloScore.parts = [];
    const { wav: solo } = await runJob('audition', { ...request, solo: bass, muted: [bass, kick] }, undefined, options);
    assert.deepEqual(solo, packWav(renderAudio(soloScore, options)));
    assert.equal(solo.length, originalMix.length);
    assert.notDeepEqual(solo, originalMix);

    const mutedScore = JSON.parse(originalScore);
    mutedScore.keys = mutedScore.drums.kick = [];
    const { wav: muted } = await runJob('audition', { ...request, muted: [keys, kick] }, undefined, options);
    assert.deepEqual(muted, packWav(renderAudio(mutedScore, options)));
    assert.notDeepEqual(muted, originalMix);

    const { wav: silence } = await runJob('audition', { ...request, muted: tracks.map((track) => track.id) }, undefined, options);
    assert.equal(silence.subarray(44).some(Boolean), false);
    assert.deepEqual(await Promise.all(paths.map((path) => readFile(path))), [originalMix, originalScore]);
    assert.deepEqual((await listAudio()).filter((file) => file.name.startsWith(name)).map((file) => file.name), [source]);
  } finally {
    await Promise.all(paths.map((path) => rm(path, { force: true })));
  }
});

test('part seeds independently change sound, notes and rhythm on the existing arrangement', () => {
  const original = compose(prompt + ', change meter to 7/8 at bar 4, just intonation', {
    seed: 'part variations', parts: [{ name: 'reply', profile: 'clarinet' }],
  });
  const vary = (mode, seed = 'take-1', track = 'voice:bass') => {
    const score = structuredClone(original);
    applyPartVariations(score, [{ track, mode, seed }]);
    return validateEditableScore(score);
  };
  const sound = vary('sound'), phrase = vary('phrase'), both = vary('both');
  const timingAndPitch = (events) => events.map(({ bar, step, time, note, duration, frequency }) => ({ bar, step, time, note, duration, frequency }));
  assert.deepEqual(timingAndPitch(sound.bass), timingAndPitch(original.bass));
  assert.notEqual(sound.bass[0].profile, original.bass[0].profile);
  assert.deepEqual(phrase.bass.map(({ profile }) => profile), original.bass.map(({ profile }) => profile));
  assert.ok(phrase.bass.some((event, i) => event.note !== original.bass[i].note && event.frequency !== original.bass[i].frequency));
  assert.ok(phrase.bass.some((event, i) => event.step !== original.bass[i].step && event.time !== original.bass[i].time));
  assert.ok(phrase.bass.every((event, i) => event.time >= original.bass[i].time && event.time + event.duration <= original.config.duration));
  assert.deepEqual(timingAndPitch(both.bass), timingAndPitch(phrase.bass));
  assert.deepEqual(both.bass.map(({ profile }) => profile), sound.bass.map(({ profile }) => profile));
  assert.deepEqual(vary('both'), both);
  assert.notDeepEqual(vary('phrase', 'take-2').bass, phrase.bass);
  assert.deepEqual({ ...both, bass: original.bass }, original);
  const rhythm = vary('rhythm'), sauce = vary('sauce');
  assert.ok(rhythm.bass.some((event, i) => event.time !== original.bass[i].time));
  assert.deepEqual(timingAndPitch(sauce.bass), timingAndPitch(rhythm.bass));
  assert.deepEqual(rhythm.bass.map(({ profile }) => profile), original.bass.map(({ profile }) => profile));
  assert.deepEqual(sauce.bass.map(({ profile }) => profile), sound.bass.map(({ profile }) => profile));
  for (const changed of [rhythm, sauce]) {
    assert.deepEqual(changed.bass.map(({ note, frequency }) => ({ note, frequency })),
      original.bass.map(({ note, frequency }) => ({ note, frequency })));
    assert.deepEqual({ ...changed, bass: original.bass }, original);
  }
  const kit = vary('sound', 'kit-1', 'drum:kick');
  assert.notEqual(kit.drums.kick[0].kit, original.drums.kick[0].kit);
  assert.deepEqual(timingAndPitch(kit.drums.kick), timingAndPitch(original.drums.kick));
  const named = vary('sound', 'reply-1', 'part:reply');
  const reply = named.parts.find((part) => part.name === 'reply');
  assert.notEqual(reply.profile, 'clarinet');
  assert.ok(reply.events.every(({ profile }) => profile === reply.profile));
  both.partVariation = { source: 'original.wav', changes: [{ track: 'voice:bass', mode: 'both', seed: 'take-1' }] };
  const inspection = describeEditableScore(both);
  assert.equal(inspection.variationSource, 'original.wav');
  assert.equal(inspection.tracks.find((track) => track.id === 'voice:bass').savedSeed, 'take-1');
});

test('prompt variations can be compared in solo or in the mix and saved without changing the original', async () => {
  const name = unique();
  const source = name + '.wav';
  const files = [source, name + '.json'];
  const options = { sampleRate: 8000 };
  try {
    await runJob('generate', { prompt, output: source, options: { seed: 'part prompt' } }, undefined, options);
    const originalBytes = await Promise.all(files.map((file) => readFile(join(outputDirectory, file))));
    const original = JSON.parse(originalBytes[1]);
    const { revision } = await runJob('inspect-score', { source });
    const track = 'voice:bass';
    const variation = { track, mode: 'prompt', prompt: 'Use a clean sine sub and make the notes shorter' };
    const request = { source, revision, variations: [variation] };
    const { wav: originalSolo } = await runJob('audition', { source, revision, solo: track }, undefined, options);
    const { wav: variedSolo } = await runJob('audition', { ...request, solo: track }, undefined, options);
    const { wav: variedMix } = await runJob('audition', request, undefined, options);
    assert.notDeepEqual(variedSolo, originalSolo);
    assert.notDeepEqual(variedMix, originalBytes[0]);
    await assert.rejects(runJob('audition', { ...request, revision: 'stale' }), /score changed/);
    await assert.rejects(runJob('audition', { ...request, variations: [{ ...variation, prompt: 'Change the whole arrangement' }] }), /compatible instrument/);
    await assert.rejects(runJob('audition', { ...request, variations: [variation, variation] }), /different available part/);
    const keys = { track: 'voice:keys', mode: 'prompt', prompt: 'try a different key' };
    const { wav: changedKey, parameters } = await runJob('audition', { source, revision, solo: keys.track, variations: [keys], interpretPrompt: true },
      () => assert.fail('A direct key change should skip Liquid'), options);
    const { wav: originalKeys } = await runJob('audition', { source, revision, solo: keys.track }, undefined, options);
    assert.notDeepEqual(changedKey, originalKeys);
    assert.notEqual(parameters.key.root, original.config.root);
    const keyedCopy = await runJob('render-edit', { source, revision, variations: [keys] }, undefined, options);
    files.push(...keyedCopy.files);
    const reopened = await runJob('inspect-score', { source: keyedCopy.filename });
    assert.deepEqual(reopened.tracks.find(({ id }) => id === keys.track).parameters, parameters);
    const { wav: replayedKey } = await runJob('audition', { source: keyedCopy.filename, revision: reopened.revision, solo: keys.track }, undefined, options);
    assert.deepEqual(replayedKey, changedKey);
    const revoiced = structuredClone(original);
    applyPartVariations(revoiced, [{ ...keys, prompt: 'use different chord voicings' }]);
    assert.ok(revoiced.keys.some((event, i) => event.note !== original.keys[i].note));
    assert.deepEqual(revoiced.keys.map(({ note, ...event }) => ({ ...event, pitchClass: note % 12 })),
      original.keys.map(({ note, ...event }) => ({ ...event, pitchClass: note % 12 })));
    assert.deepEqual({ ...revoiced, keys: original.keys }, original);

    const saved = await runJob('render-edit', request, undefined, options);
    files.push(...saved.files);
    const edited = JSON.parse(await readFile(join(outputDirectory, saved.files[1])));
    assert.equal(saved.summary.sounds.bass, 'sine_sub');
    assert.deepEqual(await readFile(join(outputDirectory, saved.filename)), variedMix);
    assert.deepEqual(edited.partVariation, { source, revision, changes: [variation] });
    assert.deepEqual(edited.bass, original.bass.map((event) => ({ ...event, profile: 'sine_sub', duration: event.duration * .55 })));
    assert.deepEqual({ ...edited, bass: original.bass, partVariation: undefined }, { ...original, partVariation: undefined });
    assert.deepEqual(await Promise.all(files.slice(0, 2).map((file) => readFile(join(outputDirectory, file)))), originalBytes);
  } finally {
    await Promise.all(files.map((file) => rm(join(outputDirectory, file), { force: true })));
  }
});

test('an interpreted part prompt replays and saves the same bounded edit', async () => {
  const source = unique() + '.wav';
  const files = [source, source.replace(/\.wav$/, '.json')];
  const options = { sampleRate: 8000 };
  try {
    await runJob('generate', { prompt: prompt + ', lead melody', output: source }, undefined, options);
    const original = JSON.parse(await readFile(join(outputDirectory, files[1])));
    const { revision } = await runJob('inspect-score', { source });
    const track = 'voice:lead';
    const variation = { track, mode: 'prompt', prompt: 'more static to the lead', interpretation: 'add_radio_static' };
    const request = { source, revision, variations: [variation] };
    const { wav: originalSolo } = await runJob('audition', { source, revision, solo: track }, undefined, options);
    const { wav: interpretedSolo } = await runJob('audition', { ...request, solo: track }, undefined, options);
    assert.notDeepEqual(interpretedSolo, originalSolo);
    const direct = { track, mode: 'prompt', prompt: 'Add radio static' };
    const { wav: directSolo, interpretation } = await runJob('audition', {
      ...request, solo: track, variations: [direct], interpretPrompt: true,
    }, () => assert.fail('A recognized edit should skip Liquid'), options);
    assert.equal(interpretation, undefined);
    assert.deepEqual(directSolo, interpretedSolo);
    await assert.rejects(runJob('audition', { ...request, solo: track, interpretPrompt: true,
      variations: [{ ...direct, prompt: 'Make the pitch more static, with less melodic movement' }],
    }, () => assert.fail('Pitch movement should not be interpreted as radio noise'), options), /Less pitch movement/);

    const { wav: mix } = await runJob('audition', request, undefined, options);
    const edited = await runJob('render-edit', request, undefined, options);
    files.push(...edited.files);
    assert.deepEqual(await readFile(join(outputDirectory, edited.filename)), mix);
    const score = JSON.parse(await readFile(join(outputDirectory, edited.files[1])));
    assert.deepEqual(score.partVariation.changes, [variation]);
    assert.deepEqual(score.lead, original.lead.map((event) => ({ ...event, radioStatic: true })));
    assert.deepEqual({ ...score, lead: original.lead, partVariation: undefined }, { ...original, partVariation: undefined });
    assert.throws(() => applyPartVariations(original, [{ ...variation, track: 'drum:kick' }]), /Invalid Liquid edit/);
    assert.throws(() => applyPartVariations(original, [{ ...variation, interpretation: 'change_everything' }]), /Invalid Liquid edit/);
  } finally {
    await Promise.all(files.map((file) => rm(join(outputDirectory, file), { force: true })));
  }
});

test('worker reports a result and handles engine validation failures', async () => {
  async function run(request) {
    const messages = [];
    const worker = new Worker(new URL('../desktop/worker.js', import.meta.url), { workerData: { action: 'preview', request } });
    await new Promise((resolve, reject) => {
      worker.on('message', (message) => messages.push(message));
      worker.on('error', reject);
      worker.on('exit', (code) => code === 0 ? resolve() : reject(new Error('Exit ' + code)));
    });
    return messages;
  }
  assert.equal((await run({ prompt })).at(-1).result.summary.bpm, 240);
  assert.match((await run({ prompt: 'house 999bpm' })).at(-1).error, /BPM/);
});

test('packaged workers export into the configured writable folder', async () => {
  await mkdir(outputDirectory, { recursive: true });
  const directory = await mkdtemp(join(outputDirectory, '.verify-desktop-destination-'));
  try {
    const worker = new Worker(new URL('../desktop/worker.js', import.meta.url), {
      env: { ...process.env, LOCAL_BEATS_OUTPUT_DIR: directory },
      workerData: { action: 'generate', request: { prompt, output: 'relocated.wav' } },
    });
    let result, error;
    worker.on('message', (message) => { if (message.result) result = message.result; if (message.error) error = message.error; });
    await new Promise((resolve, reject) => {
      worker.on('error', reject);
      worker.on('exit', (code) => code === 0 ? resolve() : reject(new Error('Exit ' + code)));
    });
    assert.equal(error, undefined);
    assert.equal(result.filename, 'relocated.wav');
    assert.equal((await readFile(join(directory, 'relocated.wav'))).toString('ascii', 0, 4), 'RIFF');
    assert.equal(JSON.parse(await readFile(join(directory, 'relocated.json'), 'utf8')).config.bars, 8);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('first launch remembers the chosen folder, re-prompts if moved, and respects cancellation', async () => {
  await mkdir(outputDirectory, { recursive: true });
  const directory = await mkdtemp(join(outputDirectory, '.verify-desktop-preferences-'));
  const settings = join(directory, 'settings'), audio = join(directory, 'my-beats');
  await mkdir(audio);
  try {
    assert.equal(await chooseOutputDirectory(settings, async () => audio), join(audio, 'generated_beats'));
    assert.equal(await chooseOutputDirectory(settings, async () => assert.fail('Must reuse saved choice')), join(audio, 'generated_beats'));
    await rm(audio, { recursive: true });
    assert.equal(await chooseOutputDirectory(settings, async () => null), null);
    assert.equal(await chooseOutputDirectory(settings, async () => directory), join(directory, 'generated_beats'));
    await assert.rejects(chooseOutputDirectory(join(directory, 'new-settings'), async () => 'relative-folder'), /available folder/);
    await writeFile(join(settings, 'settings.json'), '{broken');
    assert.equal(await chooseOutputDirectory(settings, async () => null), null);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
