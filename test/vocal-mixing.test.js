import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { planVocalMix, alignBacking, VOCAL_MIX_DEFAULTS } from '../scripts/lib/vocal-mixing.js';
import { mixExternalVocal } from '../scripts/lib/vocal-remix.js';

const analysis = {
  tempo_and_key_estimates: { bpm: 120, key: 'C Minor' },
  excerpt: { offset_seconds: 30, duration_seconds: 8 },
  estimated_beat_times_seconds: [30.2, 30.7, 31.2],
  semantic: { delivery: [{ label: 'rap' }], themes: [{ label: 'confidence' }] },
};

test('vocal backing uses measured tempo/key, explicit phase, and replayable score', () => {
  const a = planVocalMix(analysis, { seed: 'check' });
  assert.equal(a.bpm, 120);
  assert.equal(a.score.config.root, 0);
  assert.equal(a.score.config.scale, 'minor');
  assert.equal(a.score.config.intent, 'trap_halftime');
  assert(Math.abs(a.grid_offset_seconds - .2) < 1e-10);
  assert.equal(a.score.lead.length, 0);
  assert.equal(a.score.vocals, undefined);
  assert.deepEqual(a.score, planVocalMix(analysis, { seed: 'check' }).score);
  const b = planVocalMix(analysis, { bpm: 60, key: 'F# major', gridOffset: .1, prompt: 'lofi' });
  assert.equal(b.score.config.bpm, 60);
  assert.equal(b.score.config.root, 6);
  assert.equal(b.score.config.scale, 'major');
  assert.equal(b.grid_offset_seconds, .1);
  assert.equal(b.tempo_source, 'CLI override');
  assert.throws(() => planVocalMix(analysis, { gridOffset: .5 }), /one beat/);
  assert.throws(() => planVocalMix(analysis, { key: 'Unknown' }), /Key is undetermined/);
  assert.throws(() => planVocalMix(analysis, { bpm: 0 }), /Tempo is undetermined/);
  assert.throws(() => planVocalMix(analysis, { prompt: 'jazz in 3/4' }), /4\/4/);
});

test('alignment moves only backing samples and neither mutates nor shifts source vocals', () => {
  const pcm = Buffer.alloc(16 * 4);
  pcm.writeInt16LE(1234, 0); pcm.writeInt16LE(-5678, 2);
  const source = Buffer.from(pcm);
  const music = { pcm, frames: 16, sampleRate: 44100, channels: 2 };
  const result = alignBacking(music, 12, 2 / 44100);
  assert.equal(result.frames, 12);
  assert.equal(result.pcm.readInt32LE(0), 0);
  assert.equal(result.pcm.readInt16LE(8), 1234);
  assert.equal(result.pcm.readInt16LE(10), -5678);
  assert.deepEqual(pcm, source);
  assert.throws(() => alignBacking(music, 20, 0), /cover/);
});

test('preview defaults keep a midrange backing audible alongside a loud vocal', () => {
  const frames = 4 * 44100, vocal = Buffer.alloc(frames * 4);
  const music = { sampleRate: 44100, channels: 2, frames, pcm: Buffer.alloc(frames * 4) };
  for (let i = 0; i < frames; i++) for (let side = 0; side < 2; side++) {
    music.pcm.writeInt16LE(Math.round(10000 * Math.sin(2 * Math.PI * 900 * i / 44100)), i * 4 + side * 2);
    vocal.writeInt16LE(Math.round(7000 * Math.sin(2 * Math.PI * 2300 * i / 44100)), i * 4 + side * 2);
  }
  const mixed = mixExternalVocal(music, vocal, VOCAL_MIX_DEFAULTS);
  let vocalEnergy = 0, backingEnergy = 0;
  for (let i = 0; i < vocal.length; i += 2) {
    const voice = vocal.readInt16LE(i) * mixed.mix.vocalGain;
    const backing = mixed.pcm.readInt16LE(i) - voice;
    vocalEnergy += voice ** 2; backingEnergy += backing ** 2;
  }
  assert(backingEnergy >= vocalEnergy, 'The backing is masked by the vocal at the default balance');
  assert(mixed.stats.peak <= .781);
});

test('CLI help and bad options require no models and cannot escape the output folder', () => {
  const cli = fileURLToPath(new URL('../bin/vocalmix.js', import.meta.url));
  const input = fileURLToPath(new URL('../package.json', import.meta.url));
  const run = args => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
  assert.equal(run(['--help']).status, 0);
  assert.notEqual(run([]).status, 0);
  for (const [args, error] of [
    [['--seconds', 'NaN'], /seconds between/],
    [['--offset', '-1'], /nonnegative/],
    [['--output', '../escape'], /simple folder/],
    [['--vocal-db', '2'], /vocal-db/],
    [['--bpm', 'NaN'], /bpm 40/],
  ]) assert.match(run([input, ...args]).stderr, error);
});
