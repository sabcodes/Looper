// Render the 20 saved requests through the integrated main API, without tuning them.
import assert from 'node:assert/strict';
import { readFile, writeFile, readdir, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { compose, renderAudio, sliceAudio, prepareVocalSamples } from '../src/index.js';
import { checkCase } from './evaluation-checks.js';
import { nextBatch, hash, encodePreview, sourceIdentity, verifySources, run } from './lib/audio-evaluation.js';

const root = new URL('../', import.meta.url), output = fileURLToPath(new URL('generated_beats/', root));
const fixturePath = 'data/expanded-palette-20.json', fixtureBytes = await readFile(new URL(fixturePath, root)), fixture = JSON.parse(fixtureBytes);
assert.equal(fixture.cases.length, 20);
const batch = await nextBatch(output, 'expanded-20');
const sources = await sourceIdentity(root);
for (const path of [fixturePath, 'scripts/generate-expanded-listening-set.js', 'scripts/evaluation-checks.js', 'scripts/lib/audio-evaluation.js']) sources.push({path, sha256:hash(await readFile(new URL(path, root)))});
const combinedBudget = 25e6, vocalVelocityScale = .4;
// The previous 25-case set and this continuation share the already approved cap.
async function totalEvaluationBytes(directory = output, nested = false) {
  let bytes = 0;
  for (const e of await readdir(directory, {withFileTypes:true})) {
    if (!nested && !(e.name.startsWith('palette-vocals-001') || e.name.startsWith('palette-vocals-run') || e.name.startsWith('palette-vocals-analysis') || e.name.startsWith('expanded-20'))) continue;
    const p = join(directory, e.name);
    bytes += e.isDirectory() ? await totalEvaluationBytes(p, true) : (await stat(p)).size;
  }
  return bytes;
}
const priorBytes = await totalEvaluationBytes();
const manifest = {batch,status:'rendering',createdAt:new Date().toISOString(),engineVersion:JSON.parse(await readFile(new URL('package.json',root))).version,
  gitHead:(await run('git',['rev-parse','HEAD'])).stdout.trim(),nodeVersion:process.version,ffmpeg:(await run('ffmpeg',['-version'])).stdout.split('\n')[0],
  fixtureSha256:hash(fixtureBytes),sources,previewSeconds:16,previewStartBar:20,
  storage:{combinedBudgetBytes:combinedBudget,priorEvaluationBytes:priorBytes,scoreCompression:'gzip',noIntermediateWav:true},
  vocals:{cases:4,phraseOpportunitiesPerTrack:1,section:'drop',chops:0,velocityScale:vocalVelocityScale,gainDb:20*Math.log10(vocalVelocityScale),note:'Each saved vocal event velocity is scaled by 0.4 for a quiet hook. The rest of each arrangement is instrumental.'},
  caveats:['Development requirements, not human musical-quality ratings.','Vague cases have instrument checks and a listening question; no forced exact genre.','Source hashes and seed fix plans. Native speech bytes can vary; source sample hashes are saved.','Preview-only retained audio; full 32-bar scores are gzip-compressed JSON.','Attenuation-only loudness matching can leave quieter clips.'],cases:[]};
const manifestPath = join(output,batch+'.manifest.json');
const save = () => writeFile(manifestPath,JSON.stringify(manifest,null,2)+'\n');
await writeFile(manifestPath,JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
await writeFile(join(output,batch+'.prompts.json'),fixtureBytes,{flag:'wx'});

function evaluate(score,item) {
  const result = checkCase(score,item.expect), c=score.config;
  const check = (name,actual,expected,passed=actual===expected) => result.checks.push({name,actual,expected,passed});
  const events=[...Object.values(score.drums).flat(),...score.bass,...score.keys,...score.lead,...score.arp];
  const profiles=new Set(events.map(e=>e.profile??e.voice));
  for(const profile of item.expect.profiles??[]) check('profile:'+profile,profiles.has(profile),true);
  if(item.expect.timeSignature) check('timeSignature',c.timeSignature,item.expect.timeSignature);
  if(item.expect.polyrhythm) {
    check('polyrhythmEnabled',c.groove.polyrhythm,true);
    check('polyrhythmAgogoBar20',(score.drums.agogo??[]).filter(e=>e.bar===20).length,3);
    check('polyrhythmWoodblockBar20',(score.drums.woodblock??[]).filter(e=>e.bar===20).length,2);
  }
  if(item.id==='27') check('909Kit',c.soundDesign.drumKit,'909');
  if(item.id==='31') check('808Kit',c.soundDesign.drumKit,'808');
  if(item.id==='33') check('crossBarCycleSteps',c.groove.cycleSteps,15);
  if(item.id==='35') check('acidSlideEvents',score.bass.filter(e=>e.glide&&e.fromNote!==e.note).length,'>0',score.bass.some(e=>e.glide&&e.fromNote!==e.note));
  if(item.id==='37') check('noPercussionOrMelodicCowbells',events.filter(e=>e.profile==='cowbell_melody'||e.voice==='cowbell').length,0);
  if(item.id==='43') check('sonClaveDirection',c.groove.clave,'2-3');
  if(item.id==='44') for(const voice of ['conga','clap']) check('exclude:'+voice,score.drums[voice]?.length??0,0);
  if(item.id==='45') {
    const build=score.sections.find(s=>s.name==='build'); check('eightBarBuild',[build.start,build.end],[12,20],build.start===12&&build.end===20);
  }
  check('bars',c.bars,32);
  check('finiteEventTimes',events.every(e=>Number.isFinite(e.time)&&e.time>=0&&e.time<c.duration&&Number.isFinite(e.duration)&&e.duration>0),true);
  if(item.vocal) {
    check('vocalEvents',score.vocals?.events.length??0,1);
    check('vocalPhraseInDrop',score.vocals.events.every(e=>e.kind==='phrase'&&e.section==='drop'),true);
    check('quietVocalVelocity',score.vocals.events.every(e=>e.velocity<=.8*vocalVelocityScale+1e-10),true);
  } else check('instrumentalNoVocalPlan',score.vocals??null,null);
  result.passed=result.checks.every(c=>c.passed);
  return result;
}
for(let i=0;i<fixture.cases.length;i++) {
  const item=fixture.cases[i],seed=fixture.seedBase+i;
  console.log('['+(i+1)+'/20] '+item.id+' '+item.title);
  await verifySources(root,sources);
  const score=compose(item.prompt,{seed,...item.vocal});
  assert.deepEqual(score,compose(item.prompt,{seed,...item.vocal}));
  if(score.vocals) for(const event of score.vocals.events) event.velocity*=vocalVelocityScale;
  const row={...item,seed,audio:batch+'-'+item.id+'.mp3',score:batch+'-'+item.id+'.score.json.gz',
    interpretation:{intent:score.config.intent,source:score.config.classification.source,needsInterpretationReview:score.config.classification.needsInterpretationReview,
      bpm:score.config.bpm,root:score.config.rootName,scale:score.config.scale,timeSignature:score.config.timeSignature,bassProfile:score.config.bassProfile,synthProfile:score.config.synthProfile,
      soundDesign:score.config.soundDesign,groove:score.config.groove,messages:score.config.messages},...evaluate(score,item),
    humanReview:{promptFit:null,genreFit:null,tone:null,groove:null,vocalBalance:null,notes:null}};
  const bank=await prepareVocalSamples(score);
  if(score.vocals) {
    score.vocals.sampleHashes=bank.hashes;score.vocals.speechRuntime=bank.runtime;
    if(bank.pitch)score.vocals.pitchResult=bank.pitch;
    row.vocalPlan={voice:score.vocals.voice,events:score.vocals.events.length,velocityScale:vocalVelocityScale,nativeSampleHashes:bank.hashes};
  }
  const audio=renderAudio(score,{vocalSamples:bank});
  assert.equal(audio.frames,Math.round(score.config.duration*44100));
  assert(Number.isFinite(audio.stats.rms)&&audio.stats.rms>.0001&&audio.stats.peak<=.81);
  const startSeconds=Math.min(20*score.config.beatsPerBar*60/score.config.bpm,score.config.duration-16);
  const preview=sliceAudio(audio,startSeconds,16);
  assert.equal(preview.frames,16*44100);
  if(item.vocal) {
    const v=renderAudio(score,{vocalSamples:bank,voices:['vocals']});
    const v2=renderAudio(score,{vocalSamples:bank,voices:['vocals']});
    assert.equal(hash(v.pcm),hash(v2.pcm));
    assert(sliceAudio(v,startSeconds,16).stats.rms>.0001);
    row.vocalPlan.preparedBankMixDeterministic=true;
  }
  const scoreJson=Buffer.from(JSON.stringify(score)+'\n'),compressed=gzipSync(scoreJson,{level:9});
  assert((await totalEvaluationBytes())+compressed.length+500000+300000<combinedBudget,'Combined 25 MB cap would be exceeded.');
  await writeFile(join(output,row.score),compressed,{flag:'wx'});
  row.scoreSha256=hash(compressed);row.scoreJsonSha256=hash(scoreJson);row.uncompressedScoreBytes=scoreJson.length;
  row.audioChecks=await encodePreview(join(output,row.audio),preview);
  row.rawPcmStats=preview.stats;row.excerpt={startSeconds,durationSeconds:16};row.status='ready';
  manifest.cases.push(row);await save();
  console.log('  '+row.interpretation.intent+' | '+row.interpretation.bpm+' BPM | '+row.checks.filter(c=>!c.passed).length+' requirement misses');
}
await verifySources(root,sources);
manifest.status='complete';manifest.completedAt=new Date().toISOString();
manifest.summary={cases:20,vocalCases:manifest.cases.filter(r=>r.vocal).length,instrumentalCases:manifest.cases.filter(r=>!r.vocal).length,
  signalChecksPassed:manifest.cases.filter(r=>r.audioChecks.encoded.truePeakDbfs<=-1).length,
  requirements:manifest.cases.reduce((n,r)=>n+r.checks.length,0),requirementsPassed:manifest.cases.reduce((n,r)=>n+r.checks.filter(c=>c.passed).length,0),
  casesWithNoRequirementMisses:manifest.cases.filter(r=>r.passed).length,uniqueIntents:new Set(manifest.cases.map(r=>r.interpretation.intent)).size,
  uniqueEncodedFiles:new Set(manifest.cases.map(r=>r.audioChecks.audioSha256)).size};
await save();
const lines=['# 20 additional genre and instrument previews','',fixture.purpose,'',
  'Rendered through the integrated main API at '+manifest.gitHead+'. No vocal bridge is used. All audio is 16-second 44.1 kHz stereo MP3 at 192 kbps, starting at bar 20. Full 32-bar scores are compressed JSON (.json.gz).','',
  '**16 instrumental previews; four contain one quiet spoken phrase at the drop.** The phrase velocity is reduced by about 8 dB before mastering, with no chops or stutters.','',
  '**'+manifest.summary.signalChecksPassed+'/20 signal checks; '+manifest.summary.requirementsPassed+'/'+manifest.summary.requirements+' structural requirements; '+manifest.summary.casesWithNoRequirementMisses+'/20 cases pass every narrow requirement.** These results do not certify musical quality.','',
  '[Exact prompts and vocal options](<'+join(output,batch+'.prompts.json')+'>) · [Manifest, checks and measurements](<'+manifestPath+'>)','',
  'Full scores are gzip-compressed to stay within the existing combined 25 MB allowance. For direct JSON access use a gzip reader or `gunzip -c filename.score.json.gz`. Existing outputs remain available.',''];
for(const row of manifest.cases) {
  const c=row.interpretation,failed=row.checks.filter(x=>!x.passed);
  lines.push('## '+row.id+' — '+row.title,'',row.prompt,'','!['+row.id+'](<'+join(output,row.audio)+'>)','',
    '**Interpretation:** '+c.intent+' ('+c.source+'), '+c.bpm+' BPM, '+c.root+' '+c.scale+', '+c.timeSignature+'.','',
    '**Palette:** harmony '+c.synthProfile+'; bass '+c.bassProfile+'; lead '+c.soundDesign.leadProfile+'.','',
    '**Vocal:** '+(row.vocalPlan?row.vocalPlan.voice+', one short phrase, velocity ×0.4.':'off.'),'',
    '**Checks:** '+(failed.length?failed.map(x=>x.name+': '+JSON.stringify(x.actual)+' (wanted '+JSON.stringify(x.expected)+')').join('; '):'Passed the narrow structural requirements.'),'',
    ...(row.review?['**Listening question:** '+row.review,'']:[]),
    '[Full compressed score](<'+join(output,row.score)+'>) · '+row.audioChecks.encoded.integratedLufs+' LUFS · '+row.audioChecks.encoded.truePeakDbfs+' dBTP','',
    'Listening: prompt fit ___ | groove ___ | sound ___ | keep/change ___','');
}
await writeFile(join(output,batch+'.listening.md'),lines.join('\n')+'\n',{flag:'wx'});
manifest.storage.combinedRetainedBytes=await totalEvaluationBytes();manifest.storage.newBatchBytes=manifest.storage.combinedRetainedBytes-priorBytes;
await save();assert((await totalEvaluationBytes())<combinedBudget);
console.log(JSON.stringify({batch,...manifest.summary,newMB:manifest.storage.newBatchBytes/1e6,combinedMB:manifest.storage.combinedRetainedBytes/1e6,listening:join(output,batch+'.listening.md')}));
