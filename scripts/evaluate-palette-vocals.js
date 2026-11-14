// Frozen development evaluation only. Does not merge branches or edit the engine.
import assert from 'node:assert/strict';
import { readFile, readdir, mkdir, writeFile, stat } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { nextBatch, hash, encodePreview, run } from './lib/audio-evaluation.js';

const root = new URL('../', import.meta.url), output = fileURLToPath(new URL('generated_beats/', root));
const fixtureBytes = await readFile(new URL('data/palette-vocals-25.json', root));
const fixture = JSON.parse(fixtureBytes);
assert.equal(fixture.cases.length, 25);
await mkdir(output, { recursive: true });
const batch = await nextBatch(output, 'palette-vocals');
const snapshot = new URL('generated_beats/' + batch + '.sources/', root);
const snapshotPath = fileURLToPath(snapshot);
const fileNames = ['package.json', 'data/genre-rules.json', 'data/intent-corpus.json', 'data/palette-vocals-25.json',
  'scripts/evaluate-palette-vocals.js', 'scripts/evaluation-checks.js', 'scripts/lib/audio-evaluation.js',
  ...(await readdir(new URL('src/', root))).filter((f) => f.endsWith('.js')).map((f) => 'src/' + f)];
const vocalFiles = ['src/vocals.js', 'src/speech.js', 'src/vocal-pitch.js'];
const identities = [], captured = [];
// Capture exact bytes and check again before using them; refuse a moving snapshot.
for (const path of fileNames) captured.push({ path, from: new URL(path, root), bytes: await readFile(new URL(path, root)) });
for (const path of vocalFiles) {
  assert(!fileNames.includes(path), 'Vocals now exist in the main tree; remove the evaluation bridge and use the integrated API.');
  const from = new URL('.worktrees/vocals/' + path, root);
  captured.push({ path, from, bytes: await readFile(from) });
}
for (const item of captured) assert.equal(hash(await readFile(item.from)), hash(item.bytes), 'Source changed during capture: ' + item.path + '; retry after the writer finishes.');
for (const item of captured) {
  await mkdir(new URL('./', new URL(item.path, snapshot)), { recursive: true });
  await writeFile(new URL(item.path, snapshot), item.bytes, { flag: 'wx' });
  identities.push({ path: item.path, origin: fileURLToPath(item.from), sha256: hash(item.bytes) });
}
await writeFile(join(output, batch + '.prompts.json'), fixtureBytes, { flag: 'wx' });
const api = await import(new URL('src/index.js', snapshot));
const { checkCase } = await import(new URL('scripts/evaluation-checks.js', snapshot));
const { arrangeVocals } = await import(new URL('src/vocals.js', snapshot));
const { INSTRUMENTS } = await import(new URL('src/instruments.js', snapshot));

function absoluteImports(source, moduleUrl) {
  return source.replace(/from (['"])(\.\.?\/[^'"]+)\1/g, (_, quote, relative) => 'from ' + JSON.stringify(new URL(relative, moduleUrl).href));
}
// Only test glue is transformed in memory: the same mixVocals insertion point as
// the vocal branch, and its temporary speech path redirected to the chosen root.
const dspUrl = new URL('src/dsp.js', snapshot);
const originalDsp = await readFile(dspUrl, 'utf8');
const insertion = '  applyAutomation(left, right, score.automation, config.stepSeconds, sr);';
assert.equal(originalDsp.split(insertion).length, 2, 'Expected one pre-automation vocal mixing seam.');
let bridgedDsp = absoluteImports(originalDsp, dspUrl)
  .replace('...PERCUSSION_VOICES]);', "...PERCUSSION_VOICES, 'vocals']);")
  .replace(insertion, "  if (!selected || selected.has('vocals')) mixVocals(score.vocals, options.vocalSamples, left, right, sr);\n" + insertion);
bridgedDsp = 'import { mixVocals } from ' + JSON.stringify(new URL('src/vocals.js', snapshot).href) + ';\n' + bridgedDsp;
const { renderAudio, sliceAudio } = await import('data:text/javascript;base64,' + Buffer.from(bridgedDsp).toString('base64'));
const speechUrl = new URL('src/speech.js', snapshot), speech = await readFile(speechUrl, 'utf8');
const tempPathLine = "const generated = fileURLToPath(new URL('../generated_beats/', import.meta.url));";
assert.equal(speech.split(tempPathLine).length, 2, 'Unexpected speech temporary-directory API.');
const bridgedSpeech = absoluteImports(speech, speechUrl).replace(tempPathLine, 'const generated = ' + JSON.stringify(output) + ';');
const { prepareVocalSamples } = await import('data:text/javascript;base64,' + Buffer.from(bridgedSpeech).toString('base64'));

function summary(score) {
  const c = score.config;
  return { intent: c.intent, source: c.classification.source, needsInterpretationReview: c.classification.needsInterpretationReview,
    bpm: c.bpm, root: c.rootName, scale: c.scale, timeSignature: c.timeSignature, duration: c.duration,
    bassProfile: c.bassProfile, synthProfile: c.synthProfile, soundDesign: c.soundDesign, messages: c.messages };
}
function evaluate(score, expect) {
  const result = checkCase(score, expect), c = score.config;
  const add = (name, actual, expected, passed) => result.checks.push({ name, actual, expected, passed });
  const profiles = new Set([...score.keys, ...score.bass, ...score.lead, ...score.arp, ...Object.values(score.drums).flat()].map(e => e.profile ?? e.voice));
  for (const profile of expect.profiles ?? []) add('instrument:' + profile, profiles.has(profile), true, profiles.has(profile));
  if (expect.timeSignature) add('timeSignature', c.timeSignature, expect.timeSignature, c.timeSignature === expect.timeSignature);
  if (expect.minSwing) add('minSwing', c.swing, expect.minSwing, c.swing >= expect.minSwing);
  if (expect.fourOnFloor) {
    const kicks = score.drums.kick.filter(e => e.bar === 20).map(e => e.step % c.stepsPerBar);
    add('dropFourOnFloor', kicks, [0,4,8,12], JSON.stringify(kicks) === '[0,4,8,12]');
  }
  if (expect.kickVariation) {
    const patterns = [20,21,22,23].map(b => score.drums.kick.filter(e => e.bar === b).map(e => e.step % c.stepsPerBar).join(','));
    add('kickPhraseVariation', new Set(patterns).size, '>1', new Set(patterns).size > 1);
  }
  // Read the actual current renderer: only the bass bus is multiplied by duck.
  if (expect.padDucking) add('padSidechainImplemented', false, true, false);
  if (expect.polyrhythm) add('explicitPolyrhythmActivated', c.groove?.polyrhythm, true, c.groove?.polyrhythm === true);
  const events = [...Object.values(score.drums).flat(), ...score.keys, ...score.bass, ...score.lead, ...score.arp];
  add('finiteEventsWithinTrack', events.every(e => Number.isFinite(e.time) && e.time >= 0 && e.time < c.duration && Number.isFinite(e.duration) && e.duration > 0), true, events.every(e => Number.isFinite(e.time) && e.time >= 0 && e.time < c.duration && Number.isFinite(e.duration) && e.duration > 0));
  add('32bars', c.bars, 32, c.bars === 32);
  result.passed = result.checks.every(check => check.passed);
  return result;
}
async function retainedBytes(path = output) {
  let bytes = 0;
  for (const entry of await readdir(path, { withFileTypes: true })) {
    if (path === output && !entry.name.startsWith(batch + '.sources') && !entry.name.startsWith(batch + '.') && !entry.name.startsWith(batch + '-')) continue;
    const target = join(path, entry.name);
    bytes += entry.isDirectory() ? await retainedBytes(target) : (await stat(target)).size;
  }
  return bytes;
}
const manifest = { batch, status: 'rendering', createdAt: new Date().toISOString(), nodeVersion: process.version,
  engineVersion: JSON.parse(await readFile(new URL('package.json', snapshot))).version,
  fixtureSha256: hash(fixtureBytes), storageLimitBytes: fixture.storageLimitBytes, sources: identities,
  evaluationSources: await Promise.all(['scripts/evaluate-palette-vocals.js', 'scripts/evaluation-checks.js', 'scripts/lib/audio-evaluation.js'].map(async path => ({path, sha256:hash(await readFile(new URL(path,root)))}))),
  ffmpeg: (await run('ffmpeg', ['-version'])).stdout.split('\n')[0],
  integration: { type: 'evaluation-only in-memory bridge', snapshot: basename(snapshotPath),
    rendererSha256: hash(bridgedDsp), speechModuleSha256: hash(bridgedSpeech),
    changes: ['Insert existing mixVocals after instrument effects and before shared automation/mastering.', 'Permit vocals in stem selection.', 'Redirect existing speech temporary files into the selected root generated_beats/.'],
    note: 'Main CLI has not been merged with the vocal branch. No production modules or instrument implementations were changed.' },
  previewSeconds: 16, caveats: ['Development cases, not a held-out benchmark.', 'Settings/event checks are not listening ratings.', 'Unsupported requests remain gaps even when narrower checks pass.', 'Speech is robotic, not singing; native speech bytes can vary despite the seed.', 'Most excerpts are from bar 20; case 04 straddles build/drop. Full arrangements are scores, not retained full audio.', 'Loudness matching only attenuates; quieter clips are possible.'],
  cases: [], presetProbes: [], instrumentProbes: [] };
const manifestPath = join(output, batch + '.manifest.json');
const saveManifest = async () => writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
await saveManifest();

// Additional nonretained signal probes cover the six specifically requested new
// presets and all named instruments, even when the 25 prompts do not request them.
for (const [prompt, intent] of Object.entries({'deep house':'deep_house','speed garage':'speed_garage',trap:'trap_halftime','afro house':'afro_house','liquid dnb':'liquid_dnb',country:'country_acoustic'})) {
  const s = api.compose(prompt, { seed: 910 }), audio = api.renderAudio(s, { sampleRate:8000 });
  const replay = api.renderAudio(s, { sampleRate:8000 });
  manifest.presetProbes.push({prompt, expected:intent, actual:s.config.intent, finiteNonSilent:audio.stats.rms > .001 && audio.stats.peak <= .81,
    deterministic:hash(audio.pcm) === hash(replay.pcm), passed:s.config.intent === intent && audio.stats.rms > .001 && audio.stats.peak <= .81 && hash(audio.pcm) === hash(replay.pcm)});
}
for (const profile of Object.keys(INSTRUMENTS)) {
  const s = api.compose('classical', { seed:910, sauce:0 });
  s.config.duration = 1.6; s.drums = {kick:[]}; s.bass = []; s.lead=[]; s.arp=[]; s.automation=[];
  s.keys = [{voice:'keys',profile,note:57,time:0,duration:1.5,velocity:.8,pan:0}];
  const audio = api.renderAudio(s, {sampleRate:16000});
  const replay = api.renderAudio(s, {sampleRate:16000});
  manifest.instrumentProbes.push({profile,rms:audio.stats.rms,peak:audio.stats.peak,pcmSha256:hash(audio.pcm),passed:audio.stats.rms>.001 && audio.stats.peak<=.81 && hash(audio.pcm)===hash(replay.pcm)});
}

for (let i=0; i<fixture.cases.length; i++) {
  const item = fixture.cases[i], seed = fixture.seedBase + i;
  console.log('['+(i+1)+'/25] '+item.title);
  const original = api.compose(item.original, {seed}), score = api.compose(item.prompt,{seed});
  assert.deepEqual(score, api.compose(item.prompt,{seed}));
  if (item.vocal) {
    assert.equal(score.config.timeSignature,'4/4','The current vocal scheduler is 4/4 only.');
    score.vocals = arrangeVocals(score.config,score.sections,score.automation,item.vocal);
    assert.deepEqual(score.vocals,arrangeVocals(score.config,score.sections,score.automation,item.vocal));
  }
  const plan = score.vocals;
  const row = {...item, seed, prompt:item.prompt, audio:batch+'-'+item.id+'.mp3',score:batch+'-'+item.id+'.score.json',
    originalInterpretation:summary(original), originalChecks:evaluate(original,item.expect), interpretation:summary(score),
    ...evaluate(score,item.expect), humanReview:{promptFit:null,genreFit:null,instrumentRealism:null,vocalFit:null,groove:null,notes:null}};
  row.vocalChecks = {requested:!!item.vocal,events:plan?.events.length ?? 0,voice:plan?.voice ?? null};
  if(plan) {
    const valid = plan.events.every((e,index)=>e.time>=0 && e.time+e.duration<=score.config.duration+1e-8 && (!index || plan.events[index-1].time+plan.events[index-1].duration<=e.time+1e-8));
    assert(valid,'Invalid/overlapping vocal plan');
    row.vocalChecks.nonOverlappingWithinTrack = valid;
    row.vocalChecks.sectionCoverage = [...new Set(plan.events.map(e=>e.section))];
    row.vocalChecks.hookInDrop = plan.events.some(e=>e.section==='drop' && e.source==='phrase:'+plan.hookIndex);
  }
  const bank = item.vocal ? await prepareVocalSamples(score) : null;
  if(bank) {
    plan.sampleHashes = bank.hashes; plan.speechRuntime=bank.runtime;
    if(bank.pitch) plan.pitchResult=bank.pitch;
    row.vocalChecks.pitchResult = bank.pitch ?? null;
    row.vocalChecks.preparedSourceCount = Object.keys(bank.sources).length;
  }
  const start = item.id==='04' ? Math.max(0,20*score.config.beatsPerBar*60/score.config.bpm-8) : Math.min(20*score.config.beatsPerBar*60/score.config.bpm,score.config.duration-16);
  const audio = renderAudio(score,{vocalSamples:bank});
  if (bank) {
    const voiceAudio = renderAudio(score,{vocalSamples:bank,voices:['vocals']});
    const voiceReplay = renderAudio(score,{vocalSamples:bank,voices:['vocals']});
    const vocalPreview = sliceAudio(voiceAudio,start,16);
    row.vocalChecks.preparedBankMixDeterministic = hash(voiceAudio.pcm)===hash(voiceReplay.pcm);
    row.vocalChecks.previewRms = vocalPreview.stats.rms;
    row.vocalChecks.previewAudible = vocalPreview.stats.rms>.001;
    assert(row.vocalChecks.preparedBankMixDeterministic && row.vocalChecks.previewAudible);
  } else {
    row.vocalChecks.noVocalPlan = !plan;
    // The bridge must be byte-identical to the current renderer when vocals are off.
    assert.equal(hash(audio.pcm),hash(api.renderAudio(score).pcm));
    row.vocalChecks.bridgePreservesInstrumentalPcm = true;
  }
  const preview = sliceAudio(audio,start,16);
  assert.equal(preview.frames,44100*16);
  assert(preview.stats.rms>.0001 && preview.stats.peak<=.81);
  const scoreBytes=Buffer.from(JSON.stringify(score)+'\n');
  assert((await retainedBytes())+scoreBytes.length+700000+1000000<fixture.storageLimitBytes,'Agreed 25 MB additional budget would be exceeded.');
  await writeFile(join(output,row.score),scoreBytes,{flag:'wx'});
  row.scoreSha256=hash(scoreBytes);
  row.audioChecks=await encodePreview(join(output,row.audio),preview);
  row.rawPcmStats=preview.stats; row.excerpt={startSeconds:start,durationSeconds:16}; row.status='ready';
  manifest.cases.push(row); await saveManifest();
  console.log('  '+score.config.intent+' | '+score.config.bpm+' BPM | '+row.checks.filter(c=>!c.passed).length+' requirement misses | '+(plan?.voice ?? 'instrumental'));
}
for (const source of identities) assert.equal(hash(await readFile(new URL(source.path,snapshot))),source.sha256,'Frozen source changed.');
manifest.status='complete'; manifest.completedAt=new Date().toISOString();
manifest.summary={cases:25,vocalCases:manifest.cases.filter(r=>r.vocal).length,instrumentalCases:manifest.cases.filter(r=>!r.vocal).length,
  observableCasesPassed:manifest.cases.filter(r=>r.passed).length,checks:manifest.cases.reduce((n,r)=>n+r.checks.length,0),
  checksPassed:manifest.cases.reduce((n,r)=>n+r.checks.filter(c=>c.passed).length,0),signalPassed:manifest.cases.filter(r=>r.audioChecks.encoded.truePeakDbfs<=-1).length,
  uniqueEncodedFiles:new Set(manifest.cases.map(r=>r.audioChecks.audioSha256)).size,
  capabilityGapCases:manifest.cases.filter(r=>r.gaps.length).length,
  uniqueIntents:new Set(manifest.cases.map(r=>r.interpretation.intent)).size,
  presetProbesPassed:manifest.presetProbes.filter(r=>r.passed).length,instrumentProbesPassed:manifest.instrumentProbes.filter(r=>r.passed).length};
await saveManifest();
const lines=['# 25 instrument and vocal examples','',fixture.purpose,'',
  'The active music source reports v'+manifest.engineVersion+'. Sources were frozen before rendering while another agent continued work. Vocals are combined through an evaluation-only bridge; the main CLI is not yet integrated. The source snapshot and hashes are retained locally.','',
  '**'+manifest.summary.signalPassed+'/25 signal checks; '+manifest.summary.checksPassed+'/'+manifest.summary.checks+' observable requirement checks; '+manifest.summary.observableCasesPassed+'/25 cases pass every narrow check. These are not musical-quality scores.** Unsupported singing/instruments/arrangement requests remain listed below.','',
  '17 clips include robotic native speech; 8 are instrumental. Each MP3 is 16 seconds, with a complete 32-bar score. Case 04 straddles the build/drop; others start at bar 20. Native speech bytes are not seed-deterministic; repeat mixing of the same prepared bank was tested.','',
  '[Manifest and exact checks](<'+manifestPath+'>) · [All original/rewritten prompts and lyrics](<'+join(output,batch+'.prompts.json')+'>)','',
  '## Additional probes','',manifest.summary.presetProbesPassed+'/6 new-preset probes passed. '+manifest.summary.instrumentProbesPassed+'/'+manifest.instrumentProbes.length+' named instrument profiles produced repeatable non-silent audio at diagnostic sample rates. These probes are not additional retained listening clips.','',
  '## Listening order','', 'Start with 07 (indie guitar), 08 (boom-bap rap), 11 (garage pitch/chops), 12 (waltz/accordion miss), 19 (solo piano), 21 (house/pad-sidechain miss), 22 (liquid D&B) and 25 (robotic synth-pop).',''];
for(const row of manifest.cases) {
  const c=row.interpretation;
  lines.push('## '+row.id+' — '+row.title,'','**Original:** '+row.original,'','**Rendered prompt:** '+row.prompt,'',
    '!['+row.id+'](<'+join(output,row.audio)+'>)','',
    'Interpretation: **'+row.originalInterpretation.intent+' → '+c.intent+'** (original → rewritten), '+c.bpm+' BPM, '+c.root+' '+c.scale+', '+c.timeSignature+'.',
    'Instruments: harmony '+c.synthProfile+'; bass '+c.bassProfile+'; lead '+c.soundDesign.leadProfile+'.','');
  if(row.vocal) lines.push('**Vocal:** '+row.vocalChecks.voice+'; density '+row.vocal.vocalDensity+', chops '+row.vocal.vocalChops+(row.vocal.vocalPitch?' , pitch '+row.vocal.vocalPitch+' semitones':'')+'.','', '**Lyrics:** '+row.vocal.lyrics,'','**Hook:** '+row.vocal.hook,'');
  else lines.push('**Vocals:** off.','');
  const failures=row.checks.filter(c=>!c.passed);
  lines.push('**Observable checks:** '+(failures.length?failures.map(c=>c.name+' (actual '+JSON.stringify(c.actual)+', expected '+JSON.stringify(c.expected)+')').join('; '):'Passed the narrow structural checks.')+'','');
  if(row.gaps.length) lines.push('**Capability gaps / listening questions:** '+row.gaps.join(' '),'');
  lines.push('[Full score](<'+join(output,row.score)+'>) · '+row.audioChecks.encoded.integratedLufs+' LUFS · '+row.audioChecks.encoded.truePeakDbfs+' dBTP','',
    'Listening: prompt fit ___ | sound/voice ___ | groove ___ | keep/change ___','');
}
await writeFile(join(output,batch+'.listening.md'),lines.join('\n')+'\n',{flag:'wx'});
manifest.retainedBytes=await retainedBytes(); await saveManifest();
assert(manifest.retainedBytes<fixture.storageLimitBytes);
console.log(JSON.stringify({batch,...manifest.summary,retainedMB:manifest.retainedBytes/1e6,listening:join(output,batch+'.listening.md')}));
