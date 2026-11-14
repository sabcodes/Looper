import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compose, analyzeScore } from '../src/index.js';

const renderScore = (prompt, seed = 5030) => compose(prompt, { seed, sauce: 0 });
test('a bare key and spelled-out seventh chords survive a Blueprint style choice', () => {
  const prompt = 'Soft offbeat electric piano seventh chords and a skipping bassline. A minor, 110 BPM.';
  for (const intentOverride of [undefined, 'deep_house']) {
    const score = compose(prompt, { seed: 42, sauce: 0, intentOverride });
    assert.equal(score.config.rootName, 'A');
    assert.equal(score.config.scale, 'minor');
    assert.equal(score.config.bpm, 110);
    assert.ok(score.config.classification.scores.every((style) => !style.explicit));
    assert.ok(score.chords.every((chord) => new Set(chord.pitchClasses).size === 4));
  }
  assert.equal(renderScore('A UK bassline track').config.classification.source, 'explicit');
  assert.equal(renderScore('A minor change to a warm groove').config.rootName, 'C');
  const modulating = renderScore('House in D minor, modulate to G major at bar 9');
  assert.equal(modulating.config.rootName, 'D');
  assert.equal(modulating.chords.find((chord) => chord.bar === 8).keyRoot, 7);
});

test('night-drive context produces dark bass-led electronics instead of bright piano', () => {
  for (const prompt of ['Something dark for a late night drive', 'An ominous soundtrack for driving after midnight']) {
    const s = renderScore(prompt);
    assert.ok(['techno_rave','industrial_bass','dubstep_halftime','synthwave_retro'].includes(s.config.intent), s.config.intent);
    assert.equal(analyzeScore(s).pianoVoiceCount, 0);
    assert.ok(['reese_bass','dark_analog_bass','dark_distorted_bass','growl_bass'].includes(s.config.bassProfile), s.config.bassProfile);
  }
});
test('reading and relaxation favor quiet jazz or piano with restrained tempo', () => {
  for (const prompt of ['Music to relax and read to', 'A peaceful instrumental for unwinding with a book']) {
    const s = renderScore(prompt);
    assert.ok(['jazz_lounge','classical_minimal'].includes(s.config.intent), s.config.intent);
    assert.ok(s.config.bpm <= 90, String(s.config.bpm));
    assert.equal(s.lead.length + s.arp.length, 0);
    assert.ok(analyzeScore(s).pianoVoiceCount > 0);
  }
});
test('bounce and workout language affect the actual groove and energy', () => {
  const bounce = renderScore('Make it bounce');
  assert.ok(['jersey_club','chicago_footwork','hiphop_bounce','dnb_rolling','drill_sliding'].includes(bounce.config.intent), bounce.config.intent);
  const energetic = renderScore('An intense workout beat');
  const calm = renderScore('A calm rainy evening');
  assert.ok(energetic.config.bpm >= 140, String(energetic.config.bpm));
  assert.ok(calm.config.bpm <= 95, String(calm.config.bpm));
  assert.ok(energetic.config.density > calm.config.density);
  assert.ok(energetic.drums.kick.length > calm.drums.kick.length);
});
test('road-trip, nostalgic and rainy contexts produce different arrangements', () => {
  const road = renderScore('Bright upbeat music for a road trip');
  const warm = renderScore('A warm nostalgic groove');
  const rain = renderScore('A calm rainy evening');
  assert.ok(road.config.bpm >= 118, String(road.config.bpm));
  assert.ok(warm.config.bpm <= 100, String(warm.config.bpm));
  assert.equal(warm.arp.length, 0);
  assert.ok(new Set([road,warm,rain].map((s) => JSON.stringify([s.config.intent,s.config.bpm,s.config.synthProfile,s.config.bassMode]))).size === 3);
});
test('dancefloor and organ cues choose a playable house groove across seeds', () => {
  const briefs = [
    'A warm Sunday dancefloor groove with rich Hammond organ chords, plucked electric bass, tambourine and a steady kick. Add one brief, quiet female spoken hook near the drop.',
    'A Hammond-led groove for the dance floor with electric bass and tambourine.',
  ];
  for (const prompt of briefs) for (const seed of [0, 42, 16000]) {
    const { config, drums } = renderScore(prompt, seed);
    assert.equal(config.intent, 'soulful_house');
    assert.equal(config.bpm, 122);
    assert.equal(config.synthProfile, 'organ');
    assert.equal(config.bassProfile, 'electric_bass');
    assert.deepEqual(drums.kick.filter((e) => e.bar === 8).map((e) => e.step % 16), [0, 4, 8, 12]);
    assert.ok(drums.tambourine.length > 0);
  }
  assert.equal(renderScore('UK garage in F minor at 135 bpm with Hammond for the dance floor').config.intent, 'uk_garage_2step');
  assert.equal(renderScore('Hammond for the dance floor, no drums').drums.kick.length, 0);
  assert.equal(renderScore('Music for the dancefloor without any Hammond organ').config.classification.context.weights.soulful_house, undefined);
});

test('island context uses a related groove and keeps the requested percussion and rounded bass', () => {
  for (const prompt of [
    'A breezy island street party with a laid-back, bouncy riddim, steelpan chords, bongos, and a rounded bass',
    'A relaxed Caribbean courtyard groove with bouncing rhythms, steel pan chords, bongos and deep rounded sub bass',
  ]) for (const seed of [0, 42, 1046]) {
    const score = renderScore(prompt, seed);
    assert.equal(score.config.intent, 'dancehall');
    assert.ok(score.config.bpm >= 86 && score.config.bpm <= 110);
    assert.equal(score.config.bassProfile, 'sine_sub');
    assert.equal(score.config.synthProfile, 'steelpan');
    assert.ok(score.drums.bongo.length && score.drums.kick.length && score.bass.length);
    const drop = score.sections.find((section) => section.name === 'drop').start;
    const voicings = Object.values(Object.groupBy(score.keys.filter((event) => event.bar === drop), (event) => event.step));
    assert.ok(voicings.length && voicings.every((notes) => notes.length >= 3));
  }
  assert.equal(renderScore('A bouncy island riddim, without dancehall').config.intent, 'dub');
  assert.equal(renderScore('Jersey club at 136 bpm for an island party with steelpan').config.intent, 'jersey_club');
  assert.equal(renderScore('A trip to an island with friends').config.classification.context.weights.dancehall, undefined);
});

test('dark heavy techno changes the synth recipe and register while retaining techno', () => {
  const ordinary = renderScore('90s techno with a rolling rave bassline');
  const dark = renderScore('90s techno, not house, at 132bpm; dark heavy subs, no piano or lead');
  assert.equal(dark.config.intent, 'techno_rave');
  assert.notEqual(dark.config.bassProfile, ordinary.config.bassProfile);
  const mean = (notes) => notes.reduce((sum,n) => sum+n.note,0)/notes.length;
  assert.ok(mean(dark.keys) < mean(ordinary.keys), 'Dark synth harmony should sit lower');
  assert.equal(analyzeScore(dark).pianoVoiceCount + dark.lead.length, 0);
  assert.ok(analyzeScore(dark).bassMedianDurationBeats > analyzeScore(ordinary).bassMedianDurationBeats * 2, 'Dark bass should have longer phrases, not just a different label');
});

test('explicit genre, tempo, instruments and exclusions override context defaults', () => {
  const jazz = renderScore('jazz in F minor at 140bpm for reading, metallic bass and no keys');
  assert.equal(jazz.config.intent, 'jazz_lounge'); assert.equal(jazz.config.bpm, 140);
  assert.equal(jazz.config.scale, 'minor'); assert.equal(jazz.config.bassProfile, 'metallic_reese');
  assert.equal(jazz.keys.length + jazz.lead.length + jazz.arp.length, 0);
  const piano = renderScore('dark techno for a night drive with piano');
  assert.equal(piano.config.intent, 'techno_rave'); assert.ok(analyzeScore(piano).pianoVoiceCount > 0);
  const clean = renderScore('dark heavy techno with sustained clean sine bass');
  assert.equal(clean.config.bassProfile, 'sine_sub'); assert.equal(clean.config.soundDesign.bassArticulation, 'sustained');
  assert.notEqual(renderScore('techno, not dark, no piano').config.mood, 'dark');
});

test('paraphrases generalize and vague alternatives stay within musical families across seeds', () => {
  for (const seed of [0,1,2,3,4,5,12,50]) {
    assert.ok(['jazz_lounge','classical_minimal'].includes(renderScore('Peaceful music for an afternoon with a book', seed).config.intent));
    assert.ok(['jersey_club','chicago_footwork','drill_sliding'].includes(renderScore('A bouncy head nod groove', seed).config.intent));
  }
  const a = renderScore('An energetic track for the gym');
  const b = renderScore('Gentle music for a quiet library');
  assert.ok(a.config.bpm > b.config.bpm + 40);
  const replay = renderScore('Something dark for a late night drive', 123);
  assert.deepEqual(replay, renderScore('Something dark for a late night drive', 123));
  assert.ok(replay.config.classification.context.evidence.length > 0);
  assert.ok(replay.config.classification.alternatives.length > 1);
});

test('combined everyday cues infer distinct arrangements across paraphrases without exact prompt matching',()=>{
  const groups=[
    {family:['indie_pop','nu_disco'],prompts:['A breezy soundtrack for cooking lunch with friends while sunlight fills the kitchen','Sunlit brunch together with friends','Easy music while cooking dinner for guests']},
    {family:['alternative_rnb','lofi_chill','synthwave_retro'],prompts:['Music for the last train home: tired but hopeful, with a steady sense of motion','A wistful soundtrack for the bus ride home','Reflective music for a weary commute']},
    {family:['nu_disco','afropop'],prompts:['Restless, playful music for walking quickly through a crowded market','A mischievous soundtrack for a brisk walk','Playful music for strolling through bustling streets']},
  ];
  for(const seed of [0,1,12,50]){
    const plans=[];
    for(const group of groups)for(const prompt of group.prompts){
      const s=renderScore(prompt,seed),c=s.config;
      assert(!c.classification.fallback,prompt+' used neutral fallback');
      assert.equal(c.classification.source,'context',prompt);assert(group.family.includes(c.intent),prompt+': '+c.intent);
      assert(c.classification.context.evidence.length>=2);
      assert.deepEqual(s,renderScore(prompt,seed));
      if(prompt===group.prompts[0])plans.push(JSON.stringify([c.intent,c.bpm,c.density,c.synthProfile,c.bassProfile,s.drums,s.keys]));
    }
    assert.equal(new Set(plans).size,3,'Distinct briefs collapsed into identical musical plans');
  }
  const explicit=renderScore('UK garage in D minor at 141bpm for cooking lunch with friends in a sunny kitchen, no piano or lead');
  assert.equal(explicit.config.intent,'uk_garage_2step');assert.equal(explicit.config.bpm,141);assert.equal(explicit.config.root,2);assert.equal(explicit.config.scale,'minor');
  assert.equal(analyzeScore(explicit).pianoVoiceCount+explicit.lead.length,0);
  for(const prompt of ['Instrumental 32 bars','Music with friends','A recording of train noises'])assert.equal(renderScore(prompt).config.classification.fallback,true,prompt+' over-inferred from an isolated cue');
});
