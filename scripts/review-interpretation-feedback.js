// Render only the human-discussed cases. Preserve the first listening set as evidence.
import assert from 'node:assert/strict';
import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { compose, renderAudio, sliceAudio } from '../src/index.js';
import { writeJson } from '../src/export.js';
import { checkCase } from './evaluation-checks.js';
import { hash, nextBatch, sourceIdentity, verifySources, encodePreview } from './lib/audio-evaluation.js';
const root = new URL('../', import.meta.url), output = fileURLToPath(new URL('generated_beats/', root));
const fixture = JSON.parse(await readFile(new URL('data/varied-prompt-evaluation.json', root), 'utf8'));
const baseline = JSON.parse(await readFile(join(output, 'varied-50-001.manifest.json'), 'utf8'));
const selectedIds = ['02','03','04','05','06','07','08','09','35','50'];
const batch = await nextBatch(output, 'context-review');
const sources = await sourceIdentity(root);
for (const path of ['data/varied-prompt-evaluation.json','scripts/review-interpretation-feedback.js','scripts/evaluation-checks.js','scripts/lib/audio-evaluation.js']) sources.push({path,sha256:hash(await readFile(new URL(path,root)))});
let retainedBytes = 0;
// Include the original 50-case set, phrasing controls and development reports.
for (const name of await readdir(output)) {
  if (/^(?:varied-50-001|bass-phrasing-001|varied-prompts-|intent-contextual|interpretation-|context-review)/.test(name)) retainedBytes += (await stat(join(output,name))).size;
}
const budget = 40e6, rows = [];
for (let i=0;i<fixture.cases.length;i++) {
  const item = fixture.cases[i], score = compose(item.prompt,{seed:fixture.seedBase+i});
  const result = checkCase(score,item.expect);
  assert(result.passed,'Updated expectations failed for '+item.id);
  const previous = baseline.cases.find((r)=>r.id===item.id);
  rows.push({id:item.id,prompt:item.prompt,seed:fixture.seedBase+i,before:previous.interpretation,
    after:{intent:score.config.intent,bpm:score.config.bpm,synthProfile:score.config.synthProfile,bassProfile:score.config.bassProfile,soundDesign:score.config.soundDesign},
    ...result});
}
const manifest = {batch,status:'rendering',createdAt:new Date().toISOString(),sources,previewSeconds:16,previewStartBar:20,
  baselineManifest:'varied-50-001.manifest.json',baselineManifestSha256:hash(await readFile(join(output,'varied-50-001.manifest.json'))),
  note:'Same original prompt and seed, new interpretation/composition version. Genre defaults including sauce may change. These are revised examples, not proof of musical acceptance.',
  storageBudgetBytes:budget,cases:[],all50Checks:rows.map(({id,passed,checks})=>({id,passed,checks}))};
await writeJson(join(output,batch+'.before-after.json'),{batch,rows});
const manifestPath = join(output,batch+'.manifest.json');
await writeJson(manifestPath,manifest);
for (const row of rows.filter((r)=>selectedIds.includes(r.id))) {
  console.log('Rendering '+row.id+': '+row.before.intent+' -> '+row.after.intent+' at '+row.after.bpm+' BPM');
  const score = compose(row.prompt,{seed:row.seed});
  const prefix = batch+'-'+row.id;
  const scoreBytes = Buffer.from(JSON.stringify(score,null,2)+'\n');
  assert(retainedBytes+scoreBytes.length+900000 < budget,'Agreed combined 40 MB budget would be exceeded.');
  const scoreName = prefix+'.score.json', audioName=prefix+'.mp3';
  await writeFile(join(output,scoreName),scoreBytes,{flag:'wx'});
  const startSeconds=20*score.config.beatsPerBar*60/score.config.bpm;
  const preview=sliceAudio(renderAudio(score),startSeconds,16);
  assert.equal(preview.frames,16*44100);
  assert(preview.stats.rms>.0001 && preview.stats.peak<1);
  const audioChecks=await encodePreview(join(output,audioName),preview);
  retainedBytes+=scoreBytes.length+(await stat(join(output,audioName))).size;
  const item={...row,audio:audioName,score:scoreName,scoreSha256:hash(scoreBytes),audioChecks,
    interpretation:row.after,expect:fixture.cases.find((r)=>r.id===row.id).expect,
    excerpt:{startSeconds,durationSeconds:16},rawPcmStats:preview.stats,
    humanReview:{interpretationFit:null,groove:null,tone:null,improved:null,notes:null}};
  manifest.cases.push(item);
  await writeJson(manifestPath,manifest,true);
}
await verifySources(root,sources);
manifest.status='complete';manifest.completedAt=new Date().toISOString();manifest.combinedRetainedBytesBeforeFinalReports=retainedBytes;
await writeJson(manifestPath,manifest,true);
const lines=['# Revised interpretation — same prompts and seeds','',
  'Ten cases discussed in human feedback. The earlier audio is preserved for comparison. Preview clips are 16 seconds from bar 20; full 32-bar scores are saved. Interpretation choices and mix/phrasing have changed. Listening ratings remain open.','',
  '[All 50 before/after interpretations](<'+join(output,batch+'.before-after.json')+'>) · [Checks and source identities](<'+manifestPath+'>)',''];
for (const row of manifest.cases) {
  const p=row.after, old=baseline.cases.find((r)=>r.id===row.id);
  lines.push('## '+row.id+' — '+row.prompt,'',
    'Before: '+row.before.intent+' / '+row.before.bpm+' BPM / '+row.before.bassProfile+'.',
    'After: **'+p.intent+' / '+p.bpm+' BPM / '+p.bassProfile+'**. Harmony: '+p.soundDesign.harmonyPattern+'; register shift: '+p.soundDesign.harmonyRegister+' semitones.','',
    '!['+row.id+' revised](<'+join(output,row.audio)+'>)','',
    '[Original clip](<'+join(output,old.audio)+'>) · [Full revised score](<'+join(output,row.score)+'>)','',
    'Listening: closer to the ask ___ | remaining mismatch ___ | keep/change ___','');
}
await writeFile(join(output,batch+'.listening.md'),lines.join('\n')+'\n',{flag:'wx'});
console.log('Ready: '+join(output,batch+'.listening.md'));
console.log('Combined retained set budget: '+(retainedBytes/1e6).toFixed(2)+' / 40 MB before small final reports.');
