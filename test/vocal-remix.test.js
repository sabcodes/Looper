import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {renderAudio} from '../src/index.js';
import {buildVocalRemix,vocalChordPlan,mixExternalVocal} from '../scripts/lib/vocal-remix.js';
const fixture=JSON.parse(readFileSync(new URL('../data/let-down-vocal-remixes.json',import.meta.url)));

test('five arrangements preserve the supplied vocal clock and distinct grooves with chord-bounded pitches',()=>{
 const fingerprints=[];
 for(const spec of fixture.cases){
  const s=buildVocalRemix(spec,fixture);assert.deepEqual(s,buildVocalRemix(spec,fixture));
  assert.equal(s.config.bpm,125);assert.equal(s.config.root,9);assert.equal(s.config.scale,'major');assert.equal(s.config.bars,26);assert(Math.abs(s.config.duration-49.92)<1e-8);
  assert.equal(s.externalVocal.rate,1);assert.equal(s.externalVocal.pitchSemitones,0);assert.equal(s.externalVocal.outputStartSeconds,0);
  assert.equal(s.lead.length+s.arp.length+s.parts.length+s.automation.length,0);
  for(const e of [...s.bass,...s.keys]){
   assert(Number.isFinite(e.time)&&e.time>=0&&e.time<s.config.duration);assert(Number.isFinite(e.duration)&&e.duration>0&&e.time+e.duration<=s.config.duration+1e-8);
   const chord=s.chords.findLast(c=>c.step<=e.step),end=s.chords.find(c=>c.step>e.step)?.time??s.config.duration;
   assert(chord.pitchClasses.includes(e.note%12));assert(e.time+e.duration<=end+1e-8,'note crossed harmony boundary');
  }
  assert(s.bass.every(e=>e.profile===spec.bass));assert(s.keys.every(e=>e.profile===spec.harmony));
  for(let i=1;i<s.bass.length;i++)assert(s.bass[i-1].time+s.bass[i-1].duration<=s.bass[i].time+1e-8);
  if(spec.bassMode==='unison_lock')assert(s.bass.every(e=>s.drums.kick.some(k=>k.step===e.step&&k.time===e.time)));
  if(spec.bassMode==='counterpoint')assert(s.bass.every(e=>!s.drums.kick.some(k=>k.step===e.step)));
  if(spec.bassMode==='offbeat_pump')assert(s.bass.every(e=>e.step%4===2));
  fingerprints.push(JSON.stringify(s.drums.kick.map(e=>[e.step,e.velocity])));
 }
 assert.equal(new Set(fingerprints).size,5);
 const chords=vocalChordPlan();assert.equal(chords[0].step,0);assert.equal(chords.at(-1).step+chords.at(-1).length,416);
 for(let i=1;i<chords.length;i++)assert.equal(chords[i-1].step+chords[i-1].length,chords[i].step);
});

test('external mixing keeps vocal sample positions and stereo unchanged when accompaniment is silent',()=>{
 const frames=4410,vocal=Buffer.alloc(frames*4);
 for(let i=0;i<frames;i++){vocal.writeInt16LE(Math.round(8000*Math.sin(i*.09)),i*4);vocal.writeInt16LE(Math.round(6000*Math.sin(i*.07)),i*4+2);}
 const before=Buffer.from(vocal),music={sampleRate:44100,channels:2,frames,pcm:Buffer.alloc(frames*4)};
 const mixed=mixExternalVocal(music,vocal);assert.equal(mixed.pcm.compare(vocal),0);assert.equal(vocal.compare(before),0);
 assert.equal(mixed.mix.sourceShiftFrames,0);assert.equal(mixed.mix.timeStretchRatio,1);assert.equal(mixed.mix.pitchSemitones,0);
 assert.throws(()=>mixExternalVocal(music,vocal.subarray(4)));
});

test('mixing is deterministic and bounded with loud music plus vocal, with real midrange ducking',()=>{
 const frames=4410,music={sampleRate:44100,channels:2,frames,pcm:Buffer.alloc(frames*4)},vocal=Buffer.alloc(frames*4);
 for(let i=0;i<frames;i++)for(let side=0;side<2;side++){music.pcm.writeInt16LE(Math.round(30000*Math.sin(i*.31)),i*4+side*2);vocal.writeInt16LE(Math.round(30000*Math.sin(i*.03)),i*4+side*2);}
 const a=mixExternalVocal(music,vocal),b=mixExternalVocal(music,vocal);assert.equal(a.pcm.compare(b.pcm),0);
 assert(a.stats.peak<=.781&&a.stats.rms>0);assert(a.mix.midrangeDuckMaxDb<0);assert(a.mix.globalSafetyGain<=1);
});

test('favorite variations retain exact original references and produce deterministic musical changes',()=>{
 const newer=JSON.parse(readFileSync(new URL('../data/let-down-favorite-variations.json',import.meta.url)));
 const canonical=x=>JSON.stringify(x);
 for(const id of ['03','05']){
  const original=fixture.cases.find(c=>c.id===id),base=buildVocalRemix(original,fixture),rows=newer.cases.filter(c=>c.id===id);
  assert.equal(rows.length,3);assert.equal(canonical(buildVocalRemix(rows[0],newer)),canonical(base));
  const fingerprints=[];
  for(const spec of rows){
   const s=buildVocalRemix(spec,newer);assert.equal(canonical(s),canonical(buildVocalRemix(spec,newer)));
   assert.equal(s.config.bpm,125);assert.equal(s.config.root,9);assert.equal(s.config.bars,26);
   for(const e of [...s.bass,...s.keys]){const chord=s.chords.findLast(c=>c.step<=e.step),end=s.chords.find(c=>c.step>e.step)?.time??s.config.duration;assert(e.duration>0&&e.time+e.duration<=end+1e-8);assert(chord.pitchClasses.includes(e.note%12));}
   if(id==='03')assert(s.bass.every(e=>e.step%4===2));
   fingerprints.push(canonical({bass:s.bass.map(e=>[e.step,e.duration,e.profile]),keys:s.keys.map(e=>[e.note,e.time,e.duration,e.profile]),hats:s.drums.hat.map(e=>[e.step,e.time])}));
  }
  assert.equal(new Set(fingerprints).size,3,'New seeds differ only in labels or velocities');
 }
});

test('minus-six vocal control lowers only the vocal component relative to an identical backing',()=>{
 const frames=4410,music={sampleRate:44100,channels:2,frames,pcm:Buffer.alloc(frames*4)},vocal=Buffer.alloc(frames*4);
 for(let i=0;i<frames;i++)for(let side=0;side<2;side++){music.pcm.writeInt16LE(Math.round(3000*Math.sin(i*.3)),i*4+side*2);vocal.writeInt16LE(Math.round(4000*Math.sin(i*.07)),i*4+side*2);}
 const old=mixExternalVocal(music,vocal),quiet=mixExternalVocal(music,vocal,{vocalDb:-6});
 assert.equal(old.mix.globalSafetyGain,1);assert.equal(quiet.mix.globalSafetyGain,1);assert.equal(old.mix.musicGain,quiet.mix.musicGain);
 assert(Math.abs(20*Math.log10(quiet.mix.vocalGain/old.mix.vocalGain)+6)<1e-9);
 for(let i=0;i<vocal.length;i+=2)assert(Math.abs((old.pcm.readInt16LE(i)-quiet.pcm.readInt16LE(i))-vocal.readInt16LE(i)*(1-10**(-6/20)))<=1.1);
 assert.throws(()=>mixExternalVocal(music,vocal,{vocalDb:Infinity}));assert.throws(()=>mixExternalVocal(music,vocal,{vocalDb:-30}));
});


test('dark breakbeat piano/violin seeds render real pitched layers and retain the extra minus-twelve vocal change',()=>{
 const newer=JSON.parse(readFileSync(new URL('../data/let-down-dark-acoustic-remixes.json',import.meta.url)));
 assert.equal(newer.vocalDb,-18);assert.deepEqual(newer.cases.map(c=>c.layers),['piano','violin','both']);
 for(const spec of newer.cases){
  const s=buildVocalRemix(spec,newer);assert.deepEqual(s,buildVocalRemix(spec,newer));assert.equal(s.config.bpm,125);assert.equal(s.config.root,9);
  assert.equal(s.parts.length,spec.layers==='both'?2:1);
  for(const part of s.parts){
   assert(part.events.length>10);assert(['acoustic_piano','fiddle'].includes(part.profile));
   for(const e of part.events){const next=s.chords.find(c=>c.time>e.time)?.time??s.config.duration;assert(e.time>=0&&e.duration>0&&e.time+e.duration<=next+1e-8);assert([9,11,1,2,4,6,8].includes(e.note%12));}
   const solo=structuredClone(s);solo.config.duration=.7;solo.keys=[];solo.bass=[];solo.lead=[];solo.arp=[];solo.automation=[];
   for(const voice of Object.keys(solo.drums))solo.drums[voice]=[];
   solo.parts=[{...part,events:[{...part.events[0],time:0,bar:0,step:0,duration:.55}]}];
   const a=renderAudio(solo,{sampleRate:16000,raw:true,normalize:false}),b=renderAudio(solo,{sampleRate:16000,raw:true,normalize:false});
   assert(a.stats.rms>1e-5&&a.stats.peak<1,part.profile+' layer is silent or clips');assert.equal(a.pcm.compare(b.pcm),0);
  }
 }
 const frames=4410,music={sampleRate:44100,channels:2,frames,pcm:Buffer.alloc(frames*4)},vocal=Buffer.alloc(frames*4);
 for(let i=0;i<frames;i++)for(let side=0;side<2;side++){music.pcm.writeInt16LE(Math.round(2000*Math.sin(i*.3)),i*4+side*2);vocal.writeInt16LE(Math.round(4000*Math.sin(i*.07)),i*4+side*2);}
 const before=mixExternalVocal(music,vocal,{vocalDb:-6}),after=mixExternalVocal(music,vocal,{vocalDb:-18});
 assert.equal(before.mix.musicGain,after.mix.musicGain);assert(Math.abs(20*Math.log10(after.mix.vocalGain/before.mix.vocalGain)+12)<1e-9);
});
