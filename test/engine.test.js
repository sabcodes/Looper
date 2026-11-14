import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  compilePrompt, classify, archetypes, corpus, compose, euclidean, swingTime, linearMasks, ratchet,
  minimalVoiceLeading, renderAudio, packWav, duckingGain, glideFrequency,
} from '../src/index.js';
import { random, midiHz } from '../src/random.js';
import { applyAutomation } from '../src/dsp.js';
import { writeAudio, writeJson } from '../src/export.js';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const generated = join(root, 'generated_beats');
const hash = (buffer) => createHash('sha256').update(buffer).digest('hex');
const near = (a, b, epsilon = 1e-9) => assert.ok(Math.abs(a - b) < epsilon, a + ' != ' + b);
let temporary;
async function testDirectory() {
  await mkdir(generated, { recursive: true });
  temporary ??= await mkdtemp(join(generated, '.verify-'));
  return temporary;
}
after(async () => { if (temporary) await rm(temporary, { recursive: true, force: true }); });

const genres = [
  ['uk garage', 'uk_garage_2step'], ['footwork', 'chicago_footwork'], ['jersey club', 'jersey_club'],
  ['amapiano', 'amapiano_log'], ['drill', 'drill_sliding'], ['baile funk', 'baile_funk_tambor'],
  ['synthwave', 'synthwave_retro'], ['idm', 'idm_glitch'], ['lofi', 'lofi_chill'], ['house', 'house_bright'],
];

test('the original ten styles and eighty prompts plus the new sound intents are loaded', () => {
  assert.equal(Object.keys(archetypes).length, 97);
  assert.equal(Object.values(corpus).flat().length, 440);
  let correct = 0;
  for (const [intent, prompts] of Object.entries(corpus)) for (const prompt of prompts) correct += classify(prompt).intent === intent;
  assert.ok(correct / Object.values(corpus).flat().length >= .95, 'Training-corpus consistency below 95% (not a held-out accuracy claim).');
});

test('numeric slots are unit-bound and key/mode are explicit', () => {
  const c = compilePrompt('classic 1999 garage in F minor, 32 bars at 135bpm');
  assert.equal(c.bpm, 135); assert.equal(c.bars, 32); assert.equal(c.root, 5); assert.equal(c.scale, 'minor');
  assert.equal(compilePrompt('classic 1999 garage 32 bars').bpm, 134);
  assert.equal(compilePrompt('house in C# harmonic minor tempo 127').root, 1);
  assert.equal(compilePrompt('house in B♭ major').root, 10);
  assert.equal(compilePrompt('house in f minor').root, 5);
  assert.equal(compilePrompt('make music in a club').rootName, 'C');
});

test('explicit values override genre ranges and mood respects an explicit mode', () => {
  const c = compilePrompt('happy house in F minor 135 bpm');
  assert.equal(c.bpm, 135); assert.equal(c.scale, 'minor'); assert.equal(c.mood, 'bright');
  assert.ok(c.messages.some((m) => m.includes('overrides')));
  assert.equal(compilePrompt('happy drill').scale, 'major');
});

test('boundary validation rejects conflicting/invalid tempos, bars and sauce', () => {
  for (const p of ['house -135bpm', 'house 0bpm', 'house 241bpm', 'house 120bpm 140bpm', 'house 129 bars', 'house -32 bars', 'house in C minor in F minor']) {
    assert.throws(() => compilePrompt(p), undefined, p);
  }
  for (const sauce of [-.1, 1.1, NaN, Infinity, 'no']) assert.throws(() => compilePrompt('house', { sauce }));
  assert.throws(() => compilePrompt(''));
});

test('held-out named prompts resolve all ten styles and vague input falls back', () => {
  for (const [name, id] of genres) assert.equal(classify('compose an unusual ' + name + ' instrumental').intent, id);
  assert.equal(classify('xyzzy quux').intent, 'neutral_groove');
  assert.equal(classify('xyzzy quux').fallback, true);
  assert.equal(classify('2-step').intent, 'uk_garage_2step');
  assert.equal(classify('2step').intent, 'uk_garage_2step');
});

test('separate intent regression cases cover descriptive prompts and genre exclusions', async () => {
  const fixture = JSON.parse(await readFile(join(root, 'data/intent-evaluation.json'), 'utf8'));
  for (const c of fixture.cases) assert.equal(classify(c.prompt).intent, c.expected, c.prompt);
  assert.deepEqual(classify('house without trap or drill influences').excludedIntents, ['drill_sliding', 'trap_halftime']);
  assert.equal(classify('no garage').intent, 'neutral_groove');
  assert.equal(classify('garage without house').intent, 'uk_garage_2step');
  assert.equal(classify('no house or garage, lofi').intent, 'lofi_chill');
  assert.equal(classify('no house').intent, 'neutral_groove');
});

test('analysis CLI help and invalid inputs do not load model dependencies', async () => {
  const input = join(await testDirectory(), 'analysis-input.wav');
  await writeFile(input, packWav({ pcm: Buffer.alloc(8000 * 4), sampleRate: 8000, channels: 2 }));
  const run = (args) => spawnSync(process.execPath, ['bin/analyzebeats.js', ...args], { cwd: root, encoding: 'utf8' });
  assert.equal(run(['--help']).status, 0);
  assert.notEqual(run([]).status, 0);
  assert.match(run([input, '--output', '../escape.json', '--python', process.execPath]).stderr, /--output must be a JSON filename/);
  assert.match(run([input, '--stems']).stderr, /require --deconstruct/);
  assert.match(run([input, '--deconstruct', '--semantic']).stderr, /separately/);
  assert.match(run([input, '--deconstruct', '--seconds', '61', '--python', process.execPath]).stderr, /between 1 and 60/);
});

test('seeded streams are reproducible and independent', () => {
  const a = random(42, 'drums'), b = random(42, 'drums'), c = random(42, 'bass');
  assert.deepEqual(Array.from({ length: 20 }, a), Array.from({ length: 20 }, b));
  assert.notEqual(random(42, 'drums')(), c());
});

test('Euclidean quantization conserves pulses, phase and circular spacing', () => {
  for (let n = 1; n <= 32; n++) for (let k = 0; k <= n; k++) {
    const e = euclidean(k, n);
    assert.equal(e.reduce((a, b) => a + b, 0), k);
    assert.deepEqual(e, e.map((_, i) => Math.floor((i + 1) * k / n) - Math.floor(i * k / n)));
    if (k > 1) {
      const indices = e.flatMap((on, i) => on ? [i] : []);
      const gaps = indices.map((v, i) => (indices[(i + 1) % k] - v + n) % n);
      assert.ok(Math.max(...gaps) - Math.min(...gaps) <= 1);
    }
  }
  const a = euclidean(5, 16), b = euclidean(5, 16, 3);
  assert.deepEqual(b, a.map((_, i) => a[(i + 13) % 16]));
  assert.throws(() => euclidean(17, 16));
});

test('Linn swing leaves even steps unchanged and offsets odd steps', () => {
  near(swingTime(0, .1, 62), 0); near(swingTime(1, .1, 62), .124);
  near(swingTime(2, .1, 62), .2); near(swingTime(3, .1, 62), .324);
  near(swingTime(1, .1, 50), .1);
});

test('linear masks preserve intentional backbeats and exclude generated stacking', () => {
  const m = linearMasks({ kick: [1, 1, 0, 0], snare: [.9, .4, .9, 0], hat: [1, 1, 1, 0], aux: [1, 1, 1, 1] }, [0]);
  assert.deepEqual(m.snare, [.9, 0, .9, 0]); assert.deepEqual(m.hat, [0, 1, 0, 0]); assert.deepEqual(m.aux, [0, 0, 0, 1]);
});

test('ratchets use supported pulse counts, exponential decay and pitch modulation', () => {
  for (const count of [2, 3, 4, 8]) {
    const r = ratchet({ step: 0, time: 0, stepSeconds: .125, duration: .1, velocity: 1 }, count);
    assert.equal(r.length, count);
    near(r.at(-1).time, .125 * (count - 1) / count);
    near(r[1].velocity, Math.exp(-.48)); assert.notEqual(r[0].pitch, r[1].pitch);
  }
  assert.throws(() => ratchet({}, 5));
});

test('ratchet pulses stay inside their actual swung grid cells', () => {
  const score = compose('uk garage', { seed: 42, sauce: 1 });
  let count = 0;
  for (const e of Object.values(score.drums).flat()) {
    if (!e.ratchet) continue;
    const boundary = swingTime(Math.floor(e.step) + 1, score.config.stepSeconds, score.config.swing);
    assert.ok(e.time + e.duration <= boundary + 1e-9, 'A roll spilled into the following swung step.');
    count++;
  }
  assert.ok(count > 0);
});

test('voice-leading optimum agrees with an independent brute-force register search', () => {
  const previous = [60, 64, 67], pcs = [2, 5, 9];
  const actual = minimalVoiceLeading(previous, pcs);
  let optimum = Infinity;
  const pool = pcs.flatMap((p) => [48 + p, 60 + p, 72 + p]);
  for (const a of pool) for (const b of pool) for (const c of pool) {
    if (new Set([a % 12, b % 12, c % 12]).size !== 3) continue;
    optimum = Math.min(optimum, Math.abs(a - previous[0]) + Math.abs(b - previous[1]) + Math.abs(c - previous[2]));
  }
  assert.equal(actual.distance, optimum);
  assert.deepEqual(actual.notes.map((n) => n % 12).sort((a, b) => a - b), pcs);
  assert.equal(minimalVoiceLeading(previous, [0, 4, 7]).distance, 0);
});

test('all arrangements have the exact section matrix, modal chords and valid event times', () => {
  for (const [name] of genres) {
    const s = compose(name + ' in F minor', { seed: 42 });
    assert.deepEqual(s.sections.map((x) => [x.start, x.end]), [[0, 4], [4, 12], [12, 16], [16, 20], [20, 28], [28, 32]]);
    assert.equal(s.chords.length, 16); assert.equal(s.chords[0].function, 'tonic'); assert.equal(s.chords.at(-1).function, 'tonic');
    for (const c of s.chords) for (const n of c.notes) assert.ok(s.config.intervals.includes((n - s.config.root + 120) % 12));
    for (const e of [...Object.values(s.drums).flat(), ...s.bass, ...s.keys]) {
      assert.ok(e.time >= 0 && e.time < s.config.duration);
      assert.ok(Number.isFinite(e.velocity) && e.velocity > 0 && e.velocity <= 1);
    }
    assert.equal(s.drums.kick.filter((e) => e.bar >= 12 && e.bar < 16).length, 0);
    assert.equal(s.bass.filter((e) => e.bar >= 12 && e.bar < 20).length, 0);
  }
});

test('bass lock exactly follows kick times for drill and Jersey', () => {
  for (const name of ['drill', 'jersey club']) {
    const s = compose(name, { seed: 7, sauce: 0 });
    for (const e of s.bass) {
      const k = s.drums.kick.find((k) => k.step === e.step);
      assert.ok(k); assert.equal(e.time, k.time);
    }
  }
});

test('garage bass never triggers on occupied kick steps; house pumps offbeat', () => {
  const garage = compose('uk garage', { seed: 4 });
  const kickSteps = new Set(garage.drums.kick.map((e) => e.step));
  for (const e of garage.bass) assert.ok(!kickSteps.has(e.step));
  const house = compose('house', { sauce: 0 });
  for (const e of house.drums.kick) assert.equal(e.step % 4, 0);
  for (const e of house.bass) assert.equal(e.step % 4, 2);
});

test('S-curve glide endpoints and sidechain depth/recovery are mathematically correct', () => {
  near(glideFrequency(24, 36, 0), midiHz(24)); near(glideFrequency(24, 36, .12), midiHz(36));
  near(glideFrequency(24, 36, .06), midiHz(30));
  near(20 * Math.log10(duckingGain(0)), -21);
  near(duckingGain(.055), 1 - (1 - 10 ** (-21 / 20)) / Math.E);
  assert.equal(duckingGain(Infinity), 1); assert.ok(duckingGain(.3) > .99);
});

test('sauce zero disables disruptions; sauce one guarantees air and tape stop', () => {
  assert.deepEqual(compose('idm', { sauce: 0 }).automation, []);
  const s = compose('idm', { sauce: 1 });
  assert.ok(s.automation.some((a) => a.type === 'air' && a.startStep === 316 && a.endStep === 320));
  assert.ok(s.automation.some((a) => a.type === 'brake' && a.endStep === 512));
  assert.ok(s.automation.some((a) => a.type === 'stutter'));
});

test('buffer effects repeat slices and quadratic tape stop actually changes playback', () => {
  const l = Float32Array.from({ length: 400 }, (_, i) => i / 400), r = l.slice();
  applyAutomation(l, r, [{ type: 'stutter', startStep: 10, endStep: 14, sliceSteps: 1 }], .01, 1000);
  assert.equal(l[105], l[115]);
  const a = Float32Array.from({ length: 400 }, (_, i) => i / 400), b = a.slice();
  applyAutomation(a, b, [{ type: 'brake', startStep: 10, endStep: 30 }], .01, 1000);
  assert.ok(a[299] < .5, 'Stopped playback should advance about one third of the region.');
});

test('same seed produces identical scores; another seed changes musical events', () => {
  const a = compose('amapiano', { seed: 123 });
  assert.deepEqual(a, compose('amapiano', { seed: 123 }));
  assert.notDeepEqual(a.drums, compose('amapiano', { seed: 124 }).drums);
});

let referenceAudio;
test('real synthesis is deterministic, stereo, non-silent, finite and below clipping', () => {
  const score = compose('house in F major 135bpm', { seed: 123, sauce: 1 });
  const a = renderAudio(score, { sampleRate: 8000 }), b = renderAudio(score, { sampleRate: 8000 });
  assert.equal(hash(a.pcm), hash(b.pcm));
  assert.equal(a.frames, Math.round(32 * 4 * 60 / 135 * 8000));
  assert.ok(a.stats.rms > .03 && a.stats.rms < .5); assert.ok(a.stats.peak < .95);
  assert.notEqual(hash(a.pcm), hash(renderAudio(compose('house in F major 135bpm', { seed: 124, sauce: 1 }), { sampleRate: 8000 }).pcm));
  let stereo = false;
  for (let i = 0; i < a.pcm.length; i += 4) if (a.pcm.readInt16LE(i) !== a.pcm.readInt16LE(i + 2)) { stereo = true; break; }
  assert.ok(stereo);
  const start = Math.round(316 * score.config.stepSeconds * 8000) * 4;
  const end = Math.round(320 * score.config.stepSeconds * 8000) * 4;
  assert.ok(a.pcm.subarray(start, end).every((byte) => byte === 0), 'Air must silence tails, not just triggers.');
  assert.equal(a.pcm.readInt16LE(a.pcm.length - 4), 0);
  referenceAudio = a;
});

test('ratchet pitch modulation reaches snare and hat synthesis', () => {
  for (const voice of ['snare', 'hat']) {
    const isolated = {
      config: { seed: 'pitch', duration: .2, stepSeconds: .125, intent: 'house_bright' },
      drums: { kick: [], hit: [{ voice, time: 0, duration: .15, velocity: .8, pitch: 0 }] },
      bass: [], keys: [], automation: [], sidechain: { duckDb: -21, tauSeconds: .055 },
    };
    const original = renderAudio(isolated, { sampleRate: 16000 });
    isolated.drums.hit[0].pitch = 12;
    const shifted = renderAudio(isolated, { sampleRate: 16000 });
    assert.notEqual(hash(original.pcm), hash(shifted.pcm), voice + ' ignored its pitch offset');
  }
});

test('every archetype renders meaningful audio', () => {
  for (const [name] of genres) {
    const a = renderAudio(compose(name, { seed: 12 }), { sampleRate: 8000 });
    assert.ok(a.stats.rms > .02, name + ' is silent or too quiet');
    assert.ok(a.stats.peak <= .93, name + ' clipped');
  }
});

test('WAV packing has correct PCM16 metadata and exact payload length', () => {
  const wav = packWav(referenceAudio);
  assert.equal(wav.toString('ascii', 0, 4), 'RIFF'); assert.equal(wav.toString('ascii', 8, 12), 'WAVE');
  assert.equal(wav.readUInt16LE(20), 1); assert.equal(wav.readUInt16LE(22), 2);
  assert.equal(wav.readUInt32LE(24), 8000); assert.equal(wav.readUInt16LE(34), 16);
  assert.equal(wav.readUInt32LE(40), referenceAudio.pcm.length); assert.equal(wav.length, referenceAudio.pcm.length + 44);
});

test('exports preserve existing files, support force, and leave no temporary artifacts', async () => {
  const d = await testDirectory(), path = join(d, 'atomic.wav');
  await writeAudio(path, referenceAudio, { format: 'wav' });
  const original = await readFile(path);
  await assert.rejects(writeAudio(path, referenceAudio, { format: 'wav' }), /Output exists/);
  assert.deepEqual(await readFile(path), original);
  await writeFile(path, 'old'); await writeAudio(path, referenceAudio, { format: 'wav', force: true });
  assert.deepEqual(await readFile(path), original);
  await writeJson(join(d, 'score.json'), compose('house'));
  assert.ok(!(await readdir(d)).some((f) => f.endsWith('.tmp')));
});

test('MP3 and FLAC use local FFmpeg and FLAC round-trips exact PCM', { skip: spawnSync('ffmpeg', ['-version']).status !== 0 }, async () => {
  const d = await testDirectory();
  // A short real PCM slice keeps codec tests fast and artifacts small.
  const audio = { ...referenceAudio, pcm: referenceAudio.pcm.subarray(0, 8000 * 4 * 2) };
  for (const format of ['mp3', 'flac']) {
    const target = join(d, 'codec.' + format);
    await writeAudio(target, audio, { format });
    const decoded = spawnSync('ffmpeg', ['-v', 'error', '-i', target, '-f', 's16le', '-acodec', 'pcm_s16le', 'pipe:1']);
    assert.equal(decoded.status, 0, decoded.stderr.toString());
    assert.ok(decoded.stdout.length > 0);
    if (format === 'flac') assert.deepEqual(decoded.stdout, audio.pcm);
    else assert.ok((await readFile(target)).length < audio.pcm.length);
  }
});

test('CLI dry-run, random seed replay and invalid arguments behave correctly', () => {
  const run = (args) => spawnSync(process.execPath, ['bin/makebeats.js', ...args], { cwd: root, encoding: 'utf8', maxBuffer: 4e6 });
  const dry = run(['house 135bpm', '--dry-run', '--seed', '73']);
  assert.equal(dry.status, 0, dry.stderr); const score = JSON.parse(dry.stdout); assert.equal(score.config.seed, '73');
  const fresh = run(['house', '--random', '--dry-run']); assert.equal(fresh.status, 0, fresh.stderr);
  const randomScore = JSON.parse(fresh.stdout);
  assert.deepEqual(randomScore, JSON.parse(run(['house', '--seed', randomScore.config.seed, '--dry-run']).stdout));
  for (const args of [[], ['house', '--sauce', 'oops'], ['house', '--random', '--seed', '3'],
    ['house', '--output', '../escape.wav'], ['house', '--output', '/tmp/escape.wav'], ['house', '--format', 'ogg'],
    ['house', '--format', 'mp3', '--output', 'bad.wav'], ['house', '--unknown']]) assert.notEqual(run(args).status, 0, String(args));
});

test('missing encoder fails clearly and cleans its partial file', async () => {
  const d = await testDirectory(), originalPath = process.env.PATH;
  try {
    process.env.PATH = d;
    await assert.rejects(writeAudio(join(d, 'missing.mp3'), referenceAudio), /FFmpeg is required/);
  } finally { process.env.PATH = originalPath; }
  assert.ok(!(await readdir(d)).some((f) => f === 'missing.mp3' || f.endsWith('.tmp')));
});
