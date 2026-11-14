import assert from 'node:assert/strict';
import { readFile, writeFile, readdir, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, basename } from 'node:path';
import { createHash } from 'node:crypto';
const root=new URL('../',import.meta.url), output=fileURLToPath(new URL('generated_beats/',root));
const name=process.argv[2];
assert(/^palette-vocals-\d{3}$/.test(name),'Usage: node scripts/audit-palette-vocals.js palette-vocals-NNN');
const bytes=await readFile(join(output,name+'.manifest.json')), manifest=JSON.parse(bytes);
assert.equal(manifest.status,'complete'); assert.equal(manifest.cases.length,25);
const digest=b=>createHash('sha256').update(b).digest('hex');
const snapshot=new URL('generated_beats/'+manifest.integration.snapshot+'/',root);
for(const source of manifest.sources) assert.equal(digest(await readFile(new URL(source.path,snapshot))),source.sha256);
for(const row of manifest.cases) {
  for(const filename of [row.audio,row.score]) assert.equal(filename,basename(filename));
  assert.equal(digest(await readFile(join(output,row.audio))),row.audioChecks.audioSha256);
  assert.equal(digest(await readFile(join(output,row.score))),row.scoreSha256);
  assert.equal(row.audioChecks.probe.streams[0].channels,2);
  assert.equal(row.audioChecks.probe.streams[0].sample_rate,'44100');
  assert(row.audioChecks.encoded.truePeakDbfs<=-1);
  if(row.vocal) assert(row.vocalChecks.previewAudible && row.vocalChecks.preparedBankMixDeterministic && row.vocalChecks.nonOverlappingWithinTrack && row.vocalChecks.hookInDrop);
  else assert(row.vocalChecks.noVocalPlan && row.vocalChecks.bridgePreservesInstrumentalPcm);
}
const {compose}=await import(new URL('src/index.js',snapshot));
const {arrangeVocals,MACOS_VOICES}=await import(new URL('src/vocals.js',snapshot));
let boundaryProbes=0;
for(const voice of Object.keys(MACOS_VOICES)) for(const genre of ['deep house','speed garage','trap','afro house','liquid dnb','country']) for(const bpm of [40,240]) {
  const score=compose(genre+' '+bpm+'bpm',{seed:921,sauce:1});
  const options={voice,lyrics:'Move now. Stay here.',hook:'Move now',vocalDensity:1,vocalChops:1};
  const plan=arrangeVocals(score.config,score.sections,score.automation,options);
  assert.deepEqual(plan,arrangeVocals(score.config,score.sections,score.automation,options));
  assert(plan.events.every((e,i)=>e.time>=0 && e.time+e.duration<=score.config.duration+1e-8 && (!i||plan.events[i-1].time+plan.events[i-1].duration<=e.time+1e-8)));
  const air=score.automation.filter(a=>a.type==='air');
  assert(plan.events.every(e=>!air.some(a=>e.time<a.endStep*score.config.stepSeconds && e.time+e.duration>a.startStep*score.config.stepSeconds+1e-8)));
  assert.equal(arrangeVocals(score.config,score.sections,score.automation,{...options,vocalDensity:0}).events.length,0);
  assert.equal(arrangeVocals(score.config,score.sections,score.automation,{...options,vocals:'off'}),null);
  boundaryProbes++;
}
async function size(path){let n=0;for(const e of await readdir(path,{withFileTypes:true})){if(path===output&&!e.name.startsWith(name))continue;const p=join(path,e.name);n+=e.isDirectory()?await size(p):(await stat(p)).size;}return n;}
const report={batch:name,manifestSha256:digest(bytes),sourceAndAudioHashesVerified:true,casesVerified:25,boundaryProbesPassed:boundaryProbes,
  boundaryProbeSettings:{voices:Object.keys(MACOS_VOICES),genres:['deep house','speed garage','trap','afro house','liquid dnb','country'],bpms:[40,240],seed:921,density:1,chops:1,sauce:1},
  voicesActuallyRendered:[...new Set(manifest.cases.filter(r=>r.vocal).map(r=>r.vocalChecks.voice))],
  vocalNativeBytesReproducible:false,note:'Event plans and mixing of an unchanged prepared bank replay exactly. Native macOS speech bytes can vary; only source hashes, not speech banks, are retained.',
  failedRequirements:manifest.cases.flatMap(r=>r.checks.filter(c=>!c.passed).map(c=>({id:r.id,...c}))),
  baselineLiveTreeTests:{passed:64,failed:2,total:66,note:'Observed before source capture while another agent was editing. This is not a whole-suite result for the frozen snapshot or later working tree.',failures:[{test:'separate intent regression cases cover descriptive prompts and genre exclusions',evidence:'fractured modular percussion, polymetric clicks and metallic FM plucks: actual sgija, expected idm_glitch'},{test:'bass phrasing changes timing, accents and pitch while keeping the synth recipe',evidence:'Call-and-response bass request changed drum events, violating the controlled-comparison invariant.'}]},
  narrowPassesAreNotMusicApproval:true,retainedBytesBeforeAudit:await size(output)};
await writeFile(join(output,name+'.audit.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
assert((await size(output))<manifest.storageLimitBytes,'Budget exceeded');
console.log(JSON.stringify({hashesVerified:true,boundaryProbes,voices:report.voicesActuallyRendered.length,failedRequirements:report.failedRequirements.length,retainedMB:(await size(output))/1e6}));
