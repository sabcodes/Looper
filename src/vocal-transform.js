import { createHash } from 'node:crypto';
import { fft } from './synthesis.js';
const TAU=2*Math.PI;
export function vocalTransformSettings(options={}) {
  const stretch=options.vocalStretch===undefined?1:Number(options.vocalStretch),formant=options.vocalFormant===undefined?0:Number(options.vocalFormant);
  if(!Number.isFinite(stretch)||stretch<.5||stretch>2||!Number.isFinite(formant)||Math.abs(formant)>12)throw new Error('Vocal stretch must be 0.5–2 and formant shift -12–12 semitones.');
  return stretch===1&&formant===0?null:{stretch,formant};
}
// Phase-vocoder stretching with independently warped smooth spectral envelope.
// Formant shifting is a spectral approximation, not a speech identity model.
export function transformVocalBuffer(input,{stretch=1,formant=0,size=1024}={}) {
  if(!(input instanceof Float32Array)||input.length>3840000||!input.length||!input.every(Number.isFinite)||!Number.isFinite(stretch)||stretch<.5||stretch>2||!Number.isFinite(formant)||Math.abs(formant)>12||!Number.isInteger(size)||size<128||size>4096||(size&(size-1)))throw new Error('Invalid vocal transformation buffer or settings.');
  if(stretch===1&&formant===0)return input.slice();
  const hop=size/4,synthesisHop=hop*stretch,frames=Math.ceil((input.length+size)/hop),length=Math.round(input.length*stretch),out=new Float64Array(length),weight=new Float64Array(length);
  const previous=new Float64Array(size/2+1),phase=new Float64Array(size/2+1),window=Float64Array.from({length:size},(_,i)=>.5-.5*Math.cos(TAU*i/size));
  const ratio=2**(formant/12);let first=true;
  for(let frame=0;frame<frames;frame++){
    const start=frame*hop-size,position=Math.round(frame*synthesisHop-size*stretch),re=new Float64Array(size),im=new Float64Array(size);
    for(let j=0;j<size;j++)re[j]=(input[start+j]??0)*window[j];fft(re,im);
    const magnitude=Float64Array.from({length:size/2+1},(_,k)=>Math.hypot(re[k],im[k])),envelope=new Float64Array(magnitude.length);
    // A short log-frequency envelope separates broad vowel peaks from harmonics.
    const prefix=new Float64Array(magnitude.length+1);for(let k=0;k<magnitude.length;k++)prefix[k+1]=prefix[k]+Math.log(Math.max(1e-9,magnitude[k]));
    for(let k=0;k<magnitude.length;k++){const lo=Math.max(0,k-8),hi=Math.min(magnitude.length,k+9);envelope[k]=Math.exp((prefix[hi]-prefix[lo])/(hi-lo));}
    for(let k=0;k<magnitude.length;k++){
      const angle=Math.atan2(im[k],re[k]),expected=TAU*k*hop/size,delta=angle-previous[k]-expected,wrapped=delta-TAU*Math.round(delta/TAU);
      if(first)phase[k]=angle;else phase[k]+=(expected+wrapped)*stretch;previous[k]=angle;
      const x=k/ratio,a=Math.floor(x),u=x-a,warped=a<envelope.length?envelope[a]*(1-u)+(envelope[a+1]??envelope[a])*u:0;
      const gain=formant?Math.min(8,warped/Math.max(1e-9,envelope[k])):1,m=magnitude[k]*gain;
      re[k]=m*Math.cos(phase[k]);im[k]=m*Math.sin(phase[k]);
      if(k>0&&k<size/2){re[size-k]=re[k];im[size-k]=-im[k];}
    }
    first=false;fft(re,im,true);
    for(let j=0;j<size;j++){const i=position+j;if(i>=0&&i<length){out[i]+=re[j]*window[j];weight[i]+=window[j]**2;}}
  }
  const result=Float32Array.from(out,(v,i)=>v/Math.max(1e-4,weight[i]));let peak=0;for(const v of result)peak=Math.max(peak,Math.abs(v));if(peak>.95)for(let i=0;i<result.length;i++)result[i]*=.95/peak;
  return result;
}
export function transformVocalBank(samples,settings,phrases) {
  if(!settings)return samples;
  if(samples.transform)throw new Error('Vocal bank has already been transformed.');
  const sources={};for(const [key,audio]of Object.entries(samples.sources))if(key.startsWith('word:'))sources[key]=transformVocalBuffer(audio,settings);
  for(const key of Object.keys(samples.sources).filter(k=>k.startsWith('phrase:'))){const tokens=phrases[Number(key.slice(7))].split(' '),gap=Math.round(samples.sampleRate*.025);const buffer=new Float32Array(tokens.reduce((n,w)=>n+sources['word:'+w].length,gap*(tokens.length-1)));let at=0;for(const word of tokens){buffer.set(sources['word:'+word],at);at+=sources['word:'+word].length+gap;}sources[key]=buffer;}
  const hashes=Object.fromEntries(Object.entries(sources).map(([key,value])=>[key,createHash('sha256').update(Buffer.from(value.buffer,value.byteOffset,value.byteLength)).digest('hex')]));
  return{...samples,sources,hashes,inputHashes:samples.inputHashes??samples.hashes,transform:{...settings,method:'phase-vocoder-envelope-warp'}};
}
