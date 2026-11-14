import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { compose, compilePrompt, renderAudio, classify } from '../src/index.js';
import { INSTRUMENTS, instrumentVoice } from '../src/instruments.js';
import { grooveTime } from '../src/groove.js';
import { random, midiHz } from '../src/random.js';

const styles = {
  'deep house': 'deep_house', 'speed garage': 'speed_garage', trap: 'trap_halftime',
  'afro house': 'afro_house', 'liquid drum and bass': 'liquid_dnb', country: 'country_acoustic',
};
const fingerprint = (audio) => createHash('sha256').update(audio.pcm).digest('hex');
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);
const scoreEvents = (s) => [...Object.values(s.drums).flat(), ...s.keys, ...s.bass, ...s.lead, ...s.arp];

function isolated(profile, note = 60, duration = 1.6) {
  const score = compose('classical', { sauce: 0 });
  score.config.duration = duration;
  score.keys = [{ voice: 'keys', profile, note, time: 0, duration, velocity: .8, pan: 0 }];
  return score;
}
function rms(audio, start, end) {
  let sum = 0, n = 0;
  for (let i = Math.floor(start * audio.sampleRate); i < Math.floor(end * audio.sampleRate); i++) {
    sum += (audio.pcm.readInt16LE(i * 4) / 32767) ** 2; n++;
  }
  return Math.sqrt(sum / n);
}

test('new names select distinct presets and preserve existing neighboring styles', () => {
  for (const [name, intent] of Object.entries(styles)) {
    assert.equal(classify(`An instrumental in the style of ${name}`).intent, intent, name);
    assert.equal(classify(`${name}, not techno`).intent, intent);
  }
  for (const [name, intent] of Object.entries({ house: 'house_bright', garage: 'uk_garage_2step', drill: 'drill_sliding', jazz: 'jazz_lounge', classical: 'classical_minimal' })) {
    assert.equal(classify(name).intent, intent);
  }
  assert.equal(classify('liquid dnb').intent, 'liquid_dnb');
  assert.equal(classify('bluegrass').intent, 'bluegrass');
});

test('dance presets have recognizable repeated kick phrases and answering endings', () => {
  const kicks = (prompt, bar) => compose(prompt, { sauce: 0 }).drums.kick.filter((e) => e.bar === bar).map((e) => e.step % 16);
  assert.deepEqual(kicks('speed garage', 20), [0, 4, 8, 12]);
  assert.notDeepEqual(kicks('speed garage', 20), kicks('garage', 20));
  assert.deepEqual(kicks('trap', 20), [0, 7, 10]);
  assert.deepEqual(kicks('trap', 23), [0, 6, 10, 15]);
  assert.deepEqual(kicks('liquid dnb', 20), [0, 10]);
  assert.deepEqual(kicks('liquid dnb', 23), [0, 6, 10, 14]);
  const dnb = compose('liquid dnb', { sauce: 0 });
  assert.ok(dnb.drums.snare.some((e) => e.bar === 20 && e.velocity < .3));
  assert.ok(dnb.keys.every((e) => e.duration > 1));
  const deep = compose('deep house', { sauce: 0 });
  assert.ok(deep.keys.some((e) => deep.keys.filter((k) => k.step === e.step).length === 4));
});

test('independent timing controls change the requested voices and preserve kick/bass locking by default', () => {
  const base = compose('house', { seed: 81, sauce: 0 });
  const swung = compose('house, hat swing 65, late snare', { seed: 81, sauce: 0 });
  assert.deepEqual(base.drums.kick, swung.drums.kick);
  base.drums.snare.forEach((e, i) => near(swung.drums.snare[i].time - e.time, .012));
  assert.ok(swung.drums.hat.some((e, i) => e.time !== base.drums.hat[i].time));
  for (const e of swung.drums.hat) assert.ok(e.time >= grooveTime(swung.config, e.step, 'hat'));
  const global = compilePrompt('afro house, swing 60, hat swing 65');
  near(grooveTime(global, 1, 'kick'), global.stepSeconds * 1.2);
  near(grooveTime(global, 1, 'hat'), global.stepSeconds * 1.3);
  const trap = compose('trap, kick offset -6ms, bass offset 15ms', { sauce: 0 });
  near(trap.config.groove.offsets.kick, -.006);
  near(trap.config.groove.offsets.bass, .015);
  for (const e of trap.bass) near(e.time, grooveTime(trap.config, e.step, 'bass'));
  for (const prompt of ['house swing 80', 'house swing -5', 'house snare offset 31ms']) assert.throws(() => compilePrompt(prompt));
});

test('supplemental percussion obeys exclusions, hat choking and isolation', () => {
  const s = compose('afro house', { sauce: 0 });
  for (const voice of ['clap', 'open_hat', 'shaker', 'conga']) {
    assert.ok(s.drums[voice].length > 0, voice);
    const hit = s.drums[voice].find((e) => e.bar === 20);
    const audio = renderAudio({ ...s, config: { ...s.config, duration: 1 },
      drums: { kick: [], [voice]: [{ ...hit, time: 0 }] }, keys: [], bass: [], lead: [], arp: [], automation: [] },
      { sampleRate: 8000, voices: [voice] });
    assert.ok(audio.stats.rms > .001, `${voice} is silent`);
  }
  const hats = [...s.drums.hat, ...s.drums.open_hat].sort((a, b) => a.time - b.time);
  hats.forEach((e, i) => {
    if (e.voice === 'open_hat' && hats[i + 1]) assert.ok(e.time + e.duration <= hats[i + 1].time + 1e-8);
  });
  const excluded = compose('afro house, without congas or shakers or open hats or claps', { sauce: 0 });
  for (const voice of ['conga', 'shaker', 'open_hat', 'clap']) assert.equal(excluded.drums[voice]?.length ?? 0, 0);
  const silent = compose('afro house, no drums');
  assert.equal(Object.values(silent.drums).flat().length, 0);
  assert.ok(compose('house with rimshots and shakers').drums.rim.length > 0);
});

test('jazz extends existing comping with sevenths, upright walking bass, brushes and triplet ride', () => {
  const s = compose('jazz in C major', { sauce: 0 });
  assert.equal(s.config.synthProfile, 'acoustic_piano');
  assert.ok(s.bass.every((e) => e.profile === 'upright_bass'));
  assert.ok(s.drums.snare.every((e) => e.profile === 'brush'));
  assert.ok(s.drums.ride.some((e) => !Number.isInteger(e.step)));
  const bass = s.bass.filter((e) => e.bar === 20);
  assert.deepEqual(bass.map((e) => e.step % 16), [0, 4, 8, 12]);
  assert.ok(s.keys.some((e) => s.keys.filter((k) => k.step === e.step).length === 4));
  assert.ok(s.chords.some((c, i) => i < s.chords.length - 2 && c.degree === 1 && s.chords[i + 1].degree === 4 && s.chords[i + 2].degree === 0));
  assert.deepEqual(s.automation, []);
});

test('country uses staggered strums, root/fifth bass, banjo rolls and optional fiddle/steel', () => {
  const s = compose('country in G major with banjo and fiddle', { sauce: 0 });
  const chord = s.chords[10];
  const bass = s.bass.filter((e) => e.bar === 20);
  assert.deepEqual(bass.map((e) => e.step % 16), [0, 8]);
  assert.deepEqual(bass.map((e) => e.note % 12), [chord.root, chord.pitchClasses[2]]);
  const strum = s.keys.filter((e) => e.bar === 20 && e.step % 16 === 4);
  assert.equal(strum.length, 3); near(strum[1].time - strum[0].time, .009);
  assert.ok(s.arp.length > 0 && s.arp.every((e) => e.profile === 'banjo'));
  assert.ok(s.lead.every((e) => e.profile === 'fiddle'));
  assert.ok(s.drums.rim.length && s.drums.shaker.length);
  const steel = compose('country with steel guitar');
  assert.ok(steel.lead.length && steel.lead.every((e) => e.profile === 'pedal_steel'));
  assert.ok(steel.keys.every((e) => e.profile === 'acoustic_guitar'));
});

test('pedal steel leaves space, bends against a held string, and resolves to the final chord', () => {
  const prompt = 'Country in G major with pedal steel, 16 bars, verse chorus form, change meter to 7/8 at bar 8, change tempo 106 at bar 10, just intonation';
  const options = { seed: 202, phraseSeed: 'steel', sauce: 0 };
  const score = compose(prompt, options);
  const { lead, chords, config } = score;
  const pitchClass = (note) => note % 12;
  assert.deepEqual(compose(prompt, options).lead, lead);
  assert.notDeepEqual(compose(prompt, { ...options, phraseSeed: 'steel alternate' }).lead, lead);
  assert.ok(lead.some((e) => e.phrase === 'steel_pickup'));
  assert.ok(lead.some((e) => e.phrase === 'steel_reply' && e.duration > .45 && e.fromNote !== e.note));
  const verse = score.sections.find((s) => s.name === 'verse');
  assert.ok(!lead.some((e) => e.bar === verse.start));
  const arrival = lead.filter((e) => e.phrase === 'steel_arrival').slice(0, 2);
  assert.equal(arrival.length, 2);
  assert.equal(arrival[0].time, arrival[1].time);
  assert.equal(arrival[0].fromNote, arrival[0].note);
  assert.notEqual(arrival[1].fromNote, arrival[1].note);
  assert.equal(pitchClass(lead.at(-1).note), chords.at(-1).root);
  for (const e of lead) {
    const bar = config.timeline[e.bar], chord = chords.findLast((item) => item.bar <= e.bar);
    assert.ok(e.step >= bar.startStep && e.step < bar.startStep + bar.stepsPerBar);
    assert.ok(e.duration > 0 && e.time >= bar.time && e.time + e.duration <= bar.time + bar.duration);
    assert.ok(chord.pitchClasses.includes(pitchClass(e.note)) && Math.abs(e.note - e.fromNote) <= 2);
    assert.ok(Number.isFinite(e.frequency) && Number.isFinite(e.fromFrequency));
  }
  const layered = compose('Western swing, 16 bars', options).parts.find((part) => part.name === 'steel_answers');
  assert.ok(layered?.events.some((e) => e.steel === 'reply' && e.part === layered.name && e.role === 'counterpoint'));
});

test('a pedal-steel reply holds its starting pitch, then settles at its target', () => {
  const sampleRate = 8000;
  const event = { voice: 'lead', profile: 'pedal_steel', steel: 'reply', note: 69, fromNote: 67, duration: 1 };
  const voice = instrumentVoice(event, sampleRate, random('steel pitch'));
  const crossings = [];
  let previous = 0;
  for (let i = 0; i < sampleRate; i++) {
    const sample = voice(i / sampleRate);
    if (previous < 0 && sample >= 0) crossings.push((i - sample / (sample - previous)) / sampleRate);
    previous = sample;
  }
  const frequency = (start, end) => {
    const window = crossings.filter((time) => time >= start && time <= end);
    return (window.length - 1) / (window.at(-1) - window[0]);
  };
  assert.ok(Math.abs(frequency(.025, .055) - midiHz(67)) < 2);
  assert.ok(Math.abs(frequency(.36, .48) - midiHz(69)) < 2);
});

test('classical reuses broken figures and supports legato strings, cello, harp and flute', () => {
  const piano = compose('classical');
  assert.equal(piano.config.synthProfile, 'acoustic_piano');
  assert.equal(Object.values(piano.drums).flat().length + piano.bass.length, 0);
  assert.ok(piano.keys.some((e) => e.role === 'piano_figure'));
  const strings = compose('classical with bowed strings and cello');
  assert.equal(strings.config.soundDesign.harmonyPattern, 'legato');
  assert.ok(strings.keys.every((e) => e.profile === 'bowed_strings' && e.duration > 1));
  assert.ok(strings.lead.length && strings.lead.every((e) => e.profile === 'cello' && e.note < 72));
  assert.ok(compose('classical with harp and flute').keys.every((e) => e.profile === 'harp'));
});

test('named acoustic instrument exclusions and role exclusions survive prompt selection', () => {
  for (const prompt of ['country with banjo and fiddle, no banjo or fiddle', 'jazz with saxophone, no saxophone', 'classical with flute, no lead']) {
    const s = compose(prompt);
    assert.equal(s.lead.length + s.arp.length, 0, prompt);
  }
  assert.equal(compose('country, no acoustic guitar').keys.length, 0);
  const keysOff = compose('jazz with vibraphone and saxophone, no keys');
  assert.equal(keysOff.keys.length + keysOff.lead.length + keysOff.arp.length, 0);
  assert.equal(compose('jazz without piano').keys.some((e) => e.profile === 'acoustic_piano'), false);
});

test('all acoustic algorithms render distinct deterministic non-silent audio', () => {
  const hashes = new Set();
  for (const profile of Object.keys(INSTRUMENTS)) {
    const score = isolated(profile);
    const audio = renderAudio(score, { sampleRate: 16000 });
    assert.ok(audio.stats.rms > .004, `${profile} silent`);
    assert.ok(Number.isFinite(audio.stats.rms) && audio.stats.peak <= .81);
    assert.equal(fingerprint(audio), fingerprint(renderAudio(score, { sampleRate: 16000 })), profile);
    hashes.add(fingerprint(audio));
  }
  assert.equal(hashes.size, Object.keys(INSTRUMENTS).length);
});

test('string models track pitch and bowed instruments sustain longer than struck/plucked instruments', () => {
  for (const sr of [8000, 44100]) {
    const f = midiHz(57), sample = instrumentVoice({ profile: 'acoustic_guitar', note: 57 }, sr, random(3, 'pitch'));
    const values = Float64Array.from({ length: Math.floor(sr * .3) }, (_, i) => sample(i / sr));
    let best = 0, bestLag = 0;
    for (let lag = Math.floor(sr / f * .85); lag <= Math.ceil(sr / f * 1.15); lag++) {
      let energy = 0;
      for (let i = Math.floor(sr * .1); i < values.length - lag; i++) energy += values[i] * values[i + lag];
      if (energy > best) { best = energy; bestLag = lag; }
    }
    assert.ok(Math.abs(sr / bestLag - f) / f < .035, `String pitch drift at ${sr}`);
  }
  const bow = renderAudio(isolated('fiddle'), { sampleRate: 16000 });
  const piano = renderAudio(isolated('acoustic_piano'), { sampleRate: 16000 });
  assert.ok(rms(bow, 1.1, 1.4) / rms(bow, .15, .4) > .7);
  assert.ok(rms(piano, 1.1, 1.4) / rms(piano, .15, .4) < .7);
  const banjo = renderAudio(isolated('banjo'), { sampleRate: 16000 });
  assert.ok(rms(banjo, 1.1, 1.4) < rms(banjo, .15, .4) * .3);
});

test('new styles render complete finite arrangements and replay across seeds', () => {
  for (const prompt of [...Object.keys(styles), 'jazz with vibraphone and saxophone', 'classical with harp and flute', 'country with banjo and fiddle']) {
    const score = compose(prompt, { seed: 917, sauce: .3 });
    assert.deepEqual(score, compose(prompt, { seed: 917, sauce: .3 }));
    assert.notDeepEqual(score.keys, compose(prompt, { seed: 918, sauce: .3 }).keys);
    for (const e of scoreEvents(score)) {
      assert.ok(Number.isFinite(e.time) && e.time >= 0 && e.time < score.config.duration, prompt);
      assert.ok(e.duration > 0 && Number.isFinite(e.duration));
    }
    for (let i = 0; i < score.bass.length - 1; i++) assert.ok(score.bass[i].time + score.bass[i].duration <= score.bass[i + 1].time + 1e-8);
    const audio = renderAudio(score, { sampleRate: 8000 });
    assert.equal(audio.frames, Math.round(score.config.duration * 8000));
    assert.ok(Number.isFinite(audio.stats.rms) && audio.stats.rms > .008, prompt);
    assert.ok(audio.stats.peak <= .81);
  }
});

test('timing extremes remain inside the track and preserve positive roll cells', () => {
  for (const bpm of [40, 240]) {
    const s = compose(`trap ${bpm}bpm, swing 75, hat offset 30ms, snare offset -30ms`, { seed: 3, sauce: 1 });
    for (const e of scoreEvents(s)) {
      assert.ok(e.time >= 0 && e.time < s.config.duration);
      assert.ok(Number.isFinite(e.duration) && e.duration > 0);
      if (e.ratchet) assert.ok(e.time + e.duration <= s.config.duration + 1e-8);
    }
  }
});

test('existing electric piano recipes and explicit halftime cues override new defaults', () => {
  assert.equal(compilePrompt('jazz with electric piano').synthProfile, 'jazz_keys');
  assert.equal(compilePrompt('classical with rhodes').synthProfile, 'rhodes_stabs');
  const score = compose('liquid dnb with halftime drums', { sauce: 0 });
  const strong = score.drums.snare.filter((e) => e.bar === 20 && e.velocity > .65);
  assert.deepEqual(strong.map((e) => e.step % 16), [8]);
  const config = compilePrompt('deep house, hat swing 65');
  near(grooveTime(config, 1, 'open_hat'), grooveTime(config, 1, 'hat'));
});
