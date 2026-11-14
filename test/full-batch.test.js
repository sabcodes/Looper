import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { compose, compilePrompt, renderAudio, sliceAudio, archetypes, analyzeScore } from '../src/index.js';
import { PERCUSSION_VOICES } from '../src/instruments.js';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const requested = {
  'soulful house': 'soulful_house', 'tech house': 'tech_house', bassline: 'bassline', 'UK funky': 'uk_funky',
  jungle: 'jungle', 'jump-up': 'jump_up', neurofunk: 'neurofunk', 'minimal techno': 'minimal_techno',
  'dub techno': 'dub_techno', 'industrial techno': 'industrial_techno', 'acid techno': 'acid_techno',
  'boom bap': 'boom_bap', 'alternative R&B': 'alternative_rnb', Memphis: 'memphis', phonk: 'phonk',
  gqom: 'gqom', 'private-school piano': 'private_school_piano', sgija: 'sgija', dancehall: 'dancehall',
  reggaeton: 'reggaeton', 'Dominican dembow': 'dominican_dembow', 'classic electro': 'electro',
  'Miami bass': 'miami_bass', 'progressive trance': 'progressive_trance', psytrance: 'psytrance',
  'trip-hop': 'trip_hop', dub: 'dub',
};
const hash = (a) => createHash('sha256').update(a.pcm).digest('hex');
const events = (s) => [...Object.values(s.drums).flat(), ...s.keys, ...s.bass, ...s.lead, ...s.arp];
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);
const locals = (s, voice, bar) => (s.drums[voice] ?? []).filter((e) => e.bar === bar).map((e) => e.step - bar * s.config.stepsPerBar);

test('every remaining requested genre selects a dedicated preset and supports exclusions', () => {
  assert.equal(Object.keys(requested).length, 27);
  for (const [name, id] of Object.entries(requested)) {
    const config = compilePrompt(`${name} in F minor at 120bpm`);
    assert.equal(config.intent, id, name); assert.equal(config.root, 5); assert.equal(config.bpm, 120);
    assert.ok(config.rhythm.kick.length && config.rhythm.bass.length);
    assert.equal(compilePrompt(`country, not ${name}`).intent, 'country_acoustic');
  }
});

test('neighboring styles differ in actual pattern or instrument choices', () => {
  const signature = (prompt) => {
    const s = compose(prompt, { seed: 7, sauce: 0 });
    return JSON.stringify([locals(s, 'kick', 20), locals(s, 'snare', 20),
      s.bass.filter((e) => e.bar === 20).map((e) => [e.step % 16, e.profile]),
      s.keys.filter((e) => e.bar === 20).map((e) => [e.step % 16, e.note, e.profile]),
      s.lead.filter((e) => e.bar === 20).map((e) => e.profile)]);
  };
  for (const [a, b] of [['soulful house', 'tech house'], ['bassline', 'UK funky'], ['jungle', 'jump up'],
    ['jump up', 'neurofunk'], ['minimal techno', 'dub techno'], ['dub techno', 'industrial techno'],
    ['boom bap', 'lofi'], ['Memphis', 'phonk'], ['private school piano', 'sgija'],
    ['dancehall', 'reggaeton'], ['reggaeton', 'Dominican dembow'], ['electro', 'Miami bass'],
    ['progressive trance', 'psytrance'], ['trip hop', 'dub']]) assert.notEqual(signature(a), signature(b), `${a} / ${b}`);
  const trance = compose('progressive trance');
  assert.deepEqual(trance.sections.find((s) => s.name === 'build'), { ...trance.sections.find((s) => s.name === 'build'), start: 12, end: 20 });
  assert.ok(trance.arp.length && trance.lead.length);
  assert.equal(compose('private school piano').config.soundDesign.harmonyColor, 'ninths');
});

test('all added percussion produces distinct non-silent isolated audio', () => {
  const hashes = new Set();
  for (const voice of PERCUSSION_VOICES) {
    const s = compose('classical');
    s.config.duration = 1;
    s.keys = [];
    s.drums[voice] = [{ voice, profile: voice, time: 0, duration: .8, velocity: .7, note: 60 }];
    const audio = renderAudio(s, { sampleRate: 16000, voices: [voice] });
    assert.ok(audio.stats.rms > .002, voice); assert.ok(audio.stats.peak <= .81);
    hashes.add(hash(audio));
  }
  assert.equal(hashes.size, PERCUSSION_VOICES.length);
});

test('808, 909 and soft kits change rendered drums', () => {
  const hashes = new Set();
  for (const kit of ['808', '909', 'soft']) {
    const s = compose(`house with ${kit} kit, drums only`, { sauce: 0 });
    assert.equal(s.config.soundDesign.drumKit, kit);
    s.config.duration = 2;
    hashes.add(hash(renderAudio(s, { sampleRate: 16000 })));
  }
  assert.equal(hashes.size, 3);
});

test('clave directions are complementary two-bar patterns, and tresillo accents repeat', () => {
  const a = compose('house, 3-2 son clave', { sauce: 0 });
  const b = compose('house, 2-3 son clave', { sauce: 0 });
  assert.deepEqual(locals(a, 'claves', 20), [0, 6, 12]);
  assert.deepEqual(locals(a, 'claves', 21), [4, 8]);
  assert.deepEqual(locals(b, 'claves', 20), [4, 8]);
  assert.deepEqual(locals(b, 'claves', 21), [0, 6, 12]);
  assert.equal(compilePrompt('house, 2/3 clave').timeSignature, '4/4');
  const t = compose('house with tresillo', { sauce: 0 });
  assert.deepEqual(locals(t, 'kick', 20), [0, 6, 12]);
  assert.deepEqual(t.bass.filter((e) => e.bar === 20).map((e) => e.step % 16), [0, 6, 12]);
});

test('three-against-two uses evenly spaced independent pulse trains', () => {
  const s = compose('house, 3 against 2 polyrhythm', { sauce: 0 });
  const three = s.drums.agogo.filter((e) => e.bar === 20);
  assert.equal(three.length, 3);
  assert.equal(s.drums.woodblock.filter((e) => e.bar === 20).length, 2);
  near(three[1].time - three[0].time, s.config.stepsPerBar * s.config.stepSeconds / 3);
  near(three[2].time - three[1].time, three[1].time - three[0].time);
});

test('long percussion cycles cross bar boundaries and call/response leaves bass-only controls independent', () => {
  const s = compose('house, percussion cycle 15 steps', { sauce: 0 });
  const steps = s.drums.woodblock.map((e) => e.step);
  for (const step of steps) assert.notEqual(Math.floor((step + 1) * 2 / 15), Math.floor(step * 2 / 15));
  assert.notDeepEqual(locals(s, 'woodblock', 20), locals(s, 'woodblock', 21));
  const odd = compose('minimal techno in 5/4 at 128 BPM with a woodblock percussion cycle of 15 steps', { sauce: 0 });
  assert.equal(odd.config.groove.cycleSteps, 15);
  assert.equal(odd.config.stepsPerBar, 20);
  assert.ok(odd.drums.woodblock.length > 0);
  assert.deepEqual(odd.drums.woodblock, compose('minimal techno in 5/4 at 128 BPM with a woodblock percussion cycle 15 steps', { sauce: 0 }).drums.woodblock);
  for (const invalid of [-4, 3.5, 65]) assert.throws(() => compilePrompt('house percussion cycle of ' + invalid + ' steps'), /whole steps/);
  const response = compose('house, drum call and response', { sauce: 0 });
  assert.notDeepEqual(locals(response, 'kick', 20), locals(response, 'kick', 21));
  const held = compose('industrial bass', { sauce: 0 });
  const bassOnly = compose('industrial bass, call and response bass phrases', { sauce: 0 });
  assert.deepEqual(held.drums, bassOnly.drums);
  for (const n of [0, 2, 65]) assert.throws(() => compilePrompt(`house percussion cycle ${n} steps`));
});

test('triplet and shuffle hats follow their actual subdivisions and accept timing offsets', () => {
  for (const [feel, offsets] of [['triplet hats', [0, 4 / 3, 8 / 3]], ['shuffle hats', [0, 8 / 3]]]) {
    const s = compose(`house, ${feel}, hat offset 10ms`, { seed: 21, sauce: 0 });
    const hats = s.drums.hat.filter((e) => e.bar === 20);
    for (const e of hats) {
      const local = e.step % 4;
      assert.ok(offsets.some((value) => Math.abs(value - local) < 1e-7));
      near(e.time, e.step * s.config.stepSeconds + .01);
    }
    assert.ok(hats.some((e) => !Number.isInteger(e.step)));
  }
  assert.ok(compose('house, funk ghost notes', { sauce: 0 }).drums.snare.some((e) => e.velocity < .25));
});

test('mixed role/percussion exclusions suppress default and explicitly named instruments', () => {
  const s = compose('UK funky with vibraphone and saxophone, no piano or claps or saxophone or agogo', { sauce: 0 });
  assert.equal(s.lead.length, 0); assert.equal(s.drums.clap?.length ?? 0, 0); assert.equal(s.drums.agogo?.length ?? 0, 0);
  const p = compose('phonk, no cowbells', { sauce: 0 });
  assert.equal(p.lead.length, 0); assert.equal(p.drums.cowbell?.length ?? 0, 0);
  assert.equal(Object.values(compose('UK funky, no drums').drums).flat().length, 0);
});

test('meter controls bar lengths, musical accents, score analysis and preview boundaries', () => {
  const signatures = { '3/4': [12, [0, 4, 8]], '5/4': [20, [0, 12]], '7/4': [28, [0, 12, 20]],
    '6/8': [12, [0, 6]], '7/8': [14, [0, 4, 8]], '9/8': [18, [0, 6, 12]], '12/8': [24, [0, 6, 12, 18]] };
  for (const [meter, [n, accents]] of Object.entries(signatures)) {
    const s = compose(`house in ${meter} at 120bpm`, { sauce: 0 });
    assert.equal(s.config.stepsPerBar, n); near(s.config.duration, 32 * n * .125);
    assert.deepEqual(locals(s, 'kick', 20), accents);
    for (const e of events(s)) {
      assert.ok(e.time >= 0 && e.time < s.config.duration, `${meter} time`);
      assert.ok(e.step >= e.bar * n && e.step < (e.bar + 1) * n, `${meter} step`);
      assert.ok(Number.isFinite(e.duration) && e.duration > 0, `${meter} duration`);
    }
    const audio = renderAudio(s, { sampleRate: 8000 });
    assert.equal(audio.frames, Math.round(s.config.duration * 8000));
    assert.equal(sliceAudio(audio, 20 * n * .125, 1).frames, 8000);
    assert.ok(Number.isFinite(analyzeScore(s).bassGateCoverage));
  }
  for (const prompt of ['house -3/4', 'house 3/-4', 'house 0/4', 'house 4/0', 'house 11/16', 'house 3/4 and 7/8']) assert.throws(() => compilePrompt(prompt));
});

test('every preset composes in all supported meters with finite event times and monophonic bass', () => {
  for (const a of Object.values(archetypes)) for (const meter of ['4/4', '3/4', '6/8', '7/8', '5/4', '7/4', '9/8', '12/8']) {
    const s = compose(`${a.aliases[0]} ${meter}`, { seed: 85, sauce: .8 });
    for (const e of events(s)) assert.ok(Number.isFinite(e.time) && e.time >= 0 && e.time < s.config.duration && e.duration > 0, `${a.id} ${meter}`);
    for (let i = 0; i < s.bass.length - 1; i++) assert.ok(s.bass[i].time + s.bass[i].duration <= s.bass[i + 1].time + 1e-8, `${a.id} ${meter} overlapping bass`);
  }
});

test('all remaining genres render full non-silent tracks with bounded peaks', () => {
  for (const [name, id] of Object.entries(requested)) {
    const s = compose(name, { seed: 49, sauce: .3 });
    assert.equal(s.config.intent, id);
    assert.deepEqual(s, compose(name, { seed: 49, sauce: .3 }));
    const audio = renderAudio(s, { sampleRate: 8000 });
    assert.ok(Number.isFinite(audio.stats.rms) && audio.stats.rms > .008, name);
    assert.ok(audio.stats.peak <= .81, name);
  }
});

test('CLI dry-run exposes new styles and the requested meter without writing audio', () => {
  const r = spawnSync(process.execPath, ['bin/makebeats.js', 'psytrance 7/8 with marimba', '--dry-run'], { encoding: 'utf8', maxBuffer: 4e6 });
  assert.equal(r.status, 0, r.stderr);
  const score = JSON.parse(r.stdout);
  assert.equal(score.config.intent, 'psytrance'); assert.equal(score.config.timeSignature, '7/8');
});

test('expanded analysis vocabulary covers all presets and edge-case timing remains valid', () => {
  const descriptions = JSON.parse(readFileSync(new URL('../data/analysis-descriptions.json', import.meta.url)));
  assert.deepEqual(Object.keys(descriptions.genres).sort(), Object.keys(archetypes).sort());
  const score = compose('tech house 7/4 at 240bpm with acoustic guitar, swing 75, keys offset 30ms', { sauce: 1 });
  for (const e of events(score)) assert.ok(e.time >= 0 && e.time < score.config.duration && e.duration > 0);
  const odd = compose('house in 7/8 with 3 against 2 polyrhythm', { sauce: 0 });
  const two = odd.drums.woodblock.filter((e) => e.bar === 20);
  near(two[1].time - two[0].time, 7 * odd.config.stepSeconds);
});
