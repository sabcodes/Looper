import assert from 'node:assert/strict';
import {parseArgs} from 'node:util';
import {spawn} from 'node:child_process';
import {readFile,writeFile,mkdir,lstat,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {gzipSync} from 'node:zlib';
import {renderAudio,analyzeScore} from '../src/index.js';
import {buildVocalRemix,mixExternalVocal} from './lib/vocal-remix.js';
import {hash,sourceIdentity,verifySources,measure,encodePreview,run} from './lib/audio-evaluation.js';

const {values}=parseArgs({options:{fixture:{type:'string',default:'let-down-vocal-remixes.json'},folder:{type:'string',default:'set10'},plan:{type:'boolean'}}});
assert(/^[a-z0-9-]+\.json$/.test(values.fixture),'Use a fixture filename inside data/');assert(/^set\d+$/.test(values.folder),'Use a numbered generated_beats set folder');
const root=new URL('../',import.meta.url),output=fileURLToPath(new URL('generated_beats/'+values.folder+'/',root));
const fixturePath='data/'+values.fixture;
const fixtureBytes=await readFile(new URL(fixturePath,root)),fixture=JSON.parse(fixtureBytes);
const input=fileURLToPath(new URL(fixture.input,root)),inputSha256=hash(await readFile(input));
const probe=JSON.parse((await run('ffprobe',['-v','error','-show_entries','format=duration,size:stream=codec_name,sample_rate,channels,bits_per_sample','-of','json',input])).stdout);
assert(Math.abs(Number(probe.format.duration)-49.92)<.001);assert.equal(probe.streams[0].channels,2);
const sources=await sourceIdentity(root);
for(const path of [fixturePath,'scripts/lib/vocal-remix.js','scripts/generate-vocal-remix-set.js','scripts/lib/audio-evaluation.js'])sources.push({path,sha256:hash(await readFile(new URL(path,root)))});
const scores=fixture.cases.map(spec=>({spec,score:buildVocalRemix(spec,fixture)}));
const temporaryReserve=1_220_000,reportReserve=180_000;
const estimatedRetained=scores.reduce((n,p)=>n+Math.ceil(p.score.config.duration*24000)+6000+gzipSync(Buffer.from(JSON.stringify(p.score))).length,0)+reportReserve;
assert(estimatedRetained+temporaryReserve<fixture.storageLimitBytes);
const plan={output,input:fixture.input,inputSha256,key:'A major',bpm:125,bars:26,secondsPerMix:49.92,mixes:fixture.cases.length,vocalDb:fixture.vocalDb??0,estimatedRetainedBytes:estimatedRetained,estimatedPeakBytes:estimatedRetained+temporaryReserve,temporaryReserveBytes:temporaryReserve,storageLimitBytes:fixture.storageLimitBytes,downloads:0};
const artifact=(name,data)=>writeFile(join(output,name),Buffer.isBuffer(data)||typeof data==='string'?data:JSON.stringify(data,null,2)+'\n',{flag:'wx'});
async function bytes(){let n=0;for(const f of await readdir(output))n+=(await lstat(join(output,f))).size;return n;}
async function decode(){
 return new Promise((resolve,reject)=>{
  const child=spawn('ffmpeg',['-hide_banner','-loglevel','error','-threads','1','-filter_threads','1','-i',input,'-ac','2','-ar','44100','-f','s16le','pipe:1'],{stdio:['ignore','pipe','pipe']});
  const chunks=[];let count=0,stderr='';const timer=setTimeout(()=>{child.kill('SIGKILL');reject(new Error('Vocal decode timed out'));},30000);
  child.stdout.on('data',b=>{count+=b.length;if(count>9_000_000){child.kill('SIGKILL');reject(new Error('Decoded vocal exceeds its bounds'));}else chunks.push(b);});
  child.stderr.on('data',b=>stderr=(stderr+b).slice(-2000));child.on('error',e=>{clearTimeout(timer);reject(e)});
  child.on('close',code=>{clearTimeout(timer);code?reject(new Error(stderr)):resolve(Buffer.concat(chunks));});
 });
}
if(values.plan)console.log(JSON.stringify(plan,null,2));else{
 await mkdir(output);await artifact('plan.json',plan);await artifact('prompts.json',fixtureBytes);
 const vocal=await decode();assert.equal(vocal.length,Math.round(49.92*44100)*4);
 let vocalEnergy=0,vocalPeak=0,firstActive=null,lastActive=null;
 for(let i=0;i<vocal.length;i+=4){for(let side=0;side<2;side++){const x=vocal.readInt16LE(i+side*2)/32767;vocalEnergy+=x*x;vocalPeak=Math.max(vocalPeak,Math.abs(x));}if(Math.abs(vocal.readInt16LE(i))>400||Math.abs(vocal.readInt16LE(i+2))>400){firstActive??=i/4/44100;lastActive=i/4/44100;}}
 const sourceAnalysis={input:fixture.input,inputSha256,originalProbe:probe,decodedSampleRate:44100,decodedFrames:vocal.length/4,decodedPcmSha256:hash(vocal),rms:Math.sqrt(vocalEnergy/(vocal.length/2)),peak:vocalPeak,firstActiveSeconds:firstActive,lastActiveSeconds:lastActive,
  key:'A major',bpm:125,keyTempoSource:'User supplied; authoritative for this arrangement. No auto-tempo estimate substituted.',gridOriginSeconds:0,sourceTimeStretchRatio:1,sourcePitchSemitones:0,verseToChorusSeconds:30.72,alignmentCaveat:fixture.alignmentCaveat,research:fixture.research};
 await artifact('source-analysis.json',sourceAnalysis);
 const prepared=[];
 for(const p of scores){
  await verifySources(root,sources);const scoreBytes=gzipSync(Buffer.from(JSON.stringify(p.score)+'\n'),{level:9});
  const music=renderAudio(p.score),mixed=mixExternalVocal(music,vocal,{musicRms:p.spec.musicRms,vocalDb:fixture.vocalDb??0});
  assert.equal(mixed.frames,vocal.length/4);assert(Number.isFinite(mixed.stats.rms)&&mixed.stats.rms>.01&&mixed.stats.peak<=.781);
  const raw=await measure(mixed);prepared.push({...p,scoreBytes,audio:mixed,raw,musicStats:music.stats});
  console.log(p.spec.id+': procedural backing and original vocal mixed in memory');
 }
 const targetLufs=Math.min(-18,...prepared.map(p=>p.raw.integratedLufs))-.1;
 const manifest={status:'rendering',type:'external-vocal-listening-set',nodeVersion:process.version,plan,sources,fixtureSha256:hash(fixtureBytes),source:sourceAnalysis,targetLufs,
  caveat:'The source vocal is unchanged in time/pitch and mixed externally, with global gain only. Instrumental arrangements are hand-directed procedural remixes, not a validated transcription. All mixes share an inferred file-origin grid and verse/chorus alignment; listening must validate it.',cases:[]};
 for(const p of prepared){
  const caseId=p.spec.label??p.spec.id,stem=caseId+'-'+p.spec.title.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/-$/,''),audioFile=stem+'.mp3',scoreFile=stem+'.score.json.gz';
  assert(await bytes()+p.scoreBytes.length+temporaryReserve*2+reportReserve<fixture.storageLimitBytes);
  await artifact(scoreFile,p.scoreBytes);
  const checks=await encodePreview(join(output,audioFile),p.audio,{targetLufs,raw:p.raw});
  assert(Math.abs(checks.encoded.integratedLufs-targetLufs)<=.3);assert((await lstat(join(output,audioFile))).size<temporaryReserve);
  manifest.cases.push({id:caseId,sourceCase:p.spec.id,referenceType:p.spec.referenceType??null,title:p.spec.title,prompt:p.spec.prompt,seed:p.spec.seed,audio:audioFile,score:scoreFile,scoreSha256:hash(p.scoreBytes),bass:p.spec.bass,harmony:p.spec.harmony,bassMode:p.spec.bassMode,harmonyStyle:p.spec.style,layers:p.spec.layers??null,
   scoreAnalysis:analyzeScore(p.score),sections:p.score.sections,audioChecks:checks,mix:p.audio.mix,musicStats:p.musicStats,mixedStats:p.audio.stats,
   humanReview:{vocalTiming:null,harmonicFit:null,groove:null,sound:null,voiceBalance:null,overall:null,notes:null}});
  console.log(p.spec.id+': full vocal mix saved, level '+checks.encoded.integratedLufs+' LUFS, peak '+checks.encoded.truePeakDbfs+' dBFS');
 }
 await verifySources(root,sources);assert.equal(hash(await readFile(input)),inputSha256);
 for(const c of manifest.cases){assert.equal(hash(await readFile(join(output,c.audio))),c.audioChecks.audioSha256);assert.equal(hash(await readFile(join(output,c.score))),c.scoreSha256);}
 const lines=['# '+values.folder+' — beats around your Let Down vocal','','The full **verse 2 + chorus** vocal you supplied, **A major / 125 BPM**, stays at its original pitch, speed and stereo timing. Each mix is **49.92 seconds / 26 bars**. Only sample-rate conversion from 48 kHz to 44.1 kHz and global level changes affect the vocal; it is not resynthesized or replaced.', '',
  'These procedural backings share a restrained A-major reharmonization. Verse-to-chorus at **30.72 s** is inferred from the section and meter, not manually verified. This is a remix listening study; timing/harmony fit remains a listening judgment. The sung entrance near 0.73 s is preserved. No full-mix tape brakes, air pockets or stutters cut through the lyrics.', '',
  'The exact sound profiles and prompts are listed below. The backing midrange gently makes room while the vocal is active. All mixes match integrated loudness within 0.3 LU; no new models/downloads.', '',
  '| Case | Direction | Bass | Harmony |','|---|---|---|---|'];
 for(const c of manifest.cases)lines.push(`| ${c.id} | ${c.title} | ${c.bass} | ${c.harmony} |`);
 if(fixture.vocalDb)lines.push('',`**Vocal is ${Math.abs(fixture.vocalDb)} dB lower relative to the backing than set10.** ${fixture.balanceNote??'R labels reuse the exact favorite arrangements with only the vocal-level change; N1/N2 are new seeds with bounded bass phrasing, hat and pad-voicing/color variation.'} Vocal timing, pitch and shared harmony/form remain fixed.`,'');
 for(const c of manifest.cases)lines.push('','## '+c.id+' — '+c.title,'','!['+c.title+'](<'+join(output,c.audio)+'>)','','Prompt: '+c.prompt,'','Listen: vocal locked to beat? · Harmony fits? · Groove · Voice balance · Overall · Notes/timestamps:');
 lines.push('','## Research and limitations','','The lyric sequence was checked against your supplied verse/chorus text and the [Citizen Insane song archive](https://citizeninsane.eu/music/okc/letdown.html). [Ethan Hein’s published analysis](https://www.musicradar.com/artists/if-the-point-of-radiohead-songs-isnt-to-make-you-feel-good-what-is-their-music-for-a-music-professor-breaks-down-the-theory-behind-radioheads-let-down) informed the tonal/form choices. This backing is a sparse creative reharmonization, not an exact original chord transcription. Your 125 BPM setting takes precedence over online tempo listings.');
 await artifact('listening.md',lines.join('\n')+'\n');await artifact('scorecard.csv','case,vocal_timing,harmonic_fit,groove,sound,voice_balance,overall,notes_timestamps\n'+manifest.cases.map(c=>c.id+',,,,,,,').join('\n')+'\n');
 manifest.status='complete';await artifact('manifest.json',manifest);
 const audit={status:'passed',newMixes:manifest.cases.length,vocalDb:fixture.vocalDb??0,secondsEach:49.92,barsEach:26,key:'A major',bpm:125,sourceInputHashUnchanged:true,sourceTimeStretchRatio:1,sourcePitchSemitones:0,sourcesVerified:sources.length,
  targetLufs,highestTruePeakDbfs:Math.max(...manifest.cases.map(c=>c.audioChecks.encoded.truePeakDbfs)),maximumLevelDifferenceLu:Math.max(...manifest.cases.map(c=>c.audioChecks.encoded.integratedLufs))-Math.min(...manifest.cases.map(c=>c.audioChecks.encoded.integratedLufs)),retainedBytes:0,estimatedPeakBytes:0,storageLimitBytes:fixture.storageLimitBytes,temporaryReserveBytes:temporaryReserve,downloads:0,subjectiveQuality:'unscored',alignment:'Inferred; see source-analysis.json and listening.md.'};
 const before=await bytes();for(let i=0;i<5;i++){audit.retainedBytes=before+Buffer.byteLength(JSON.stringify(audit,null,2)+'\n');audit.estimatedPeakBytes=audit.retainedBytes+temporaryReserve;}
 assert(audit.estimatedPeakBytes<fixture.storageLimitBytes);await artifact('audit.json',audit);assert.equal(await bytes(),audit.retainedBytes);
 console.log('Complete: '+output+'; retained '+audit.retainedBytes+' bytes, conservative peak '+audit.estimatedPeakBytes+' / '+fixture.storageLimitBytes);
}
