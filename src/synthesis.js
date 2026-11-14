import { clamp, midiHz } from './random.js';
import { SOURCE_PROFILES, sourceVoice, grainVoice } from './sound-sources.js';
import { partialVoice, modulationState, adsr } from './timbre.js';
const TAU = Math.PI * 2;
export const SYNTH_PROFILES = {
  ...SOURCE_PROFILES,
  wavetable: { names: 'wavetable(?: synth)?', role: 'harmony' },
  supersaw: { names: 'supersaw|unison(?: synth)?', role: 'harmony' },
  fm_synth: { names: '(?:four operator |multi operator )?fm synth|pm synth', role: 'lead' },
  granular: { names: 'granular(?: synth)?', role: 'harmony' },
  spectral: { names: 'spectral(?: synth)?', role: 'harmony' },
  wavefold: { names: 'wavefold(?:ing)?(?: synth)?', role: 'lead' },
  phase_distortion: { names: 'phase distortion(?: synth)?', role: 'lead' },
  hard_sync: { names: 'hard sync(?: synth)?', role: 'lead' },
  pwm: { names: 'pwm(?: synth)?|pulse width(?: synth)?', role: 'harmony' },
  ring_mod: { names: 'ring mod(?:ulation)?(?: synth)?', role: 'lead' },
  formant: { names: 'formant(?: synth)?', role: 'harmony' },
  vocoder: { names: 'vocoder', role: 'harmony' },
};

// In-place radix-2 FFT. Shared by spectral resynthesis and partitioned convolution.
export function fft(real, imag, inverse = false) {
  const n = real.length;
  if (imag.length !== n || n < 2 || n > 1048576 || (n & (n - 1))) throw new Error('FFT length must be a power of two, 2–1048576.');
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [real[i], real[j]] = [real[j], real[i]]; [imag[i], imag[j]] = [imag[j], imag[i]]; }
  }
  for (let len = 2; len <= n; len *= 2) {
    const angle = (inverse ? TAU : -TAU) / len, wr = Math.cos(angle), wi = Math.sin(angle);
    for (let start = 0; start < n; start += len) {
      let ar = 1, ai = 0;
      for (let j = 0; j < len / 2; j++) {
        const a = start + j, b = a + len / 2;
        const tr = real[b] * ar - imag[b] * ai, ti = real[b] * ai + imag[b] * ar;
        real[b] = real[a] - tr; imag[b] = imag[a] - ti; real[a] += tr; imag[a] += ti;
        const next = ar * wr - ai * wi; ai = ar * wi + ai * wr; ar = next;
      }
    }
  }
  if (inverse) for (let i = 0; i < n; i++) { real[i] /= n; imag[i] /= n; }
}
const read = (buffer, phase) => {
  const x = ((phase % 1) + 1) % 1 * buffer.length, i = Math.floor(x), u = x - i;
  return buffer[i] * (1 - u) + buffer[(i + 1) % buffer.length] * u;
};
const tables = new Map();
function table(harmonics, weights, name) {
  const key = name + ':' + harmonics;
  if (tables.has(key)) return tables.get(key);
  const result = Float64Array.from({ length: 1024 }, (_, i) => {
    let sum = 0;
    for (let h = 1; h <= harmonics; h++) sum += weights(h) * Math.sin(TAU * h * i / 1024);
    return sum;
  });
  tables.set(key, result); return result;
}
function createSynthVoice(event, sr, rng) {
  const kind = event.profile;
  if (!Object.hasOwn(SYNTH_PROFILES, kind)) return null;
  const f = (event.frequency ?? midiHz(event.note ?? 60)) * 2 ** ((event.pitch ?? 0) / 12), limit = Math.max(1, Math.min(64, Math.floor(sr * .43 / f)));
  let phase = rng(), low = 0;
  const a = table(1, () => 1, 'sine'), b = table(limit, (h) => .6 / h, 'saw'), c = table(limit, (h) => h % 2 ? .8 / h : 0, 'square');
  const phases = Array.from({ length: 7 }, () => rng());
  const ratios = event.fmRatios ?? [1, 2, 3, 1], indices = event.fmIndices ?? [2.3, 1.2, .7];
  if (!Array.isArray(ratios) || ratios.length !== 4 || ratios.some((v) => !Number.isFinite(v) || v <= 0 || v > 16)
      || !Array.isArray(indices) || indices.length !== 3 || indices.some((v) => !Number.isFinite(v) || v < 0 || v > 12)) throw new Error('FM needs four ratios (0–16) and three indices (0–12).');
  const source = Float64Array.from({ length: 4096 }, (_, i) => .65 * read(b, i / 512) + .25 * Math.sin(TAU * i * i / 700000) + .1 * (rng() * 2 - 1));
  const custom = event.partials || kind === 'additive' ? partialVoice({...event,partials:event.partials ?? [1,2,3,4,5,6].map((ratio)=>({ratio,amplitude:1/ratio,phase:0,decay:2,targetAmplitude:1/ratio,targetRatio:ratio}))},sr,f) : sourceVoice(event,sr,rng,f);
  const granular = kind === 'granular' ? grainVoice(event,sr,rng,f,source) : null;
  const modulate = modulationState(event,sr,rng);
  let feedback = 0;
  // Spectral freeze: synthesize a periodic spectrum, then inverse-transform it.
  const spectrum = new Float64Array(1024), imaginary = new Float64Array(1024);
  if (kind === 'spectral') {
    for (let h = 1; h <= Math.min(limit, 511); h++) {
      const magnitude = Math.exp(-(((h - 5) / 5) ** 2)) / Math.sqrt(h), angle = rng() * TAU;
      spectrum[h] = spectrum[1024 - h] = magnitude * Math.cos(angle) * 128;
      imaginary[h] = magnitude * Math.sin(angle) * 128; imaginary[1024 - h] = -imaginary[h];
    }
    fft(spectrum, imaginary, true);
  }
  return (t) => {
    const mods = modulate(t);
    phase += f / sr;
    let sample;
    if (custom) sample = custom(t, {morph:mods.morph});
    else if (kind === 'wavetable') {
      const morph = clamp((event.spectrumMorph ?? (.5 + .5 * Math.sin(TAU * .37 * t))) + mods.morph,0,1);
      sample = read(a, phase) * (1 - morph) + read(b, phase) * morph;
    } else if (kind === 'supersaw') {
      sample = 0;
      for (let j = 0; j < 7; j++) { phases[j] += f * 2 ** ((j - 3) * (event.detune ?? 7) / 1200) / sr; sample += read(b, phases[j]) / 7; }
    } else if (kind === 'fm_synth') {
      const p = phase * TAU, decay = Math.exp(-t / .7), env = (i) => event.operatorEnvelopes ? adsr(t,event.duration??1,event.operatorEnvelopes[i]) : i===0?1:decay;
      const depth = clamp(1+mods.fm,0,5), op4 = Math.sin(p*ratios[3]+feedback*(event.fmFeedback??0))*env(3);
      feedback=op4;
      const op3=Math.sin(p*ratios[2]+indices[2]*op4*depth)*env(2),op2=Math.sin(p*ratios[1]+indices[1]*op3*depth)*env(1);
      const algorithm=event.fmAlgorithm??'serial';
      sample=algorithm==='parallel' ? (Math.sin(p*ratios[0])*env(0)+op2+op3+op4)*.25
        : algorithm==='pairs' ? (Math.sin(p*ratios[0]+indices[0]*Math.sin(p*ratios[1])*env(1)*depth)*env(0)+op3)*.5
        : algorithm==='branch' ? Math.sin(p*ratios[0]+indices[0]*(Math.sin(p*ratios[1])*env(1)+op3+op4)/3*depth)*env(0)
        : Math.sin(p*ratios[0]+indices[0]*op2*depth)*env(0);
    } else if (kind === 'granular') sample = granular(t);
    else if (kind === 'spectral') sample = read(spectrum, phase) * (.75 + .25 * Math.cos(TAU * .13 * t));
    else if (kind === 'wavefold') { const x = Math.sin(TAU * phase) * (1.5 + 2 * Math.exp(-t)); sample = 2 / Math.PI * Math.asin(Math.sin(Math.PI * x / 2)); }
    else if (kind === 'phase_distortion') { const p = phase % 1, pivot = .25 + .12 * Math.sin(t * 2); sample = Math.cos(TAU * (p < pivot ? p / pivot * .5 : .5 + (p - pivot) / (1 - pivot) * .5)); }
    else if (kind === 'hard_sync') { const master = phase % 1; sample = read(b, master * (2 + Math.exp(-t * 2))); }
    else if (kind === 'pwm') { const width = .5 + .3 * Math.sin(TAU * .8 * t); sample = read(b, phase) - read(b, phase + width); }
    else if (kind === 'ring_mod') sample = read(c, phase) * Math.sin(TAU * phase * 1.41421356);
    else {
      // Voiced excitation into vowel-weighted harmonic envelopes; vocoder adds
      // rhythmic per-band envelope transfer from a procedural speech-like modulator.
      const vowels = [[730, 1090, 2440], [270, 2290, 3010], [300, 870, 2240]], vowel = vowels[Math.floor(t * 1.5) % 3];
      sample = 0;
      for (let h = 1; h <= limit; h++) {
        const weight = vowel.reduce((sum, center) => sum + Math.exp(-(((h * f - center) / (center * .12 + 60)) ** 2)), 0);
        const envelope = kind === 'vocoder' ? .25 + .75 * Math.max(0, Math.sin(TAU * (3 + h % 3) * t)) ** 2 : 1;
        sample += Math.sin(TAU * phase * h) * weight * envelope / Math.sqrt(h);
      }
    }
    // A gentle low-pass bounds the brightest nonlinear spectra.
    low += .65 * (sample - low);
    return .27 * low;
  };
}

const decimationKernel = (() => {
  const taps = Array.from({ length: 63 }, (_, i) => { const x = i - 31, cutoff = .1125; return (x === 0 ? 2 * cutoff : Math.sin(TAU * cutoff * x) / (Math.PI * x)) * (.54 - .46 * Math.cos(TAU * i / 62)); });
  const sum = taps.reduce((a,b) => a+b,0); return taps.map((v) => v/sum);
})();
export function synthVoice(event, sr, rng) {
  if (!Object.hasOwn(SYNTH_PROFILES, event.profile)) return null;
  const sample = createSynthVoice(event, sr * 4, rng), line = new Float64Array(64); let at = 0;
  return (t) => {
    for (let k = 0; k < 4; k++) { line[at] = sample(t + k / (sr * 4)); at = (at + 1) % line.length; }
    let out = 0;
    for (let k = 0; k < 63; k++) out += line[(at - 1 - k + 64) % 64] * decimationKernel[k];
    return out;
  };
}

// Weighted overlap-add STFT resynthesis. A frozen magnitude frame keeps the
// current analysis phase; tilt changes spectral balance in octaves around bin 8.
export function spectralResynthesize(input, { size = 512, hop = size / 4, freeze = null, tilt = 0 } = {}) {
  if (!(input instanceof Float32Array) || !input.every(Number.isFinite) || !Number.isInteger(size) || size < 32 || size > 8192 || (size & (size - 1)) || !Number.isInteger(hop) || hop < 1 || hop > size / 2 || !Number.isFinite(tilt) || Math.abs(tilt) > 2 || freeze !== null && (!Number.isInteger(freeze) || freeze < 0 || freeze >= input.length)) throw new Error('Invalid STFT buffer, window, hop, freeze or tilt.');
  const out = new Float64Array(input.length), weight = new Float64Array(input.length), window = Float64Array.from({ length: size }, (_, i) => .5 - .5 * Math.cos(TAU * i / size));
  let frozen;
  if (freeze !== null) {
    const re = new Float64Array(size), im = new Float64Array(size);
    for (let i = 0; i < size; i++) re[i] = (input[freeze + i] ?? 0) * window[i];
    fft(re, im); frozen = Float64Array.from(re, (v, i) => Math.hypot(v, im[i]));
  }
  for (let start = -size + hop; start < input.length; start += hop) {
    const re = new Float64Array(size), im = new Float64Array(size);
    for (let i = 0; i < size; i++) re[i] = (input[start + i] ?? 0) * window[i];
    fft(re, im);
    for (let k = 0; k < size; k++) {
      const bin = Math.min(k, size - k), magnitude = Math.hypot(re[k], im[k]);
      const gain = (frozen ? frozen[k] / Math.max(1e-12, magnitude) : 1) * (Math.max(1, bin) / 8) ** tilt;
      re[k] *= gain; im[k] *= gain;
    }
    fft(re, im, true);
    for (let i = 0; i < size; i++) if (start + i >= 0 && start + i < out.length) { out[start + i] += re[i] * window[i]; weight[start + i] += window[i] ** 2; }
  }
  return Float32Array.from(out, (v, i) => v / Math.max(1e-12, weight[i]));
}
