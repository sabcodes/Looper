import { clamp } from './random.js';
const TAU = 2 * Math.PI;
const range = (value,lo,hi,label) => { if (typeof value !== 'number' || !Number.isFinite(value) || value < lo || value > hi) throw new Error(label + ` must be ${lo}–${hi}.`); return value; };
export const TIMBRE_FIELDS = ['pluckPosition','pickupPosition','bowPosition','hammerWidth','hardness','stiffness','body','bodySize','bodyMix','sympathetic','partials','spectrumMorph','modulation','envelope','filterModel','cutoff','resonance','fmAlgorithm','fmFeedback','operatorEnvelopes','sample','sampleRate','grainSize','grainDensity','scanRate','grainPosition','pitchRatio','noiseColor','scanStiffness','scanDamping','stochasticRate','rissetRate','cents'];
export function validateTimbre(input = {}, {strict=false} = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Timbre must be an object.');
  if(strict)for(const key of Object.keys(input))if(!TIMBRE_FIELDS.includes(key))throw new Error('Unknown timbre setting: '+key);
  const out = Object.fromEntries(TIMBRE_FIELDS.filter(k=>input[k] !== undefined).map(k=>[k,input[k]]));
  const ranges = { pluckPosition:[.02,.98],pickupPosition:[.02,.98],bowPosition:[.02,.98],hammerWidth:[.005,.8],hardness:[0,1],stiffness:[0,.02],bodySize:[.25,4],bodyMix:[0,1],sympathetic:[0,1],spectrumMorph:[0,1],cutoff:[20,30000],resonance:[0,.95],fmFeedback:[0,4],sampleRate:[8000,96000],grainSize:[.01,.5],grainDensity:[1,100],scanRate:[-4,4],grainPosition:[0,1],pitchRatio:[.25,4],scanStiffness:[.01,.24],scanDamping:[.8,.9999],stochasticRate:[.01,1],rissetRate:[-.5,.5],cents:[-1200,1200] };
  for (const [k,[a,b]] of Object.entries(ranges)) if (k in out) range(out[k],a,b,k);
  for (const [k,values] of Object.entries({body:['none','guitar','violin','piano','wood','metal','glass'],filterModel:['svf','ladder','diode'],fmAlgorithm:['serial','parallel','pairs','branch'],noiseColor:['white','pink','brown','blue','violet']})) if (k in out && !values.includes(out[k])) throw new Error('Unknown ' + k + '.');
  if (out.partials !== undefined) {
    if (!Array.isArray(out.partials) || !out.partials.length || out.partials.length > 64) throw new Error('Use 1–64 partials.');
    out.partials = out.partials.map(p=> {
      if (!p || typeof p !== 'object' || Array.isArray(p) || Object.keys(p).some(k=>!['ratio','amplitude','phase','decay','targetAmplitude','targetRatio'].includes(k))) throw new Error('Invalid partial.');
      return {ratio:range(p.ratio,.01,128,'Partial ratio'), amplitude:range(p.amplitude??1,0,1,'Partial amplitude'),phase:range(p.phase??0,-TAU,TAU,'Partial phase'),decay:range(p.decay??2,.005,30,'Partial decay'),targetAmplitude:range(p.targetAmplitude??p.amplitude??1,0,1,'Target amplitude'),targetRatio:range(p.targetRatio??p.ratio,.01,128,'Target ratio')};
    });
  }
  const checkEnvelope = e => {
    if (!e || typeof e !== 'object' || Array.isArray(e) || Object.keys(e).some(k=>!['attack','decay','sustain','release'].includes(k))) throw new Error('Invalid ADSR envelope.');
    return {attack:range(e.attack??.01,0,10,'Attack'),decay:range(e.decay??.2,.001,10,'Decay'),sustain:range(e.sustain??.7,0,1,'Sustain'),release:range(e.release??.15,.001,10,'Release')};
  };
  if (out.envelope !== undefined) out.envelope = checkEnvelope(out.envelope);
  if (out.operatorEnvelopes !== undefined) { if (!Array.isArray(out.operatorEnvelopes) || out.operatorEnvelopes.length !== 4) throw new Error('Four operator envelopes required.'); out.operatorEnvelopes=out.operatorEnvelopes.map(checkEnvelope); }
  if (out.modulation !== undefined) {
    if (!Array.isArray(out.modulation) || out.modulation.length > 16) throw new Error('Use at most 16 modulation routes.');
    out.modulation = out.modulation.map(m=> {
      if (!m || !['lfo','envelope','velocity','pressure','random'].includes(m.source) || !['pitch','cutoff','morph','fm','pan','gain'].includes(m.target) || Object.keys(m).some(k=>!['source','target','amount','rate','beats','shape'].includes(k))) throw new Error('Invalid modulation route.');
      const shape=m.shape??'sine'; if (!['sine','triangle','square','sample_hold'].includes(shape)) throw new Error('Invalid LFO shape.');
      return {...m,amount:range(m.amount??0,-4,4,'Modulation amount'),rate:range(m.rate??1,.01,100,'LFO rate'),...(m.beats===undefined?{}:{beats:range(m.beats,.03125,32,'LFO beats')}),shape};
    });
  }
  if (out.sample !== undefined) {
    if (!(Array.isArray(out.sample)||out.sample instanceof Float32Array) || !out.sample.length || out.sample.length>384000 || !Array.from(out.sample).every(v=>Number.isFinite(v)&&Math.abs(v)<=1)) throw new Error('Sample must contain 1–384000 finite mono frames in [-1,1].');
    out.sample=Array.from(out.sample);
  }
  return out;
}
export function adsr(t,duration,e) {
  if (!e) return 1;
  const on = t < e.attack ? t / Math.max(1e-9,e.attack) : e.sustain+(1-e.sustain)*Math.exp(-Math.max(0,t-e.attack)/e.decay);
  return on * Math.min(1,Math.max(0,duration-t)/e.release);
}
export function modulationState(e,sr,rng) {
  const routes=(e.modulation??[]).map(m=>({...m,last:-1,held:0,phase:rng()}));
  return t=> {
    const out={pitch:0,cutoff:0,morph:0,fm:0,pan:0,gain:0};
    for (const m of routes) {
      const p=t*(m.beats ? (e.bpm??120)/60/m.beats : m.rate)+m.phase;
      let x;
      if (m.source==='velocity') x=e.velocity??.5;
      else if (m.source==='pressure') x=e.pressure??.6;
      else if (m.source==='envelope') x=adsr(t,e.duration??1,e.envelope??{attack:.02,decay:.2,sustain:.3,release:.1});
      else if (m.source==='random'||m.shape==='sample_hold') { const index=Math.floor(p); if(index!==m.last){m.last=index;m.held=rng()*2-1;} x=m.held; }
      else x=m.shape==='square'?(p%1<.5?1:-1):m.shape==='triangle'?1-4*Math.abs(p%1-.5):Math.sin(TAU*p);
      out[m.target]+=m.amount*x;
    }
    return out;
  };
}
export function filterVoice(sr,kind='svf') {
  const state=new Float64Array(4); let previous=0,dc=0; const pole=Math.exp(-TAU*20/sr);
  return (input,cutoff=1500,resonance=.2)=> {
    // Four nonlinear one-pole stages, 4x substepping and bounded feedback.
    const g=1-Math.exp(-TAU*clamp(cutoff,20,sr*.4)/(sr*4));
    for(let k=0;k<4;k++) {
      let x=input-resonance*(kind==='diode'?3:3.8)*state[3];
      for(let j=0;j<4;j++){const driven=kind==='diode'?Math.tanh(x*(x>=0?1.8:1.1)):.95*Math.tanh(x);state[j]+=g*(driven-Math.tanh(state[j]));x=state[j];}
    }
    const y=state[3],difference=y-previous;dc=difference+pole*dc;previous=y;
    return kind==='diode'?dc+.15*difference:dc;
  };
}
export function partialVoice(e,sr,f) {
  const partials=e.partials, phases=partials.map(p=>p.phase), norm=Math.max(1,partials.reduce((n,p)=>n+Math.max(p.amplitude,p.targetAmplitude),0));
  return (t,mods={})=> {
    const morph=clamp((e.spectrumMorph??0)+(mods.morph??0),0,1), pitch=2**((mods.pitch??0));
    let sum=0;
    for(let i=0;i<partials.length;i++){const p=partials[i],ratio=p.ratio*(1-morph)+p.targetRatio*morph,frequency=f*ratio*pitch;phases[i]+=TAU*frequency/sr;if(frequency<sr*.43)sum+=(p.amplitude*(1-morph)+p.targetAmplitude*morph)*Math.sin(phases[i])*Math.exp(-t/p.decay);}
    return sum/norm*.5;
  };
}
export function bodyResonator(sr,{body='guitar',bodySize=1,bodyMix=.35,sympathetic=0}={}) {
  const modes={guitar:[95,190,310,520,880],violin:[280,450,700,1200,2500],piano:[80,150,270,440,740],wood:[180,486,970,1580,2400],metal:[240,353,511,641,912],glass:[440,1214,2376,3929,5500]};
  if(body==='none')return x=>x;
  const values=modes[body]??modes.guitar;
  const resonators=values.map((hz,i)=>{const r=Math.exp(-1/(sr*(.08+(sympathetic??0)*1.8)/(1+i*.3))),w=TAU*Math.min(sr*.42,hz/bodySize)/sr;return{a:2*r*Math.cos(w),r2:r*r,g:(1-r)*2,y1:0,y2:0};});
  return x=> {let sum=0;for(const m of resonators){const y=m.g*x+m.a*m.y1-m.r2*m.y2;m.y2=m.y1;m.y1=y;sum+=y;}return x*(1-bodyMix)+sum*bodyMix;};
}
