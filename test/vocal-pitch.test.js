import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { compose, pitchVocalSamples, estimateVocalPitch, renderAudio } from '../src/index.js';
import { resolveVocalPitch } from '../src/vocal-pitch.js';
import { random } from '../src/random.js';

const sampleRate = 8000;
const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0;
function tone(hz = 220) { return Float32Array.from({ length: sampleRate }, (_, i) => .45 * Math.sin(2 * Math.PI * hz * i / sampleRate)); }
function bank(audio = tone()) { return { sampleRate, voice: 'Fred', sources: { 'word:move': audio, 'phrase:0': audio }, hashes: { original: 'test-tone' } }; }
function score(options = {}) { return compose('house in F minor 125bpm', { lyrics: 'move', voice: 'fred', vocalSection: 'drop', ...options }); }
const closePitch = (actual, expected) => assert.ok(Math.abs(actual / expected - 1) < .01, actual + ' differs from ' + expected);

test('pitch options validate before rendering and normalize notes and ranges', () => {
  assert.deepEqual(score({ vocalPitch: -5 }).vocals.pitch, { mode: 'shift', semitones: -5 });
  assert.deepEqual(score({ vocalNote: 'Bb3' }).vocals.pitch, { mode: 'note', note: 'A#3', midi: 58 });
  assert.deepEqual(score({ vocalNote: 'root' }).vocals.pitch, { mode: 'root', pitchClass: 5 });
  assert.equal(score({ vocalRange: 'C3:C4' }).vocals.pitch.lowMidi, 48);
  for (const options of [{ vocalPitch: 25 }, { vocalPitch: -25 }, { vocalPitch: '' }, { vocalPitch: 'NaN' }, { vocalPitch: null },
    { vocalNote: 'H3' }, { vocalNote: 'C1' }, { vocalNote: 'B6' }, { vocalRange: 'C4:C3' }, { vocalRange: 'high' },
    { vocalPitch: 0, vocalNote: 'F3' }, { vocalNote: 'F3', vocalRange: 'C3:C4' }]) assert.throws(() => score(options));
  assert.throws(() => compose('house', { vocalPitch: 5 }), /lyrics/);
  const { pitch, ...pitchedPlan } = score({ vocalPitch: 5 }).vocals;
  assert.deepEqual(pitchedPlan, score().vocals, 'Pitch settings must not change vocal placement.');
});

test('voiced pitch estimation distinguishes periodic tones from silence and noise', () => {
  for (const hz of [100, 180, 220, 440]) closePitch(estimateVocalPitch({ 'word:move': tone(hz) }, sampleRate).hz, hz);
  assert.equal(estimateVocalPitch({ 'word:move': new Float32Array(sampleRate) }, sampleRate), null);
  const rng = random(42, 'pitch-noise');
  const noise = Float32Array.from({ length: sampleRate }, () => (rng() * 2 - 1) * .3);
  assert.equal(estimateVocalPitch({ 'word:move': noise }, sampleRate), null);
  assert.throws(() => resolveVocalPitch({ mode: 'note', midi: 60 }, { 'word:move': noise }, sampleRate), /No stable voiced pitch/);
  assert.equal(resolveVocalPitch({ mode: 'shift', semitones: 5 }, { 'word:move': noise }, sampleRate).appliedSemitones, 5);
});

test('zero and omitted pitch preserve original buffers without FFmpeg', async () => {
  const samples = bank(), saved = process.env.PATH;
  try {
    process.env.PATH = '';
    assert.equal(await pitchVocalSamples(score(), samples), samples);
    const unchanged = await pitchVocalSamples(score({ vocalPitch: 0 }), samples);
    assert.equal(unchanged.sources, samples.sources);
    assert.equal(unchanged.hashes, samples.hashes);
    assert.equal(unchanged.pitch.appliedSemitones, 0);
  } finally { process.env.PATH = saved; }
});

test('real transposition changes measured frequency and keeps exact word/phrase lengths', { skip: !hasFfmpeg }, async () => {
  const original = bank();
  for (const semitones of [-24, -12, 5, 12, 24]) {
    const shifted = await pitchVocalSamples(score({ vocalPitch: semitones }), original);
    for (const [key, audio] of Object.entries(shifted.sources)) {
      assert.equal(audio.length, original.sources[key].length);
      assert.ok(audio.every((sample) => Number.isFinite(sample) && Math.abs(sample) <= .951));
      assert.ok(audio.some((sample) => Math.abs(sample) > .1));
    }
    if (Math.abs(semitones) < 24) closePitch(estimateVocalPitch(shifted.sources, sampleRate).hz, 220 * 2 ** (semitones / 12));
    assert.equal(shifted.pitch.durationPreserved, true);
    assert.deepEqual(shifted.sources['phrase:0'], shifted.sources['word:move']);
  }
  const a = await pitchVocalSamples(score({ vocalPitch: 5 }), original);
  const b = await pitchVocalSamples(score({ vocalPitch: 5 }), original);
  assert.deepEqual(a.sources, b.sources);
  assert.notDeepEqual(a.sources['word:move'], original.sources['word:move']);
  assert.equal(original.pitch, undefined);
});

test('note, root and register modes move the measured pitch center', { skip: !hasFfmpeg }, async () => {
  for (const [option, expected] of [[{ vocalNote: 'F3' }, 174.6141], [{ vocalNote: 'root' }, 174.6141], [{ vocalRange: 'C4:C5' }, 261.6256 * 2 ** (.5 / 12)]]) {
    const shifted = await pitchVocalSamples(score(option), bank());
    closePitch(estimateVocalPitch(shifted.sources, sampleRate).hz, expected);
    assert.ok(shifted.pitch.voicedFrames >= 3);
  }
  const original = bank();
  const alreadyInside = await pitchVocalSamples(score({ vocalRange: 'A2:A4' }), original);
  assert.equal(alreadyInside.sources, original.sources);
});

test('pitch metadata reaches the renderer and mismatched or twice-shifted banks fail', { skip: !hasFfmpeg }, async () => {
  const s = score({ vocalPitch: 5 }), samples = bank();
  assert.throws(() => renderAudio(s, { sampleRate, vocalSamples: samples, voices: ['vocals'] }), /pitch does not match/);
  const shifted = await pitchVocalSamples(s, samples);
  const audio = renderAudio(s, { sampleRate, vocalSamples: shifted, voices: ['vocals'] });
  assert.ok(audio.stats.rms > .01);
  await assert.rejects(pitchVocalSamples(s, shifted), /unprocessed/);
  assert.throws(() => renderAudio(score(), { sampleRate, vocalSamples: shifted, voices: ['vocals'] }), /pitch does not match/);
  const different = score({ vocalPitch: 12 });
  assert.throws(() => renderAudio(different, { sampleRate, vocalSamples: shifted, voices: ['vocals'] }), /pitch does not match/);
});

test('CLI dry-run includes pitch settings without starting speech or DSP', () => {
  const run = (args) => spawnSync(process.execPath, ['bin/makebeats.js', 'house in F minor', '--lyrics', 'move', ...args, '--dry-run'], { cwd: fileURLToPath(new URL('../', import.meta.url)), encoding: 'utf8', maxBuffer: 4e6 });
  const shifted = run(['--voice', 'samantha', '--vocal-pitch=-5']);
  assert.equal(shifted.status, 0, shifted.stderr);
  assert.equal(JSON.parse(shifted.stdout).vocals.pitch.semitones, -5);
  assert.equal(JSON.parse(shifted.stdout).vocals.voice, 'Samantha');
  assert.equal(run(['--vocal-note', 'F3', '--vocal-pitch', '5']).status, 1);
});
