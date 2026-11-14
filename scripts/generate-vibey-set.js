// Three saved-seed variations per user specification, using existing engine APIs.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, readdir, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { compose, renderAudio, sliceAudio, prepareVocalSamples, vocode } from '../src/index.js';
import { instrumentVoice } from '../src/instruments.js';
import { random } from '../src/random.js';
import { sourceIdentity, verifySources, hash, encodePreview, run } from './lib/audio-evaluation.js';
const root=new URL('../',import.meta.url),base=fileURLToPath(new URL('generated_beats/',root));
const fixtureBytes=await readFile(new URL('data/vibey-75.json',root)),fixture=JSON.parse(fixtureBytes);
assert.equal(fixture.cases.length,25);assert.equal(new Set(fixture.cases.flatMap(c=>c.seeds)).size,75);
let folder=process.argv[2];
if(folder===undefined){const names=await readdir(base);const numbers=names.filter(n=>/^set\d+$/.test(n)).map(n=>Number(n.slice(3)));folder='set'+(Math.max(0,...numbers)+1);}
assert(/^set\d+$/.test(folder),'Supply a set folder name such as set5.');
const batch=folder+'-vibey-75',output=join(base,folder);await mkdir(output);
const sources=await sourceIdentity(root);
for(const path of ['data/vibey-75.json','scripts/generate-vibey-set.js','scripts/lib/audio-evaluation.js'])sources.push({path,sha256:hash(await readFile(new URL(path,root)))});
const manifest={batch,status:'rendering',createdAt:new Date().toISOString(),gitHead:(await run('git',['rev-parse','HEAD'])).stdout.trim(),engineVersion:JSON.parse(await readFile(new URL('package.json',root))).version,
 nodeVersion:process.version,ffmpeg:(await run('ffmpeg',['-version'])).stdout.split('\n')[0],fixtureSha256:hash(fixtureBytes),sources,previewSeconds:fixture.previewSeconds,
 storageLimitBytes:fixture.newBatchBudgetBytes,vocalVelocityScale:fixture.vocalVelocityScale,
 caveats:['Three saved random seeds per identical adapted prompt; no best-of seed selection.','Original structures, unsupported meters/free time and singing requests have explicit adaptation notes.','Full scores and actual layered-voice inventory are retained. Narrow checks are not overall request success or musical-quality ratings.','Speech source bank is reused across the three variants; native speech bytes can vary when prepared again.','Preview is cut from the full rendered score using the actual timeline; it may include multiple sections.','Only previews are retained as audio. Full arrangements remain gzip JSON scores.'],cases:[]};
const manifestPath=join(output,'manifest.json');
const save=()=>writeFile(manifestPath,JSON.stringify(manifest,null,2)+'\n');
await writeFile(manifestPath,JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
await writeFile(join(output,'prompts.json'),fixtureBytes,{flag:'wx'});
async function bytes(){let n=0;for(const e of await readdir(output,{withFileTypes:true})){assert(e.isFile(),'Unexpected batch subfolder');n+=(await stat(join(output,e.name))).size;}return n;}
function focal(score){return ['drop','chorus','B','variation2','A','verse'].map(name=>score.sections.find(s=>s.name===name)).find(Boolean)??score.sections[Math.floor(score.sections.length/2)];}
function build(item,seed){
 const probe=compose(item.prompt,{seed,mix:item.mix});const focus=focal(probe);
 const score=compose(item.prompt,{seed,mix:item.mix,...item.vocal,vocalSection:focus.name});
 score.vocals.events=score.vocals.events.filter(e=>e.bar>=focus.start&&e.bar<focus.end);
 for(const event of score.vocals.events)event.velocity*=fixture.vocalVelocityScale;
 for(const event of [...score.keys,...score.parts.flatMap(p=>p.events)])if(event.profile==='choir')event.velocity*=.35;
 return {score,focus};
}
function bankProcessing(bank,score,effect){
 if(effect!=='vocoder')return bank;
 const sources={},hashes={},note=48+score.config.root;
 for(const [name,input] of Object.entries(bank.sources)){
  const synth=instrumentVoice({profile:'supersaw',note,detune:7},bank.sampleRate,random('vibey-vocoder',name));
  const carrier=Float32Array.from({length:input.length},(_,i)=>synth(i/bank.sampleRate));
  const output=vocode(carrier,input,bank.sampleRate);let peak=0;for(const value of output){assert(Number.isFinite(value));peak=Math.max(peak,Math.abs(value));}
  assert(peak>1e-7,'Silent vocoder bank');const gain=Math.min(8,.7/peak);for(let i=0;i<output.length;i++)output[i]*=gain;
  sources[name]=output;hashes[name]=hash(Buffer.from(output.buffer,output.byteOffset,output.byteLength));
 }
 return {...bank,sources,hashes,processing:{method:'existing vocode() plus existing supersaw carrier',carrierNote:note,inputHashes:bank.hashes}};
}
function evaluate(score,item,focus){
 const c=score.config,events=[...Object.values(score.drums).flat(),...score.keys,...score.bass,...score.lead,...score.arp,...score.parts.flatMap(p=>p.events)];
 const profiles=[...new Set(events.map(e=>e.profile??e.voice))],checks=[];
 const check=(name,actual,expected,passed=actual===expected)=>checks.push({name,actual,expected,passed});
 check('intent',c.intent,item.expectedIntent);check('bpm',c.bpm,item.bpm);check('key',c.rootName,item.key);check('scale',c.scale,item.mode);check('adaptedMeter',c.timeSignature,item.meter);check('bars',c.bars,32);check('form',c.arrangement.form,item.form);
 for(const profile of item.requiredProfiles)check('profile:'+profile,profiles.includes(profile),true);
 check('finiteInstrumentEvents',events.every(e=>Number.isFinite(e.time)&&e.time>=0&&e.time<c.duration&&Number.isFinite(e.duration)&&e.duration>0&&e.time+e.duration<=c.duration+1e-8),true);
 check('vocalPhrasePresent',score.vocals.events.some(e=>e.kind==='phrase'),true);
 check('lightVocalVelocity',score.vocals.events.every(e=>e.velocity<=.32000001),true);
 check('vocalsInsideSelectedSection',score.vocals.events.every(e=>e.bar>=focus.start&&e.bar<focus.end&&e.time+e.duration<=focus.endTime+1e-8),true);
 check('monophonicPrimaryBass',score.bass.every((e,i)=>!i||score.bass[i-1].time+score.bass[i-1].duration<=e.time+1e-8),true);
 if([3,5,9,11].includes(Number(item.id)))check('noDrumKit',Object.values(score.drums).flat().length,0);
 return {passed:checks.every(x=>x.passed),checks,profiles};
}
let index=0;
for(const item of fixture.cases){
 let bank;
 for(let vi=0;vi<3;vi++){
  index++;const variant='ABC'[vi],seed=item.seeds[vi];console.log('['+index+'/75] '+item.id+variant+' '+item.title+' seed '+seed);
  await verifySources(root,sources);const {score,focus}=build(item,seed),replay=build(item,seed).score;assert.deepEqual(score,replay);
  const result=evaluate(score,item,focus),prefix=item.id+'-'+variant;
  if(!bank)bank=bankProcessing(await prepareVocalSamples(score),score,item.vocalEffect);
  score.vocals.sampleHashes=bank.hashes;score.vocals.speechRuntime=bank.runtime;if(bank.pitch)score.vocals.pitchResult=bank.pitch;
  if(bank.processing)score.vocals.processing=bank.processing;
  const audio=renderAudio(score,{vocalSamples:bank});
  assert.equal(audio.frames,Math.round(score.config.duration*44100));assert(audio.stats.rms>.0001&&audio.stats.peak<=.81);
  const startSeconds=Math.min(focus.startTime,score.config.duration-fixture.previewSeconds),preview=sliceAudio(audio,startSeconds,fixture.previewSeconds);
  assert.equal(preview.frames,44100*fixture.previewSeconds);
  const json=Buffer.from(JSON.stringify(score)+'\n'),compressed=gzipSync(json,{level:9});
  assert((await bytes())+compressed.length+650000+1500000<manifest.storageLimitBytes,'Approved additional batch budget would be exceeded.');
  const row={id:item.id+variant,specId:item.id,variant,title:item.title,seed,prompt:item.prompt,original:item.original,expect:{intent:item.expectedIntent},
   audio:prefix+'.mp3',score:prefix+'.score.json.gz',adaptations:item.adaptations,...result,
   interpretation:{intent:score.config.intent,source:score.config.classification.source,bpm:score.config.bpm,root:score.config.rootName,scale:score.config.scale,timeSignature:score.config.timeSignature,
    form:score.config.arrangement.form,accompaniment:score.config.accompaniment,partCount:score.parts.length,voice:score.vocals.voice,messages:score.config.messages},
   excerpt:{startSeconds,durationSeconds:fixture.previewSeconds,focusSection:focus.name,sections:score.sections.filter(s=>s.startTime<startSeconds+fixture.previewSeconds&&s.endTime>startSeconds).map(s=>s.name)},
   vocal:{effect:item.vocalEffect,events:score.vocals.events.length,velocityScale:fixture.vocalVelocityScale,sampleHashes:bank.hashes,processing:bank.processing??null},
   scoreSha256:hash(compressed),scoreJsonSha256:hash(json),fullAudioStats:audio.stats,
   humanReview:{promptFit:null,groove:null,instrumentTone:null,vocalFit:null,keep:null,notes:null}};
  await writeFile(join(output,row.score),compressed,{flag:'wx'});row.audioChecks=await encodePreview(join(output,row.audio),preview);row.status='ready';
  manifest.cases.push(row);await save();console.log('  '+result.checks.filter(x=>!x.passed).length+' narrow misses; '+result.profiles.length+' profiles; '+(await bytes()/1e6).toFixed(1)+' MB');
 }
}
await verifySources(root,sources);manifest.status='complete';manifest.completedAt=new Date().toISOString();
manifest.summary={clips:75,specifications:25,signalChecksPassed:manifest.cases.filter(r=>r.audioChecks.encoded.truePeakDbfs<=-1).length,
 requirements:manifest.cases.reduce((n,r)=>n+r.checks.length,0),requirementsPassed:manifest.cases.reduce((n,r)=>n+r.checks.filter(c=>c.passed).length,0),casesWithNoNarrowMisses:manifest.cases.filter(r=>r.passed).length,
 uniqueEncodedFiles:new Set(manifest.cases.map(r=>r.audioChecks.audioSha256)).size};await save();
const lines=['# Vibey set — 25 prompts, three variations each','',
 '75 sixteen-second previews from full 32-bar scores. A/B/C keep the same adapted prompt/key/tempo and use distinct saved random seeds. Native speech banks are shared within each trio.','',
 'Original requests, edited prompts and unsupported details remain visible. Specified custom forms, free time, 2/4 and lyric-following singing are approximated where noted. Vocals are restrained short phrases/chops; choir layers are wordless.','',
 '[Prompts and saved seeds](<'+join(output,'prompts.json')+'>) · [Manifest and checks](<'+manifestPath+'>)','',
 manifest.summary.signalChecksPassed+'/75 signal checks; '+manifest.summary.requirementsPassed+'/'+manifest.summary.requirements+' narrow requirements. These do not certify musical quality or exact original-request fulfillment.',''];
for(const item of fixture.cases){
 lines.push('## '+item.id+' — '+item.title,'',item.prompt,'','**Adaptations:** '+item.adaptations.join(' '),'');
 for(const row of manifest.cases.filter(r=>r.specId===item.id)){
  const failures=row.checks.filter(c=>!c.passed);lines.push('### '+row.variant+' · seed '+row.seed,'','!['+row.id+'](<'+join(output,row.audio)+'>)','',
   row.interpretation.intent+' · '+row.interpretation.bpm+' BPM · '+row.interpretation.root+' '+row.interpretation.scale+' · '+row.interpretation.timeSignature+' · '+row.interpretation.accompaniment.style+' accompaniment.','',
   '**Actual profiles:** '+row.profiles.join(', ')+'.','',
   '**Checks:** '+(failures.length?failures.map(c=>c.name+' = '+JSON.stringify(c.actual)).join('; '):'Narrow checks passed.')+'','',
   '[Full gzip score](<'+join(output,row.score)+'>) · '+row.audioChecks.encoded.integratedLufs+' LUFS · '+row.audioChecks.encoded.truePeakDbfs+' dBTP','');
 }
 lines.push('Preference: A ___ B ___ C ___ | prompt fit ___ | change ___','');
}
await writeFile(join(output,'listening.md'),lines.join('\n')+'\n',{flag:'wx'});
manifest.retainedBytes=await bytes();await save();assert((await bytes())<manifest.storageLimitBytes);
console.log(JSON.stringify({batch,...manifest.summary,retainedMB:manifest.retainedBytes/1e6,listening:join(output,'listening.md')}));
