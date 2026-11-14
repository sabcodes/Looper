import test from 'node:test';
import assert from 'node:assert/strict';
import { compose, renderAudio } from '../src/index.js';
import { random } from '../src/random.js';
import { instrumentVoice } from '../src/instruments.js';
import { validateEditableScore } from '../desktop/score-editor.js';
import { chooseWithLiquid } from '../desktop/liquid.js';

const score = () => compose('classical with acoustic guitar, 8 bars at 240bpm', { seed: 'security' });

test('saved scores reject extreme pitches and inverse-frequency allocation inputs', () => {
  const original = score();
  assert.equal(validateEditableScore(original), original);
  for (const change of [
    { note: 1e100 }, { fromNote: -1e100 }, { note: null },
    { frequency: .0001 }, { frequency: -1 }, { frequency: '220' },
    { pitch: -10000 }, { pitch: 10000 },
    { articulation: 'slide', fromNote: 60, fromFrequency: .0001 },
  ]) {
    const malformed = structuredClone(original);
    Object.assign(malformed.keys[0], change);
    assert.throws(() => validateEditableScore(malformed), /pitch|frequenc/i, JSON.stringify(change));
  }
  const invalidKey = structuredClone(original);
  invalidKey.partKeys = { 'voice:keys': { root: 1e100, scale: 'minor' } };
  assert.throws(() => validateEditableScore(invalidKey), /part key/i);
});

test('shared instrument entry rejects unsafe delay parameters before allocation', () => {
  for (const profile of ['acoustic_guitar', 'trumpet', 'electric_guitar', 'bowed_strings', 'gendy']) {
    for (const values of [{ frequency: .0001 }, { note: 1e100 }, { pitch: -10000 },
      { articulation: 'slide', fromNote: 60, fromFrequency: .0001 }]) {
      assert.throws(() => instrumentVoice({ profile, note: 60, ...values }, 44100, random('security')), /pitch|frequenc/i);
    }
  }
  const voice = instrumentVoice({ profile: 'acoustic_guitar', frequency: 220, duration: .1 }, 8000, random('control'));
  assert.ok(Number.isFinite(voice(0)));
});

test('rendering rejects malicious pitch without creating a huge delay line', () => {
  const malformed = score();
  malformed.keys[0].frequency = .0001;
  assert.throws(() => renderAudio(malformed, { sampleRate: 8000 }), /frequenc/i);
  const valid = score();
  const audio = renderAudio(valid, { sampleRate: 8000 });
  assert.ok(audio.pcm.length > 0 && Number.isFinite(audio.stats.peak));
});

test('optional Liquid bridge requires explicit absolute runtime and model paths', async () => {
  const saved = [process.env.LOOPER_LIQUID_PYTHON, process.env.LOOPER_LIQUID_MODEL];
  try {
    process.env.LOOPER_LIQUID_PYTHON = '.venv/bin/python';
    process.env.LOOPER_LIQUID_MODEL = 'models/liquid';
    assert.deepEqual(await chooseWithLiquid({ prompt: 'house', choices: [] }, () => {}), { unavailable: true });
  } finally {
    for (const [index, key] of ['LOOPER_LIQUID_PYTHON', 'LOOPER_LIQUID_MODEL'].entries()) {
      if (saved[index] === undefined) delete process.env[key]; else process.env[key] = saved[index];
    }
  }
});
