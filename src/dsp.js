import { timeAtStep } from './arrangement.js';
import { processBus, reverbBuffer, limiterGains } from './effects.js';
import { instrumentVoice, PERCUSSION_VOICES } from './instruments.js';
import { random, clamp, midiHz, eventFrequency } from './random.js';
import { StateVariableFilter } from './filter.js';
import { mixVocals } from './vocals.js';

import { modulationState, adsr, filterVoice, bodyResonator } from './timbre.js';
import { sympatheticBody } from './acoustics.js';
const TAU = Math.PI * 2;
export function polyBlep(t, dt) {
  if (t < dt) { t /= dt; return t + t - t * t - 1; }
  if (t > 1 - dt) { t = (t - 1) / dt; return t * t + t + t + 1; }
  return 0;
}
function saw(phase, dt) {
  const t = phase - Math.floor(phase);
  return 2 * t - 1 - polyBlep(t, dt);
}
export function glideFrequency(fromNote, toNote, t, seconds = .12) {
  const x = clamp(t / seconds, 0, 1);
  return midiHz(fromNote + (toNote - fromNote) * x * x * (3 - 2 * x));
}
export function duckingGain(elapsed, duckDb = -21, tauSeconds = .055) {
  if (elapsed < 0 || !Number.isFinite(elapsed)) return 1;
  return 1 - (1 - 10 ** (duckDb / 20)) * Math.exp(-elapsed / tauSeconds);
}
function edges(t, duration, attack = .003, release = .012) {
  return Math.min(1, t / attack) * Math.min(1, Math.max(0, (duration - t) / release));
}

function chopSource(sr) {
  const buffer = new Float32Array(Math.round(sr * .32));
  const f = midiHz(60);
  for (let i = 0; i < buffer.length; i++) {
    const t = i / sr;
    buffer[i] = Math.sin(TAU * f * t + 2.5 * Math.exp(-t * 12) * Math.sin(TAU * f * 2 * t))
      * Math.exp(-t * 8) * edges(t, .32);
  }
  return buffer;
}

function renderVoice(event, left, right, bass, sr, rng, chop) {
  const start = Math.round(event.time * sr);
  const count = Math.min(Math.ceil(event.duration * sr), left.length - start);
  const pan = clamp(event.pan ?? 0, -1, 1);
  const lg = Math.cos((pan + 1) * Math.PI / 4), rg = Math.sin((pan + 1) * Math.PI / 4);
  const pitchRatio = 2 ** ((event.pitch ?? 0) / 12);
  const originalBase = eventFrequency(event);
  let base=originalBase;
  let phase = 0, phase2 = 0, low = 0;
  const filter = new StateVariableFilter(sr);
  const analogBass = ['dark_analog_bass', 'dark_distorted_bass'].includes(event.profile);
  const designedBass = analogBass || ['metallic_reese', 'reese_bass', 'growl_bass'].includes(event.profile);
  const widePad = event.profile === 'dark_wide_pad';
  const pad = widePad || event.profile === 'analog_saw_pad' || event.profile === 'dark_pad';
  const chopOffset = Math.floor(rng() * (chop.length * .25));
  if (base >= sr * .45) return;
  const instrument = instrumentVoice(event, sr, rng);
  const stereoInstrument = event.profile === 'supersaw' ? instrumentVoice(event, sr, rng) : null;
  const modulate = !instrument && event.modulation?.length ? modulationState(event,sr,rng) : null;
  const needsFilter=event.filterModel||event.cutoff!==undefined||event.modulation?.some(m=>m.target==='cutoff');
  const timbreSvf=new StateVariableFilter(sr);
  const timbreFilter = !instrument && needsFilter ? (!event.filterModel||event.filterModel==='svf') ? (x,hz,q)=>timbreSvf.process(x,hz,.5+q*3) : filterVoice(sr,event.filterModel) : null;
  const timbreBody=!instrument&&event.body?bodyResonator(sr,event):null;
  const kit = event.kit ?? 'standard';
  const brightness = event.profile === 'dusty_rhodes' ? .09 : .3;
  const staticRng = event.radioStatic === true ? random(event.note, 'radio-static:' + event.time) : null;
  for (let i = 0; i < count; i++) {
    const t = i / sr;
    const mods=modulate?.(t);base=originalBase*2**clamp(mods?.pitch??0,-2,2);
    let sample = 0, stereo = null;
    const attack = widePad ? .65 : analogBass ? .07 : designedBass ? .025 : pad ? .12 : event.voice === 'lead' ? .012 : event.voice === 'keys' ? .005 : .0015;
    const envelope = edges(t, event.duration, attack, widePad ? .35 : analogBass ? .1 : designedBass ? .025 : pad ? .15 : event.voice === 'lead' ? .035 : .012);
    if (instrument) {
      sample = instrument(t);
      if (stereoInstrument) stereo = stereoInstrument(t);
    } else if (event.voice === 'kick') {
      const f = (kit === '808' ? 48 : kit === '909' ? 64 : kit === 'soft' ? 62 : 85) + (kit === '808' ? 110 : 90) * Math.exp(-t / .015);
      phase += f / sr;
      const noise = rng() * 2 - 1;
      sample = .82 * (Math.sin(TAU * phase) * Math.exp(-t / (kit === '808' ? .14 : kit === '909' ? .08 : kit === 'soft' ? .045 : .065)) + (kit === 'soft' ? .04 : .15) * noise * Math.exp(-t / .002));
    } else if (event.voice === 'snare') {
      const white = rng() * 2 - 1;
      low += .3 * (white - low);
      sample = .4 * ((white - low) * (kit === 'soft' ? .42 : kit === '909' ? 1.2 : .9) * Math.exp(-t / (kit === '808' ? .085 : .055))
        + (.55 * Math.sin(TAU * 185 * pitchRatio * t) + .25 * Math.sin(TAU * 331 * pitchRatio * t)) * Math.exp(-t / .035));
      if (event.profile === 'gated_snare') {
        const gated = t < .16 ? (white - low) * Math.min(1, (.16 - t) / .015) * .22 : 0;
        sample += gated;
      }
    } else if (event.voice === 'hat') {
      const white = rng() * 2 - 1;
      low += Math.min(.85, 7000 * pitchRatio / sr) * (white - low);
      const metal = .12 * Math.sin(TAU * Math.min(sr * .45, 4100 * pitchRatio) * t)
        + .08 * Math.sin(TAU * Math.min(sr * .45, 5780 * pitchRatio) * t);
      sample = (kit === 'soft' ? .1 : .16) * (white - low + metal * (kit === '909' ? 2 : 1)) * Math.exp(-t / (kit === '808' ? .014 : kit === '909' ? .035 : .02));
    } else if (event.voice === 'tom') {
      phase += (base + 95 * Math.exp(-t / .012)) / sr;
      sample = .42 * Math.sin(TAU * phase) * Math.exp(-t / .065);
    } else if (event.voice === 'bass') {
      const f = event.glide ? event.fromFrequency ? base*(event.fromFrequency/originalBase)**(1-((x)=>x*x*(3-2*x))(clamp(t/.12,0,1))) : glideFrequency(event.fromNote, event.note, t)*(base/originalBase) : base;
      const profile = event.profile;
      if (designedBass) {
        phase += f / sr;
        phase2 += f * (analogBass ? 1.008 : 2.014) / sr;
        const absolute = event.time + t;
        const moving = event.motion !== 'none';
        const wobble = moving && event.motion === 'wobble'
          ? .5 - .5 * Math.cos(TAU * absolute / ((event.beatSeconds ?? .43) * (event.wobbleBeats ?? 1)))
          : moving ? .5 + .5 * Math.sin(TAU * absolute * .13) : .55;
        if (analogBass) {
          const raw = .52 * saw(phase * 2, f * 2 / sr) + .48 * saw(phase2 * 2, f * 2.016 / sr);
          const distorted = profile === 'dark_distorted_bass';
          const body = distorted ? Math.tanh((event.drive ?? 5) * raw) : raw;
          const cutoff = distorted ? 280 + 1000 * wobble : 140 + 440 * wobble;
          const filtered = filter.process(body, cutoff, distorted ? .9 : .707);
          sample = .66 * Math.sin(TAU * phase) + (distorted ? .65 : .48) * filtered;
        } else {
          const carrier = Math.sin(TAU * phase * (profile === 'metallic_reese' ? 3 : 2)
            + (2.5 + wobble * 6) * Math.sin(TAU * phase * (profile === 'metallic_reese' ? Math.SQRT2 : 1.5)));
          const reese = .5 * (saw(phase * 2, f * 2 / sr) + saw(phase2, f * 2.014 / sr));
          const mid = profile === 'reese_bass' ? reese : .72 * carrier + .28 * reese;
          const driven = Math.tanh((event.drive ?? 4) * mid);
          const cutoff = profile === 'growl_bass' ? 160 * 17 ** wobble : 330 * 7 ** wobble;
          const filtered = filter.process(driven, cutoff, profile === 'growl_bass' ? 1.65 : 1.1);
          const grit = Math.tanh((.35 * filtered + .8 * filter.band) * 1.8);
          // A clean fundamental stays separate from the distorted moving mid band.
          sample = .64 * Math.sin(TAU * phase) + .58 * grit * (profile === 'growl_bass' ? .3 + .7 * wobble : .85);
        }
      } else if (profile === 'fm_log_drum') {
        phase += f * (1 + 2.8 * Math.exp(-t / .012)) / sr;
        sample = Math.sin(TAU * phase + 5.5 * Math.exp(-t / .065) * Math.sin(TAU * phase * 2.002)) * Math.exp(-t / .19);
      } else if (profile === 'sub_surdo') {
        phase += f * (1 + .6 * Math.exp(-t / .025)) / sr;
        sample = Math.sin(TAU * phase) * Math.exp(-t / .17);
      } else {
        phase += f / sr;
        const sine = Math.sin(TAU * phase);
        if (profile === 'saturated_808' || profile === 'punchy_808') sample = Math.tanh(2.5 * sine) / Math.tanh(2.5);
        else if (profile === 'rolling_saw') sample = .7 * sine + .3 * saw(phase, f / sr);
        else if (profile === 'analog_octave') sample = .65 * sine + .35 * filter.process(saw(phase, f / sr), 1100 * Math.exp(-t / .15) + 180);
        else if (profile === 'chebyshev_sub') sample = .75 * sine + .25 * (4 * sine ** 3 - 3 * sine);
        else if (profile === 'pluck_bass') sample = .83 * sine + .17 * Math.sin(TAU * phase * 2) * Math.exp(-t / .04);
        else sample = sine + .08 * Math.sin(TAU * phase * 2);
        sample *= Math.exp(-t / (event.duration * .8));
      }
      sample *= designedBass ? .67 : .48;
    } else if (event.voice === 'lead' || event.voice === 'arp') {
      const vibrato = event.voice === 'lead' ? 1 + .0025 * Math.sin(TAU * 5.1 * t) : 1;
      phase += base * vibrato / sr;
      phase2 += base * 1.002 / sr;
      const pulsePhase = phase - Math.floor(phase);
      const shifted = (pulsePhase + .55) % 1;
      const pulse = (pulsePhase < .45 ? 1 : -1) + polyBlep(pulsePhase, base / sr) - polyBlep(shifted, base / sr);
      const raw = .65 * saw(phase, base / sr) + .35 * pulse;
      if (event.voice === 'lead') sample = .25 * filter.process(raw, 1800 + 2600 * Math.exp(-t / .3), .8);
      else sample = .16 * filter.process(raw, 2500 * Math.exp(-t / .05) + 400) * Math.exp(-t / .085);
    } else if (event.voice === 'keys') {
      phase += base / sr;
      phase2 += base * (widePad ? 1.007 : 1.004) / sr;
      if (pad) {
        const raw = (saw(phase, base / sr) + saw(phase2, base * (widePad ? 1.007 : 1.004) / sr)) * .5;
        const cutoff = widePad ? 180 + 420 * (.5 + .5 * Math.sin(TAU * (event.time + t) * .07)) : event.profile === 'dark_pad' ? 450 + 300 * (.5 + .5 * Math.sin(TAU * (event.time + t) * .09)) : 1800;
        sample = filter.process(raw, cutoff, .7) * .75;
      } else if (event.profile === 'brass_stabs' || event.profile === 'synth_stabs') {
        sample = Math.tanh(1.7 * saw(phase, base / sr)) * Math.exp(-t / .14);
      } else if (event.profile === 'micro_chops') {
        // Resample short slices of our own FM voice; no external recording.
        const at = (chopOffset + t * sr * base / midiHz(60)) % chop.length;
        const a = Math.floor(at), fraction = at - a;
        sample = (chop[a] * (1 - fraction) + chop[(a + 1) % chop.length] * fraction) * Math.exp(-t / .05);
      } else {
        const bell = event.profile === 'dark_bells' || event.profile === 'fm_plucks';
        const ratio = bell ? 3.5 : 2;
        const index = (bell ? 3 : 2.2) * Math.exp(-t / (bell ? .13 : .07));
        sample = Math.sin(TAU * phase + index * Math.sin(TAU * phase * ratio)) * Math.exp(-t / (bell ? .32 : .25));
        sample += .14 * Math.sin(TAU * phase * 2) * Math.exp(-t / .06);
      }
      low += brightness * (sample - low);
      sample = low * (pad ? .34 : .27);
    }
    if (event.drumDrive > 1) sample = Math.tanh(event.drumDrive * sample);
    if(!instrument){if(timbreBody)sample=timbreBody(sample);if(timbreFilter)sample=timbreFilter(sample,(event.cutoff??1500)*2**clamp(mods?.cutoff??0,-4,4),event.resonance??.2);sample*=adsr(t,event.duration,event.envelope)*clamp(1+(mods?.gain??0),0,4);}
    if (staticRng) {
      const noise = .055 * (staticRng() * 2 - 1);
      sample += noise;
      if (stereo !== null) stereo += noise;
    }
    sample *= event.velocity * envelope;
    if (event.voice === 'bass') bass[start + i] += sample;
    else { const moving=instrument?.pan??mods?.pan??0, l=moving?Math.cos((clamp(pan+moving,-1,1)+1)*Math.PI/4):lg, r=moving?Math.sin((clamp(pan+moving,-1,1)+1)*Math.PI/4):rg; left[start + i] += sample * l; right[start + i] += (stereo === null ? sample : stereo * event.velocity * envelope) * r; }
  }
}

export function applyAutomation(left, right, automation, stepSeconds, sr, config) {
  const length = left.length;
  const frameAt = (step) => clamp(Math.round((config ? timeAtStep(config, step) : step * stepSeconds) * sr), 0, length);
  // Stutters are real buffer slices after effects, with a short edge ramp.
  for (const a of automation.filter((x) => x.type === 'stutter')) {
    const start = frameAt(a.startStep), end = frameAt(a.endStep);
    const size = Math.max(2, Math.round(a.sliceSteps * stepSeconds * sr));
    const from = Math.max(0, start - size);
    const ls = left.slice(from, start), rs = right.slice(from, start);
    if (!ls.length) continue;
    const ramp = Math.max(1, Math.min(Math.round(.001 * sr), ls.length / 8));
    for (let i = start; i < end; i++) {
      const at = (i - start) % ls.length;
      const gain = Math.min(1, at / ramp, (ls.length - 1 - at) / ramp);
      left[i] = ls[at] * gain; right[i] = rs[at] * gain;
    }
  }
  for (const a of automation.filter((x) => x.type === 'brake')) {
    const start = frameAt(a.startStep), end = frameAt(a.endStep);
    const ls = left.slice(start, end), rs = right.slice(start, end);
    let position = 0;
    for (let i = start; i < end; i++) {
      const u = (i - start) / Math.max(1, end - start - 1);
      const at = Math.min(ls.length - 2, Math.floor(position)), mix = position - Math.floor(position);
      if (at >= 0) {
        left[i] = ls[at] * (1 - mix) + ls[at + 1] * mix;
        right[i] = rs[at] * (1 - mix) + rs[at + 1] * mix;
      }
      position += (1 - u) ** 2;
    }
  }
  // Air pockets mute the entire mix, including delay/reverb and sustained notes.
  for (const a of automation.filter((x) => x.type === 'air')) {
    left.fill(0, frameAt(a.startStep), frameAt(a.endStep));
    right.fill(0, frameAt(a.startStep), frameAt(a.endStep));
  }
}

export function renderAudio(score, options = {}) {
  const sr = options.sampleRate ?? 44100;
  if (!Number.isInteger(sr) || sr < 8000 || sr > 96000) throw new Error('Sample rate must be an integer from 8000 to 96000.');
  const { config } = score;
  const frames = Math.round(config.duration * sr);
  const left = new Float32Array(frames), right = new Float32Array(frames), bass = new Float32Array(frames);
  const chop = chopSource(sr);
  const allowedVoices = new Set([...(score.parts ?? []).map((p) => p.name), 'fx','kick', 'snare', 'hat', 'tom', 'keys', 'lead', 'arp', 'bass', 'vocals', ...PERCUSSION_VOICES]);
  if (options.voices && (!Array.isArray(options.voices) || options.voices.some((v) => !allowedVoices.has(v)))) throw new Error('Unknown stem voice.');
  const selected = options.voices ? new Set(options.voices) : null;
  const events = [...Object.values(score.drums).flat(), ...score.keys, ...score.bass, ...(score.lead ?? []), ...(score.arp ?? []), ...(score.parts ?? []).flatMap((p) => p.events)]
    .filter((event) => !selected || selected.has(event.part ?? event.voice))
    .sort((a, b) => a.time - b.time || a.voice.localeCompare(b.voice, 'en') || (a.note ?? 0) - (b.note ?? 0));
  const sendLeft = new Float32Array(frames), sendRight = new Float32Array(frames);
  const detector = new Float32Array(frames);
  for (const kick of score.drums.kick) {
    const start = Math.round(kick.time * sr), end = Math.min(frames, start + Math.round(sr * .5));
    for (let i = Math.max(0, start); i < end; i++) detector[i] = Math.max(detector[i], Math.exp(-(i - start) / (sr * .055)));
  }
  const baseEvents = events.filter((e) => !e.part);
  const buses = options.raw ? {} : config.production?.buses ?? {};
  const busName = (event) => event.voice === 'keys' ? 'harmony' : ['lead','arp','bass'].includes(event.voice) ? event.voice : 'drums';
  if (!Object.keys(buses).length) {
    for (const event of baseEvents) renderVoice(event, left, right, bass, sr, random(config.seed, `voice:${event.voice}:${event.time}:${event.note ?? 0}`), chop);
  } else {
    for (const name of ['drums','bass','harmony','lead','arp']) {
      const l = new Float32Array(frames), r = l.slice(), b = l.slice();
      for (const event of baseEvents.filter((e) => busName(e) === name)) renderVoice(event, l, r, b, sr, random(config.seed, `voice:${event.voice}:${event.time}:${event.note ?? 0}`), chop);
      if (name === 'bass') for (let i = 0; i < frames; i++) l[i] = r[i] = b[i];
      if (buses[name]) { processBus(l, r, sr, buses[name], detector); reverbBuffer(l, r, sr, buses[name], options.impulseResponse); }
      for (let i = 0; i < frames; i++) { if (name === 'bass') bass[i] += (l[i] + r[i]) * .5; else { left[i] += l[i]; right[i] += r[i]; } }
    }
  }
  if(!options.raw&&config.timbre?.sympathetic){sympatheticBody(left,right,sr,baseEvents.filter(e=>e.voice!=='bass'),config.timbre);const sub=bass.slice();sympatheticBody(bass,sub,sr,baseEvents.filter(e=>e.voice==='bass'),config.timbre);}
  sendLeft.set(left); sendRight.set(right);
  for (const part of score.parts ?? []) {
    if (selected && !selected.has(part.name)) continue;
    const l = new Float32Array(frames), r = new Float32Array(frames), b = new Float32Array(frames);
    for (const event of part.events) renderVoice(event, l, r, b, sr, random(config.seed, `part:${part.name}:${event.time}:${event.note ?? 0}`), chop);
    for (let i = 0; i < frames; i++) { l[i] += b[i]; r[i] += b[i]; }
    if (!options.raw) sympatheticBody(l,r,sr,part.events,part);
    if (!options.raw) { processBus(l, r, sr, part.mix, detector); reverbBuffer(l, r, sr, part.mix, options.impulseResponse); }
    if (part.role === 'bass') for (let i = 0; i < frames; i++) { const g = 1 - (1 - 10 ** (score.sidechain.duckDb / 20)) * detector[i]; l[i] *= g; r[i] *= g; }
    for (let i = 0; i < frames; i++) { left[i] += l[i]; right[i] += r[i]; sendLeft[i] += l[i] * part.send; sendRight[i] += r[i] * part.send; }
  }
  if (config.production?.preset === 'rumble') {
    sendLeft.fill(0); sendRight.fill(0); const ignored = new Float32Array(frames);
    for (const event of baseEvents.filter((e) => e.voice === 'kick')) renderVoice(event, sendLeft, sendRight, ignored, sr, random(config.seed, `voice:${event.voice}:${event.time}:0`), chop);
  }
  const kicks = score.drums.kick.map((e) => Math.round(e.time * sr)).sort((a, b) => a - b);
  let nextKick = 0, latestKick = -Infinity;
  // Short stereo feedback delays provide space without an impulse-response file.
  const delayL = new Float32Array(Math.round(sr * config.stepSeconds * 3));
  const delayR = new Float32Array(Math.round(sr * config.stepSeconds * 4.03));
  let dl = 0, dr = 0, filterL = 0, filterR = 0;
  let lastL = 0, lastR = 0, dcL = 0, dcR = 0;
  const dcPole = Math.exp(-TAU * 18 / sr);
  const feedback = config.production?.delayFeedback ?? config.soundDesign?.delayFeedback ?? .3;
  const wet = options.raw || config.production?.preset === 'dry' ? 0 : config.production?.delayWet ?? config.soundDesign?.delayWet ?? (config.intent === 'drill_sliding' ? .09 : config.intent === 'lofi_chill' ? .12 : .15);
  for (let i = 0; i < frames; i++) {
    while (nextKick < kicks.length && kicks[nextKick] <= i) latestKick = kicks[nextKick++];
    const duck = duckingGain((i - latestKick) / sr, score.sidechain.duckDb, score.sidechain.tauSeconds);
    const sub = bass[i] * duck;
    const dryL = left[i], dryR = right[i];
    filterL += .22 * (delayL[dl] - filterL); filterR += .22 * (delayR[dr] - filterR);
    delayL[dl] = dryR * .22 + filterL * feedback;
    delayR[dr] = dryL * .22 + filterR * feedback;
    dl = (dl + 1) % delayL.length; dr = (dr + 1) % delayR.length;
    const xL = options.raw ? dryL + sub : Math.tanh(dryL + sub + filterL * wet), xR = options.raw ? dryR + sub : Math.tanh(dryR + sub + filterR * wet);
    dcL = xL - lastL + dcPole * dcL; dcR = xR - lastR + dcPole * dcR;
    lastL = xL; lastR = xR;
    left[i] = dcL; right[i] = dcR;
  }
  if (!selected || selected.has('vocals')) {
    if (buses.vocals) { const l = new Float32Array(frames), r = l.slice(); mixVocals(score.vocals, options.vocalSamples, l, r, sr); processBus(l, r, sr, buses.vocals, detector); reverbBuffer(l, r, sr, buses.vocals, options.impulseResponse); for (let i = 0; i < frames; i++) { left[i] += l[i]; right[i] += r[i]; } }
    else mixVocals(score.vocals, options.vocalSamples, left, right, sr);
  }
  if (!options.raw && config.production) {
    const sourceL = sendLeft.slice(), sourceR = sendRight.slice();
    reverbBuffer(sendLeft, sendRight, sr, config.production, options.impulseResponse);
    const rumbleL = new StateVariableFilter(sr), rumbleR = new StateVariableFilter(sr);
    for (let i = 0; i < frames; i++) {
      let l = sendLeft[i] - sourceL[i], r = sendRight[i] - sourceR[i];
      if (config.production.preset === 'rumble') { l = rumbleL.process(l, 210) * (1 - .9 * detector[i]) * 2; r = rumbleR.process(r, 210) * (1 - .9 * detector[i]) * 2; }
      left[i] += l; right[i] += r;
    }
    processBus(left, right, sr, config.production, detector);
    if (config.production.limiter) { const gains = limiterGains(left, right, sr); for (let i = 0; i < frames; i++) { left[i] *= gains[i]; right[i] *= gains[i]; } }
  }
  applyAutomation(left, right, score.automation, config.stepSeconds, sr, config);
  let peak = 0, energy = 0;
  for (let i = 0; i < frames; i++) {
    const fade = Math.min(1, i / (sr * .005), (frames - 1 - i) / (sr * .025));
    left[i] *= fade; right[i] *= fade;
    peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
  }
  // Roughly 2 dB sample headroom limits overshoot introduced by MP3 encoding.
  const gain = options.gain ?? (options.normalize === false ? 1 : peak ? Math.min(config.production?.limiter ? 1 : 2, .8 / peak) : 1);
  const pcm = Buffer.alloc(frames * 4);
  let quantizedPeak = 0;
  for (let i = 0; i < frames; i++) {
    const l = Math.round(clamp(left[i] * gain, -1, 1) * 32767);
    const r = Math.round(clamp(right[i] * gain, -1, 1) * 32767);
    pcm.writeInt16LE(l, i * 4); pcm.writeInt16LE(r, i * 4 + 2);
    energy += (l * l + r * r) / (32767 ** 2);
    quantizedPeak = Math.max(quantizedPeak, Math.abs(l), Math.abs(r));
  }
  return { pcm, sampleRate: sr, channels: 2, frames, gain, ...(options.returnFloat ? { left, right } : {}),
    stats: { peak: quantizedPeak / 32767, rms: Math.sqrt(energy / (frames * 2)), duration: frames / sr } };
}

export function packWav(audio) {
  const { pcm, sampleRate, channels } = audio;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0); header.writeUInt32LE(36 + pcm.length, 4); header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24); header.writeUInt32LE(sampleRate * channels * 2, 28);
  header.writeUInt16LE(channels * 2, 32); header.writeUInt16LE(16, 34);
  header.write('data', 36); header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}


// Sample-accurate preview from rendered PCM, with short fades at its new edges.
export function sliceAudio(audio, startSeconds, durationSeconds) {
  if (!Number.isFinite(startSeconds) || startSeconds < 0 || !Number.isFinite(durationSeconds) || durationSeconds <= 0) throw new Error('Invalid preview bounds.');
  const start = Math.round(startSeconds * audio.sampleRate);
  const frames = Math.min(audio.frames - start, Math.round(durationSeconds * audio.sampleRate));
  if (frames <= 0) throw new Error('Preview starts beyond the rendered audio.');
  const pcm = Buffer.from(audio.pcm.subarray(start * 4, (start + frames) * 4));
  let energy = 0, peak = 0;
  for (let i = 0; i < frames; i++) {
    const gain = Math.min(1, i / (audio.sampleRate * .005), (frames - 1 - i) / (audio.sampleRate * .015));
    for (let channel = 0; channel < 2; channel++) {
      const at = i * 4 + channel * 2;
      const value = Math.round(pcm.readInt16LE(at) * gain);
      pcm.writeInt16LE(value, at);
      energy += (value / 32767) ** 2;
      peak = Math.max(peak, Math.abs(value) / 32767);
    }
  }
  return { ...audio, pcm, frames, stats: { peak, rms: Math.sqrt(energy / (frames * 2)), duration: frames / audio.sampleRate } };
}

function audioFromFloat(left, right, sampleRate, gain) {
  const pcm = Buffer.alloc(left.length * 4); let peak = 0, energy = 0;
  for (let i = 0; i < left.length; i++) {
    for (let side = 0; side < 2; side++) {
      const n = Math.round(clamp((side ? right[i] : left[i]) * gain, -1, 1) * 32767);
      pcm.writeInt16LE(n, i * 4 + side * 2); peak = Math.max(peak, Math.abs(n) / 32767); energy += (n / 32767) ** 2;
    }
  }
  return { pcm, sampleRate, channels: 2, frames: left.length, gain, stats: { peak, rms: Math.sqrt(energy / Math.max(1, left.length * 2)), duration: left.length / sampleRate } };
}
// FX includes shared returns and the exact nonlinear master residual. Measure
// every component before choosing ONE gain, so even cancelling stems don't clip.
// Two passes keep peak memory independent of the number of parts.
export function renderStems(score, options = {}) {
  const full = renderAudio(score, { ...options, voices: undefined, normalize: false, returnFloat: true });
  const names = [...new Set([...Object.keys(score.drums), 'keys', 'bass', 'lead', 'arp', ...(score.vocals ? ['vocals'] : []), ...(score.parts ?? []).map((p) => p.name)])];
  const fxL = full.left.slice(), fxR = full.right.slice(); let maximum = 0;
  for (let i = 0; i < full.frames; i++) maximum = Math.max(maximum, Math.abs(full.left[i]), Math.abs(full.right[i]));
  for (const name of names) {
    const audio = renderAudio(score, { ...options, voices: [name], raw: true, normalize: false, returnFloat: true });
    for (let i = 0; i < full.frames; i++) { fxL[i] -= audio.left[i]; fxR[i] -= audio.right[i]; maximum = Math.max(maximum, Math.abs(audio.left[i]), Math.abs(audio.right[i])); }
  }
  for (let i = 0; i < full.frames; i++) maximum = Math.max(maximum, Math.abs(fxL[i]), Math.abs(fxR[i]));
  const gain = maximum ? Math.min(2, .8 / maximum) : 1, stems = {};
  const mix = audioFromFloat(full.left, full.right, full.sampleRate, gain);
  for (const name of names) stems[name] = renderAudio(score, { ...options, voices: [name], raw: true, gain });
  stems.fx = audioFromFloat(fxL, fxR, full.sampleRate, gain);
  return { mix, stems, note: 'FX includes shared returns and nonlinear master residual; keep every stem at unity for reconstruction. The shared headroom may make this mix quieter than a solo render.' };
}
