import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { compose, compilePrompt, renderAudio, progression } from '../src/index.js';
import { barInfo, barStep } from '../src/arrangement.js';
const attacks = (events, c, bar) => [...new Set(events.filter(e=>e.bar===bar).map(e=>Number((e.step-barStep(c,bar)).toFixed(4))))];
const patterns = (s,start=20,end=28) => Array.from({length:end-start},(_,i)=>JSON.stringify(attacks(s.keys,s.config,start+i)));

test('default accompaniment develops a repeated multi-bar phrase instead of one repeated stab bar',()=>{
  for(const prompt of ['deep house with acoustic piano','synth funk with clavinet','progressive house with wavetable']){
    const s=compose(prompt,{seed:918,sauce:0}), p=patterns(s);
    if(s.config.accompaniment.style==='sustain') {
      assert(s.keys.filter(e=>e.bar>=20&&e.bar<28).every(e=>e.duration>s.config.stepSeconds*15),prompt+' does not hold its voicings');
    } else assert(new Set(p).size>=3,prompt+' still repeats the same attacks');
    assert(new Set(p).size<p.length,prompt+' lost all motif repetition');
    assert(s.keys.some(e=>e.duration>s.config.stepSeconds*4),prompt+' has no longer chord/note values');
    assert.deepEqual(s,compose(prompt,{seed:918,sauce:0}));
  }
});

test('explicit held, broken and riff accompaniment alter notes and lengths while preserving drums and bass',()=>{
  const held=compose('deep house with acoustic piano, held chords, 4-bar accompaniment phrases',{seed:41,sauce:0});
  const broken=compose('deep house with acoustic piano, broken chords, 4-bar accompaniment phrases',{seed:41,sauce:0});
  const riff=compose('deep house with acoustic piano, chord riff',{seed:41,sauce:0});
  assert.equal(held.config.bars,32);assert.equal(held.config.accompaniment.phraseBars,4);
  assert(held.keys.filter(e=>e.bar>=20&&e.bar<28).every(e=>e.duration>=held.config.stepSeconds*15));
  assert(new Set(broken.keys.filter(e=>e.bar===20).map(e=>e.step)).size>=6);
  assert.notDeepEqual(attacks(riff.keys,riff.config,20),attacks(held.keys,held.config,20));
  assert.deepEqual(held.drums,broken.drums);assert.deepEqual(held.bass,broken.bass);
  const a=renderAudio(held,{sampleRate:8000,voices:['keys']}),b=renderAudio(broken,{sampleRate:8000,voices:['keys']});
  assert(a.stats.rms>.001&&b.stats.rms>.001);
  const hash=x=>createHash('sha256').update(x.pcm).digest('hex');assert.notEqual(hash(a),hash(b));
});

test('layered harmony shares phrase development and respects explicit independent cycles',()=>{
  const s=compose('house 32 bars with clavinet and rhodes',{seed:12,sauce:0});
  const p=s.parts.find(p=>p.role==='harmony');assert(p?.events.length);
  const shapes=Array.from({length:8},(_,i)=>JSON.stringify(attacks(p.events,s.config,20+i)));
  assert(new Set(shapes).size>=3,'layered harmony still follows a fixed spacing clock');
  const cycle=compose('house 16 bars',{parts:[{name:'answer',profile:'clavinet',role:'harmony',cycle:15}]});
  assert(cycle.parts.find(p=>p.name==='answer').events.every(e=>e.step%15===0));
  const strummed=compose('bluegrass 16 bars',{sauce:0});
  assert.deepEqual(strummed.chords,progression(strummed.config),'layered strums mutated shared chord voicings');
  assert.throws(()=>compose('house',{parts:[{profile:'flute',pattern:'broken'}]}));
  const muted=compose('house with clavinet and rhodes, no keys');
  assert.equal(muted.keys.length,0);assert(!muted.parts.some(p=>p.role==='harmony'));
});

test('meter precedence is explicit then form then genre, with seeded variation only on request',()=>{
  assert.equal(compilePrompt('classical waltz').timeSignature,'3/4');
  assert.equal(compilePrompt('country jig').timeSignature,'6/8');
  assert.equal(compilePrompt('country slip jig').timeSignature,'9/8');
  assert.equal(compilePrompt('classical waltz in 4/4').timeSignature,'4/4');
  assert.equal(compilePrompt('country, not a waltz').timeSignature,'4/4');
  const variants=new Set();
  for(let seed=0;seed<24;seed++){
    assert.equal(compilePrompt('jazz',{seed}).timeSignature,'4/4');
    assert.equal(compilePrompt('jazz, no random meter',{seed}).timeSignature,'4/4');
    assert.equal(compilePrompt('house, vary meter',{seed}).timeSignature,'4/4');
    const c=compilePrompt('jazz, vary meter',{seed});variants.add(c.timeSignature);
    assert.equal(c.timeSignature,compilePrompt('jazz, vary meter',{seed}).timeSignature);
  }
  assert(variants.size>1);
  assert.throws(()=>compilePrompt('house 3-bar accompaniment phrases'));
  assert.equal(compilePrompt('house, no broken chords').accompaniment.source,'genre');
});

test('phrases respect native odd/compound bars, chord changes and the v1.7 timeline',()=>{
  for(const meter of ['3/4','5/4','7/8','6/8','12/8']){
    const s=compose(`jazz 16 bars in ${meter}, broken chords, tempo 90 at bar 9`,{seed:13,sauce:0});
    for(const e of [...s.keys,...s.parts.flatMap(p=>p.events)]){
      const b=barInfo(s.config,e.bar);
      assert(e.step>=b.startStep&&e.step<b.startStep+b.stepsPerBar);
      assert(Number.isFinite(e.time)&&e.time>=0&&e.duration>0&&e.time+e.duration<=s.config.duration+1e-8);
    }
  }
  const s=compose('house 16 bars held chords, chord every 1 bar, change to 7/8 at bar 9 tempo 90 at bar 9',{sauce:0});
  for(const e of s.keys){const b=barInfo(s.config,e.bar);assert(e.time+e.duration<=b.time+b.duration+1e-8);}
});

test('instrument-qualified offbeat requests control actual 4/4 harmony attacks and respect negation',()=>{
  for(const phrase of ['offbeat chords','sparse offbeat organ chords','off-beat electric piano chords','off beat guitar comping']){
    for(const seed of [0,1,7,25]){
      const s=compose('UK garage in F minor at 134bpm, 32 bars, '+phrase+', no lead or arpeggios',{seed,sauce:0});
      assert.equal(s.config.accompaniment.style,'offbeat',phrase);
      assert.equal(s.config.accompaniment.source,'prompt');assert(s.keys.length>0);
      for(const e of s.keys)assert.equal((e.step-barStep(s.config,e.bar))%4,2,phrase+' has a non-upbeat harmony attack');
      assert.deepEqual(s,compose(s.config.prompt,{seed,sauce:0}));
    }
  }
  for(const negative of ['no','not','without','avoid']){
    const c=compilePrompt('UK garage, '+negative+' offbeat organ chords');
    assert.equal(c.accompaniment.source,'genre',negative+' activated a negated request');
  }
  assert.notEqual(compilePrompt('UK garage with offbeat hi-hats and held organ chords').accompaniment.style,'offbeat');
});

test('chord stab requests render short simultaneous voicings across seeds', () => {
  for (const phrase of ['Hammond chord stabs', 'organ stabs', 'offbeat organ chord stabs']) {
    for (const seed of [0, 23, 1042]) {
      const score = compose('Soulful house with ' + phrase, { seed, sauce: 0 });
      const { config, keys } = score;
      assert.equal(config.accompaniment.source, 'prompt');
      assert.equal(config.accompaniment.shortStabs, true);
      const drop = score.sections.find((section) => section.name === 'drop').start;
      const chords = Object.values(Object.groupBy(keys.filter((event) => event.bar === drop), (event) => event.step));
      assert.ok(chords.length > 0);
      for (const chord of chords) {
        assert.ok(chord.length >= 3 && chord.every((event) => event.time === chord[0].time));
        assert.ok(chord.every((event) => event.duration <= 1.5 * config.stepSeconds + 1e-8));
      }
      if (phrase.startsWith('offbeat')) assert.ok(attacks(keys, config, drop).every((step) => step % 4 === 2));
    }
  }
  assert.equal(compilePrompt('house, no chord stabs').accompaniment.style, 'sustain');
  assert.equal(compilePrompt('house without offbeat organ chord stabs').accompaniment.shortStabs, undefined);
});

test('soulful house and dancehall give the response its own slot and articulation', () => {
  for (const [prompt, profile, partName, articulation, step, meter] of [
    ['soulful house with Hammond chords and electric bass', 'organ', 'rhodes_answer', 'staccato', 11, '4/4'],
    ['dancehall with steelpan chords, bongos and rounded sub bass', 'steelpan', 'guitar_answer', 'palm_mute', 14, '4/4'],
    ['soulful house with Hammond chords, tempo 105 at bar 9', 'organ', 'rhodes_answer', 'staccato', 9, '7/8'],
    ['dancehall with steelpan chords', 'steelpan', 'guitar_answer', 'palm_mute', 8, '6/8'],
  ]) {
    for (const seed of [1, 4, 9]) {
      const score = compose(prompt + ' in ' + meter, { seed, sauce: 0 });
      const { config, keys } = score;
      const part = score.parts.find(p => p.name === partName);
      assert.equal(config.synthProfile, profile);
      assert.ok(part.events.length);
      const bars = new Set(part.events.map(e => e.bar));
      for (const bar of bars) {
        const section = score.sections.find(s => s.start <= bar && bar < s.end);
        assert.ok(['verse', 'drop'].includes(section.name) && (bar - section.start) % 2 === 1);
        const dyad = part.events.filter(e => e.bar === bar);
        assert.equal(dyad.length, 2);
        assert.equal(attacks(dyad, config, bar)[0], step);
        const stepSeconds = barInfo(config, bar).stepSeconds;
        assert.ok(dyad.every(e => e.articulation === articulation && e.duration <= stepSeconds + 1e-8));
        const spread = dyad[1].time - dyad[0].time;
        assert.ok(Math.abs(spread - (partName === 'guitar_answer' ? .009 : 0)) < 1e-8);
        assert.ok(!keys.some(k => k.bar === bar && dyad.some(e => e.time < k.time + k.duration - 1e-8 && k.time < e.time + e.duration - 1e-8)));
      }
      const independent = compose(prompt + ' in ' + meter + ', independent accompaniment', { seed, sauce: 0 });
      assert.deepEqual(score.drums, independent.drums);
      assert.deepEqual(score.bass, independent.bass);
      assert.ok(!independent.parts.some(p => p.name === partName));
    }
  }
});

test('automatic replies yield to instrument exclusions, held chords and custom harmony', () => {
  for (const prompt of ['soulful house with Hammond, no piano', 'dancehall with steelpan chords, no guitar',
    'dancehall with steelpan, held chords', 'dancehall without offbeat chords', 'dancehall with no short chords',
    'soulful house, no keys', 'soulful house with acoustic piano']) {
    assert.ok(!compose(prompt).parts.some(p => p.pattern === 'answer'), prompt);
  }
  const score = compose('dancehall with steelpan chords', {
    parts: [{ name: 'guitar_answer', profile: 'acoustic_guitar', pattern: 'strum', articulation: 'normal' }],
  });
  assert.equal(score.parts.length, 1);
  assert.equal(score.parts[0].pattern, 'strum');
  assert.equal(score.parts[0].articulation, 'normal');
});
