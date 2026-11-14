import assert from 'node:assert/strict';
import {readFile,writeFile,readdir,stat} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {gunzipSync} from 'node:zlib';
import {compose} from '../src/index.js';
import {hash,verifySources} from './lib/audio-evaluation.js';
import {checkIndieVariation} from './lib/indie-variations.js';
const root=new URL('../',import.meta.url),folder=process.argv[2]??'set5';
assert(/^set\d+$/.test(folder));
const output=fileURLToPath(new URL('generated_beats/'+folder+'/',root));
const m=JSON.parse(await readFile(join(output,'manifest.json')));
assert.equal(m.status,'complete');assert.equal(m.cases.length,20);
await verifySources(root,m.sources);
const attackShape = events => {
 const bars=new Map();
 for(const e of events){if(!bars.has(e.bar))bars.set(e.bar,new Set());bars.get(e.bar).add(Number((e.step%16).toFixed(3)));}
 return [...new Set([...bars.values()].map(steps=>JSON.stringify([...steps].sort((a,b)=>a-b))))].sort();
};
const rows=[];
for(const r of m.cases){
 const b=await readFile(join(output,r.score));assert.equal(hash(b),r.scoreSha256);
 const json=gunzipSync(b);assert.equal(hash(json),r.scoreJsonSha256);
 const s=JSON.parse(json);checkIndieVariation(r,s);
 assert.equal(hash(Buffer.from(JSON.stringify(compose(r.prompt,{seed:r.seed,...r.options}))+'\n')),r.scoreJsonSha256,'Serialized score replay differs: '+r.id);
 assert.equal(hash(await readFile(join(output,r.audio))),r.audioChecks.audioSha256);
 rows.push({id:r.id,attackShapes:{kick:attackShape(s.drums.kick),bass:attackShape(s.bass),harmony:attackShape(s.keys),lead:attackShape(s.lead)}});
}
let bytes=0;for(const f of await readdir(output))bytes+=(await stat(join(output,f))).size;
const report={createdAt:new Date().toISOString(),manifestSha256:hash(await readFile(join(output,'manifest.json'))),verifiedScores:20,verifiedAudioHashes:20,verifiedSourceHashes:m.sources.length,scoreReplay:'passed',actualBytesBeforeAudit:bytes,
 uniqueSetsOfBarAttackShapes:Object.fromEntries(['kick','bass','harmony','lead'].map(role=>[role,new Set(rows.map(r=>JSON.stringify(r.attackShapes[role]))).size])),
 caveat:'Attack-shape inventories omit absolute pitch, timbre, tempo, note lengths, velocities, bar order and human timing jitter. They measure score-grid diversity; perceived similarity and musical preference still require listening. Manifest raw rhythm fingerprints include durations in seconds and full bar positions, so they also change with tempo and form.',rows};
await writeFile(join(output,'audit.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
assert(bytes+Buffer.byteLength(JSON.stringify(report,null,2)+'\n')<m.storageLimitBytes);
console.log(JSON.stringify(report,(_,v)=>Array.isArray(v)&&v.length===20?undefined:v));
