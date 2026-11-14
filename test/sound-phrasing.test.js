import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { compose, compilePrompt, renderAudio, archetypes, fft } from '../src/index.js';
import { barInfo, barStep } from '../src/arrangement.js';

const attacks = (events, config, bar) => [...new Set(events.filter(e => e.bar === bar).map(e => e.step - barStep(config, bar)))];
const withoutProfile = events => events.map(({ profile, ...event }) => event);
const hash = audio => createHash('sha256').update(audio.pcm).digest('hex');

test('sound seeds diversify compatible palettes without rerolling the music or explicit slots', () => {
  const prompt = 'indie pop in F# major at 128bpm, 32 bars, 4/4, no lead or arpeggios';
  const base = compose(prompt, { seed: 'music', soundSeed: 0, phraseSeed: 'phrase', sauce: 0 });
  const basses = new Set(), harmonies = new Set();
  for (let soundSeed = 0; soundSeed < 24; soundSeed++) {
    const score = compose(prompt, { seed: 'music', soundSeed, phraseSeed: 'phrase', sauce: 0 });
    basses.add(score.config.bassProfile); harmonies.add(score.config.synthProfile);
    assert.deepEqual(score.drums, base.drums); assert.deepEqual(score.chords, base.chords);
    for (const voice of ['bass', 'keys', 'lead', 'arp']) assert.deepEqual(withoutProfile(score[voice]), withoutProfile(base[voice]));
    assert.deepEqual(score.config.accompaniment, base.config.accompaniment);
    assert.equal(score.config.bpm, 128); assert.equal(score.config.rootName, 'F#');
    assert.equal(score.config.scale, 'major'); assert.equal(score.config.bars, 32); assert.equal(score.config.timeSignature, '4/4');
    assert.equal(score.lead.length + score.arp.length, 0);
    assert.deepEqual(score, compose(prompt, { seed: 'music', soundSeed, phraseSeed: 'phrase', sauce: 0 }));
  }
  assert.equal(basses.size, 3); assert.equal(harmonies.size, 5);
});

test('named instruments and textures stay pinned across independent seeds; automatic palettes do not choose metallic Reese', () => {
  for (let seed = 0; seed < 16; seed++) {
    const c = compilePrompt('indie pop with electric bass guitar and PWM synth, held chords, in B minor at 115bpm', { seed, soundSeed: seed });
    assert.equal(c.bassProfile, 'electric_bass'); assert.equal(c.synthProfile, 'pwm');
    assert.equal(c.accompaniment.style, 'sustain');
    assert.equal(c.soundDesign.palette.bass.source, 'prompt');
    assert.equal(compilePrompt('industrial bass with metallic bass', { seed }).bassProfile, 'metallic_reese');
    assert.equal(compilePrompt('house with sustained clean sine bass', { seed }).bassProfile, 'sine_sub');
    const quiet = compilePrompt('indie pop, no piano or lead or arpeggios', { seed });
    assert(!/piano|rhodes|jazz_keys/.test(quiet.synthProfile));
    assert.equal(quiet.soundDesign.leadEnabled, false); assert.equal(quiet.soundDesign.arpEnabled, false);
  }
  for (const a of Object.values(archetypes)) for (let seed = 0; seed < 4; seed++) {
    const c = compilePrompt(a.aliases[0], { seed });
    assert.notEqual(c.bassProfile, 'metallic_reese', a.id);
  }
});

test('metallic-leaning bass is limited to explicit requests, heavy styles and occasional sound rerolls', () => {
  const edged = new Set(['metallic_reese', 'reese_bass', 'fm_bass', 'growl_bass', 'dark_distorted_bass']);
  for (const prompt of ['synth funk', 'future house', 'electro', 'bass house', 'speed garage', 'house with metallic hats and deep bass',
    'house with growling vocals and deep bass', 'house with analog bass and distorted drums']) {
    for (let seed = 0; seed < 16; seed++) assert.ok(!edged.has(compilePrompt(prompt, { seed }).bassProfile), prompt);
  }
  assert.equal(compilePrompt('indie pop with metallic bass').bassProfile, 'metallic_reese');
  assert.equal(compilePrompt('synth funk with FM bass').bassProfile, 'fm_bass');
  assert.equal(compilePrompt('neurofunk').bassProfile, 'growl_bass');
  assert.ok(!edged.has(compilePrompt('neurofunk, no metallic bass', { soundSeed: 42 }).bassProfile));
  let edgedRerolls = 0;
  for (let soundSeed = 0; soundSeed < 128; soundSeed++) {
    const options = { seed: 42, soundSeed };
    const profile = compilePrompt('synth funk', options).bassProfile;
    if (edged.has(profile)) edgedRerolls++;
    assert.equal(compilePrompt('synth funk', options).bassProfile, profile);
    assert.ok(!edged.has(compilePrompt('synth funk, avoid metallic bass', options).bassProfile));
  }
  assert.ok(edgedRerolls > 0 && edgedRerolls < 16, String(edgedRerolls));
});

test('phrase seeds change actual music while preserving the sounds, harmony progression and drums', () => {
  const prompt = 'indie pop with bouncy bass, lead melody, 32 bars';
  const base = compose(prompt, { seed: 'music', soundSeed: 'sound', phraseSeed: 0, sauce: 0 });
  const shapes = new Set(), bassShapes = new Set();
  for (let phraseSeed = 0; phraseSeed < 12; phraseSeed++) {
    const s = compose(prompt, { seed: 'music', soundSeed: 'sound', phraseSeed, sauce: 0 });
    assert.deepEqual(s.drums, base.drums); assert.deepEqual(s.chords, base.chords);
    assert.deepEqual(s.config.soundDesign.palette, base.config.soundDesign.palette);
    assert.equal(s.config.synthProfile, base.config.synthProfile); assert.equal(s.config.bassProfile, base.config.bassProfile);
    shapes.add(JSON.stringify(s.keys.map(e => [e.step, e.note, e.duration])));
    bassShapes.add(JSON.stringify(attacks(s.bass, s.config, 20)));
  }
  assert(shapes.size >= 4); assert(bassShapes.size >= 3);
});

test('drum/keys/lead response cues cannot override bass articulation; explicit bass responses still work', () => {
  for (const cue of ['drum call and response', 'drums call and response', 'call and response drums', 'keys call and response', 'lead call and response']) {
    const prompt = 'indie pop with sustained bass and held chords';
    const options = { seed: 12, sauce: 0 };
    const base = compose(prompt, options), s = compose(prompt + ', ' + cue, options);
    assert.equal(s.config.soundDesign.bassPhrasing, 'held', cue);
    assert.deepEqual(s.bass.map(e => [e.step, e.duration, e.note]), base.bass.map(e => [e.step, e.duration, e.note]), cue);
    assert(s.bass.every(e => e.duration > s.config.stepSeconds * 15));
  }
  for (const cue of ['call and response', 'call and response bass phrases', 'answering bass phrases']) {
    assert.equal(compilePrompt('indie pop, drum call and response, ' + cue).soundDesign.bassPhrasing, 'call_response');
  }
  const rows = JSON.parse(readFileSync(new URL('../data/indie-variation-20.json', import.meta.url)));
  const cases = Array.isArray(rows) ? rows : rows.cases;
  for (const id of ['05','07','12']) {
    const row = cases.find(r => r.id === id);
    const c = compilePrompt(row.prompt, { seed: row.seed, ...row.options });
    assert.notEqual(c.soundDesign.bassPhrasing, 'call_response', id);
  }
  const row = cases.find(r => r.id === '11');
  assert.equal(compilePrompt(row.prompt, { seed: row.seed, ...row.options }).soundDesign.bassPhrasing, 'call_response');
});

test('lead and bass motifs repeat openings, answer with space and develop at the turnaround', () => {
  const s = compose('indie pop with bouncy bass and lead melody, 32 bars', { seed: 42, sauce: 0 });
  for (const voice of ['bass','lead']) {
    assert.deepEqual(attacks(s[voice], s.config, 20), attacks(s[voice], s.config, 22));
    assert.notDeepEqual(attacks(s[voice], s.config, 20), attacks(s[voice], s.config, 23));
  }
  assert(attacks(s.lead, s.config, 21).length < attacks(s.lead, s.config, 20).length);
  const answer = s.lead.filter(e => e.bar === 21).at(-1), info = barInfo(s.config, 21);
  assert(answer.time + answer.duration < info.time + info.duration - info.stepSeconds);
});

test('interlocking accompaniment preserves beat anchors and leaves a limited space for bass pickups', () => {
  const prompt = 'indie pop with electric bass and electric guitar, chord riff, 32 bars';
  const a = compose(prompt + ', independent accompaniment', { seed: 8, sauce: 0 });
  const b = compose(prompt + ', interlocking accompaniment', { seed: 8, sauce: 0 });
  assert.deepEqual(a.drums, b.drums); assert.deepEqual(a.bass, b.bass); assert.deepEqual(a.chords, b.chords);
  let changed = 0;
  for (let bar = 20; bar < 28; bar++) {
    const before = attacks(a.keys, a.config, bar), after = attacks(b.keys, b.config, bar);
    assert(after.every(step => before.includes(step)));
    assert(before.filter(step => step % 4 === 0).every(step => after.includes(step)));
    assert(after.length >= 2); changed += before.length !== after.length;
  }
  assert(changed > 0, 'No competing pickup was removed');
});

test('the synth-pop backing pad sits below the kick while the melody and arpeggio remain', () => {
  const score = compose('80s synth pop in D major at 112 BPM, 16 bars, with warm sustained pads, a memorable lead melody, bright arpeggios and octave bass. No vocals.', { seed: 2310, phraseSeed: 14 });
  const level = (voice) => renderAudio(score, { sampleRate: 16000, voices: [voice], normalize: false }).stats.rms;
  assert.ok(score.keys.length && score.lead.length && score.arp.length);
  const padToKick = level('keys') / level('kick');
  assert.ok(padToKick > .45 && padToKick < .85, String(padToKick));
});

test('the Hammond house electric bass and organ keep their notes without sharp upper harmonics dominating', () => {
  const score = compose('Soulful house in A minor at 122 BPM, 16 bars, with Hammond chords, electric bass, tambourine and a steady kick. No lead or arpeggios. No vocals.', { seed: 2311, phraseSeed: 27 });
  assert.ok(score.bass.length && score.bass.every((event) => event.profile === 'electric_bass'));
  assert.ok(score.keys.length && score.keys.every((event) => event.profile === 'organ'));
  assert.equal(score.lead.length + score.arp.length, 0);
  const sampleRate = 16000, size = 2048;
  const window = Float64Array.from({ length: size }, (_, i) => .5 - .5 * Math.cos(2 * Math.PI * i / (size - 1)));
  for (const [voice, cutoff, limit] of [['bass', 500, .2], ['keys', 1000, .06]]) {
    const { left, stats } = renderAudio(score, { sampleRate, voices: [voice], normalize: false, returnFloat: true });
    let total = 0, upper = 0;
    for (let offset = 0; offset + size <= left.length; offset += size) {
      const real = Float64Array.from(window, (weight, i) => left[offset + i] * weight);
      const imaginary = new Float64Array(size);
      fft(real, imaginary);
      for (let bin = 1; bin < size / 2; bin++) {
        const energy = real[bin] ** 2 + imaginary[bin] ** 2;
        total += energy;
        if (bin * sampleRate / size >= cutoff) upper += energy;
      }
    }
    assert.ok(stats.rms > .025);
    assert.ok(upper / total < limit, voice + ' upper band share: ' + upper / total);
  }
});

test('a lead hook returns across sections, with room at the drop and a final resolution', () => {
  const prompt = '80s synth pop in D major with a lead melody, held chords and arpeggios';
  const options = { seed: 21, phraseSeed: 17, sauce: 0 };
  const score = compose(prompt, options);
  const intro = score.sections.find((section) => section.name === 'intro');
  const breakdown = score.sections.find((section) => section.name === 'breakdown');
  const drop = score.sections.find((section) => section.name === 'drop');
  const notes = (bar) => score.lead.filter((event) => event.bar === bar).map((event) => event.note);
  assert.ok(notes(drop.start).length >= 5);
  assert.deepEqual(notes(intro.end - 1), notes(drop.start).slice(0, 2));
  assert.deepEqual(notes(breakdown.start), notes(drop.start).slice(0, 2));
  const pickup = score.lead.filter((event) => event.bar === drop.start - 1).at(-1);
  assert.ok(pickup && pickup.time + pickup.duration <= drop.startTime - 4 * score.config.stepSeconds + 1e-9);
  const closing = score.lead.at(-1);
  assert.equal(closing.bar, score.config.bars - 1);
  assert.equal(closing.note % 12, score.chords.at(-1).root);
  assert.ok(closing.time + closing.duration < score.config.duration - .1);
  assert.deepEqual(compose(prompt, options), score);
});

test('a lead-free odd-meter arrangement closes on its final chord', () => {
  const score = compose('Soulful house in A minor in 7/8, 9 bars, chord every 4 bars, borrowed chords, Hammond, no lead or arpeggios', { seed: 9, sauce: 0 });
  assert.equal(score.lead.length + score.arp.length, 0);
  assert.equal(score.chords.at(-1).root, score.config.root);
  const final = score.keys.filter((event) => event.bar === score.config.bars - 1);
  assert.ok(final.length >= 3);
  assert.equal(new Set(final.map((event) => event.step)).size, 1);
  assert.ok(final.every((event) => event.time + event.duration < score.config.duration));
});

test('held bass ends at chord/section boundaries and odd-meter timeline edits; bass remains monophonic', () => {
  for (const prompt of [
    'indie pop 32 bars with sustained clean sine bass, chord every 1 bar, verse chorus form',
    'industrial bass 16 bars in 7/8, sustained dark analog bass throughout, change to 5/4 at bar 9 tempo 90 at bar 9',
  ]) {
    const s = compose(prompt, { seed: 4, sauce: 0 });
    for (const [index,e] of s.bass.entries()) {
      assert(Number.isFinite(e.time) && e.duration > 0 && e.time + e.duration <= s.config.duration + 1e-8);
      const next = s.chords.find(c => c.bar > e.bar);
      if (next) assert(e.time + e.duration <= barInfo(s.config, next.bar).time + 1e-8);
      if (s.bass[index + 1]) assert(e.time + e.duration <= s.bass[index + 1].time + 1e-8);
    }
  }
});

test('CLI independent seeds replay and reject invalid API seed types', () => {
  const run = args => spawnSync(process.execPath, ['bin/makebeats.js', ...args], { encoding: 'utf8', maxBuffer: 4e6 });
  const args = ['indie pop 8 bars', '--seed', 'music', '--sound-seed', 'sound', '--phrase-seed', 'phrase', '--sauce', '0', '--dry-run'];
  const result = run(args); assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.stringify(JSON.parse(result.stdout)), JSON.stringify(compose('indie pop 8 bars', { seed: 'music', soundSeed: 'sound', phraseSeed: 'phrase', sauce: 0 })));
  for (const name of ['seed','soundSeed','phraseSeed']) for (const value of [NaN, Infinity, {}, null]) assert.throws(() => compilePrompt('house', { [name]: value }));
});

test('new sound/phrase combinations render finite, distinct, deterministic audio in memory', () => {
  const hashes = new Set();
  for (const soundSeed of ['a','b','c']) {
    const s = compose('indie pop with sustained bass and held chords, no lead or arpeggios', { seed: 4, soundSeed, phraseSeed: 8, sauce: 0 });
    const start = barInfo(s.config, 20).time, seconds = 2;
    // Exercise actual selected voices without writing a new listening collection.
    const cut = events => events.filter(e => e.time >= start && e.time < start + seconds).map(e => ({ ...e, time: e.time - start, duration: Math.min(e.duration, start + seconds - e.time) }));
    const short = { ...s, config: { ...s.config, duration: seconds }, drums: Object.fromEntries(Object.entries(s.drums).map(([v,events]) => [v,cut(events)])),
      bass: cut(s.bass), keys: cut(s.keys), lead: [], arp: [], parts: [], automation: [] };
    const audio = renderAudio(short, { sampleRate: 16000 });
    assert(Number.isFinite(audio.stats.rms) && audio.stats.rms > .01); assert(audio.stats.peak <= .93);
    assert.equal(hash(audio), hash(renderAudio(short, { sampleRate: 16000 })));
    hashes.add(hash(audio));
  }
  assert.equal(hashes.size, 3);
});
