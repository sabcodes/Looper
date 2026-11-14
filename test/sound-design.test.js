import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeAudio } from '../src/export.js';
import { compose, compilePrompt, renderAudio, sliceAudio, analyzeScore } from '../src/index.js';
import { StateVariableFilter } from '../src/filter.js';
const hash = (a) => createHash('sha256').update(a.pcm).digest('hex');

const prompts = {
  pop: '80s synth pop in D major at 112bpm with a memorable lead melody, warm sustained pads, bright arpeggios, octave bass and gated snares, no piano',
  metal: 'dark heavy metallic bass in F minor at 100bpm with deep crunchy extended bass throughout the song, slow filter movement, sparse drums and no piano',
  dub: '140bpm halftime dubstep in F minor with deep dark synth pads, growling wobble bass and alternating bass phrases, no piano',
};

test('new requests resolve to distinct sound arrangements', () => {
  assert.equal(compilePrompt('synth pop 80s song').intent, 'synthpop_80s');
  assert.equal(compilePrompt('dark heavy metallic bass').intent, 'industrial_bass');
  assert.equal(compilePrompt('dubstep bass with deep dark synths').intent, 'dubstep_halftime');
  const house = compilePrompt('house with sustained metallic bass and no piano');
  assert.equal(house.intent, 'house_bright');
  assert.equal(house.soundDesign.bassArticulation, 'sustained');
  assert.equal(house.bassProfile, 'metallic_reese');
});

test('bass articulation does not confuse sustained pads with sustained bass', () => {
  const c = compilePrompt(prompts.pop);
  assert.equal(c.soundDesign.bassArticulation, 'genre');
  assert.equal(c.bassMode, 'octave_pulse');
  assert.equal(compilePrompt('industrial bass with staccato bass').soundDesign.bassArticulation, 'staccato');
});

test('continuous bass covers the entire timeline and is not retriggered by each kick', () => {
  const score = compose(prompts.metal, { seed: 202, sauce: 1 });
  const m = analyzeScore(score);
  assert.equal(m.bassEventCount, 16);
  assert.ok(m.bassMedianDurationBeats > 7.9);
  assert.ok(m.bassGateCoverage > .9999);
  assert.equal(m.bassPhrasePatterns, 1, 'Unused wobble settings must not create artificial phrase variety.');
  assert.equal(score.bass[0].time, 0);
  assert.ok(score.bass.some((e) => e.bar === 12));
  assert.ok(!score.automation.some((e) => e.type === 'air'));
  assert.ok(score.drums.kick.length > score.bass.length);
});

test('no piano is an instrument exclusion, while pad harmony remains available', () => {
  for (const prompt of Object.values(prompts)) {
    const score = compose(prompt);
    assert.equal(analyzeScore(score).pianoVoiceCount, 0);
    assert.ok(score.keys.length > 0);
    assert.ok(score.keys.every((e) => e.duration > 2));
  }
  const score = compose('synth pop, no lead, no arpeggios, no chords');
  assert.equal(score.lead.length, 0); assert.equal(score.arp.length, 0); assert.equal(score.keys.length, 0);
});

test('synth-pop has a hook, an answering rhythm, arpeggios and gated backbeats', () => {
  const score = compose(prompts.pop, { seed: 201 });
  const m = analyzeScore(score);
  assert.ok(m.leadNoteCount >= 100); assert.ok(m.leadUniquePitches >= 5);
  assert.ok(m.leadRhythmicPatterns >= 3); assert.ok(m.arpeggioNoteCount > 100);
  assert.deepEqual(new Set(score.lead.map((e) => e.phrase)), new Set(['hook', 'answer']));
  assert.ok(score.drums.snare.some((e) => e.profile === 'gated_snare'));
  for (const e of [...score.lead, ...score.arp]) assert.ok(score.config.intervals.includes((e.note - score.config.root) % 12));
});

test('dubstep combines halftime backbeats with distinct bass phrases and wobble rates', () => {
  const score = compose(prompts.dub, { seed: 203, sauce: 0 });
  const m = analyzeScore(score);
  const anchors = score.drums.snare.filter((e) => e.velocity >= .65 && e.bar >= 4 && e.bar < 12);
  assert.ok(anchors.length > 0); for (const e of anchors) assert.equal(e.step % 16, 8);
  assert.ok(m.bassPhrasePatterns >= 3);
  assert.ok(new Set(score.bass.map((e) => e.wobbleBeats)).size >= 3);
  assert.ok(score.bass.some((e) => e.duration > 1));
  assert.ok(score.bass.some((e) => e.duration < .4));
});

function isolated(profile, extra = {}) {
  const config = compilePrompt('house');
  config.duration = 2;
  return { config, drums: { kick: [], snare: [], hat: [], tom: [] }, keys: [], lead: [], arp: [],
    bass: [{ voice: 'bass', time: 0, duration: 2, velocity: .8, note: 29, profile, motion: 'slow', drive: 5, ...extra }],
    automation: [], sidechain: { duckDb: -21, tauSeconds: .055 } };
}
function rms(audio, from, to) {
  let power = 0, n = 0;
  for (let i = Math.round(from * audio.sampleRate); i < Math.round(to * audio.sampleRate); i++) {
    const v = audio.pcm.readInt16LE(i * 4) / 32767; power += v * v; n++;
  }
  return Math.sqrt(power / n);
}
function highFraction(audio, cutoff = 180) {
  let low = 0, highPower = 0, total = 0;
  const a = 1 - Math.exp(-2 * Math.PI * cutoff / audio.sampleRate);
  for (let i = 0; i < audio.frames; i++) {
    const v = audio.pcm.readInt16LE(i * 4) / 32767;
    low += a * (v - low); highPower += (v - low) ** 2; total += v * v;
  }
  return highPower / total;
}

test('upright bass keeps its low body while the bright string noise decays', () => {
  for (const note of [29, 36, 43]) {
    const score = isolated('upright_bass', { note, duration: .6 });
    const audio = renderAudio(score, { sampleRate: 16000, raw: true, normalize: false });
    assert.ok(rms(audio, .2, .5) > .07);
    assert.ok(highFraction(audio, 500) < .06);
  }
});

test('the rendered held bass sustains, and metallic midrange differs from a plain sub', () => {
  const metal = renderAudio(isolated('metallic_reese'), { sampleRate: 16000 });
  const clean = renderAudio(isolated('garage_sub'), { sampleRate: 16000 });
  assert.ok(rms(metal, 1.4, 1.8) > rms(metal, .2, .6) * .5);
  assert.ok(highFraction(metal) > highFraction(clean) * 2);
  const staticBass = renderAudio(isolated('metallic_reese', { motion: 'none' }), { sampleRate: 16000 });
  assert.notEqual(hash(metal), hash(staticBass));
});

test('new voices are deterministic, finite, non-silent and support isolated stems', () => {
  for (const prompt of Object.values(prompts)) {
    const score = compose(prompt, { seed: 42, sauce: .3 });
    const audio = renderAudio(score, { sampleRate: 8000 });
    assert.ok(audio.stats.rms > .035 && audio.stats.rms < .5);
    assert.ok(audio.stats.peak <= .93);
    assert.equal(hash(audio), hash(renderAudio(score, { sampleRate: 8000 })));
  }
  const score = compose(prompts.pop);
  const lead = renderAudio(score, { sampleRate: 8000, voices: ['lead'] });
  assert.ok(lead.stats.rms > .005);
  assert.throws(() => renderAudio(score, { voices: ['unknown'] }), /Unknown stem/);
});

test('moving resonant filter remains bounded through cutoff changes', () => {
  const filter = new StateVariableFilter(16000);
  let energy = 0;
  for (let i = 0; i < 32000; i++) {
    const y = filter.process(Math.sin(i * .1), 50 + 6000 * (i / 32000), 2);
    assert.ok(Number.isFinite(y) && Math.abs(y) < 6);
    energy += y * y;
  }
  assert.ok(energy > 0);
});


test('previews use the requested PCM interval and preserve the original render', () => {
  const audio = renderAudio(isolated('metallic_reese'), { sampleRate: 16000 });
  const original = hash(audio);
  const preview = sliceAudio(audio, .5, 1);
  assert.equal(preview.frames, 16000); assert.equal(preview.pcm.length, 64000);
  assert.equal(preview.pcm.readInt16LE(0), 0); assert.equal(preview.pcm.readInt16LE(preview.pcm.length - 2), 0);
  assert.equal(preview.pcm.readInt16LE(4000 * 4), audio.pcm.readInt16LE(12000 * 4));
  assert.equal(hash(audio), original);
  assert.throws(() => sliceAudio(audio, -1, 1)); assert.throws(() => sliceAudio(audio, 3, 1));
});


test('synth-pop MP3 retains true-peak headroom after encoding', { skip: spawnSync('ffmpeg', ['-version']).status !== 0 }, async () => {
  await mkdir(fileURLToPath(new URL('../generated_beats/', import.meta.url)), { recursive: true });
  const directory = await mkdtemp(fileURLToPath(new URL('../generated_beats/.peak-check-', import.meta.url)));
  try {
    const score = compose(prompts.pop, { seed: 201, sauce: .18 });
    const audio = renderAudio(score);
    const path = join(directory, 'synthpop.mp3');
    await writeAudio(path, audio, { format: 'mp3' });
    const result = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', path, '-af', 'ebur128=framelog=verbose:peak=true', '-f', 'null', '-'], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    const peaks = [...result.stderr.matchAll(/Peak:\s+(-?[\d.]+) dBFS/g)];
    assert.ok(peaks.length > 0);
    assert.ok(Number(peaks.at(-1)[1]) <= -.5, 'Encoded MP3 lost its headroom');
  } finally { await rm(directory, { recursive: true, force: true }); }
});


test('dark analog and distorted analog textures retain the selected genre', () => {
  const clean = compilePrompt('house with sustained deep dark analog synth bass, no piano');
  const heavy = compilePrompt('house with sustained distorted dark analog synth bass, no piano');
  assert.equal(clean.intent, 'house_bright'); assert.equal(heavy.intent, 'house_bright');
  assert.equal(clean.bassProfile, 'dark_analog_bass');
  assert.equal(clean.soundDesign.bassArticulation, 'sustained');
  assert.equal(heavy.bassProfile, 'dark_distorted_bass');
  assert.equal(compilePrompt('industrial bass with wide dark synth pads').synthProfile, 'dark_wide_pad');
});

test('analog profiles sustain with different harmonic weight and a wide pad swells slowly', () => {
  const clean = renderAudio(isolated('dark_analog_bass'), { sampleRate: 16000 });
  const heavy = renderAudio(isolated('dark_distorted_bass'), { sampleRate: 16000 });
  assert.notEqual(hash(clean), hash(heavy));
  assert.ok(highFraction(heavy) > highFraction(clean) * 1.15);
  assert.ok(rms(clean, 1.4, 1.8) > rms(clean, .2, .6) * .6);
  const score = isolated('dark_analog_bass');
  score.bass = [];
  score.keys = [{ voice: 'keys', profile: 'dark_wide_pad', time: 0, duration: 2, velocity: .8, note: 48, pan: .6 }];
  const pad = renderAudio(score, { sampleRate: 16000 });
  assert.ok(rms(pad, .8, 1.2) > rms(pad, .04, .14) * 2);
});


test('bass phrasing changes timing, accents and pitch while keeping the synth recipe', () => {
  const base = 'industrial bass in F minor at 100bpm, sustained distorted dark analog synth bass throughout, no piano';
  const held = compose(base, { seed: 202, sauce: 0 });
  const bounce = compose(base + ', bouncy bass riff', { seed: 202, sauce: 0 });
  const answers = compose(base + ', call and response bass phrases', { seed: 202, sauce: 0 });
  assert.equal(held.config.soundDesign.bassPhrasing, 'held');
  assert.equal(bounce.config.soundDesign.bassPhrasing, 'bounce');
  assert.equal(answers.config.soundDesign.bassPhrasing, 'call_response');
  for (const score of [held, bounce, answers]) {
    assert.deepEqual(score.drums, held.drums);
    assert.ok(score.bass.every((e) => e.profile === 'dark_distorted_bass' && e.drive === 5));
    for (let i=0;i<score.bass.length-1;i++) assert.ok(score.bass[i].time + score.bass[i].duration <= score.bass[i+1].time + 1e-8);
  }
  assert.ok(analyzeScore(held).bassGateCoverage > .99);
  assert.ok(analyzeScore(bounce).bassGateCoverage < .9);
  assert.ok(analyzeScore(answers).bassPhrasePatterns >= 3);
  assert.ok(new Set(bounce.bass.map((e) => e.velocity)).size > 2);
  assert.ok(bounce.bass.some((e) => e.duration < .3));
  assert.ok(answers.bass.some((e) => e.duration > 2));
});

test('exclusion lists respect roles, positive comma clauses and instrument-only requests', () => {
  const a = compose('synth pop, no piano or lead or arpeggios');
  assert.equal(a.keys.some((e) => ['fm_piano','dusty_rhodes'].includes(e.profile)), false);
  assert.equal(a.lead.length + a.arp.length, 0);
  const b = compose('garage, no lead, bass between the kicks');
  assert.ok(b.bass.length > 0);
  const c = compose('industrial bass only, no drums, no chords or lead or arpeggios');
  assert.ok(c.bass.length > 0); assert.equal(c.keys.length + c.lead.length + c.arp.length + Object.values(c.drums).flat().length, 0);
  const d = compose('footwork, drums only');
  assert.equal(d.bass.length + d.keys.length + d.lead.length + d.arp.length, 0);
  assert.ok(Object.values(d.drums).flat().length > 0);
  const e = compose('amapiano, no keys');
  assert.equal(e.keys.length + e.lead.length + e.arp.length, 0); assert.ok(e.bass.length > 0);
  assert.equal(compilePrompt('techno, not house, no piano').soundDesign.harmonyRole, 'stabs');
  assert.equal(compilePrompt('house, no piano').soundDesign.harmonyRole, 'pads');
});

test('techno has its own driving kick/bass pattern and explicit slots override defaults', () => {
  const score = compose('90s techno, not house, in B flat major at 132bpm, no piano', { sauce: 0 });
  assert.equal(score.config.intent, 'techno_rave'); assert.equal(score.config.root, 10); assert.equal(score.config.scale, 'major');
  assert.deepEqual(score.drums.kick.filter((e) => e.bar === 20).map((e) => e.step % 16), [0,4,8,12]);
  assert.deepEqual(score.bass.filter((e) => e.bar === 20).map((e) => e.step % 16), [0,3,4,6,8,11,12,14]);
  assert.equal(score.config.classification.source, 'explicit');
  assert.equal(compilePrompt('a happy day at the beach').classification.needsInterpretationReview, true);
});
