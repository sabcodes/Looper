import { SYNTH_PROFILES, synthVoice } from './synthesis.js';
import { PHYSICAL_PROFILES, physicalVoice } from './physical.js';
import { StateVariableFilter } from './filter.js';
import { midiHz, clamp, eventFrequency } from './random.js';
import { ACOUSTIC_PROFILES, acousticVoice, stringModes } from './acoustics.js';
import { validateTimbre, modulationState, adsr, filterVoice, bodyResonator } from './timbre.js';

// Each profile has one synthesis path shared by harmony, melody, arpeggio and bass.
export const INSTRUMENTS = {
  ...SYNTH_PROFILES, ...PHYSICAL_PROFILES, ...ACOUSTIC_PROFILES,
  organ: { names: 'organ|hammond(?: organ)?', role: 'harmony' },
  clavinet: { names: 'clavinet|clavi', role: 'harmony' },
  marimba: { names: 'marimba', role: 'harmony' },
  kalimba: { names: 'kalimba|thumb piano', role: 'harmony' },
  steelpan: { names: 'steelpan|steel pan', role: 'harmony' },
  acid_bass: { names: 'acid bass|303 bass', role: 'bass' },
  fm_bass: { names: 'fm bass', role: 'bass' },
  electric_bass: { names: 'electric bass(?: guitar)?|plucked bass guitar|bass guitar', role: 'bass' },
  cowbell_melody: { names: 'melodic cowbell|cowbell lead', role: 'lead' },
  acoustic_piano: { names: 'acoustic piano|grand piano', role: 'harmony' },
  acoustic_guitar: { names: 'acoustic guitar|guitar', role: 'harmony' },
  upright_bass: { names: 'upright bass|double bass', role: 'bass' },
  banjo: { names: 'banjo', role: 'arp' },
  harp: { names: 'harp', role: 'harmony' },
  vibraphone: { names: 'vibraphone|vibes', role: 'harmony' },
  bowed_strings: { names: 'bowed strings|strings|string ensemble', role: 'harmony' },
  cello: { names: 'cello', role: 'lead' },
  fiddle: { names: 'fiddle|violin', role: 'lead' },
  flute: { names: 'flute', role: 'lead' },
  saxophone: { names: 'saxophone|sax', role: 'lead' },
  pedal_steel: { names: 'pedal steel|steel guitar', role: 'lead' },
};
export const PERCUSSION_NAMES = {
  clap: 'claps?', rim: 'rimshots?|rims?|sidesticks?', open_hat: 'open hats?', shaker: 'shakers?',
  conga: 'congas?', ride: 'ride(?: cymbals?)?', tambourine: 'tambourines?', bongo: 'bongos?',
  claves: 'claves?', woodblock: 'woodblocks?', cowbell: 'cowbells?', agogo: 'agogos?', crash: 'crash(?: cymbals?)?', tom: 'toms?',
};
export const PERCUSSION_VOICES = Object.keys(PERCUSSION_NAMES).filter((voice) => voice !== 'tom');
const TAU = Math.PI * 2;
const steelAttacks = {
  pickup: { delay: .01, bend: .10, swell: .045 },
  reply: { delay: .06, bend: .24, swell: .13 },
  sustain: { delay: .07, bend: .32, swell: .22 },
};

// Return a sample generator, or null to use an existing voice in dsp.js.
function rawInstrumentVoice(event, sr, rng) {
  if(event.partials && !Object.hasOwn(SYNTH_PROFILES,event.profile))return synthVoice({...event,profile:'additive'},sr,rng);
  const positioned = ['pluckPosition','pickupPosition','bowPosition','hammerWidth','hardness','stiffness'].some(k=>event[k]!==undefined);
  if (positioned && ['acoustic_guitar','electric_guitar','twelve_string','mandolin','ukulele','sitar','upright_bass','electric_bass','banjo','harp','clavinet','acoustic_piano','bowed_strings','cello','fiddle'].includes(event.profile)) return stringModes(event,sr,rng,{family:['bowed_strings','cello','fiddle'].includes(event.profile)?'bow':event.profile==='acoustic_piano'?'struck':'string',pluck:event.bowPosition??event.pluckPosition});
  const extended = synthVoice(event, sr, rng) ?? physicalVoice(event, sr, rng) ?? acousticVoice(event,sr,rng);
  if (extended) return extended;
  const profile = event.profile ?? event.voice;
  const f = (event.frequency ?? midiHz(event.note ?? 60)) * 2 ** ((event.pitch ?? 0) / 12);
  const noise = () => rng() * 2 - 1;
  if (['acoustic_guitar', 'upright_bass', 'banjo', 'harp', 'electric_bass', 'clavinet'].includes(profile) || event.articulation === 'pizzicato' && ['bowed_strings', 'cello', 'fiddle'].includes(profile)) {
    // Fractional-delay Karplus–Strong: the averaging filter contributes half a sample.
    const delay = Math.max(2, sr / f - .5), fromF = Number.isFinite(event.fromNote) ? (event.fromFrequency ?? midiHz(event.fromNote)) : f;
    const length = Math.ceil(Math.max(delay, event.articulation === 'slide' ? sr / Math.min(f, fromF) : delay)) + 2;
    const line = Float64Array.from({ length }, noise);
    const mean = line.reduce((sum, x) => sum + x, 0) / length;
    for (let i = 0; i < length; i++) line[i] -= mean;
    let at = 0, previous = 0, bodyPhase = 0;
    const decay = ['muted', 'palm_mute', 'pizzicato'].includes(event.articulation) ? .18 : profile === 'clavinet' ? .28 : profile === 'electric_bass' ? .8 : profile === 'banjo' ? .45 : profile === 'upright_bass' ? 1.3 : profile === 'harp' ? 3.4 : 1.8;
    const feedback = Math.exp(-1 / (f * decay));
    const uprightBass = profile === 'upright_bass';
    const bassFilter = uprightBass || profile === 'electric_bass' ? new StateVariableFilter(sr) : null;
    const bassCutoff = uprightBass ? 350 : 420;
    const pluckCutoff = uprightBass ? 600 : 760;
    return (t) => {
      const slide = event.articulation === 'slide' ? (event.fromFrequency ? event.fromFrequency/f : 2**(((event.fromNote??event.note)-event.note)/12))**Math.max(0,1-t/.12) : 1;
      const currentDelay = event.articulation === 'slide' ? Math.max(2, sr / (f * slide) - .5) : delay;
      const read = (at - currentDelay + length) % length, i = Math.floor(read), mix = read - i;
      const sample = line[i] * (1 - mix) + line[(i + 1) % length] * mix;
      line[at] = feedback * (sample + previous) * .5;
      previous = sample; at = (at + 1) % length;
      // ponytail: a simple resonant body, not a calibrated acoustic body model.
      bodyPhase += f * slide / sr;
      const body = Math.sin(TAU * bodyPhase) * Math.exp(-t / decay);
      const slap = event.articulation === 'slap' ? .15 * noise() * Math.exp(-t / .012) + .08 * Math.sin(TAU * f * 4 * t) * Math.exp(-t / .04) : 0;
      // Keep some pluck at the attack, then roll off the string's bright buzz.
      const picked = bassFilter ? bassFilter.process(sample, bassCutoff + pluckCutoff * Math.exp(-t / .014), .65) : sample;
      return slap + (profile === 'clavinet' ? .35 * Math.tanh(2.5 * picked) : .55 * picked) + (profile === 'upright_bass' ? .28 : profile === 'electric_bass' ? .18 : .07) * body;
    };
  }
  if (['acoustic_piano', 'vibraphone', 'marimba', 'kalimba', 'steelpan'].includes(profile)) {
    const piano = profile === 'acoustic_piano';
    const ratios = piano ? [1, 2, 3, 4, 5, 6, 7, 8] : profile === 'marimba' ? [1, 3.99, 10.65] : profile === 'kalimba' ? [1, 2.75, 5.4] : profile === 'steelpan' ? [1, 2, 2.99, 4.1] : [1, 4, 10];
    const partials = ratios.map((ratio, i) => {
      const frequency = f * ratio * (piano ? Math.sqrt((1 + .00012 * ratio * ratio) / 1.00012) : 1);
      return { frequency, amplitude: (piano ? 1 / ratio ** 1.35 : [1, .3, .1, .08][i]),
        decay: (piano ? 1.9 : profile === 'marimba' ? .65 : profile === 'kalimba' ? 1.1 : profile === 'steelpan' ? 1.8 : 2.8) / (1 + i * .65) };
    }).filter((p) => p.frequency < sr * .45);
    return (t) => .4 * partials.reduce((sum, p) => sum + p.amplitude * Math.sin(TAU * p.frequency * t) * Math.exp(-t / (p.decay * (event.pedal ? 1.7 : 1))), 0) + (piano && event.pedal ? .025 * Math.sin(TAU * f * 2.002 * t) * Math.exp(-t / 3) : 0)
      * (profile === 'vibraphone' ? .85 + .15 * Math.sin(TAU * 5 * t) : 1);
  }
  if (profile === 'organ') {
    const drawbars = [[.5, .19], [1, .72], [2, .24], [3, .085], [4, .045], [6, .018]].filter(([h]) => h * f < sr * .44);
    return (t) => .25 * drawbars.reduce((sum, [h, gain]) => sum + gain * Math.sin(TAU * f * h * t), 0)
      + .035 * noise() * Math.exp(-t / .006);
  }
  if (profile === 'fm_bass') return (t) => .38 * Math.sin(TAU * f * t + 3.2 * Math.exp(-t / .13) * Math.sin(TAU * f * 2 * t)) * Math.exp(-t / .7);
  if (profile === 'acid_bass') {
    const filter = new StateVariableFilter(sr);
    const harmonics = Array.from({ length: Math.min(32, Math.floor(sr * .43 / f)) }, (_, i) => i + 1);
    let phase = 0;
    return (t) => {
      const slide = event.glide && Number.isFinite(event.fromNote) ? (event.fromFrequency ? event.fromFrequency/f : 2**((event.fromNote-event.note)/12))**Math.max(0,1-t/.08) : 1;
      phase += f * slide / sr;
      const saw = harmonics.reduce((sum, h) => sum - Math.sin(TAU * phase * h) / h, 0) * .6;
      return .5 * filter.process(Math.tanh(saw * 1.8), 160 + 2600 * Math.exp(-t / .11), 2) * Math.exp(-t / .9);
    };
  }
  if (profile === 'cowbell_melody') return (t) => .28 * (Math.sin(TAU * f * t) + .5 * Math.sin(TAU * f * 1.48 * t)) * Math.exp(-t / .12);
  if (['bowed_strings', 'cello', 'fiddle', 'flute', 'saxophone', 'pedal_steel'].includes(profile)) {
    const bowed = ['bowed_strings', 'cello', 'fiddle'].includes(profile);
    const bowSlope = profile === 'cello' ? 1.65 : profile === 'fiddle' ? 1.1 : 1.3;
    let phase = 0, breath = 0, bowAt = 0;
    const bowLine = new Float64Array(Math.max(3, Math.round(sr / f))), pressure = event.pressure ?? .6;
    const harmonics = Array.from({ length: bowed ? 12 : profile === 'saxophone' ? 10 : 5 }, (_, i) => i + 1)
      .filter((h) => f * h < sr * .43);
    const steel = profile === 'pedal_steel' && typeof event.steel === 'string' && Object.hasOwn(steelAttacks, event.steel)
      ? steelAttacks[event.steel] : null;
    const fromRatio = profile === 'pedal_steel' && Number.isFinite(event.fromNote)
      ? event.fromFrequency ? event.fromFrequency / f : 2 ** ((event.fromNote - event.note) / 12) : 1;
    const delay = steel ? Math.min(steel.delay, event.duration * .2) : 0;
    const bend = steel ? Math.min(steel.bend, event.duration * .5) : .16;
    const attack = steel ? Math.min(steel.swell, event.duration * .35)
      : event.articulation === 'legato' ? .015 : event.articulation === 'staccato' ? .012 : profile === 'cello' ? .16 : profile === 'fiddle' ? .07 : bowed ? .12 : .045;
    return (t) => {
      let glide = 1;
      if (fromRatio !== 1) {
        const progress = clamp((t - delay) / bend, 0, 1);
        glide = fromRatio ** (1 - (steel ? progress * progress * (3 - 2 * progress) : progress));
      }
      const vibrato = steel ? clamp((t - delay - bend) * 4, 0, 1) : Math.min(1, t * 4);
      phase += f * glide * (1 + (profile === 'cello' ? .0025 : bowed ? .0035 : .002) * Math.sin(TAU * 5.2 * t) * vibrato) / sr;
      const sample = harmonics.reduce((sum, h) => {
        const weight = profile === 'flute' ? 1 / h ** 3 : profile === 'pedal_steel' ? 1 / h ** 2
          : profile === 'saxophone' ? (h % 2 ? 1 : .6) / h ** 1.1 : 1 / h ** bowSlope;
        const ensemble = profile === 'bowed_strings' ? .5 * (Math.sin(TAU * phase * h) + Math.sin(TAU * phase * h * 1.003)) : Math.sin(TAU * phase * h);
        return sum + weight * ensemble;
      }, 0);
      let bow = 0;
      if (bowed) {
        const returning = bowLine[bowAt];
        const friction = Math.tanh((.12 + .02 * noise() - returning) * pressure * 6) * .035;
        bowLine[bowAt] = .97 * returning + friction; bowAt = (bowAt + 1) % bowLine.length;
        bow = (bowLine[bowAt] - returning) * .6;
      }
      breath += .2 * (noise() - breath);
      return .25 * (sample * (bowed ? .7 + pressure * .5 : 1) + bow + (profile === 'flute' || profile === 'saxophone' ? .06 : .018) * breath)
        * Math.min(1, t / attack);
    };
  }
  if (PERCUSSION_VOICES.includes(profile) || profile === 'brush') {
    let low = 0;
    return (t) => {
      const white = noise(); low += .18 * (white - low);
      const high = white - low;
      if (profile === 'clap') {
        const bursts = [0, .011, .023].reduce((sum, start) => sum + (t >= start ? Math.exp(-(t - start) / .008) : 0), 0);
        return high * (.3 * bursts + .15 * Math.exp(-t / .065));
      }
      if (profile === 'tambourine') return .18 * (high + Math.sin(TAU * Math.min(sr * .42, 6300) * t)) * Math.exp(-t / .11);
      if (profile === 'woodblock') return .4 * (Math.sin(TAU * 850 * t) + .4 * Math.sin(TAU * 1360 * t)) * Math.exp(-t / .025);
      if (profile === 'claves') return .5 * Math.sin(TAU * Math.min(sr * .42, 2600) * t) * Math.exp(-t / .009);
      if (profile === 'cowbell') return .25 * (Math.tanh(5 * Math.sin(TAU * 540 * t)) + .6 * Math.tanh(5 * Math.sin(TAU * 800 * t))) * Math.exp(-t / .09);
      if (profile === 'agogo') return .3 * (Math.sin(TAU * 830 * t) + .5 * Math.sin(TAU * 1660 * t) + .15 * Math.sin(TAU * 2410 * t)) * Math.exp(-t / .16);
      if (profile === 'bongo') return .45 * Math.sin(TAU * (event.note ? f : 290) * t - 1.3 * Math.exp(-t / .008)) * Math.exp(-t / .065) + .08 * high * Math.exp(-t / .005);
      if (profile === 'crash') return .19 * (high + .25 * Math.sin(TAU * Math.min(sr * .43, 5100) * t)) * Math.exp(-t / .65);
      if (profile === 'rim') return .45 * (Math.sin(TAU * 820 * t) + .6 * Math.sin(TAU * 1730 * t)) * Math.exp(-t / .012);
      if (profile === 'conga') return .5 * Math.sin(TAU * (event.note ? f : 180) * t - 2 * Math.exp(-t / .012)) * Math.exp(-t / .11) + .06 * high * Math.exp(-t / .008);
      if (profile === 'brush') return .18 * high * Math.exp(-t / .1);
      if (profile === 'shaker') return .22 * high * Math.sin(Math.PI * clamp(t / .07, 0, 1)) * Math.exp(-t / .035);
      const metal = [1, 1.342, 1.789, 2.137].reduce((sum, ratio) => sum + Math.sin(TAU * Math.min(sr * .43, (profile === 'ride' ? 2310 : 3500) * ratio) * t), 0) / 4;
      return .2 * (.6 * high + metal) * Math.exp(-t / (profile === 'ride' ? .24 : .14));
    };
  }
  return null;
}

// A common performance layer gives all named instruments the same modulation,
// envelope and filter controls. Stateful oscillators are resampled only when a
// pitch route is present; existing unconfigured voices retain their old path.
export function instrumentVoice(input,sr,rng) {
  const frequency = eventFrequency(input);
  if (frequency >= sr * .45) return () => 0;
  const controls=validateTimbre(input), event={...input,...controls};
  const raw=rawInstrumentVoice(event,sr,rng); if(!raw)return null;
  const needsFilter=event.filterModel||event.cutoff!==undefined||event.modulation?.some(m=>m.target==='cutoff');
  if(!event.envelope&&!event.modulation?.length&&!needsFilter&&!event.body)return raw;
  const modulate=modulationState(event,sr,rng),hasPitch=event.modulation?.some(m=>m.target==='pitch');
  const filter=needsFilter ? (!event.filterModel||event.filterModel==='svf') ? (()=>{const f=new StateVariableFilter(sr);return(x,hz,q)=>f.process(x,hz,.5+q*3);})() : filterVoice(sr,event.filterModel) : null;
  const physical=event.profile in ACOUSTIC_PROFILES || ['pluckPosition','pickupPosition','bowPosition','hammerWidth','hardness','stiffness'].some(k=>event[k]!==undefined);
  const body=event.body&&!physical?bodyResonator(sr,event):null;
  let cursor=0,sourceIndex=0,a,b;
  const sample=t=> {
    const mods=modulate(t);let value;
    if(hasPitch){if(a===undefined){a=raw(0);b=raw(1/sr);}cursor+=2**clamp(mods.pitch,-2,2);while(sourceIndex+1<=cursor){a=b;sourceIndex++;b=raw((sourceIndex+1)/sr);}const u=cursor-sourceIndex;value=a*(1-u)+b*u;}
    else value=raw(t);
    if(filter)value=filter(value,(event.cutoff??1500)*2**clamp(mods.cutoff,-4,4),event.resonance??.2);
    if(body)value=body(value);
    sample.pan=clamp(mods.pan,-1,1);
    return value*adsr(t,event.duration??1,event.envelope)*clamp(1+mods.gain,0,4);
  };
  return sample;
}
