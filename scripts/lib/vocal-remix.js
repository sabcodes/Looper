import assert from 'node:assert/strict';
import { compilePrompt, generateDrums, generateBass, resolveProduction } from '../../src/index.js';
import { minimalVoiceLeading } from '../../src/harmony.js';
import { grooveTime } from '../../src/groove.js';
import { random, clamp } from '../../src/random.js';

const harmony = {A:[9,1,4],E:[4,8,11],Fsm:[6,9,1],D:[2,6,9]};
export function vocalChordPlan(stepSeconds=.12) {
  const cells=[];
  for(let cycle=0;cycle<2;cycle++)for(const [i,name]of ['A','E','Fsm','E'].entries())cells.push({step:(cycle*8+i*2)*16,name,length:32});
  for(const start of [16,19])for(const [offset,name,length]of [[0,'D',8],[8,'E',8],[16,'A',8],[24,'Fsm',24]])cells.push({step:start*16+offset,name,length});
  for(const [step,name,length]of [[352,'D',8],[360,'E',8],[368,'A',8],[376,'Fsm',8],[384,'E',16],[400,'A',16]])cells.push({step,name,length});
  let previous=[57,61,64];
  return cells.map(c=>{const v=minimalVoiceLeading(previous,harmony[c.name]);previous=v.notes;return {...c,time:c.step*stepSeconds,duration:c.length*stepSeconds,bar:c.step/16,keyRoot:9,mode:'major',degree:({A:0,E:4,Fsm:5,D:3})[c.name],root:harmony[c.name][0],pitchClasses:harmony[c.name],notes:v.notes};});
}
export function deriveVocalRemixSpec(base, seed) {
  assert(['03','05'].includes(base.id));
  const spec=structuredClone(base),rng=random(seed,'favorite-remix-variation');spec.seed=seed;
  spec.bass=rng.pick(['sine_sub','dark_analog_bass']);
  spec.harmony=rng.pick(base.id==='03'?['analog_saw_pad','dark_wide_pad']:['dark_pad','analog_saw_pad']);
  spec.hats=rng.pick([[0,2,4,6,8,10,12,14],[0,2,6,8,10,14],[0,2,3,6,8,10,11,14]]);
  if(base.id==='05'){const shift=rng.int(1,3);spec.kicks=base.kicks.map((_,i)=>base.kicks[(i+shift)%base.kicks.length]);}
  spec.swing=base.swing+rng.int(0,2);
  spec.variation={voicingRotation:rng.int(0,2),register:rng.pick([0,12]),padGate:rng.pick([.8,.92]),bassPhase:rng.int(0,2),bassGate:rng.pick([2.6,3.2])};
  return spec;
}
export function addRemixLayers(score, layers, seed) {
  assert(['piano','violin','both'].includes(layers),'Unknown remix orchestration');
  const rng=random(seed,'dark-acoustic-layers'),parts=[];
  const piano={A:[66,64,61,59],E:[68,66,64,59],Fsm:[69,68,66,64],D:[66,64,62,61]};
  const violin={A:[76,73,71],E:[76,73,71],Fsm:[73,71,69],D:[74,73,69]};
  const makePart=(name,profile,role,wet)=>({name,profile,role,send:.1,mix:resolveProduction('',{reverb:'chamber',wet,decay:1.8}),events:[]});
  if(layers==='piano'||layers==='both'){
    const part=makePart('dark-piano','acoustic_piano','harmony',.16);
    for(const [index,c]of score.chords.entries()){
      const offsets=c.length<16?[2]:[[2,14,26],[6,22],[0,10,26],[4,20]][(index+rng.int(0,1))%4].filter(o=>o<c.length);
      for(const [i,offset]of offsets.entries()){
        const step=c.step+offset,time=step*score.config.stepSeconds,note=piano[c.name][i%4];
        part.events.push({voice:'keys',part:part.name,profile:part.profile,role:'melodic_answer',note,bar:Math.floor(step/16),step,time,duration:Math.min(.9+rng()*.45,c.time+c.duration-time-.015),velocity:.32+rng()*.08,pan:-.2,
          articulation:'normal',hardness:.15,hammerWidth:.16,cutoff:1350,resonance:.12,filterModel:'svf',envelope:{attack:.008,decay:.8,sustain:.25,release:.2}});
      }
    }
    parts.push(part);
  }
  if(layers==='violin'||layers==='both'){
    const part=makePart('violin-line','fiddle','counterpoint',.21);
    for(const [index,c]of score.chords.entries()){
      if(c.length<16||c.step<64||c.step<256&&index%2===1)continue;
      const offsets=c.length>=32?[1,12,23]:[1,13];
      for(const [i,offset]of offsets.entries()){
        if(offset>=c.length-2)continue;const step=c.step+offset,time=step*score.config.stepSeconds;
        part.events.push({voice:'lead',part:part.name,profile:part.profile,role:'counterpoint',note:violin[c.name][i%3],bar:Math.floor(step/16),step,time,duration:Math.min(1.18,c.time+c.duration-time-.02),velocity:.25+rng()*.05,pan:.22,articulation:'legato',cutoff:1700,resonance:.1,filterModel:'svf',pressure:.4,envelope:{attack:.18,decay:.35,sustain:.72,release:.22}});
      }
    }
    parts.push(part);
  }
  score.parts.push(...parts);for(const e of score.keys)e.velocity*=layers==='both'?.55:.7;
  score.experiment.orchestration={layers,note:'Sparse descending acoustic-piano and/or bowed-violin counterlines in the existing A-major pitch collection. Intended darker/sadder color; not a key change or lyric transcription.'};
}
export function buildVocalRemix(spec, fixture) {
  assert.equal(fixture.bpm,125);assert.equal(fixture.bars,26);
  const config=compilePrompt(spec.prompt,{seed:spec.seed,sauce:0});
  assert.equal(config.root,9);assert.equal(config.scale,'major');assert.equal(config.bpm,125);assert.equal(config.bars,26);
  config.bassProfile=spec.bass;config.synthProfile=spec.harmony;config.bassMode=spec.bassMode;config.swing=spec.swing;
  config.groove.swing=spec.swing;config.groove.swings={kick:50,snare:50,hat:spec.swing,bass:spec.bassMode==='counterpoint'?spec.swing:50,keys:spec.swing};
  config.soundDesign.bassTexture=spec.bass;config.soundDesign.bassArticulation='genre';config.soundDesign.bassPhrasing='genre';config.soundDesign.harmonyRole=spec.style==='sustain'?'pads':'stabs';
  config.soundDesign.leadEnabled=false;config.soundDesign.arpEnabled=false;config.soundDesign.drumKit=spec.id==='04'?'soft':'standard';
  config.rhythm.kick=spec.kicks;config.rhythm.snare=[spec.snare];config.rhythm.hat=spec.hats;config.rhythm.ghosts=spec.id==='05'?[7,15]:[];
  config.kickAnchors=[0];config.snareAnchors=spec.snare;
  config.density=spec.id==='05'?.7:spec.id==='01'?.35:.5;
  const sections=[['verse',0,8,.65],['verse',8,16,.8],['chorus',16,25,1],['outro',25,26,.4]].map(([name,start,end,gain])=>({name,start,end,kick:true,snare:true,hats:gain,bass:true,keys:gain,startTime:start*1.92,endTime:end*1.92}));
  config.arrangement={...config.arrangement,custom:true,sections};
  const chords=vocalChordPlan(config.stepSeconds), at=step=>chords.findLast(c=>c.step<=step), next=step=>chords.find(c=>c.step>step)?.time??config.duration;
  const drums=generateDrums(config);
  // Existing drum generator omits the first two kicks for a generic intro.
  // Here the supplied excerpt is already a verse: add a quiet opening anchor.
  for(let bar=0;bar<2;bar++)for(const step of spec.kicks[bar%spec.kicks.length]){
    if(spec.snare.includes(step))continue;
    drums.kick.push({voice:'kick',bar,step:bar*16+step,time:(bar*16+step)*config.stepSeconds,duration:.25,velocity:.63,profile:'standard',kit:config.soundDesign.drumKit,pan:0});
  }
  drums.kick.sort((a,b)=>a.time-b.time);
  let bass=generateBass(drums.kick,chords,config);
  if(spec.variation) bass=bass.filter(e=>{
    const pos=e.step%16,phase=(e.bar+spec.variation.bassPhase)%4;
    return spec.id==='03'?phase===1?pos!==10:phase===3?pos!==6:true:!(phase===1&&pos===10);
  });
  const rng=random(spec.seed,'vocal-remix-harmony'),keys=[];
  for(let i=0;i<bass.length;i++){
    const e=bass[i],c=at(e.step);if(spec.variation)e.duration=Math.max(e.duration,config.stepSeconds*spec.variation.bassGate);e.note=24+c.root;e.profile=spec.bass;e.velocity*=spec.id==='03'?.8:1;
    e.duration=Math.max(.001,Math.min(spec.id==='01'?.8:e.duration,next(e.step)-e.time,(bass[i+1]?.time??config.duration)-e.time,config.duration-e.time));
    e.glide=spec.id==='01'&&i%4===3;e.fromNote=i?bass[i-1].note:e.note;
  }
  for(const c of chords){
    const chorus=c.step>=256&&c.step<400;
    let offsets=spec.style==='sustain'?[0]:spec.style==='offbeat'?[2,6,10,14,18,22,26,30]:spec.style==='fingerpick'?[0,3,6,10,14,16,19,22,26,30]:[0,6,14,20,28];
    offsets=offsets.filter(s=>s<c.length);
    if(spec.style==='broken'&&!chorus)offsets=offsets.filter((_,i)=>i%2===0);
    for(const [i,offset]of offsets.entries()){
      const step=c.step+offset,time=grooveTime(config,step,'keys');
      const chordal=spec.style==='sustain'||spec.style==='offbeat';
      let voicing=c.notes;if(spec.variation){const rotation=spec.variation.voicingRotation;voicing=[...c.notes.slice(rotation),...c.notes.slice(0,rotation).map(n=>n+12)].map(n=>n+spec.variation.register);}
      const notes=chordal?voicing:[c.notes[[0,2,1,2,0][i%5]]+(spec.style==='fingerpick'&&i%4===3?12:0)];
      for(const note of notes){
        const duration=Math.min(spec.style==='sustain'?c.duration*(spec.variation?.padGate??1)-.03:spec.style==='offbeat'?.2:.36,c.time+c.duration-time-.008,config.duration-time);
        if(duration<=0)continue;
        keys.push({voice:'keys',profile:spec.harmony,note,bar:Math.floor(step/16),step,time,duration,velocity:(chorus?.31:.23)*(spec.style==='sustain'?.8:1)*(.9+.2*rng()),pan:clamp((note-64)/25,-.45,.45),articulation:spec.style==='fingerpick'?'normal':'legato'});
      }
    }
  }
  // All auxiliary hits retain the engine's priority-mask policy.
  for(const name of Object.keys(drums))drums[name]=drums[name].map(e=>({...e,velocity:e.velocity*(e.bar>=16?.82:.66)}));
  const score={config,chords,drums,bass,keys,lead:[],arp:[],parts:[],sections,automation:[],sidechain:{duckDb:spec.id==='04'?-10:-21,tauSeconds:.055},externalVocal:{input:fixture.input,sourceStartSeconds:0,outputStartSeconds:0,rate:1,pitchSemitones:0,notes:'Original stereo stem is mixed externally after procedural synthesis; no speech generation or vocal resynthesis.'}};
  // Actual custom role overrides are explicit; classification remains provenance.
  score.experiment={type:'vocal-accompaniment',seed:spec.seed,arrangement:'Shared sparse A-major reharmonization. Verse 16 bars; chorus 9 bars; 1-bar tail. Inferred bar alignment, not an exact original transcription.',soundOverrides:{bass:spec.bass,harmony:spec.harmony},bassPipeline:'generateDrums -> generateBass(final kicks) -> retune/cap to the supplied harmonic timeline'};
  if(spec.variation)score.experiment.variation=structuredClone(spec.variation);
  if(spec.layers)addRemixLayers(score,spec.layers,spec.seed);
  return score;
}
export function mixExternalVocal(music,vocal,{musicRms=.065,vocalDb=0}={}){
  assert(Number.isFinite(vocalDb)&&vocalDb>=-24&&vocalDb<=0,'Vocal dB must be -24 to 0');
  const vocalInputGain=10**(vocalDb/20);
  assert.equal(music.sampleRate,44100);assert.equal(music.channels,2);assert.equal(vocal.length,music.pcm.length);
  const sr=music.sampleRate,frames=music.frames,pcm=Buffer.alloc(vocal.length),temp=new Float32Array(frames*2);
  let energy=0;for(let i=0;i<music.pcm.length;i+=2)energy+=(music.pcm.readInt16LE(i)/32767)**2;
  const musicGain=energy?Math.min(2,musicRms/Math.sqrt(energy/(frames*2))):0;
  const slow=[0,0],fast=[0,0],a=1-Math.exp(-2*Math.PI*450/sr),b=1-Math.exp(-2*Math.PI*4000/sr);
  const attack=Math.exp(-1/(sr*.008)),release=Math.exp(-1/(sr*.18));let env=0,peak=0;
  for(let i=0;i<frames;i++){
    const v0=vocal.readInt16LE(i*4)/32767,v1=vocal.readInt16LE(i*4+2)/32767,level=Math.max(Math.abs(v0),Math.abs(v1)),coef=level>env?attack:release;
    env=coef*env+(1-coef)*level;const duck=.32*clamp((env-.012)/.07,0,1);
    const tail=Math.min(1,(frames-1-i)/(sr*.8));
    for(let side=0;side<2;side++){
      const x=music.pcm.readInt16LE(i*4+side*2)/32767*musicGain;slow[side]+=a*(x-slow[side]);fast[side]+=b*(x-fast[side]);
      const value=(x-duck*(fast[side]-slow[side]))*Math.max(0,tail)+(side?v1:v0)*vocalInputGain;
      temp[i*2+side]=value;peak=Math.max(peak,Math.abs(value));
    }
  }
  const gain=peak?Math.min(1,.78/peak):1;let sum=0,quantizedPeak=0;
  for(let i=0;i<temp.length;i++){const v=Math.round(clamp(temp[i]*gain,-1,1)*32767);pcm.writeInt16LE(v,i*2);sum+=(v/32767)**2;quantizedPeak=Math.max(quantizedPeak,Math.abs(v)/32767);}
  return {pcm,sampleRate:sr,channels:2,frames,stats:{peak:quantizedPeak,rms:Math.sqrt(sum/temp.length),duration:frames/sr},mix:{musicGain,globalSafetyGain:gain,midrangeDuckMaxDb:20*Math.log10(.68),vocalGain:gain*vocalInputGain,vocalDb,vocalInputGain,sourceShiftFrames:0,timeStretchRatio:1,pitchSemitones:0,originalStereoPreserved:true}};
}
