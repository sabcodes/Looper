import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {compose,compilePrompt,renderAudio,renderStems,INSTRUMENTS,ACOUSTIC_PROFILES,parseScala,resolveTuning,tunedHz,validateTimbre,transformVocalBuffer,transformVocalBank,prepareVocalSamples} from '../src/index.js';
import {instrumentVoice} from '../src/instruments.js';
import {random} from '../src/random.js';
import {filterVoice,bodyResonator,partialVoice} from '../src/timbre.js';
import {sympatheticBody} from '../src/acoustics.js';
const hash=b=>createHash('sha256').update(b).digest('hex');
const near=(a,b,e=1e-7)=>assert.ok(Math.abs(a-b)<e,`${a} != ${b}`);
const rms=a=>Math.sqrt(a.reduce((s,x)=>s+x*x,0)/a.length);
const voice=(profile,settings={},sr=16000,seconds=.3)=>{const sample=instrumentVoice({profile,note:57,duration:seconds,velocity:.6,...settings},sr,random('sound-math',profile));return Float32Array.from({length:Math.round(sr*seconds)},(_,i)=>sample(i/sr));};
const magnitude=(a,hz,sr)=>{let re=0,im=0;for(let i=0;i<a.length;i++){re+=a[i]*Math.cos(2*Math.PI*hz*i/sr);im+=a[i]*Math.sin(2*Math.PI*hz*i/sr);}return Math.hypot(re,im)/a.length;};

test('historical tuning, concert pitch, EDO and Scala have analytical frequency ratios',()=>{
  const just=resolveTuning('',{system:'just'});near(tunedHz(64,just)/tunedHz(60,just),5/4);near(tunedHz(67,just)/tunedHz(60,just),3/2);near(tunedHz(48,just)/tunedHz(60,just),.5);
  const pyth=resolveTuning('pythagorean tuning');near(tunedHz(64,pyth)/tunedHz(60,pyth),81/64);
  near(tunedHz(67,resolveTuning('quarter comma meantone'))/tunedHz(60,resolveTuning('quarter comma meantone')),5**.25);
  near(tunedHz(69,resolveTuning('A4=432Hz')),432);
  const edo=resolveTuning('19 edo');near(tunedHz(61,edo)/tunedHz(60,edo),2**(2/19));
  near(tunedHz(61,resolveTuning('',{divisions:24,mapping:'degree'}))/tunedHz(60,resolveTuning('',{divisions:24,mapping:'degree'})),2**(1/24));
  const scala='! example\nFive tones\n5\n9/8\n5/4\n3/2\n5/3\n2/1\n';assert.equal(parseScala(scala).length,5);near(tunedHz(62,resolveTuning('',{scala,mapping:'degree'}))/tunedHz(60,resolveTuning('',{scala,mapping:'degree'})),5/4);
  near(parseScala('Cents\n2\n700.0\n1200.0')[0],2**(700/1200));
  for(const tuning of [{divisions:0},{concertPitch:NaN},{system:'unknown'},{ratios:[1,2]},{scala:'bad'},{mapping:'bad'}])assert.throws(()=>resolveTuning('',tuning));
});

test('tuning reaches all pitched score voices and changes rendered pitch',()=>{
  const s=compose('synth pop in F minor 8 bars with viola',{tuning:{system:'just',concertPitch:432},parts:[{name:'quarter',profile:'additive',cents:50}]});
  for(const e of [...s.keys,...s.bass,...s.lead,...s.arp,...s.parts.flatMap(p=>p.events)]){assert.ok(e.frequency>0);near(e.frequency,tunedHz(e.note,s.config.tuning,65)*2**((e.cents??0)/1200));}
  const a=voice('additive',{frequency:220,partials:[{ratio:1,amplitude:1,decay:5}]},16000,.5),b=voice('additive',{frequency:240,partials:[{ratio:1,amplitude:1,decay:5}]},16000,.5);
  assert.ok(magnitude(a,220,16000)>magnitude(a,240,16000)*20);assert.ok(magnitude(b,240,16000)>magnitude(b,220,16000)*20);
});

test('every new acoustic profile is distinct, stable and recognized with exclusions',()=>{
  assert.equal(Object.keys(ACOUSTIC_PROFILES).length,39);
  for(const sr of [8000,44100]){
    const fingerprints=new Set();
    for(const [profile,spec] of Object.entries(ACOUSTIC_PROFILES)){
      for(const note of [36,60,84]){const a=voice(profile,{note},sr,.15);assert.ok(a.every(x=>Number.isFinite(x)&&Math.abs(x)<4),`${profile}/${note}/${sr}`);assert.ok(rms(a)>1e-5,`${profile} silence`);if(note===60)fingerprints.add(hash(a));}
      const name=spec.names.split('|')[0].replace(/\?/g,'');
      if(!/[()[\]]/.test(name)){const s=compose(`neutral groove 8 bars with ${name}`);assert.ok([s.config.synthProfile,s.config.bassProfile,s.config.soundDesign.leadProfile,s.config.soundDesign.arpProfile,...s.parts.map(p=>p.profile)].includes(profile),name);const no=compose(`house without ${name}`);assert.ok(!no.parts.some(p=>p.profile===profile));}
    }
    assert.equal(fingerprints.size,39);
  }
});

test('pluck/pickup positions suppress expected modes and hammer width changes brightness',()=>{
  const a=voice('acoustic_guitar',{frequency:200,pluckPosition:.5,pickupPosition:.23,body:'none'},16000,.5),b=voice('acoustic_guitar',{frequency:200,pluckPosition:.2,pickupPosition:.23,body:'none'},16000,.5);
  assert.ok(magnitude(a,400,16000)<magnitude(b,400,16000)*.1);
  assert.notEqual(hash(a),hash(voice('acoustic_guitar',{frequency:200,pluckPosition:.5,pickupPosition:.5,body:'none'},16000,.5)));
  assert.notEqual(hash(voice('acoustic_piano',{hammerWidth:.02,hardness:.9})),hash(voice('acoustic_piano',{hammerWidth:.5,hardness:.1})));
  assert.notEqual(hash(voice('cello',{bowPosition:.1})),hash(voice('cello',{bowPosition:.4})));
});

test('editable partial amplitudes, frequencies and morphing reach audio',()=>{
  const e=validateTimbre({partials:[{ratio:1,amplitude:.8,decay:30},{ratio:2,amplitude:.2,decay:30,targetRatio:3,targetAmplitude:.5}]});
  const a=partialVoice(e,16000,200),b=Float32Array.from({length:8000},(_,i)=>a(i/16000));
  assert.ok(magnitude(b,200,16000)>magnitude(b,400,16000)*3.5);assert.ok(magnitude(b,400,16000)>magnitude(b,600,16000)*20);
  assert.notEqual(hash(voice('additive',e)),hash(voice('additive',{...e,spectrumMorph:1})));
  assert.notEqual(hash(voice('additive',e)),hash(voice('additive',{...e,modulation:[{source:'lfo',target:'morph',amount:.5,rate:4}]})));
});

test('modulation routes and envelopes act on pitch, gain, cutoff and stereo deterministically',()=>{
  const base=voice('acoustic_guitar');
  for(const route of [{source:'lfo',target:'pitch',amount:.08,rate:5},{source:'velocity',target:'gain',amount:-1},{source:'pressure',target:'gain',amount:.8},{source:'random',target:'cutoff',amount:2,rate:20}]){
    const settings={modulation:[route],filterModel:'svf',cutoff:1000};const a=voice('acoustic_guitar',settings);assert.notEqual(hash(base),hash(a));assert.equal(hash(a),hash(voice('acoustic_guitar',settings)));
  }
  assert.ok(rms(voice('wavetable',{envelope:{attack:1,decay:.2,sustain:.1,release:.1}}))<rms(voice('wavetable'))*.6);
  const s=compose('house 8 bars',{parts:[{name:'moving',profile:'fm_synth',modulation:[{source:'lfo',target:'pan',amount:1,beats:.25}]}]});s.config.duration=2;const audio=renderAudio(s,{sampleRate:8000,voices:['moving']});assert.ok(audio.stats.rms>.001);assert.equal(hash(audio.pcm),hash(renderAudio(s,{sampleRate:8000,voices:['moving']}).pcm));
});

test('FM algorithms, feedback and independent operator envelopes produce distinct signals',()=>{
  const hashes=new Set(['serial','parallel','pairs','branch'].map(fmAlgorithm=>hash(voice('fm_synth',{fmAlgorithm}))));assert.equal(hashes.size,4);
  assert.notEqual(hash(voice('fm_synth',{fmFeedback:2})),hash(voice('fm_synth')));
  assert.notEqual(hash(voice('fm_synth',{operatorEnvelopes:Array.from({length:4},(_,i)=>({attack:.01,decay:.02+i*.1,sustain:.2,release:.03}))})),hash(voice('fm_synth')));
});

test('ladder/diode filters attenuate high frequencies and survive extreme resonance',()=>{
  const fingerprints=new Set();
  for(const model of ['ladder','diode']){
    const low=filterVoice(16000,model),high=filterVoice(16000,model);const a=Float32Array.from({length:16000},(_,i)=>low(.3*Math.sin(2*Math.PI*100*i/16000),500,.2)),b=Float32Array.from({length:16000},(_,i)=>high(.3*Math.sin(2*Math.PI*5000*i/16000),500,.2));assert.ok(rms(a)>rms(b)*20);fingerprints.add(hash(a));
    const extreme=filterVoice(8000,model);for(let i=0;i<8000;i++)assert.ok(Number.isFinite(extreme(i%17?0:1,30000,.95)));
  }
  assert.equal(fingerprints.size,2);
});

test('shared body and sympathetic modes ring after excitation and reconstruct in stems',()=>{
  const left=new Float32Array(16000),right=left.slice();left[0]=right[0]=1;
  sympatheticBody(left,right,8000,[{frequency:220}],{body:'piano',sympathetic:.8,bodyMix:.2});assert.ok(left.slice(4000).some(x=>Math.abs(x)>1e-6));assert.ok(left.every(Number.isFinite));
  const fingerprints=new Set();for(const body of ['guitar','violin','piano','wood','metal','glass']){const r=bodyResonator(8000,{body,bodyMix:.7}),a=Float32Array.from({length:8000},(_,i)=>r(i?0:1));fingerprints.add(hash(a));}assert.equal(fingerprints.size,6);
  const s=compose('house 8 bars',{parts:[{name:'resonant',profile:'harpsichord',sympathetic:.6,body:'piano'}]});s.config.duration=1;const {mix,stems}=renderStems(s,{sampleRate:8000});for(let i=0;i<mix.pcm.length;i+=2){const sum=Object.values(stems).reduce((n,s)=>n+s.pcm.readInt16LE(i),0);assert.ok(Math.abs(sum-mix.pcm.readInt16LE(i))<=Object.keys(stems).length/2+1);}
});

test('sample granular pitch and traversal are independently controlled and seeded',()=>{
  const sample=Array.from({length:8000},(_,i)=>.5*Math.sin(2*Math.PI*(i<4000?220:440)*i/8000));
  const settings={sample,sampleRate:8000,scanRate:0,grainPosition:.1,grainSize:.1,grainDensity:40,pitchRatio:1};const a=voice('granular',settings,16000,.5);
  assert.equal(hash(a),hash(voice('granular',settings,16000,.5)));assert.notEqual(hash(a),hash(voice('granular',{...settings,pitchRatio:2},16000,.5)));assert.notEqual(hash(a),hash(voice('granular',{...settings,grainPosition:.7},16000,.5)));
  assert.ok(magnitude(a.slice(1600),220,16000)>magnitude(a.slice(1600),440,16000)*3);
  for(const sr of [8000,16000,44100]){const b=voice('granular',{frequency:261.625565},sr,1),band=f=>Math.max(...Array.from({length:21},(_,i)=>magnitude(b.slice(Math.round(sr*.1)),f-20+i*2,sr)));assert.ok(band(261.625565)>band(sr/128)*1.4,'procedural grain source tracks note at '+sr);}

});

test('scanned, stochastic, Shepard/Risset, FOF/VOSIM and colored noise are distinct and stable',()=>{
  const profiles=['scanned','gendy','shepard','risset','fof','vosim','colored_noise'];const hashes=new Set();for(const profile of profiles){const a=voice(profile,{},16000,1);assert.ok(a.every(x=>Number.isFinite(x)&&Math.abs(x)<2));assert.ok(rms(a)>1e-4,profile);assert.equal(hash(a),hash(voice(profile,{},16000,1)));hashes.add(hash(a));}assert.equal(hashes.size,profiles.length);
  assert.equal(new Set(['white','pink','brown','blue','violet'].map(noiseColor=>hash(voice('colored_noise',{noiseColor})))).size,5);
  assert.notEqual(hash(voice('scanned',{scanStiffness:.2})),hash(voice('scanned',{scanStiffness:.02})));
  assert.notEqual(hash(voice('gendy',{stochasticRate:.5})),hash(voice('gendy',{stochasticRate:.01})));
});

test('vocal stretch preserves tone pitch and formant warping preserves frame count',()=>{
  const sr=16000,input=Float32Array.from({length:sr},(_,i)=>.3*Math.sin(2*Math.PI*200*i/sr));
  const a=transformVocalBuffer(input,{stretch:1.5});assert.equal(a.length,24000);assert.ok(magnitude(a.slice(4000,20000),200,sr)>magnitude(a.slice(4000,20000),300,sr)*10);
  const b=transformVocalBuffer(input,{formant:4});assert.equal(b.length,input.length);assert.ok(b.every(Number.isFinite));assert.notEqual(hash(input),hash(b));
  const bank=transformVocalBank({sampleRate:sr,sources:{'word:hello':input,'phrase:0':input}},{stretch:.5,formant:2},['hello']);assert.equal(bank.sources['word:hello'].length,8000);assert.equal(bank.sources['phrase:0'].length,8000);
  assert.throws(()=>transformVocalBuffer(input,{stretch:0}));assert.throws(()=>transformVocalBank(bank,{stretch:1},['hello']));
});

test('new scales, chord sizes and constrained second-order melodies stay musical and finite',()=>{
  for(const mode of ['lydian','locrian','melodic minor','major pentatonic','minor pentatonic','blues','whole tone','diminished','chromatic','quarter tone']){
    const s=compose(`synth pop in C ${mode} 16 bars with flute 13th chords markov melody phrase cadences max leap 5`,{seed:31});assert.equal(s.chords[0].notes.length,7,mode);assert.ok(s.lead.length,mode);
    for(const e of [...s.keys,...s.lead,...s.bass,...s.arp,...s.parts.flatMap(p=>p.events)])assert.ok(Number.isFinite(e.note),mode);
    for(let i=1;i<s.lead.length;i++)assert.ok(Math.abs(s.lead[i].note-s.lead[i-1].note)<=5,mode);
    assert.deepEqual(s,compose(s.config.prompt,{seed:31}));
  }
  const a=compose('synth pop 16 bars with flute markov melody',{seed:1}),b=compose('synth pop 16 bars with flute markov melody',{seed:2});assert.notDeepEqual(a.lead.map(e=>e.note),b.lead.map(e=>e.note));
});

test('CLI exposes new controls without audio writes and validates unsafe settings',()=>{
  const result=spawnSync(process.execPath,['bin/makebeats.js','house 8 bars with handpan','--timbre','{"filterModel":"ladder","cutoff":800}','--tuning','{"system":"just"}','--development','{"chordSize":9}','--lyrics','move','--vocal-stretch','1.2','--vocal-formant','3','--dry-run'],{encoding:'utf8',maxBuffer:4e6});assert.equal(result.status,0,result.stderr);const s=JSON.parse(result.stdout);assert.equal(s.chords[0].notes.length,5);assert.equal(s.vocals.transform.formant,3);assert.equal(s.keys[0].filterModel,'ladder');
  for(const input of [{pluckPosition:0},{pickupPosition:2},{hammerWidth:0},{body:'unknown'},{partials:[{ratio:NaN}]},{sample:[Infinity]},{modulation:[{source:'lfo',target:'oops'}]},{fmAlgorithm:'oops'},{envelope:false},{operatorEnvelopes:[]}])assert.throws(()=>validateTimbre(input));
  assert.throws(()=>compilePrompt('house',{timbre:{unknown:1}}));
  assert.throws(()=>compilePrompt('house',{timbre:null}));
  assert.equal(compose('house with pink noise').config.timbre.noiseColor,'pink');
  assert.throws(()=>compilePrompt('house',{development:{maxLeap:0}}));assert.throws(()=>compose('house',{lyrics:'move',vocalStretch:5}));
});


test('prepared native vocals apply transforms and reject mismatched render settings', {skip:process.platform!=='darwin'||spawnSync('ffmpeg',['-version']).status!==0},async()=>{
  const score=compose('house 8 bars',{lyrics:'Move.',vocalStretch:1.15,vocalFormant:2,vocalPitch:0});
  const samples=await prepareVocalSamples(score,{sampleRate:8000});assert.equal(samples.transform.stretch,1.15);assert.ok(samples.hashes['word:move']);assert.notEqual(samples.hashes['word:move'],samples.inputHashes['word:move']);
  const audio=renderAudio(score,{sampleRate:8000,vocalSamples:samples,voices:['vocals']});assert.ok(audio.stats.rms>0);
  const bad={...score,vocals:{...score.vocals,transform:{stretch:1.2,formant:2}}};assert.throws(()=>renderAudio(bad,{sampleRate:8000,vocalSamples:samples,voices:['vocals']}),/transform/);
});
