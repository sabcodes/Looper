import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compose, renderAudio } from '../src/index.js';
import { checkGeneralization, selectExcerpt, scoreHash, musicPlan } from '../scripts/lib/generalization-evaluation.js';
const fixture=JSON.parse(readFileSync(new URL('../data/generalization-evaluation.json',import.meta.url)));

test('fresh evaluation has 12 prompts, two fixed seeds and no required genre for vague briefs',()=>{
  assert.equal(fixture.cases.length,12);assert.equal(fixture.seeds.length,2);assert.equal(new Set(fixture.seeds).size,2);
  assert.equal(new Set(fixture.cases.map(c=>c.prompt)).size,12);
  for(const group of ['vague','detailed','contrast'])assert.equal(fixture.cases.filter(c=>c.group===group).length,4);
  for(const row of fixture.cases.filter(c=>c.group==='vague'))assert.equal(row.expect.intent,undefined);
  for(const row of fixture.cases)for(const seed of fixture.seeds){
    const s=compose(row.prompt,{...fixture.options,seed}),result=checkGeneralization(s,row.expect);
    assert(result.safetyPassed,row.id+': '+JSON.stringify(result.safety.filter(c=>!c.passed)));
    assert.equal(scoreHash(s),scoreHash(compose(row.prompt,{...fixture.options,seed})));
    const excerpt=selectExcerpt(s);assert(excerpt.startSeconds>=0&&excerpt.startSeconds+16<=s.config.duration+1e-8);
    // Deliberately do not force constraint success here: evaluation failures must
    // stay visible in the report, rather than becoming new expected behavior.
  }
});

test('the evaluation catches role exclusions, incorrect accompaniment and broken event bounds',()=>{
  const s=compose('house with acoustic piano, offbeat chords, no lead',{sauce:0});
  assert(checkGeneralization(s,{synthProfile:'acoustic_piano',accompanimentStyle:'offbeat',noLead:true}).constraintPassed);
  assert(!checkGeneralization(s,{noHarmony:true}).constraintPassed);
  assert(!checkGeneralization(s,{accompanimentStyle:'sustain'}).constraintPassed);
  assert(!checkGeneralization(s,{excludedProfiles:['acoustic_piano']}).constraintPassed);
  const broken=structuredClone(s);broken.keys[0].duration=Infinity;
  assert(!checkGeneralization(broken,{}).safetyPassed);
});

test('music-plan fingerprints ignore prompt wording but expose actual performance differences',()=>{
  const a=compose('neutral groove',{seed:123,sauce:0}),b=structuredClone(a);b.config.prompt='different words';b.config.classification.source='other';
  assert.equal(scoreHash(musicPlan(a)),scoreHash(musicPlan(b)));
  b.keys[0].note+=1;assert.notEqual(scoreHash(musicPlan(a)),scoreHash(musicPlan(b)));
});

test('selected new voices respond to velocity, release and replay across registers and render rates',()=>{
  const profiles=['celesta','alto_flute','resonator_guitar','recorder','additive','fm_synth'];
  for(const sampleRate of [16000,44100])for(const profile of profiles)for(const note of [36,60,84]){
    const score=compose('classical 8 bars',{seed:'voice-regression',sauce:0});score.config.duration=.4;
    score.parts=[];score.bass=[];score.lead=[];score.arp=[];score.automation=[];score.drums={kick:[],snare:[],hat:[],tom:[]};
    const render=velocity=>{score.keys=[{voice:'keys',profile,note,time:0,duration:.25,velocity,pan:0}];return renderAudio(score,{sampleRate,raw:true,normalize:false});};
    const low=render(.25),high=render(.8);
    assert(Number.isFinite(high.stats.rms)&&high.stats.rms>1e-5,profile+'/'+note);
    assert(high.stats.rms>low.stats.rms*1.5,profile+' ignores velocity');assert(high.stats.peak<1);
    assert.equal(high.pcm.compare(render(.8).pcm),0,profile+' failed PCM replay');
    // The output DC blocker can retain a few quantization counts after note-off.
    const tailLimit=Math.max(2,high.stats.peak*32767*.005);
    for(let i=Math.round(.3*sampleRate)*4;i<high.pcm.length;i+=2)assert(Math.abs(high.pcm.readInt16LE(i))<=tailLimit,profile+' has excessive post-release energy');
  }
});
