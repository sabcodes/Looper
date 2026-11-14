// Explicitly run to save six four-second previews (~2.1 MB total) in generated_beats.
// Existing files are protected. No models, samples, network or native speech needed.
import {writeFile,access,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {compose,renderAudio,packWav,tunedHz,resolveTuning} from '../src/index.js';
const directory=fileURLToPath(new URL('../generated_beats/',import.meta.url)),sampleRate=22050;
const event=(profile,note,time,extra={})=>({voice:'keys',profile,note,time,duration:1.7,velocity:.7,pan:0,...extra});
const just=resolveTuning('',{system:'just'});
const examples=[
  {name:'pluck-position',description:'Same guitar note: pluck at center, then near bridge.',events:[event('acoustic_guitar',57,0,{pluckPosition:.5,pickupPosition:.7}),event('acoustic_guitar',57,2,{pluckPosition:.08,pickupPosition:.7})]},
  {name:'just-intonation',description:'C-major chord: equal temperament, then just intonation.',events:[...([60,64,67].map(n=>event('additive',n,0))),...([60,64,67].map(n=>event('additive',n,2,{frequency:tunedHz(n,just)})))]},
  {name:'fm-filters',description:'Four-operator FM: pairs/ladder, then branch/diode with cutoff movement.',events:[event('fm_synth',48,0,{fmAlgorithm:'pairs',filterModel:'ladder',cutoff:1100,resonance:.5}),event('fm_synth',48,2,{fmAlgorithm:'branch',fmFeedback:.8,filterModel:'diode',cutoff:700,modulation:[{source:'lfo',target:'cutoff',amount:2,rate:2}]})]},
  {name:'scanned-gendy',description:'Elastic scanned synthesis, then stochastic GENDY waveform.',events:[event('scanned',57,0,{scanStiffness:.1}),event('gendy',57,2,{stochasticRate:.3})]},
  {name:'new-instruments',description:'Kora, viola, handpan and English horn, staggered across four seconds.',events:[event('kora',60,0,{duration:1.2}),event('viola',64,1,{duration:1.1}),event('handpan',67,2,{duration:1.8}),event('english_horn',72,3,{duration:.9})]},
  {name:'fof-risset',description:'FOF vowel-like tone, then rising Risset layers.',events:[event('fof',48,0,{vowel:'a'}),event('risset',57,2,{rissetRate:.3})]},
];
const paths=examples.map(e=>directory+`v110-listen-${e.name}-001.wav`),manifestPath=directory+'v110-listening-previews-001.json';
await mkdir(directory,{recursive:true});
for(const path of [...paths,manifestPath]){try{await access(path);throw new Error('Output exists: '+path);}catch(error){if(error.code!=='ENOENT')throw error;}}
const results=[];
for(const [i,example]of examples.entries()){
  const score=compose('classical 8 bars',{seed:36,sauce:0,mix:{preset:'dry'}});score.config.duration=4;score.drums={kick:[],snare:[],hat:[],tom:[]};score.bass=[];score.lead=[];score.arp=[];score.parts=[];score.automation=[];score.keys=example.events;
  const audio=renderAudio(score,{sampleRate}),wav=packWav(audio);await writeFile(paths[i],wav,{flag:'wx'});
  results.push({path:paths[i],description:example.description,events:example.events,seed:36,sampleRate,bytes:wav.length,sha256:createHash('sha256').update(wav).digest('hex'),stats:audio.stats});
}
await writeFile(manifestPath,JSON.stringify({version:'1.10.0',date:'2026-10-29',examples:results},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({files:results.length,bytes:results.reduce((s,e)=>s+e.bytes,0),manifest:manifestPath,measurements:results.map(e=>({name:e.path.split('/').at(-1),...e.stats}))},null,2));
