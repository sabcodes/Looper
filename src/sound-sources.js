import { clamp } from './random.js';
const TAU=2*Math.PI;
export const SOURCE_PROFILES={
  additive:{names:'additive(?: synth)?|partial synth',role:'harmony'},
  scanned:{names:'scanned(?: synth)?',role:'harmony'},
  gendy:{names:'gendy|stochastic synth',role:'lead'},
  shepard:{names:'shepard(?: tone| synth)?',role:'harmony'},
  risset:{names:'risset(?: glissando| synth)?',role:'harmony'},
  fof:{names:'fof(?: synth)?',role:'harmony'},
  vosim:{names:'vosim(?: synth)?',role:'harmony'},
  colored_noise:{names:'colored noise|coloured noise|(?:white|pink|brown|blue|violet) noise|noise synth',role:'harmony'},
};
export function sourceVoice(e,sr,rng,f) {
  const kind=e.profile;if(!Object.hasOwn(SOURCE_PROFILES,kind)||kind==='additive')return null;
  if(kind==='scanned') {
    const n=32,y=Float64Array.from({length:n},(_,i)=>Math.sin(TAU*i/n)*Math.exp(-(((i-n*.3)/7)**2))),velocity=new Float64Array(n);let at=0,phase=0;
    return ()=> {
      if(at++%Math.max(1,Math.round(sr/1000))===0){const next=y.slice();for(let j=0;j<n;j++){const force=(y[(j+n-1)%n]+y[(j+1)%n]-2*y[j])*(e.scanStiffness??.1);velocity[j]=((e.scanDamping??.99)*velocity[j]+force);next[j]=clamp(y[j]+velocity[j],-2,2);}y.set(next);}
      phase=(phase+f/sr)%1;const x=phase*n,i=Math.floor(x),u=x-i;return .4*(y[i]*(1-u)+y[(i+1)%n]*u);
    };
  }
  if(kind==='gendy') {
    const points=Float64Array.from({length:12},()=>rng()*1.2-.6),durations=Float64Array.from({length:12},()=>.5+rng());let index=0,phase=0;
    return ()=> {const step=f/sr*12/durations[index];phase+=step;while(phase>=1){phase-=1;index=(index+1)%12;points[index]=clamp(points[index]+(rng()*2-1)*(e.stochasticRate??.1),-.9,.9);durations[index]=clamp(durations[index]+(rng()*2-1)*.05,.5,1.5);}return .4*(points[index]*(1-phase)+points[(index+1)%12]*phase);};
  }
  if(kind==='shepard'||kind==='risset') {
    const phases=new Float64Array(9);return t=> {let sum=0,norm=0;const rate=e.rissetRate??(kind==='risset'?.08:0);for(let j=0;j<9;j++){const octave=j-4+rate*t,wrapped=((octave+4)%8+8)%8-4,freq=f*2**wrapped;phases[j]+=TAU*freq/sr;const gain=Math.exp(-((wrapped/1.6)**2));if(freq<sr*.43){sum+=gain*Math.sin(phases[j]);norm+=gain;}}return .4*sum/Math.max(1,norm);};
  }
  if(kind==='colored_noise') {
    let brown=0,last=0,previous=0;const pink=new Float64Array(3);
    return ()=> {const white=rng()*2-1;pink[0]=.99765*pink[0]+white*.099046;pink[1]=.963*pink[1]+white*.296516;pink[2]=.57*pink[2]+white*1.0526913;brown=clamp(.998*brown+.03*white,-1,1);const blue=(white-last)*.5,violet=(white-2*last+previous)*.25;previous=last;last=white;return .25*(e.noiseColor==='pink'?(pink[0]+pink[1]+pink[2]+white*.1848)*.15:e.noiseColor==='brown'?brown:e.noiseColor==='blue'?blue:e.noiseColor==='violet'?violet:white);};
  }
  let phase=0;
  return t=> {
    phase=(phase+f/sr)%1;
    const vowel=e.vowel==='i'?[270,2290,3010]:e.vowel==='u'?[300,870,2240]:[730,1090,2440];
    if(kind==='vosim'){const age=phase/f,width=1/(vowel[0]*2),p=age/width;return p<3?.4*Math.sin(Math.PI*p)**2*Math.exp(-p):0;}
    // FOF: damped formant bursts repeat at the fundamental; neighboring pulses
    // overlap so low-pitch vowels retain their formant bandwidth.
    let sum=0;for(const center of vowel){if(center>=sr*.43)continue;for(let k=0;k<4;k++){const age=(phase+k)/f;sum+=Math.sin(TAU*center*age)*Math.exp(-age*90)*Math.min(1,age/.002);}}return .2*sum;
  };
}
export function grainVoice(e,sr,rng,f,fallback) {
  const source=e.sample??fallback,sourceRate=e.sample?(e.sampleRate??sr/4):sr,grains=[];
  // The procedural source contains eight cycles in 4096 frames (sr/512 Hz).
  // Calibrate its playback ratio at the internal oversampled rate, rather than
  // treating that source as a fixed middle-C recording at every sample rate.
  const sourceRoot=e.sample?261.625565:sr/512;
  let next=0;
  const read=x=>{const p=((x%source.length)+source.length)%source.length,i=Math.floor(p),u=p-i;return source[i]*(1-u)+source[(i+1)%source.length]*u;};
  return t=> {
    if(t>=next){const duration=e.grainSize??(.06+rng()*.07),position=(e.grainPosition??.2)*source.length+t*(e.scanRate??1)*sourceRate;
      grains.push({start:t,duration,position:position+(rng()-.5)*sourceRate*.02,rate:e.pitchRatio??f/sourceRoot});next=t+1/(e.grainDensity??50);}
    let sum=0,weight=0;
    for(let j=grains.length-1;j>=0;j--){const g=grains[j],age=t-g.start;if(age>=g.duration){grains.splice(j,1);continue;}const window=.5-.5*Math.cos(TAU*age/g.duration);sum+=read(g.position+age*sourceRate*g.rate)*window;weight+=window;}
    return .5*sum/Math.max(1,weight);
  };
}
