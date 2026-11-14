import assert from 'node:assert/strict';
import { readFile, writeFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync, gunzipSync } from 'node:zlib';
import { compose, renderAudio, sliceAudio } from '../src/index.js';
import { hash, nextBatch, sourceIdentity, verifySources, encodePreview } from './lib/audio-evaluation.js';
const root=new URL('../',import.meta.url),output=fileURLToPath(new URL('generated_beats/',root));
const stage=process.argv[2];assert(['before','after'].includes(stage),'Use before, or after BATCH.');
const batch=stage==='before'?await nextBatch(output,'phrasing-compare'):process.argv[3];assert(/^phrasing-compare-\d{3}$/.test(batch));
const manifestPath=join(output,batch+'.manifest.json');
const cases=[{id:'piano',prompt:'deep house 32 bars in C minor at 120bpm with acoustic piano',seed:918},
 {id:'clav',prompt:'synth funk 32 bars in C minor at 110bpm with clavinet',seed:918},
 {id:'synth',prompt:'progressive house 32 bars in C minor at 126bpm with wavetable',seed:918}];
const m=stage==='before'?{batch,previewSeconds:12,status:'before',stages:{},cases:cases.map(c=>({...c}))}:JSON.parse(await readFile(manifestPath));
assert(!m.stages[stage],'Stage already exists; preserve earlier audio.');
async function bytes(dir=output,nested=false){let n=0;for(const e of await readdir(dir,{withFileTypes:true})){if(!nested&&!/^(?:palette-vocals-001|palette-vocals-run|palette-vocals-analysis|expanded-20|phrasing-)/.test(e.name))continue;const p=join(dir,e.name);n+=e.isDirectory()?await bytes(p,true):(await stat(p)).size;}return n;}
const sources=await sourceIdentity(root);m.stages[stage]={sources,engineVersion:JSON.parse(await readFile(new URL('package.json',root))).version};
for(const c of m.cases){
 const s=compose(c.prompt,{seed:c.seed,sauce:0}),name=batch+'-'+c.id+'-'+stage;
 if(stage==='after'){
  const old=JSON.parse(gunzipSync(await readFile(join(output,c.before.score))));
  for(const key of ['chords','drums','bass','lead','arp'])assert.deepEqual(JSON.parse(JSON.stringify(s[key])),old[key],key+' changed during the accompaniment comparison');
 }
 const compressed=gzipSync(Buffer.from(JSON.stringify(s)),{level:9});assert((await bytes())+compressed.length+400000<25e6,'Approved combined evaluation budget would be exceeded.');
 await writeFile(join(output,name+'.score.json.gz'),compressed,{flag:'wx'});
 const start=s.config.timeline[20].time,preview=sliceAudio(renderAudio(s),start,12);
 const audioChecks=await encodePreview(join(output,name+'.mp3'),preview);
 const attacks=Array.from({length:8},(_,i)=>[...new Set(s.keys.filter(e=>e.bar===20+i).map(e=>Number((e.step-s.config.timeline[20+i].startStep).toFixed(4))))]);
 c[stage]={audio:name+'.mp3',score:name+'.score.json.gz',scoreSha256:hash(compressed),audioChecks,attacks,uniqueAttackBars:new Set(attacks.map(x=>JSON.stringify(x))).size};
 console.log(stage+' '+c.id+': '+c[stage].uniqueAttackBars+' attack patterns across drop bars');
}
await verifySources(root,sources);m.status=stage==='after'?'complete':'before';m.combinedRetainedBytes=await bytes();assert(m.combinedRetainedBytes<25e6);
await writeFile(manifestPath,JSON.stringify(m,null,2)+'\n',{flag:stage==='before'?'wx':'w'});
if(stage==='after'){
 const lines=['# Accompaniment before / after','', 'Same prompts, seeds, chords, drums, bass, lead and arpeggios. Only accompaniment changes. Twelve-second previews from bar 20. Loudness matching only attenuates; listen before judging preference.',''];
 for(const c of m.cases){lines.push('## '+c.id,'',c.prompt,'');for(const stage of ['before','after'])lines.push('**'+stage+'** — '+c[stage].uniqueAttackBars+' distinct attack bars in the eight-bar drop.','','!['+c.id+' '+stage+'](<'+join(output,c[stage].audio)+'>)','');}
 await writeFile(join(output,batch+'.listening.md'),lines.join('\n')+'\n',{flag:'wx'});
}
console.log(batch+' '+stage+' saved; combined retained '+(await bytes()/1e6).toFixed(2)+' MB.');
