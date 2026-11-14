// Render the saved, explicitly expanded indie-pop prompts. No seed rerolls.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,readdir,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {gzipSync} from 'node:zlib';
import {compose,renderAudio,sliceAudio,analyzeScore} from '../src/index.js';
import {planIndieVariations,checkIndieVariation} from './lib/indie-variations.js';
import {sourceIdentity,verifySources,hash,encodePreview,run} from './lib/audio-evaluation.js';
const root=new URL('../',import.meta.url),base=fileURLToPath(new URL('generated_beats/',root));
const fixtureBytes=await readFile(new URL('data/indie-variation-20.json',root)),fixture=JSON.parse(fixtureBytes);
assert.deepEqual(fixture.cases,planIndieVariations(fixture.masterSeed));
const folder=process.argv[2]??'set5';assert(/^set\d+$/.test(folder),'Use a numbered set folder.');
const output=join(base,folder),manifestPath=join(output,'manifest.json');
// Exclusive folder creation protects earlier listening sets.
await mkdir(output);
const sources=await sourceIdentity(root);
for(const path of ['data/indie-variation-20.json','scripts/generate-indie-variation-set.js','scripts/lib/indie-variations.js','scripts/lib/audio-evaluation.js'])sources.push({path,sha256:hash(await readFile(new URL(path,root)))});
const manifest={batch:folder+'-indie-variation-20',status:'rendering',createdAt:new Date().toISOString(),
 gitHead:(await run('git',['rev-parse','HEAD'])).stdout.trim(),sources,fixtureSha256:hash(fixtureBytes),masterSeed:fixture.masterSeed,
 engineVersion:JSON.parse(await readFile(new URL('package.json',root))).version,nodeVersion:process.version,
 previewSeconds:fixture.previewSeconds,storageLimitBytes:fixture.storageLimitBytes,
 source:fixture.source,adaptations:fixture.adaptations,cases:[]};
const save=()=>writeFile(manifestPath,JSON.stringify(manifest,null,2)+'\n');
const bytes=async()=>{let n=0;for(const e of await readdir(output,{withFileTypes:true})){assert(e.isFile());n+=(await stat(join(output,e.name))).size;}return n;};
const eventGroups=s=>({keys:s.keys,bass:s.bass,lead:s.lead,arp:s.arp,...Object.fromEntries(s.parts.map(p=>[p.name,p.events]))});
// Fingerprints omit pitch, velocity and timbre to distinguish rhythmic changes
// from files which merely have different seeds or keys.
const rhythms=events=>hash(JSON.stringify([...new Set(events.map(e=>JSON.stringify([e.bar,Number((e.step%16).toFixed(3)),Number(e.duration.toFixed(2))])))].sort()));
await save();await writeFile(join(output,'prompts.json'),fixtureBytes,{flag:'wx'});
try {
 for(const row of fixture.cases){
  console.log('['+row.id+'/20] '+row.expect.bass+' / '+row.expect.harmony+' / '+row.expect.style);
  await verifySources(root,sources);
  const score=compose(row.prompt,{seed:row.seed,...row.options});checkIndieVariation(row,score);
  assert.deepEqual(score,compose(row.prompt,{seed:row.seed,...row.options}));
  const groups=eventGroups(score),all=[...Object.values(score.drums).flat(),...Object.values(groups).flat()];
  assert(all.every(e=>Number.isFinite(e.time)&&e.time>=0&&e.time<score.config.duration&&Number.isFinite(e.duration)&&e.duration>0));
  const focus=['chorus','drop','B','variation2','verse'].map(name=>score.sections.find(s=>s.name===name)).find(Boolean);
  const audio=renderAudio(score);assert(audio.stats.rms>.0001&&audio.stats.peak<=.81);
  const startSeconds=Math.min(focus.startTime,score.config.duration-fixture.previewSeconds);
  const preview=sliceAudio(audio,startSeconds,fixture.previewSeconds);assert.equal(preview.frames,44100*16);
  const json=Buffer.from(JSON.stringify(score)+'\n'),compressed=gzipSync(json,{level:9});
  assert((await bytes())+compressed.length+800000+1000000<fixture.storageLimitBytes,'Stop before exceeding the approved 12 MB budget.');
  const record={...row,audio:row.id+'.mp3',score:row.id+'.score.json.gz',status:'ready',passed:true,
   interpretation:{intent:score.config.intent,bpm:score.config.bpm,root:score.config.rootName,scale:score.config.scale,timeSignature:score.config.timeSignature,form:score.config.arrangement.form,accompaniment:score.config.accompaniment},
   profiles:{bass:[...new Set(score.bass.map(e=>e.profile))],harmony:[...new Set(score.keys.map(e=>e.profile))],lead:[...new Set(score.lead.map(e=>e.profile))],parts:score.parts.map(p=>({profile:p.profile,role:p.role,pattern:p.accompaniment?.style}))},
   excerpt:{startSeconds,durationSeconds:16,focusSection:focus.name,sections:score.sections.filter(s=>s.startTime<startSeconds+16&&s.endTime>startSeconds).map(s=>s.name)},
   checks:{expectedSounds:true,expectedPhrasing:true,expectedKeyAndForm:true,finiteEvents:true,seedReplay:true,monophonicPrimaryBass:true,noMetallicReese:true},
   maxEventTailBeyondTrackSeconds:Math.max(0,...all.map(e=>e.time+e.duration-score.config.duration)),
   scoreAnalysis:analyzeScore(score),rhythmFingerprints:Object.fromEntries(Object.entries({...groups,kick:score.drums.kick}).map(([k,v])=>[k,rhythms(v)])),
   scoreSha256:hash(compressed),scoreJsonSha256:hash(json),fullAudioStats:audio.stats,
   humanReview:{tone:null,groove:null,keep:null,notes:null}};
  await writeFile(join(output,record.score),compressed,{flag:'wx'});
  record.audioChecks=await encodePreview(join(output,record.audio),preview);
  manifest.cases.push(record);await save();console.log('  '+record.audioChecks.encoded.integratedLufs+' LUFS; '+(await bytes()/1e6).toFixed(2)+' MB');
 }
 await verifySources(root,sources);
 const unique=fn=>new Set(manifest.cases.map(fn)).size;
 manifest.summary={clips:20,signalChecksPassed:20,bassSounds:unique(r=>r.expect.bass),harmonySounds:unique(r=>r.expect.harmony),keys:unique(r=>r.expect.root),forms:unique(r=>r.expect.form),accompanimentStyles:unique(r=>r.expect.style),tempos:unique(r=>r.expect.bpm),uniqueEncodedFiles:unique(r=>r.audioChecks.audioSha256),kickRhythms:unique(r=>r.rhythmFingerprints.kick),bassRhythms:unique(r=>r.rhythmFingerprints.bass),harmonyRhythms:unique(r=>r.rhythmFingerprints.keys),metallicReeseCases:manifest.cases.filter(r=>r.profiles.bass.includes('metallic_reese')).length};
 assert.equal(manifest.summary.uniqueEncodedFiles,20);
 for(const field of ['kickRhythms','bassRhythms','harmonyRhythms'])assert(manifest.summary[field]>1);
 const lines=['# Set 5 — twenty indie-pop palette explorations','',fixture.purpose,'',...fixture.adaptations,'',
  '[Saved prompts, seed and options](<'+join(output,'prompts.json')+'>) · [Checks and actual voice inventory](<'+manifestPath+'>)','',
  'All twenty signal checks passed. '+manifest.summary.bassSounds+' bass sounds, '+manifest.summary.harmonySounds+' harmony sounds, '+manifest.summary.keys+' roots, '+manifest.summary.forms+' forms and '+manifest.summary.accompanimentStyles+' accompaniment styles. No metallic Reese preset. Other sounds may still have a bright or metallic character; listening feedback decides that.','',
  'These vary multiple factors together to explore preferences. They do not isolate a cause or establish improved musical quality. Keys remain major, meter remains 4/4, and all full scores have 32 bars. Only 16-second excerpts are retained as audio.','',
  '## Earlier #8 reference','', 'Original 08B, including its original light speech. The new set is instrumental, so this is an inspiration reference, not a matched A/B.','',
  '![Earlier 08B](<'+join(base,'set4','08-B.mp3')+'>)',''];
 for(const r of manifest.cases)lines.push('## '+r.id+' — '+r.expect.bass+' + '+r.expect.harmony,'',
  '!['+r.id+'](<'+join(output,r.audio)+'>)','',
  r.expect.root+' major · '+r.expect.bpm+' BPM · '+r.expect.form+' · '+r.expect.style+' harmony · '+r.expect.bassCue+' · '+r.expect.groove+' · '+(r.expect.lead??'no lead')+'.','',
  r.prompt,'','Seed '+r.seed+'. Additional parts: '+(r.options.parts.map(p=>p.profile+' ('+p.pattern+')').join(', ')||'none')+'. Excerpt starts '+r.excerpt.startSeconds.toFixed(2)+'s ('+r.excerpt.focusSection+').','',
  'Tone ___ | groove ___ | keep ___ | notes ___','');
 await writeFile(join(output,'listening.md'),lines.join('\n')+'\n',{flag:'wx'});
 manifest.status='complete';manifest.completedAt=new Date().toISOString();manifest.retainedBytes=await bytes();await save();
 assert((await bytes())<fixture.storageLimitBytes);
 console.log(JSON.stringify({...manifest.summary,retainedMB:(await bytes())/1e6,listening:join(output,'listening.md')}));
} catch(error){manifest.status='failed';manifest.error=error.message;await save();throw error;}
