import { createHash } from 'node:crypto';
import { checkCase } from '../evaluation-checks.js';
import { barInfo } from '../../src/arrangement.js';

export const scoreHash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function musicPlan(score) {
  const c = score.config;
  return { settings: Object.fromEntries(['bpm','root','scale','timeSignature','timeline','production','accompaniment','development','tuning','timbre'].map(k=>[k,c[k]])),
    drums:score.drums,bass:score.bass,keys:score.keys,lead:score.lead,arp:score.arp,parts:score.parts,chords:score.chords,automation:score.automation,sidechain:score.sidechain };
}
export function checkGeneralization(score, expected = {}) {
  const base = checkCase(score, expected), c = score.config, checks = [...base.checks], safety = [];
  const add = (list,name,actual,wanted,passed=actual===wanted) => list.push({name,actual,expected:wanted,passed});
  for(const key of ['synthProfile','timeSignature'])if(key in expected)add(checks,key,c[key],expected[key]);
  if('leadProfile' in expected)add(checks,'leadProfile',c.soundDesign.leadProfile,expected.leadProfile);
  if('accompanimentStyle' in expected)add(checks,'accompanimentStyle',c.accompaniment.style,expected.accompanimentStyle);
  if('tuningSystem' in expected)add(checks,'tuningSystem',c.tuning.system,expected.tuningSystem);
  if('concertPitch' in expected)add(checks,'concertPitch',c.tuning.concertPitch,expected.concertPitch);
  if('melodyModel' in expected)add(checks,'melodyModel',c.development.melodyModel,expected.melodyModel);
  if('maxLeap' in expected){
    const max=score.lead.slice(1).reduce((n,e,i)=>Math.max(n,Math.abs(e.note-score.lead[i].note)),0);
    add(checks,'actualLeadMaxLeap',max,'<='+expected.maxLeap,score.lead.length>0&&max<=expected.maxLeap);
  }
  const pitched=[...score.bass,...score.keys,...score.lead,...score.arp,...score.parts.flatMap(p=>p.events)];
  const profiles=new Set(pitched.map(e=>e.profile));
  for(const profile of expected.excludedProfiles??[])add(checks,'excludedProfile:'+profile,profiles.has(profile),false);
  if(expected.noPitchedParts)add(checks,'noPitchedParts',score.parts.reduce((n,p)=>n+p.events.length,0),0);
  add(safety,'bars',c.bars,32);add(safety,'instrumental',Boolean(score.vocals),false);
  const drums=Object.values(score.drums).flat(),all=[...drums,...pitched];
  const invalid=all.filter(e=>!Number.isFinite(e.time)||e.time<0||e.time>=c.duration||!Number.isFinite(e.duration)||e.duration<=0||!Number.isFinite(e.velocity)).length;
  add(safety,'invalidEvents',invalid,0);
  add(safety,'nonFinitePitches',pitched.filter(e=>!Number.isFinite(e.note)||e.frequency!==undefined&&(!Number.isFinite(e.frequency)||e.frequency<=0)).length,0);
  add(safety,'pitchedTailsBeyondTrack',pitched.filter(e=>e.time+e.duration>c.duration+1e-8).length,0);
  add(safety,'pitchedStepsOutsideOwningBar',pitched.filter(e=>{const b=barInfo(c,e.bar);return e.step<b.startStep||e.step>=b.startStep+b.stepsPerBar;}).length,0);
  add(safety,'bassOverlaps',score.bass.slice(1).filter((e,i)=>score.bass[i].time+score.bass[i].duration>e.time+1e-8).length,0);
  return {constraintPassed:checks.every(c=>c.passed),safetyPassed:safety.every(c=>c.passed),checks,safety,metrics:base.metrics,
    classification:{intent:c.intent,source:c.classification.source,fallback:c.classification.fallback,needsReview:c.classification.needsInterpretationReview},
    musicPlanSha256:scoreHash(musicPlan(score)),diagnostics:{drumTailsBeyondTrack:drums.filter(e=>e.time+e.duration>c.duration+1e-8).length}};
}
export function selectExcerpt(score, seconds=16) {
  const section=score.sections.find(s=>s.name==='drop')??score.sections.find(s=>s.name==='chorus')??score.sections[Math.floor(score.sections.length/2)];
  const requested=section?.startTime??0,start=Math.max(0,Math.min(requested,score.config.duration-seconds));
  return {startSeconds:start,durationSeconds:seconds,focusSection:section?.name??'start',sections:score.sections.filter(s=>s.startTime<start+seconds&&s.endTime>start).map(s=>s.name)};
}
