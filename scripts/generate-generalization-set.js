import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, readdir, lstat, symlink, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';
import { compose, renderAudio, sliceAudio } from '../src/index.js';
import { writeJson } from '../src/export.js';
import { hash, sourceIdentity, verifySources, encodePreview, run } from './lib/audio-evaluation.js';
import { checkGeneralization, selectExcerpt, scoreHash } from './lib/generalization-evaluation.js';

const root=new URL('../',import.meta.url),folder=process.argv[2]??'set8';
assert(/^set\d+$/.test(folder));
const output=fileURLToPath(new URL('generated_beats/'+folder+'/',root));
const fixtureBytes=await readFile(new URL('data/generalization-evaluation.json',root)),fixture=JSON.parse(fixtureBytes);
assert.equal(fixture.cases.length,12);assert.equal(fixture.seeds.length,2);
const engineCommit=(await run('git',['rev-parse',fixture.sourceCommit])).stdout.trim();
const runtimePaths=['src','data/genre-rules.json','data/intent-corpus.json','package.json'];
await run('git',['diff','--quiet',engineCommit,'--',...runtimePaths]);
const sources=await sourceIdentity(root);
await run('git',['ls-files','--error-unmatch',...sources.map(s=>s.path)]);
for(const path of ['data/generalization-evaluation.json','scripts/lib/generalization-evaluation.js','scripts/evaluation-checks.js','scripts/generate-generalization-set.js','scripts/lib/audio-evaluation.js'])sources.push({path,sha256:hash(await readFile(new URL(path,root)))});
await mkdir(output,{recursive:true});
const manifestPath=join(output,'manifest.json');
try{await access(manifestPath);throw new Error('Collection manifest exists; preserve earlier results.');}catch(e){if(e.code!=='ENOENT')throw e;}
const write=(name,data)=>writeFile(join(output,name),typeof data==='string'||Buffer.isBuffer(data)?data:JSON.stringify(data,null,2)+'\n',{flag:'wx'});
async function bytes(){let n=0;for(const f of await readdir(output))n+=(await lstat(join(output,f))).size;return n;}
const prepared=[];
for(const row of fixture.cases)for(const [index,seed]of fixture.seeds.entries()){
 const score=compose(row.prompt,{...fixture.options,seed});
 assert.equal(scoreHash(score),scoreHash(compose(row.prompt,{...fixture.options,seed})),row.id+': score replay failed');
 const result=checkGeneralization(score,row.expect);assert(result.safetyPassed,row.id+': unsafe event data');
 const compressed=gzipSync(Buffer.from(JSON.stringify(score)+'\n'),{level:9}),excerpt=selectExcerpt(score,fixture.previewSeconds);
 const rendererInput=structuredClone(score);delete rendererInput.config.prompt;delete rendererInput.config.classification;delete rendererInput.config.messages;
 prepared.push({row,seed,variant:index?'B':'A',score,compressed,excerpt,result,rendererInput,renderKey:scoreHash(rendererInput)});
}
assert(await bytes()+prepared.reduce((n,p)=>n+p.compressed.length+386_000,0)+800_000<fixture.storageLimitBytes,'Budget preflight failed');
await write('prompts.json',fixture);
const manifest={batch:folder,status:'rendering',engineCommit,engineVersion:prepared[0].score.config.version,nodeVersion:process.version,
 fixtureSha256:hash(fixtureBytes),sources,previewSeconds:fixture.previewSeconds,storageLimitBytes:fixture.storageLimitBytes,
 method:'Ordinary compose(prompt,{seed,vocals:off}), two predeclared seeds per prompt; no post-composition profile swaps or seed selection. Failed observable constraints remain reported. Vague styles are not forced to a single label.',
 caveat:'Listening previews do not establish full-arrangement quality, instrument realism or semantic correctness. Distinct hashes do not establish musical diversity. Human ratings remain unfilled.',cases:[]};
await writeJson(manifestPath,manifest);
const cache=new Map();
for(const p of prepared){
 await verifySources(root,sources);
 const id=p.row.id+'-'+p.variant,scoreFile=id+'.score.json.gz',audioFile=id+'.mp3';
 assert(await bytes()+p.compressed.length+2*386_000+250_000<fixture.storageLimitBytes,'Insufficient storage including codec temporary and report reserve');
 await write(scoreFile,p.compressed);
 const item={id,promptId:p.row.id,variant:p.variant,group:p.row.group,prompt:p.row.prompt,listenFor:p.row.listenFor,seed:p.seed,options:fixture.options,expect:p.row.expect,
 score:scoreFile,scoreSha256:hash(p.compressed),audio:audioFile,excerpt:p.excerpt,...p.result,
 interpretation:{intent:p.score.config.intent,classification:p.result.classification,bpm:p.score.config.bpm,root:p.score.config.rootName,scale:p.score.config.scale,timeSignature:p.score.config.timeSignature,
 bass:p.score.config.bassProfile,harmony:p.score.config.synthProfile,lead:p.score.config.soundDesign.leadEnabled?p.score.config.soundDesign.leadProfile:null,accompaniment:p.score.config.accompaniment,
 parts:p.score.parts.map(x=>({name:x.name,role:x.role,profile:x.profile})),tuning:p.score.config.tuning,development:p.score.config.development},
 humanReview:{promptFit:null,groove:null,sound:null,repetition:null,overallUsefulness:null,notes:null}};
 const cached=cache.get(p.renderKey);
 if(cached){
  assert.deepEqual(p.rendererInput,cached.rendererInput);
  assert.deepEqual(p.excerpt,cached.excerpt);
  await symlink(cached.audio,join(output,audioFile));
  item.audioChecks=cached.audioChecks;item.fullAudioStats=cached.fullAudioStats;item.previewStats=cached.previewStats;
  item.renderReuse={case:cached.id,reason:'Identical renderer inputs after removing only prompt text, classification metadata and messages. Existing encoded clip linked without duplicate storage.'};
 }else{
  const full=renderAudio(p.score),preview=sliceAudio(full,p.excerpt.startSeconds,fixture.previewSeconds);
  assert.equal(preview.frames,44100*fixture.previewSeconds);
  assert(Number.isFinite(full.stats.rms)&&full.stats.rms>.001&&full.stats.peak<=.93);
  assert(preview.stats.rms>.0001,'Silent preview');
  item.fullAudioStats=full.stats;item.previewStats=preview.stats;
  item.audioChecks=await encodePreview(join(output,audioFile),preview,{targetLufs:-18});
  cache.set(p.renderKey,{id,audio:audioFile,rendererInput:p.rendererInput,excerpt:p.excerpt,audioChecks:item.audioChecks,fullAudioStats:item.fullAudioStats,previewStats:item.previewStats});
 }
 manifest.cases.push(item);await writeJson(manifestPath,manifest,true);
 console.log(id+': '+item.classification.intent+'; constraints '+(item.constraintPassed?'pass':'FAIL')+(item.renderReuse?'; identical music linked to '+item.renderReuse.case:''));
}
await verifySources(root,sources);
const anchorSpecs=[
 {id:'02-preferred',folder:'set7/combined',case:'02',variant:'combined',feedback:'D approved: warm sub + Rhodes'},
 {id:'08-preferred',folder:'set7',case:'08',variant:'C-harmony',feedback:'C approved: upright bass + acoustic piano'},
 {id:'09-preferred',folder:'set7/combined',case:'09',variant:'combined',feedback:'D approved: analog bass + organ'},
 {id:'12-groove',folder:'set6',case:'12',variant:'before',feedback:'A preferred for groove; B preferred for repetition/overall'},
 {id:'12-overall',folder:'set6',case:'12',variant:'after',feedback:'B preferred for repetition/overall; A preferred for groove'},
 {id:'20-reference',folder:'set6',case:'20',variant:'before',feedback:'Slight A preference'},
 {id:'13-similar-A',folder:'set6',case:'13',variant:'before',feedback:'A and B sounded about the same'},
 {id:'13-similar-B',folder:'set6',case:'13',variant:'after',feedback:'A and B sounded about the same'},
];
const anchors=[];
for(const a of anchorSpecs){
 const directory=fileURLToPath(new URL('generated_beats/'+a.folder+'/',root)),old=JSON.parse(await readFile(join(directory,'manifest.json'))),row=old.cases.find(c=>c.id===a.case);
 const variant=a.variant==='C-harmony'?row.variants.find(v=>v.label===a.variant):row[a.variant];
 const audioSha256=variant.audioSha256??variant.audioChecks.audioSha256;
 assert.equal(hash(await readFile(join(directory,variant.audio))),audioSha256);assert.equal(hash(await readFile(join(directory,variant.score))),variant.scoreSha256);
 anchors.push({...a,audio:join(directory,variant.audio),score:join(directory,variant.score),audioSha256,scoreSha256:variant.scoreSha256,
 check:'Archived identity preserved. Not newly rendered with v1.10; prior human preferences are not assumed to survive every DSP change.'});
}
await write('reference-anchors.json',anchors);
const duplicates=new Map();for(const row of manifest.cases){const list=duplicates.get(row.musicPlanSha256)??[];list.push(row.id);duplicates.set(row.musicPlanSha256,list);}
manifest.summary={cases:24,constraintPassed:manifest.cases.filter(r=>r.constraintPassed).length,safetyPassed:manifest.cases.filter(r=>r.safetyPassed).length,
 signalPassed:manifest.cases.filter(r=>r.audioChecks.encoded.truePeakDbfs<=-1).length,newEncodedFiles:cache.size,reusedAudioLinks:manifest.cases.filter(r=>r.renderReuse).length,
 unresolvedStyleCases:manifest.cases.filter(r=>r.classification.fallback).map(r=>r.id),identicalMusicPlans:[...duplicates.values()].filter(ids=>ids.length>1),
 constraintFailures:manifest.cases.filter(r=>!r.constraintPassed).map(r=>({id:r.id,checks:r.checks.filter(c=>!c.passed)})),referenceArtifactsVerified:anchors.length};
for(const row of manifest.cases){
 assert.equal(hash(await readFile(join(output,row.audio))),row.audioChecks.audioSha256);
 const data=await readFile(join(output,row.score));assert.equal(hash(data),row.scoreSha256);
 assert.equal(scoreHash(JSON.parse(gunzipSync(data))),scoreHash(compose(row.prompt,{...row.options,seed:row.seed})));
}
const summary=['# '+folder+' — fresh prompt evaluation','',fixture.purpose,'',
 '24 previews: 12 prompts × two fixed seeds. A/B are different seeds, not before/after versions. All generation is automatic from the prompts. No sound substitutions were applied after composing.','',
 '**Observable constraints: '+manifest.summary.constraintPassed+'/24. Event safety and encoded audio headroom: 24/24.** These are not music-quality scores.','',
 'Known constraint misses: '+manifest.summary.constraintFailures.map(r=>r.id+' ('+r.checks.map(c=>c.name+': '+JSON.stringify(c.actual)+'; requested '+JSON.stringify(c.expected)).join(', ')+')').join('; ')+'.','',
 'Unresolved style/fallback cases: '+manifest.summary.unresolvedStyleCases.join(', ')+'. Distinct vague briefs may map to the same neutral arrangement.','',
 'Identical music-plan groups: '+manifest.summary.identicalMusicPlans.map(ids=>ids.join(' / ')).join('; ')+'. Identical renderer inputs reuse audio via local links; every original prompt and seed remains listed.','',
 'Rate prompt fit, groove, sound, repetition and overall usefulness separately. Full 32-bar scores are saved, but only the 16-second focal excerpts are auditioned here. All human score fields start blank.',''];
for(const group of ['vague','detailed','contrast']){
 summary.push('## '+group,'');
 for(const prompt of fixture.cases.filter(c=>c.group===group)){
  summary.push('### '+prompt.id,'',prompt.prompt,'','Listen for: '+prompt.listenFor,'');
  for(const row of manifest.cases.filter(r=>r.promptId===prompt.id)){
   const i=row.interpretation;
   summary.push('**'+row.variant+' — seed '+row.seed+'**','','!['+row.id+'](<'+join(output,row.audio)+'>)','',
    `Actual: ${i.intent} (${row.classification.source}); ${i.bpm} BPM; ${i.root} ${i.scale}; ${i.timeSignature}. Bass ${i.bass}; harmony ${i.harmony}; lead ${i.lead??'off'}; accompaniment ${i.accompaniment.style}.`,'',
    'Constraint checks: '+(row.constraintPassed?'pass':row.checks.filter(c=>!c.passed).map(c=>c.name+' = '+JSON.stringify(c.actual)+'; requested '+JSON.stringify(c.expected)).join('; '))+'.'+(row.renderReuse?' Same rendered music as '+row.renderReuse.case+'.':''),'');
  }
  summary.push('Prompt fit ___ · Groove ___ · Sound ___ · Repetition ___ · Useful/keep? ___ · A/B preference or tie ___','');
 }
}
summary.push('## Existing listening references','','These links preserve the previously rated files. They were hash-verified, not regenerated with the new DSP.','');
for(const a of anchors)summary.push('- ['+a.id+'](<'+a.audio+'>): '+a.feedback);
await write('listening.md',summary.join('\n')+'\n');
await write('scorecard.csv','case,prompt_fit,groove,sound,repetition,overall_usefulness,notes\n'+manifest.cases.map(r=>r.id+',,,,,,').join('\n')+'\n');
await verifySources(root,sources);
manifest.status='complete';await writeJson(manifestPath,manifest,true);
await write('evaluation.json',{engineCommit,engineVersion:manifest.engineVersion,summary:manifest.summary,
 caveat:'Explicit requested settings are checked; vague style/mood fit, musical quality, timbre realism and perceived diversity remain human judgments.'});
assert(await bytes()<fixture.storageLimitBytes);
console.log('Complete: '+output+'; '+(await bytes())+' bytes; '+manifest.summary.constraintPassed+'/24 observable constraints; '+cache.size+' new audio files.');
