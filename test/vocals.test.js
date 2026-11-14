import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { compose, renderAudio, prepareVocalSamples, MACOS_VOICES, archetypes } from '../src/index.js';
import { mixVocals } from '../src/vocals.js';

const lyrics = 'Move your body. Feel the rhythm. Stay with me.';
const options = { lyrics, hook: 'Move your body', seed: 42, vocalDensity: 1, vocalChops: 1 };
const digest = (b) => createHash('sha256').update(b).digest('hex');
function fixtures(score, sampleRate = 8000) {
  const sources = {};
  for (const event of score.vocals.events) sources[event.source] = Float32Array.from({ length: sampleRate / 4 }, (_, i) => .6 * Math.sin(2 * Math.PI * 220 * i / sampleRate));
  return { sampleRate, voice: score.vocals.voice, sources };
}

test('vocal arrangement is repeatable, varies by seed, and preserves every instrument', () => {
  const score = compose('house', options);
  assert.deepEqual(score, compose('house', options));
  assert.notDeepEqual(score.vocals.events, compose('house', { ...options, seed: 43 }).vocals.events);
  const instrumental = compose('house', { seed: 42 });
  const { vocals, ...rest } = score;
  assert.deepEqual(rest, instrumental);
  assert.equal(vocals.phrases[vocals.hookIndex], 'move your body');
  assert.ok(vocals.events.some((e) => e.kind === 'chop'));
  assert.ok(vocals.events.some((e) => e.kind === 'stutter'));
  assert.ok(new Set(vocals.events.filter((e) => e.section === 'verse').map((e) => e.source)).size > 1);
});

test('section schedules stay monophonic, inside sections, and clear the pre-drop beat', () => {
  for (const bpm of [40, 125, 240]) for (const every of [1, 2, 4, 8]) {
    const score = compose('house ' + bpm + 'bpm', { ...options, sauce: 1, vocalEvery: every });
    const events = score.vocals.events;
    for (const [i, event] of events.entries()) {
      const section = score.sections.find((s) => s.name === event.section && event.bar >= s.start && event.bar < s.end);
      assert.ok(event.time >= section.start * 16 * score.config.stepSeconds);
      assert.ok(event.time + event.duration <= section.end * 16 * score.config.stepSeconds + 1e-9);
      assert.ok(event.time + event.duration <= score.config.duration + 1e-9);
      const gapStart = 316 * score.config.stepSeconds, gapEnd = 320 * score.config.stepSeconds;
      assert.ok(event.time >= gapEnd || event.time + event.duration <= gapStart + 1e-9);
      if (i) assert.ok(events[i - 1].time + events[i - 1].duration <= event.time + 1e-9);
    }
  }
});

test('density, chop, section, repeat, and off controls affect the actual schedule', () => {
  assert.equal(compose('house', { ...options, vocalDensity: 0 }).vocals.events.length, 0);
  assert.ok(compose('house', { ...options, vocalChops: 0 }).vocals.events.every((e) => !['chop', 'stutter'].includes(e.kind)));
  for (const section of ['intro', 'verse', 'breakdown', 'build', 'drop', 'outro']) {
    const score = compose('house', { ...options, vocalSection: section });
    assert.ok(score.vocals.events.length > 0);
    assert.ok(score.vocals.events.every((e) => e.section === section));
  }
  const four = compose('house', { ...options, vocalSection: 'drop', vocalEvery: 4 });
  const two = compose('house', { ...options, vocalSection: 'drop', vocalEvery: 2 });
  assert.deepEqual(four.vocals.events.filter((e) => e.kind === 'phrase').map((e) => e.bar), [20, 24]);
  assert.deepEqual(two.vocals.events.filter((e) => e.kind === 'phrase').map((e) => e.bar), [20, 22, 24, 26]);
  assert.equal(compose('house', { ...options, vocals: 'off' }).vocals, undefined);
});

test('invalid vocal options fail before speech or file creation', () => {
  for (const bad of [{ lyrics: '' }, { vocals: 'auto' }, { lyrics: '???' }, { hook: 'hello' }, { lyrics, voice: 'unknown' }, { lyrics, voice: 'constructor' }, { lyrics, voice: '__proto__' },
    { lyrics, vocalDensity: '' }, { lyrics, vocalChops: -1 }, { lyrics, vocalDensity: 'NaN' },
    { lyrics, vocalEvery: 3 }, { lyrics, vocalSection: 'unknown' }, { lyrics: 'é' }, { lyrics, hook: '???' },
    { lyrics: 'a'.repeat(1201) }, { lyrics: Array(34).fill('hello').join(' ') }]) {
    assert.throws(() => compose('house', bad), undefined, JSON.stringify(bad));
  }
});

test('vocal samples reach PCM, honor solo/mute, and share full-mix air silence', () => {
  const score = compose('house 125bpm', { ...options, sauce: 1 });
  const samples = fixtures(score);
  assert.throws(() => renderAudio(score, { sampleRate: 8000 }), /Prepare vocal samples/);
  assert.throws(() => renderAudio(score, { sampleRate: 8000, vocalSamples: { ...samples, sampleRate: 44100 } }), /sample rate/);
  assert.throws(() => renderAudio(score, { sampleRate: 8000, vocalSamples: { ...samples, voice: 'Ralph' } }), /voice does not match/);
  const audio = renderAudio(score, { sampleRate: 8000, vocalSamples: samples });
  assert.equal(digest(audio.pcm), digest(renderAudio(score, { sampleRate: 8000, vocalSamples: samples }).pcm));
  const instrumental = renderAudio(compose('house 125bpm', { seed: 42, sauce: 1 }), { sampleRate: 8000 });
  const muted = renderAudio(score, { sampleRate: 8000, voices: ['kick', 'snare', 'hat', 'tom', 'keys', 'bass', 'lead', 'arp'] });
  assert.equal(digest(muted.pcm), digest(instrumental.pcm));
  assert.notEqual(digest(audio.pcm), digest(instrumental.pcm));
  const solo = renderAudio(score, { sampleRate: 8000, vocalSamples: samples, voices: ['vocals'] });
  assert.ok(solo.stats.rms > .005);
  assert.ok(audio.stats.peak <= .81);
  for (const rendered of [audio, solo]) {
    assert.ok(rendered.pcm.subarray(Math.round(316 * score.config.stepSeconds * 8000) * 4, Math.round(320 * score.config.stepSeconds * 8000) * 4).every((b) => b === 0));
  }
  // Vocal tails obey the gap even without a full-mix air automation event.
  const dryGap = compose('house 125bpm', { ...options, sauce: 0 });
  const isolated = renderAudio(dryGap, { sampleRate: 8000, vocalSamples: fixtures(dryGap), voices: ['vocals'] });
  assert.ok(isolated.pcm.subarray(Math.round(316 * dryGap.config.stepSeconds * 8000) * 4, Math.round(320 * dryGap.config.stepSeconds * 8000) * 4).every((b) => b === 0));
});

test('chops read real sample content, fade their edges, and long phrases fail clearly', () => {
  const plan = { stepSeconds: .125, events: [{ source: 'word:move', kind: 'chop', time: 0, duration: .05, velocity: 1 }] };
  const left = new Float32Array(800), right = left.slice();
  mixVocals(plan, { sampleRate: 8000, sources: { 'word:move': new Float32Array(800).fill(.5) } }, left, right, 8000);
  assert.equal(left[0], 0); assert.ok(left[100] > .2); assert.equal(left[399], 0); assert.equal(left[500], 0);
  plan.events[0].kind = 'phrase';
  assert.throws(() => mixVocals(plan, { sampleRate: 8000, sources: { 'word:move': new Float32Array(8000) } }, left, right, 8000), /too long/);
});

test('CLI dry-run exposes vocal decisions without synthesizing speech', () => {
  const run = (args) => spawnSync(process.execPath, ['bin/makebeats.js', ...args], { cwd: fileURLToPath(new URL('../', import.meta.url)), encoding: 'utf8', maxBuffer: 4e6 });
  const result = run(['house', '--lyrics', lyrics, '--hook', 'stay with me', '--vocal-section', 'drop', '--vocal-every', '2', '--vocal-chops', '0', '--dry-run']);
  assert.equal(result.status, 0, result.stderr);
  const plan = JSON.parse(result.stdout).vocals;
  assert.equal(plan.phrases[plan.hookIndex], 'stay with me');
  assert.ok(plan.events.every((e) => e.section === 'drop' && e.kind === 'phrase'));
  for (const args of [['house', '--vocals', 'auto'], ['house', '--lyrics', lyrics, '--vocal-density', '2']]) assert.notEqual(run(args).status, 0);
});

test('native speech synthesis produces cached word/phrase audio and cleans temporary files', { skip: process.platform !== 'darwin' || spawnSync('ffmpeg', ['-version']).status !== 0 }, async () => {
  const score = compose('house', { lyrics: 'Move your body.', seed: 42, vocalSection: 'drop', vocalDensity: 1, vocalChops: 1 });
  const samples = await prepareVocalSamples(score, { sampleRate: 8000 });
  assert.equal(Object.keys(samples.hashes).filter((k) => k.startsWith('word:')).length, 3);
  assert.ok(samples.sources['phrase:0'].length > 8000 / 2);
  const audio = renderAudio(score, { sampleRate: 8000, vocalSamples: samples, voices: ['vocals'] });
  assert.ok(audio.stats.rms > .01);
  assert.ok(!(await readdir(fileURLToPath(new URL('../generated_beats/', import.meta.url)))).some((p) => p.startsWith('.speech-')));
  const saved = process.env.PATH;
  try {
    process.env.PATH = '';
    await assert.rejects(prepareVocalSamples(score, { sampleRate: 8000 }), /ffmpeg is required/);
  } finally { process.env.PATH = saved; }
  assert.ok(!(await readdir(fileURLToPath(new URL('../generated_beats/', import.meta.url)))).some((p) => p.startsWith('.speech-')));
});


test('native voice selection is case-insensitive and preserves vocal placement', () => {
  const baseline = compose('house', options).vocals;
  for (const [name, canonical] of Object.entries(MACOS_VOICES)) {
    const plan = compose('house', { ...options, voice: name.toUpperCase() }).vocals;
    assert.equal(plan.voice, canonical);
    assert.deepEqual(plan.events, baseline.events);
  }
  const result = spawnSync(process.execPath, ['bin/makebeats.js', 'house', '--lyrics', 'move', '--voice', 'fred', '--dry-run'], { cwd: fileURLToPath(new URL('../', import.meta.url)), encoding: 'utf8', maxBuffer: 4e6 });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).vocals.voice, 'Fred');
});

test('other installed macOS voices produce distinct audible speech', { skip: process.platform !== 'darwin' || spawnSync('ffmpeg', ['-version']).status !== 0 }, async () => {
  const hashes = new Set();
  const voices = Object.keys(MACOS_VOICES).filter((name) => name !== 'zarvox');
  for (const voice of voices) {
    const score = compose('house', { lyrics: 'Move.', voice, vocalSection: 'drop' });
    const samples = await prepareVocalSamples(score, { sampleRate: 8000 });
    assert.equal(samples.voice, MACOS_VOICES[voice]);
    assert.ok(samples.sources['word:move'].some((sample) => Math.abs(sample) > .01));
    hashes.add(samples.hashes['word:move']);
  }
  assert.equal(hashes.size, voices.length);
});


const stylePrompts = ['UK garage', 'footwork', 'jersey club', 'amapiano', 'drill', 'baile funk', 'synthwave', 'IDM glitch', 'lofi chill', 'house', '80s synth pop', 'industrial bass', 'dubstep'];

test('all existing genres preserve vocal boundaries for every supported voice', () => {
  for (const prompt of stylePrompts) for (const voice of Object.keys(MACOS_VOICES)) for (const bpm of [40, 240]) {
    const score = compose(prompt + ' ' + bpm + 'bpm', { ...options, voice, sauce: 1 });
    const gapStart = 316 * score.config.stepSeconds, gapEnd = 320 * score.config.stepSeconds;
    const events = score.vocals.events;
    assert.ok(events.length > 0);
    for (let i = 0; i < events.length; i++) {
      const event = events[i];
      assert.ok(event.duration > 0 && Number.isFinite(event.duration));
      assert.ok(event.time >= 0 && event.time + event.duration <= score.config.duration + 1e-9);
      assert.ok(event.time >= gapEnd || event.time + event.duration <= gapStart + 1e-9);
      if (i) assert.ok(events[i - 1].time + events[i - 1].duration <= event.time + 1e-9);
    }
    const plain = compose(prompt + ' ' + bpm + 'bpm', { seed: options.seed, sauce: 1 });
    const { vocals, ...instrumental } = score;
    assert.deepEqual(instrumental, plain);
  }
});

test('all existing genres mix vocals and preserve sample-exact pre-drop silence', () => {
  const voices = Object.keys(MACOS_VOICES);
  for (const [i, prompt] of stylePrompts.entries()) {
    const score = compose(prompt + ' 137bpm', { ...options, voice: voices[i % voices.length], sauce: 1 });
    const samples = fixtures(score);
    const audio = renderAudio(score, { sampleRate: 8000, vocalSamples: samples });
    assert.ok(Number.isFinite(audio.stats.rms) && audio.stats.rms > .01, prompt);
    assert.ok(audio.stats.peak <= .81, prompt);
    const begin = Math.round(316 * score.config.stepSeconds * 8000) * 4;
    const end = Math.round(320 * score.config.stepSeconds * 8000) * 4;
    assert.ok(audio.pcm.subarray(begin, end).every((byte) => byte === 0), prompt);
  }
});

test('word buffers retain apostrophes and hyphens without interpreting speech markup', () => {
  const score = compose('house', { ...options, lyrics: "Don't stop. Bass-line 808. [[rate 999]] move.", hook: "Don't stop" });
  assert.ok(score.vocals.words.includes("don't"));
  assert.ok(score.vocals.words.includes('bass-line'));
  assert.ok(score.vocals.words.includes('808'));
  assert.ok(score.vocals.words.every((word) => /^[a-z0-9]+(?:['-][a-z0-9]+)*$/.test(word)));
  assert.ok(!score.vocals.phrases.some((phrase) => phrase.includes('[[')));
});


test('all v1.6 presets preserve vocal boundaries in every supported meter', () => {
  for (const style of Object.values(archetypes)) for (const meter of ['3/4', '4/4', '5/4', '7/4', '6/8', '7/8', '9/8', '12/8']) for (const every of [1, 4]) {
    const prompt = `${style.aliases[0]} ${meter} at 240bpm`;
    const score = compose(prompt, { ...options, sauce: 1, vocalEvery: every });
    const n = score.config.stepsPerBar, stepSeconds = score.config.stepSeconds;
    const drop = (score.sections.find((s) => s.name === 'drop')?.start ?? Infinity) * n;
    const events = score.vocals.events;
    assert.ok(events.length > 0, prompt);
    for (const [i, event] of events.entries()) {
      const section = score.sections.find((s) => s.name === event.section && event.bar >= s.start && event.bar < s.end);
      assert.equal(event.bar, Math.floor(event.step / n));
      assert.ok(event.time >= section.start * n * stepSeconds, prompt);
      assert.ok(event.time + event.duration <= section.end * n * stepSeconds + 1e-9, prompt);
      assert.ok(event.time >= drop * stepSeconds || event.time + event.duration <= (drop - 4) * stepSeconds + 1e-9, prompt);
      assert.ok(event.duration > 0 && Number.isFinite(event.duration), prompt);
      if (i) assert.ok(events[i - 1].time + events[i - 1].duration <= event.time + 1e-9, prompt);
    }
    const { vocals, ...instrumental } = score;
    assert.deepEqual(instrumental, compose(prompt, { seed: options.seed, sauce: 1 }), prompt);
  }
});

test('vocals and added percussion render together in compound and odd meters', () => {
  for (const prompt of ['reggaeton 7/8', 'psytrance 12/8', 'country 3/4']) {
    const score = compose(prompt, { ...options, sauce: 1 });
    const audio = renderAudio(score, { sampleRate: 8000, vocalSamples: fixtures(score) });
    assert.equal(audio.frames, Math.round(score.config.duration * 8000));
    assert.ok(Number.isFinite(audio.stats.rms) && audio.stats.rms > .01, prompt);
    const n = score.config.stepsPerBar;
    const solo = renderAudio(score, { sampleRate: 8000, vocalSamples: fixtures(score), voices: ['vocals'] });
    const start = Math.round((20 * n - 4) * score.config.stepSeconds * 8000) * 4;
    const end = Math.round(20 * n * score.config.stepSeconds * 8000) * 4;
    assert.ok(solo.pcm.subarray(start, end).every((byte) => byte === 0), prompt);
  }
});
