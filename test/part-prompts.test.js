import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compose, renderAudio } from '../src/index.js';
import { tunedHz } from '../src/tuning.js';
import { applyPartVariations, describeEditableScore, describePartParameters, resolvePartPrompt } from '../desktop/score-editor.js';

const original = compose('cloud rap in C minor at 130bpm, 8 bars, lead melody', { seed: 'solo-edit' });
const edit = (prompt, interpretation, source = original, track = 'voice:lead') => {
  const score = structuredClone(source);
  applyPartVariations(score, [{ track, mode: 'prompt', prompt, ...(interpretation && { interpretation }) }]);
  return score;
};
const withoutPitch = (events) => events.map(({ note, frequency, fromNote, fromFrequency, ...event }) => event);

test('Instrument and Key dropdown modes repeat from their seed and keep unrelated parameters', () => {
  const seeded = (mode, seed = 'take-1', track = 'voice:lead') => {
    const score = structuredClone(original);
    const variation = { track, mode, seed };
    applyPartVariations(score, [variation]);
    score.partVariation = { source: 'source.wav', changes: [variation] };
    return score;
  };
  const sound = seeded('sound');
  assert.notEqual(sound.lead[0].profile, original.lead[0].profile);
  assert.deepEqual(sound.lead.map(({ profile, ...event }) => event), original.lead.map(({ profile, ...event }) => event));
  const key = seeded('key');
  assert.notEqual(key.partKeys['voice:lead'].root, original.config.root);
  assert.deepEqual(withoutPitch(key.lead), withoutPitch(original.lead));
  assert.deepEqual({ ...key, lead: original.lead, partKeys: undefined, partVariation: undefined }, { ...original, partKeys: undefined, partVariation: undefined });
  for (const [mode, score] of [['sound', sound], ['key', key]]) {
    assert.deepEqual(seeded(mode), score);
    const track = describeEditableScore(score).tracks.find(({ id }) => id === 'voice:lead');
    assert.equal(track.savedMode, mode);
    assert.equal(track.savedSeed, 'take-1');
  }
  assert.ok(new Set(Array.from({ length: 12 }, (_, i) => seeded('key', 'take-' + i).partKeys['voice:lead'].root)).size > 1);
  assert.throws(() => seeded('key', 'take-1', 'drum:hat'), /pitched part/);
});

test('solo key prompts transpose only the selected part and replay deterministically', async () => {
  const score = edit('Now change the key only');
  assert.notEqual(score.partKeys['voice:lead'].root, original.config.root);
  assert.notDeepEqual(score.lead, original.lead);
  assert.deepEqual(withoutPitch(score.lead), withoutPitch(original.lead));
  assert.deepEqual({ ...score, lead: original.lead, partKeys: undefined }, { ...original, partKeys: undefined });
  assert.deepEqual(score, edit('Now change the key only'));
  assert.equal(await resolvePartPrompt(original, { track: 'voice:lead', mode: 'prompt', prompt: 'Now change the key only' },
    () => assert.fail('Explicit keys do not need inference')), undefined);
  assert.throws(() => edit('change the key only', undefined, original, 'drum:hat'), /pitched part/);
});

test('target keys map mode, accidentals, slide endpoints and tuning; saved part keys support later edits', () => {
  const source = structuredClone(original);
  Object.assign(source.lead[0], { note: 63, fromNote: 60, frequency: tunedHz(63, source.config.tuning), fromFrequency: tunedHz(60, source.config.tuning) });
  const score = edit('Change the key to D major', undefined, source);
  assert.equal(score.lead[0].note, 66);
  assert.equal(score.lead[0].fromNote, 62);
  assert.equal(score.lead[0].frequency, tunedHz(66, source.config.tuning, 62));
  assert.equal(score.lead[0].fromFrequency, tunedHz(62, source.config.tuning, 62));
  assert.deepEqual(withoutPitch(score.lead), withoutPitch(source.lead));
  assert.equal(edit('in B flat minor').partKeys['voice:lead'].root, 10);
  assert.equal(edit('in Cb minor').partKeys['voice:lead'].root, 11);
  assert.equal(edit('in F# minor').partKeys['voice:lead'].root, 6);
  const next = edit('Change key to E', undefined, score);
  assert.equal(next.partKeys['voice:lead'].scale, 'major');
  assert.equal(next.lead[0].note, 68);
  assert.throws(() => edit('in D minor and in E major'), /one target key/);
});

test('instrument prompts work across roles and preserve notes and timing', () => {
  for (const prompt of ['Use a piano', 'Change the instrument to a piano']) {
    const score = edit(prompt);
    assert.ok(score.lead.every((event) => event.profile === 'acoustic_piano'));
    assert.deepEqual(score.lead.map(({ profile, ...event }) => event), original.lead.map(({ profile, ...event }) => event));
    assert.deepEqual({ ...score, lead: original.lead }, original);
    assert.notDeepEqual(renderAudio(score, { sampleRate: 8000 }), renderAudio(original, { sampleRate: 8000 }));
  }
  const source = compose('deep house, 8 bars', { parts: [{ name: 'reply', profile: 'clarinet' }] });
  const score = edit('use a violin', undefined, source, 'part:reply');
  assert.equal(score.parts.find((part) => part.name === 'reply').profile, 'fiddle');
  const different = edit('change the instrument only');
  assert.notEqual(different.lead[0].profile, original.lead[0].profile);
  assert.deepEqual(withoutPitch(different.lead).map(({ profile, ...e }) => e), withoutPitch(original.lead).map(({ profile, ...e }) => e));
});

test('bounded Liquid instrument and key choices replay through the same part editor', () => {
  const instrument = edit('Give it a brassy character', 'instrument_trumpet');
  assert.ok(instrument.lead.every((event) => event.profile === 'trumpet'));
  assert.deepEqual(describePartParameters(instrument, 'voice:lead'), {
    instrument: 'trumpet', key: { root: 0, rootName: 'C', scale: 'minor' },
  });
  const key = edit('Shift its tonality somewhere else', 'change_key');
  assert.notEqual(key.partKeys['voice:lead'].root, original.config.root);
  assert.deepEqual(withoutPitch(key.lead), withoutPitch(original.lead));
  assert.throws(() => edit('Give it a brassy character', 'instrument_unknown'), /Invalid Liquid edit/);
});
