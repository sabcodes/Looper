import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, symlink, readdir, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { renderAudio, sliceAudio, analyzeScore } from '../src/index.js';
import { hash, sourceIdentity, verifySources, encodePreview } from './lib/audio-evaluation.js';
import { checkGeneralization } from './lib/generalization-evaluation.js';

const root=new URL('../',import.meta.url), output=fileURLToPath(new URL('generated_beats/set9/',root));
const source=fileURLToPath(new URL('generated_beats/set8/deep-bass/',root));
const feedbackBytes=await readFile(new URL('data/deep-bass-feedback.json',root)), feedback=JSON.parse(feedbackBytes);
const manifestBytes=await readFile(join(source,'manifest.json')), previous=JSON.parse(manifestBytes);
assert.equal(hash(manifestBytes),feedback.manifestSha256);
const sources=await sourceIdentity(root), limit=8_000_000, reportReserve=100_000;
for(const s of sources)assert.equal(s.sha256,previous.sources.find(p=>p.path===s.path)?.sha256,'Engine changed since preference test: '+s.path);
const prepared=[];
for(const chosen of feedback.cases){
 const data=await readFile(join(source,chosen.score));assert.equal(hash(data),chosen.scoreSha256);
 assert.equal(hash(await readFile(join(source,chosen.audio))),chosen.audioSha256);
 const score=JSON.parse(gunzipSync(data));assert.equal(score.config.bars,32);
 assert(score.bass.every(e=>e.profile===chosen.bassProfile));assert.equal(score.config.synthProfile,chosen.harmonyProfile);
 assert(checkGeneralization(score).safetyPassed,'Unsafe saved score');
 const row=previous.cases.find(c=>c.id===chosen.id), selected=chosen.selectedVariant==='R'?row.reference:row.variants.find(v=>v.label===chosen.selectedVariant);
 const pcmSha256=selected.audioChecks?.pcmSha256??JSON.parse(await readFile(new URL('generated_beats/set8/manifest.json',root))).cases.find(c=>c.id===chosen.sourceCase).audioChecks.pcmSha256;
 prepared.push({chosen,score,row,pcmSha256,estimatedBytes:Math.ceil(score.config.duration*24000)+6000});
}
const estimatedRetained=prepared.reduce((n,p)=>n+p.estimatedBytes,0)+reportReserve;
const temporaryReserve=Math.max(...prepared.map(p=>p.estimatedBytes));assert(temporaryReserve<2_000_000);
assert(estimatedRetained+temporaryReserve<limit);
const plan={output,storageLimitBytes:limit,tracks:prepared.map(p=>({case:p.chosen.id,choice:p.chosen.selectedVariant,seconds:p.score.config.duration,bass:p.chosen.bassProfile,harmony:p.chosen.harmonyProfile})),estimatedRetainedBytes:estimatedRetained,estimatedPeakBytes:estimatedRetained+temporaryReserve,temporaryReserveBytes:temporaryReserve};
const artifact=(name,data)=>writeFile(join(output,name),typeof data==='string'?data:JSON.stringify(data,null,2)+'\n',{flag:'wx'});
async function bytes(){let n=0;for(const name of await readdir(output))n+=(await lstat(join(output,name))).size;return n;}
function rms(audio,start,end){
 const a=Math.max(0,Math.round(start*audio.sampleRate)),b=Math.min(audio.frames,Math.round(end*audio.sampleRate));let energy=0;
 for(let i=a*4;i<b*4;i+=2)energy+=(audio.pcm.readInt16LE(i)/32767)**2;
 return b>a?Math.sqrt(energy/((b-a)*2)):0;
}
const stamp=seconds=>`${Math.floor(seconds/60)}:${(seconds%60).toFixed(1).padStart(4,'0')}`;
if(process.argv.includes('--plan'))console.log(JSON.stringify(plan,null,2));else{
 await mkdir(output);await artifact('plan.json',plan);
 const m={status:'rendering',purpose:'Full 32-bar listening evaluation of exact human-selected saved scores; no recomposition.',engineCommit:previous.engineCommit,engineVersion:previous.engineVersion,sources,feedbackSha256:hash(feedbackBytes),referenceManifestSha256:hash(manifestBytes),toolingSha256:hash(await readFile(fileURLToPath(import.meta.url))),plan,cases:[],caveat:'Structure and signal measurements do not score musical quality. Preferences, transitions and ending quality require human listening.'};
 for(const p of prepared){
  await verifySources(root,sources);
  const name=p.chosen.id+'-'+p.chosen.selectedVariant+'-full', audioFile=name+'.mp3', scoreFile=name+'.score.json.gz';
  await symlink('../set8/deep-bass/'+p.chosen.score,join(output,scoreFile));
  const full=renderAudio(p.score);
  assert.equal(hash(sliceAudio(full,p.row.excerpt.startSeconds,16).pcm),p.pcmSha256,'Selected preview changed');
  assert.equal(full.frames,Math.round(p.score.config.duration*44100));assert(Number.isFinite(full.stats.rms)&&full.stats.rms>.01&&full.stats.peak<=.93);
  assert(await bytes()+p.estimatedBytes+temporaryReserve+reportReserve<limit);
  const audioChecks=await encodePreview(join(output,audioFile),full,{targetLufs:-18});
  assert((await lstat(join(output,audioFile))).size<=p.estimatedBytes);
  const events=[...Object.values(p.score.drums).flat(),...p.score.bass,...p.score.keys,...p.score.lead,...p.score.arp,...p.score.parts.flatMap(part=>part.events)];
  const sections=p.score.sections.map(s=>({name:s.name,bars:[s.start,s.end-1],startSeconds:s.startTime,endSeconds:s.endTime,
   rms:rms(full,s.startTime,s.endTime),bassOnsets:p.score.bass.filter(e=>e.time>=s.startTime&&e.time<s.endTime).length,
   harmonyOnsets:p.score.keys.filter(e=>e.time>=s.startTime&&e.time<s.endTime).length,drumOnsets:Object.values(p.score.drums).flat().filter(e=>e.time>=s.startTime&&e.time<s.endTime).length,
   soundingVoices:[...new Set(events.filter(e=>e.time<s.endTime&&e.time+e.duration>s.startTime).map(e=>e.voice))]}));
  const transitions=sections.slice(1).map(s=>({entering:s.name,seconds:s.startSeconds,previous200msRms:rms(full,s.startSeconds-.2,s.startSeconds),next200msRms:rms(full,s.startSeconds,s.startSeconds+.2)}));
  m.cases.push({id:p.chosen.id,choice:p.chosen.selectedVariant,sourceCase:p.chosen.sourceCase,seed:p.chosen.seed,prompt:p.score.config.prompt,bass:p.chosen.bassProfile,harmony:p.chosen.harmonyProfile,
   audio:audioFile,score:scoreFile,scoreSha256:p.chosen.scoreSha256,selectedPreviewPcmSha256:p.pcmSha256,exactSelectedPreviewReplay:true,audioChecks,
   durationSeconds:p.score.config.duration,sections,transitions,scoreAnalysis:analyzeScore(p.score),ending:{last100msRms:rms(full,p.score.config.duration-.1,p.score.config.duration),finalStereoFrame:[full.pcm.readInt16LE(full.pcm.length-4),full.pcm.readInt16LE(full.pcm.length-2)]},
   humanReview:{development:null,repetition:null,transitions:null,ending:null,bassBalance:null,overall:null,notes:null}});
  console.log(name+': full track saved; exact chosen preview reproduced');
 }
 await verifySources(root,sources);assert.equal(hash(await readFile(new URL('data/deep-bass-feedback.json',root))),hash(feedbackBytes));assert.equal(hash(await readFile(join(source,'manifest.json'))),hash(manifestBytes));
 for(const c of m.cases){assert.equal(hash(await readFile(join(output,c.audio))),c.audioChecks.audioSha256);assert.equal(hash(await readFile(join(output,c.score))),c.scoreSha256);}
 const lines=['# Set9 — full arrangements','','Your selected sounds: **09 E**, **10 R**, **11 S**. These are the exact saved 32-bar arrangements, rendered from beginning to end. No notes, sounds, phrasing, arrangement or effects were rewritten. The original chosen 16-second excerpts reproduce exactly before encoding; whole-song loudness attenuation can differ from the earlier preview.','','All tracks use 192 kbps stereo MP3 and attenuation toward -18 LUFS. Full scores link to the existing compressed files. No downloads or new models.','','Listen for whether the idea develops, repetition feels intentional, the breakdown/build/drop connects, the bass stays balanced and the ending feels finished. Structural/energy measurements are diagnostics, not musical-quality grades.'];
 for(const c of m.cases){
  lines.push('','## '+c.id+' '+c.choice+' — '+c.bass+' + '+c.harmony,'',`Duration: ${stamp(c.durationSeconds)} · Original prompt: ${c.prompt}`,'','!['+c.id+' full track](<'+join(output,c.audio)+'>)','','| Section | Time | Bars (1-based) |','|---|---|---|');
  for(const s of c.sections)lines.push(`| ${s.name} | ${stamp(s.startSeconds)}–${stamp(s.endSeconds)} | ${s.bars[0]+1}–${s.bars[1]+1} |`);
  lines.push('','Development · Repetition · Transitions · Ending · Bass balance · Overall · Notes/timestamps:');
 }
 await artifact('listening.md',lines.join('\n')+'\n');await artifact('scorecard.csv','case,development,repetition,transitions,ending,bass_balance,overall,notes_timestamps\n09,,,,,,,\n10,,,,,,,\n11,,,,,,,\n');
 m.status='complete';await artifact('manifest.json',m);
 const audit={status:'passed',tracks:3,barsPerTrack:32,exactSelectedPreviewReplays:3,scoreAndAudioHashesVerified:true,sourcesVerified:sources.length,highestTruePeakDbfs:Math.max(...m.cases.map(c=>c.audioChecks.encoded.truePeakDbfs)),retainedBytes:0,storageLimitBytes:limit,temporaryReserveBytes:temporaryReserve,estimatedPeakBytes:0,subjectiveQuality:'unscored',downloads:0};
 const before=await bytes();for(let i=0;i<5;i++){audit.retainedBytes=before+Buffer.byteLength(JSON.stringify(audit,null,2)+'\n');audit.estimatedPeakBytes=audit.retainedBytes+temporaryReserve;}
 assert(audit.estimatedPeakBytes<limit);await artifact('audit.json',audit);assert.equal(await bytes(),audit.retainedBytes);
 console.log('Complete: '+output+'; retained '+audit.retainedBytes+' bytes, peak budget '+audit.estimatedPeakBytes+' / '+limit);
}
