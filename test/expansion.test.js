import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { compose, compilePrompt, renderAudio, renderStems, archetypes, INSTRUMENTS, convolve, spectralResynthesize, transformMotif, timeAtStep, barStep, vocode } from '../src/index.js';
import { reverbBuffer, compressorGain, limiterGains, processBus, REVERBS } from '../src/effects.js';
import { instrumentVoice } from '../src/instruments.js';
import { random } from '../src/random.js';
const hash = (value) => createHash('sha256').update(value).digest('hex');
const near = (a, b, e = 1e-6) => assert.ok(Math.abs(a - b) < e, `${a} != ${b}`);
const allEvents = (s) => [...Object.values(s.drums).flat(), ...s.keys, ...s.bass, ...s.lead, ...s.arp, ...(s.parts ?? []).flatMap((p) => p.events), ...(s.vocals?.events ?? [])];

function checkScore(s) {
  assert.ok(s.sections.every((p) => p.end > p.start));
  near(s.sections[0].start, 0); near(s.sections.at(-1).end, s.config.bars);
  for (let i = 1; i < s.sections.length; i++) assert.equal(s.sections[i].start, s.sections[i - 1].end);
  for (const e of allEvents(s)) {
    assert.ok(Number.isFinite(e.time) && Number.isFinite(e.duration) && e.duration > 0 && e.time >= 0 && e.time < s.config.duration, `${s.config.prompt}: ${JSON.stringify(e)}`);
    assert.ok(e.step >= barStep(s.config, e.bar) - 1e-8 && e.step < barStep(s.config, e.bar + 1), 'event belongs to its bar');
  }
}

test('forms and variable lengths cover the song and retain valid instrument/vocal schedules', () => {
  for (const [form, bars] of [['pop form',48],['AABA',32],['12-bar blues',24],['rondo',40],['theme and variations',32],['extended club',64]]) {
    const s = compose(`jazz ${form}`, { lyrics: 'We move. Come home.', seed: 81 });
    assert.equal(s.config.bars, bars); checkScore(s);
    for (const e of s.vocals.events) {
      const section = s.sections.find((part) => part.name === e.section && e.bar >= part.start && e.bar < part.end);
      assert.ok(e.time + e.duration <= section.endTime + 1e-8);
    }
  }
  for (const bars of [8,16,48,128]) {
    checkScore(compose(`country ${bars} bars`));
    const short = compose(`house pop form ${bars} bars`, {lyrics:'Come home.',vocalDensity:1}); checkScore(short);
    for (const e of short.vocals.events) { const owner=short.sections.find((s)=>s.name===e.section&&e.bar>=s.start&&e.bar<s.end); assert.ok(owner); assert.ok(e.time+e.duration<=owner.endTime+1e-8); }
  }
  for (const bars of [0,7,129,12.5]) assert.throws(() => compose(`house ${bars} bars`));
  assert.equal(compose('jazz 12-bar blues').chords.length, 24);
});

test('tempo, meter, rubato and fermata share one timeline across instruments, vocals and automation', () => {
  const s = compose('house 8 bars at 120bpm change to 7/8 at bar 5 tempo 60 at bar 5', { lyrics: 'Move now.', sauce: 1 });
  near(s.config.duration, 22); assert.equal(s.config.totalSteps, 120); near(s.config.timeline[4].time, 8);
  assert.equal(s.config.timeline[4].stepsPerBar, 14); near(timeAtStep(s.config, 64), 8); checkScore(s);
  for (let i = 0; i < s.bass.length - 1; i++) assert.ok(s.bass[i].time + s.bass[i].duration <= s.bass[i + 1].time + 1e-8);
  const steady = compose('classical 8 bars'), expressive = compose('classical 8 bars rubato fermata');
  assert.notEqual(steady.config.duration, expressive.config.duration);
  assert.ok(expressive.config.timeline.at(-1).bpm < expressive.config.bpm); checkScore(expressive);
  for (const p of ['house 8 bars meter 7/8 at bar 9','house tempo 20 at bar 3','house tempo 0 at bar 3','house meter 7/8 at bar 2.5','house meter 7/8 at bar -1','house meter 3/4 at bar 3 meter 7/8 at bar 3','house modulate to F minor at bar 99']) assert.throws(() => compose(p));
});

test('layered parts have separate notes, registers, pans, cycles, sends and exclusions', () => {
  const s = compose('jazz 8 bars with acoustic piano and strings and trumpet', { parts: [{ name: 'answer', profile: 'clarinet', role: 'counterpoint', cycle: 15, pan: .6, send: .4 }] });
  assert.ok(s.parts.some((p) => p.profile === 'acoustic_piano'));
  const part = s.parts.find((p) => p.name === 'answer');
  assert.ok(part.events.length); assert.equal(part.send, .4); assert.ok(part.events.every((e) => e.pan === .6));
  assert.ok(part.events.some((e) => e.step % s.config.stepsPerBar !== part.events[0].step % s.config.stepsPerBar)); checkScore(s);
  const excluded = compose('orchestral classical 8 bars no lead or harp or bass');
  assert.equal(excluded.parts.filter((p) => ['counterpoint','lead','bass'].includes(p.role) || p.profile === 'harp').length, 0);
  const chamber = compose('chamber classical 8 bars'); assert.ok(chamber.parts.some((p) => p.name === 'cello_part'));
  for (const parts of [[{profile:'unknown'}],[{profile:'flute',name:'keys'}],[{profile:'flute',cycle:2}],[{profile:'flute',mix:{wet:2}}]]) assert.throws(() => compose('jazz', {parts}));
});

test('motif transformations, harmonic rhythm and chromatic harmony affect actual notes', () => {
  assert.deepEqual(transformMotif([0,2,4], 'inversion'), [0,-2,-4]); assert.deepEqual(transformMotif([0,2,4], 'retrograde'), [4,2,0]);
  const s = compose('jazz 16 bars chord every 1 bar secondary dominants borrowed chords tritone substitutions modulate to G major at bar 9');
  assert.equal(s.chords.length, 16); assert.ok(s.chords.some((c) => c.color === 'secondary dominant'));
  assert.ok(s.chords.some((c) => c.color === 'borrowed iv')); assert.ok(s.chords.filter((c) => c.bar >= 8).every((c) => c.keyRoot === 7));
  const normal = compose('synth pop 16 bars', {sauce:0}), inverted = compose('synth pop 16 bars motif inversion motif augmentation', {sauce:0});
  assert.notDeepEqual(normal.lead.map((e) => [e.step,e.note]), inverted.lead.map((e) => [e.step,e.note]));
});

test('groove templates, eighth swing, tuplets and general N:M rhythms create exact subdivisions', () => {
  const straight = compose('house 16 bars swing 60'), eighth = compose('house 16 bars eighth swing 60');
  const a = straight.drums.hat.find((e) => e.step % 4 === 2), b = eighth.drums.hat.find((e) => e.step === a.step);
  assert.ok(b.time > a.time + .02);
  for (const [word, n] of [['quintuplet',5],['septuplet',7]]) {
    const s = compose(`house 16 bars ${word} hats`, {sauce:0});
    assert.ok(s.drums.hat.some((e) => !Number.isInteger(e.step)));
    for (const e of s.drums.hat) near(e.step / 4 * n, Math.round(e.step / 4 * n));
  }
  const poly = compose('house 16 bars 5 against 4 polyrhythm', {sauce:0});
  const five = poly.drums.agogo.filter((e) => e.bar === 5); assert.equal(five.length, 5);
  assert.equal(poly.drums.woodblock.filter((e) => e.bar === 5).length, 4);
  for (let i = 1; i < five.length; i++) near(five[i].time - five[i-1].time, poly.config.timeline[5].duration / 5);
  const grooves = ['bossa','samba','cascara','songo','train','second line','mpc'];
  const signatures = grooves.map((g) => JSON.stringify(compose(`house 16 bars ${g} groove`,{sauce:0}).drums));
  assert.equal(new Set(signatures).size, grooves.length);
  assert.notDeepEqual(compose('house 16 bars humanized').drums, compose('house 16 bars').drums);
});

test('all registered instrument profiles remain stable at multiple sample rates and produce different signals', () => {
  assert.equal(Object.keys(INSTRUMENTS).length, 103);
  for (const sr of [8000,44100]) {
    const fingerprints = new Set();
    for (const profile of Object.keys(INSTRUMENTS)) {
      const sample = instrumentVoice({profile,note:57,velocity:.7,duration:1}, sr, random('stability',profile));
      const buffer = Float32Array.from({length:Math.round(sr*.3)},(_,i)=>sample(i/sr));
      assert.ok(buffer.every((v)=>Number.isFinite(v)&&Math.abs(v)<10),profile);
      assert.ok(buffer.some((v)=>Math.abs(v)>.001),profile); fingerprints.add(hash(buffer));
    }
    assert.equal(fingerprints.size, Object.keys(INSTRUMENTS).length);
  }
});

test('articulations change durations and struck/bowed/pedalled sound', () => {
  const bowed = compose('classical 8 bars with strings legato'), plucked = compose('classical 8 bars with strings pizzicato');
  bowed.config.duration = plucked.config.duration = 2;
  assert.notEqual(hash(renderAudio(bowed,{sampleRate:8000}).pcm), hash(renderAudio(plucked,{sampleRate:8000}).pcm));
  const normal = compose('classical 8 bars'), pedal = compose('classical 8 bars sustain pedal'); normal.config.duration=pedal.config.duration=2;
  assert.notEqual(hash(renderAudio(normal,{sampleRate:8000}).pcm),hash(renderAudio(pedal,{sampleRate:8000}).pcm));
  assert.ok(compose('country 8 bars staccato').keys[0].duration < compose('country 8 bars').keys[0].duration);
});

test('partitioned convolution agrees with direct convolution across block boundaries', () => {
  const signal=Float32Array.from({length:987},(_,i)=>Math.sin(i*.73)*.2), ir=Float32Array.from({length:400},(_,i)=>Math.cos(i*.1)*Math.exp(-i/60)*.2);
  const actual=convolve(signal,ir,64);
  for(let n=0;n<signal.length;n++){let expected=0;for(let k=0;k<ir.length&&k<=n;k++)expected+=signal[n-k]*ir[k];near(actual[n],expected,2e-6);}
  assert.throws(()=>convolve(signal,new Float32Array([NaN]))); assert.throws(()=>convolve(signal,ir,100));
});

test('STFT overlap-add preserves identity and spectral transformations change the output', () => {
  const source=Float32Array.from({length:4096},(_,i)=>Math.sin(i*.24)*(.2+.1*Math.sin(i*.001)));
  const identity=spectralResynthesize(source);
  for(let i=0;i<source.length;i++)near(identity[i],source[i],1e-5);
  assert.notEqual(hash(source),hash(spectralResynthesize(source,{freeze:1024,tilt:.3})));
});

test('every reverb style has a finite distinctive impulse response and real tails', () => {
  const hashes=new Set();
  for(const reverb of REVERBS){
    const l=new Float32Array(16000),r=l.slice();l[0]=r[0]=.5;
    reverbBuffer(l,r,8000,{reverb,wet:.7,decay:1.4});
    assert.ok(l.every((x)=>Number.isFinite(x)&&Math.abs(x)<2),reverb);
    assert.ok(l.slice(800,1400).some((x)=>Math.abs(x)>1e-7),reverb);
    hashes.add(hash(l));
  }
  assert.equal(hashes.size,REVERBS.length);
});

test('bus EQ, dynamics, modulation, tape and vocoder act on audio', () => {
  const sr=8000,source=Float32Array.from({length:8000},(_,i)=>.5*Math.sin(2*Math.PI*400*i/sr));
  const g=compressorGain(null,sr,{threshold:-24,ratio:8,attack:.001,release:.1}); let last;
  for(const v of source)last=g(v);assert.ok(last<.35);
  const fingerprints=new Set();
  for(const modulation of ['chorus','flanger','phaser','rotary']){const l=source.slice(),r=source.slice();processBus(l,r,sr,{eq:[],modulation,drive:1});assert.ok(l.every(Number.isFinite));fingerprints.add(hash(l));}
  assert.equal(fingerprints.size,4);
  const processed=source.slice(),r=source.slice();processBus(processed,r,sr,{eq:[{frequency:400,gain:-12,q:2}],compress:true,threshold:-24,ratio:4,attack:.01,release:.1,drive:2,tape:true,multiband:true,dynamicEq:true});
  assert.notEqual(hash(processed),hash(source));assert.ok(processed.every(Number.isFinite));
  const modulator=Float32Array.from(source,(v,i)=>v*(i<4000?1:0));const voice=vocode(source,modulator,sr);assert.ok(voice.every(Number.isFinite));assert.ok(voice.some((v)=>Math.abs(v)>.001));
});

test('lookahead limiting catches a future transient and controls reconstructed peaks', () => {
  const l=new Float32Array(800),r=l.slice();l[200]=r[200]=2;
  const gains=limiterGains(l,r,8000,.79);assert.ok(gains[190]<.5);assert.ok(gains[200]*l[200]<=.791);
});

test('shared-gain stems reconstruct a processed mix including independent parts', () => {
  const score=compose('house 8 bars hall reverb tape mix multiband compressor true peak limiter',{parts:[{name:'strings_part',profile:'bowed_strings',role:'harmony'}]});score.config.duration=2;
  const {mix,stems}=renderStems(score,{sampleRate:8000});assert.ok(stems.strings_part&&stems.fx);
  for(const s of Object.values(stems))assert.equal(s.gain,mix.gain);
  for(let i=0;i<mix.pcm.length;i+=2){const sum=Object.values(stems).reduce((n,s)=>n+s.pcm.readInt16LE(i),0);assert.ok(Math.abs(sum-mix.pcm.readInt16LE(i))<=Object.keys(stems).length/2+1);}
});

test('all 97 presets compose and render complete finite tracks, with distinct new subgenre recipes', () => {
  const signatures=new Set();
  for(const a of Object.values(archetypes)){
    const s=compose(a.aliases[0],{seed:36,sauce:.2});assert.equal(s.config.intent,a.id,a.id);checkScore(s);
    const audio=renderAudio(s,{sampleRate:8000});assert.ok(audio.stats.rms>.001&&Number.isFinite(audio.stats.rms),a.id);assert.ok(audio.stats.peak<=.81,a.id);
    if(a.id in {bluegrass:1,bebop:1,hard_bop:1,modal_jazz:1,jazz_fusion:1,bossa_nova:1,samba:1,salsa:1,bachata:1,cumbia:1})signatures.add(hash(audio.pcm));
  }
  assert.equal(signatures.size,10);
});

test('CLI dry runs expose forms and production without writing audio', () => {
  const result=spawnSync(process.execPath,['bin/makebeats.js','orchestral classical 16 bars rondo rubato hall reverb','--dry-run'],{encoding:'utf8',maxBuffer:8e6});
  assert.equal(result.status,0,result.stderr);const s=JSON.parse(result.stdout);assert.equal(s.config.bars,16);assert.equal(s.config.production.reverb,'hall');assert.ok(s.parts.length>=3);
  for(const p of ['house hall reverb 101%','house eq 0hz -3db','house eq 1000hz -50db'])assert.throws(()=>compilePrompt(p));
});


test('bus sidechains, independent sends, FM parameters and legacy layers reach the renderer', () => {
  const options = { parts: [{ name: 'brass_answer', profile: 'fm_synth', role: 'lead', fmRatios: [1, 1.5, 2, 3], fmIndices: [3, 2, 1], send: 0 }] };
  const dry = compose('house 8 bars hall reverb', options), wet = compose('house 8 bars hall reverb', { parts: [{ ...options.parts[0], send: 2 }], mix: { buses: { harmony: { sidechain: true, threshold: -24, ratio: 8 }, drums: { compress: true } } } });
  dry.config.duration = wet.config.duration = 2;
  // Lead-style additional parts play independently from the built-in lead gate.
  assert.notEqual(hash(renderAudio(dry, {sampleRate:8000}).pcm), hash(renderAudio(wet, {sampleRate:8000}).pcm));
  const s = compose('house rhodes and strings'); assert.ok(s.parts.some((p) => p.profile === 'rhodes_stabs'));
  assert.equal(compilePrompt('house dub mix').intent, 'house_bright');
  assert.equal(compilePrompt('house samba groove').intent, 'house_bright');
  assert.equal(compose('jazz', {parts:[{profile:'flute',name:'answer',pedal:true}]}).parts[0].events[0].pedal, true);
  assert.throws(() => compose('house', {parts:[{profile:'fm_synth',fmRatios:[1,2]}]}));
  assert.throws(() => compilePrompt('house', {mix:{buses:{unknown:{}}}}));
  const result=spawnSync(process.execPath,['bin/makebeats.js','house 8 bars','--format','wav','--stems','--parts','[{"name":"answer","profile":"clarinet"}]','--mix','{"buses":{"drums":{"compress":true}}}','--dry-run'],{encoding:'utf8',maxBuffer:4e6});
  assert.equal(result.status,0,result.stderr); assert.equal(JSON.parse(result.stdout).parts[0].name,'answer');
});
