import assert from 'node:assert/strict';
import {readFile,writeFile,readdir,stat} from 'node:fs/promises';
import {join,basename,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {gunzipSync} from 'node:zlib';
import {hash} from './lib/audio-evaluation.js';
const folder=process.argv[2];assert(/^(?:vibey-75-\d{3}|set\d+)$/.test(folder),'Supply a set folder such as set4.');
const reportName=process.argv[3]??'audit.json';assert.equal(reportName,basename(reportName));assert(reportName.endsWith('.json'));
const root=fileURLToPath(new URL('../',import.meta.url)),dir=join(root,'generated_beats',folder);
const mb=await readFile(join(dir,'manifest.json')),m=JSON.parse(mb),fixture=JSON.parse(await readFile(join(dir,'prompts.json')));
const batch=m.batch;let relocation={};try{relocation=JSON.parse(await readFile(join(dir,'relocation.json')));}catch(e){if(e.code!=='ENOENT')throw e;}
assert.equal(m.status,'complete');assert.equal(m.cases.length,75);assert.equal(hash(await readFile(join(dir,'prompts.json'))),m.fixtureSha256);
for(const s of m.sources){const snapshot=relocation.sourceSnapshots?.[s.path];if(snapshot){assert.equal(snapshot.file,basename(snapshot.file));assert.equal(snapshot.sha256,s.sha256);}assert.equal(hash(await readFile(snapshot?join(dir,snapshot.file):join(root,s.path))),s.sha256,'Source changed: '+s.path);}
const rows=[],specCoverage=[];
const paletteMap=[[/distorted analog bass/i,'dark_distorted_bass'],[/metallic Reese bass/i,'metallic_reese'],[/(?<!wide )dark pad/i,'dark_pad'],[/wide dark pad/i,'dark_wide_pad'],[/hard-sync synth/i,'hard_sync'],[/brass stabs/i,'brass_stabs'],[/FM piano/i,'fm_piano'],[/synth stabs/i,'synth_stabs'],[/analog lead/i,'analog_lead'],[/dusty Rhodes/i,'dusty_rhodes'],[/granular synth/i,'granular'],[/garage sub/i,'garage_sub'],[/FM plucks/i,'fm_plucks'],[/saturated 808 bass/i,'saturated_808'],[/analog saw pad/i,'analog_saw_pad'],[/analog octave bass/i,'analog_octave'],[/rolling saw bass/i,'rolling_saw'],[/sine sub/i,'sine_sub'],[/acid\/303 bass/i,'acid_bass'],[/wavetable synth/i,'wavetable'],[/spectral synth/i,'spectral'],[/wavefolding synth/i,'wavefold'],[/ring-modulation synth/i,'ring_mod'],[/dark bells/i,'dark_bells'],[/supersaw\/unison synth/i,'supersaw'],[/Growl\/wobble bass/i,'growl_bass'],[/(?<!metallic )Reese bass/i,'reese_bass'],[/punchy 808 bass/i,'punchy_808']];
for(const r of m.cases){
 for(const name of [r.audio,r.score])assert.equal(name,basename(name));
 assert.equal(hash(await readFile(join(dir,r.audio))),r.audioChecks.audioSha256);
 const gz=await readFile(join(dir,r.score));assert.equal(hash(gz),r.scoreSha256);const raw=gunzipSync(gz);assert.equal(hash(raw),r.scoreJsonSha256);const score=JSON.parse(raw);
 assert.equal(score.config.seed,r.seed);assert.equal(score.config.prompt,r.prompt);assert.equal(score.config.bars,32);
 assert.equal(r.audioChecks.probe.streams[0].sample_rate,'44100');assert.equal(r.audioChecks.probe.streams[0].channels,2);assert(Math.abs(Number(r.audioChecks.probe.format.duration)-16)<.12);assert(r.audioChecks.encoded.truePeakDbfs<=-1);
 assert(score.vocals.events.every(e=>e.velocity<=.32000001));
 const item=fixture.cases.find(x=>x.id===r.specId),events=[...Object.values(score.drums).flat(),...score.keys,...score.bass,...score.lead,...score.arp,...score.parts.flatMap(p=>p.events)],actual=new Set(events.map(e=>e.profile??e.voice));
 const listed=(item.original.match(/\*\*Synth Profiles:\*\* (.+)/)?.[1]??'');
 for(const [pattern,profile] of paletteMap)if(pattern.test(listed))specCoverage.push({id:r.id,request:'listed synth profile',profile,present:actual.has(profile)});
 if(/brushed snare/i.test(item.original))specCoverage.push({id:r.id,request:'brushed snare',actual:score.config.soundDesign.snareProfile,present:score.drums.snare?.some(e=>e.profile==='brush')??false});
 if(/slap-and-pop/i.test(item.original))specCoverage.push({id:r.id,request:'slap articulation',actual:score.config.soundDesign.articulation,present:events.some(e=>e.articulation==='slap')});
 const attacks=score.keys.map(e=>[e.bar,e.step-score.config.timeline[e.bar].startStep]);
 rows.push({id:r.id,specId:r.specId,seed:r.seed,accompaniment:score.config.accompaniment,scoreNoteFingerprint:hash(Buffer.from(JSON.stringify(events.map(e=>[e.voice,e.part,e.step,e.note,e.duration])))),harmonyAttackFingerprint:hash(Buffer.from(JSON.stringify(attacks))),vocalSourceHashes:r.vocal.sampleHashes});
}
const trios=fixture.cases.map(item=>{const rs=rows.filter(r=>r.specId===item.id);assert.equal(rs.length,3);assert.equal(new Set(rs.map(r=>r.seed)).size,3);assert.deepEqual(rs[0].vocalSourceHashes,rs[1].vocalSourceHashes);assert.deepEqual(rs[0].vocalSourceHashes,rs[2].vocalSourceHashes);return {id:item.id,noteFingerprints:new Set(rs.map(r=>r.scoreNoteFingerprint)).size,harmonyAttackFingerprints:new Set(rs.map(r=>r.harmonyAttackFingerprint)).size,styles:rs.map(r=>r.accompaniment.style),seeds:rs.map(r=>r.seed)};});
let total=0;for(const e of await readdir(dir,{withFileTypes:true})){assert(e.isFile());total+=(await stat(join(dir,e.name))).size;}assert(total<m.storageLimitBytes);
const report={batch,manifestSha256:hash(mb),audioScoreAndSourceHashesVerified:true,clips:75,savedSeedsVerified:75,trioVoiceBanksControlled:true,uniqueEncodedFiles:new Set(m.cases.map(r=>r.audioChecks.audioSha256)).size,retainedBytesBeforeAudit:total,
 narrowSummary:m.summary,originalPaletteCoverage:specCoverage,trios,rows,
 caveats:['Listed original-profile coverage is stricter than adapted named-instrument checks; missing selections remain visible.','Original structures, free time, 2/4 and singing still have declared adaptations.','Matching audio hashes, note fingerprints or attack differences are structural diagnostics, not musical preference.','No manual quality ratings have been assigned.']};
await writeFile(join(dir,reportName),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({clips:75,uniqueAudio:report.uniqueEncodedFiles,narrow:m.summary,missingOriginalPaletteItems:specCoverage.filter(c=>!c.present).length,retainedMB:total/1e6}));
