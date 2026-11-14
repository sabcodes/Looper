import { clamp, random } from './random.js';
import { fft } from './synthesis.js';
const TAU = Math.PI * 2;
export const REVERBS = ['room', 'hall', 'chamber', 'plate', 'spring', 'convolution', 'shimmer', 'reverse', 'gated', 'ducked'];
export function bounded(value, fallback, lo, hi, label) {
  const n = value === undefined ? fallback : Number(value);
  if (!Number.isFinite(n) || n < lo || n > hi) throw new Error(`${label} must be ${lo}–${hi}.`);
  return n;
}
export function resolveProduction(prompt, overrides = {}, nested = false) {
  if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) throw new Error('Mix settings must be an object.');
  if (nested && overrides.buses) throw new Error('Buses cannot contain nested buses.');
  const buses = {};
  if (overrides.buses) {
    for (const [name, settings] of Object.entries(overrides.buses)) {
      if (!['drums','bass','harmony','lead','arp','vocals'].includes(name)) throw new Error('Unknown mix bus.');
      buses[name] = resolveProduction('', settings, true);
    }
  }
  const text = prompt.toLowerCase().replace(/[-_]/g, ' ');
  const preset = /\bdry mix\b/.test(text) ? 'dry' : /\bcinematic mix\b/.test(text) ? 'cinematic' : /\bdub mix\b/.test(text) ? 'dub'
    : /\bparallel compression\b/.test(text) ? 'parallel' : /\btechno rumble\b/.test(text) ? 'rumble' : 'standard';
  const match = text.match(/\b(room|hall|chamber|plate|spring|convolution|shimmer|reverse|gated|ducked) reverb(?:\s+(\d+(?:\.\d+)?)%)?/);
  const reverb = overrides.reverb ?? match?.[1] ?? (preset === 'cinematic' ? 'hall' : preset === 'rumble' ? 'room' : null);
  if (reverb !== null && !REVERBS.includes(reverb)) throw new Error('Unknown reverb style.');
  const eq = overrides.eq ?? [...text.matchAll(/\beq\s+(\d+(?:\.\d+)?)hz\s+(-?\d+(?:\.\d+)?)db(?:\s+q\s+(\d+(?:\.\d+)?))?/g)].map((m) => ({ frequency: Number(m[1]), gain: Number(m[2]), q: Number(m[3] ?? .707) }));
  if (!Array.isArray(eq) || eq.length > 8) throw new Error('Use at most eight EQ bands.');
  const bands = eq.map((b) => ({ frequency: bounded(b.frequency, 1000, 20, 20000, 'EQ frequency'), gain: bounded(b.gain, 0, -18, 18, 'EQ gain'), q: bounded(b.q, .707, .1, 12, 'EQ Q') }));
  const modulation = overrides.modulation ?? (text.replace(/verse chorus form/g, '').match(/\b(chorus|flanger|phaser|rotary)(?: effect)?\b/)?.[1] ?? null);
  if (modulation !== null && !['chorus', 'flanger', 'phaser', 'rotary'].includes(modulation)) throw new Error('Unknown modulation effect.');
  return { preset, reverb, buses, sidechain: overrides.sidechain ?? /\bsidechain compression\b/.test(text), delayWet: preset === 'dub' ? .55 : undefined, delayFeedback: preset === 'dub' ? .65 : undefined, wet: bounded(overrides.wet ?? (match?.[2] && Number(match[2]) / 100), preset === 'dry' ? 0 : .2, 0, 1, 'Reverb wet'),
    decay: bounded(overrides.decay, reverb === 'room' ? .5 : reverb === 'chamber' ? 1.2 : 2.4, .1, 8, 'Reverb decay'), eq: bands, modulation,
    compress: overrides.compress ?? /\b(?:compression|compressor|compressed mix)\b/.test(text),
    parallel: overrides.parallel ?? preset === 'parallel', multiband: overrides.multiband ?? /\bmultiband\b/.test(text), dynamicEq: overrides.dynamicEq ?? /\bdynamic eq\b/.test(text),
    tape: overrides.tape ?? /\btape (?:mix|saturation|wow|flutter)\b/.test(text),
    drive: bounded(overrides.drive, /\b(?:saturation|overdrive|distorted mix)\b/.test(text) ? 2 : 1, 1, 8, 'Drive'),
    threshold: bounded(overrides.threshold, -18, -60, 0, 'Compressor threshold'), ratio: bounded(overrides.ratio, 4, 1, 20, 'Compressor ratio'),
    attack: bounded(overrides.attack, .01, .0001, 1, 'Attack'), release: bounded(overrides.release, .15, .005, 3, 'Release'),
    limiter: overrides.limiter ?? /\b(?:lookahead|true peak|limiter)\b/.test(text) };
}

// RBJ peaking EQ, transposed direct form II. Coefficients remain outside sample loops.
export function biquad(sr, frequency, gain, q = .707) {
  const w = TAU * clamp(frequency, 10, sr * .44) / sr, A = 10 ** (gain / 40), alpha = Math.sin(w) / (2 * q), c = Math.cos(w), a0 = 1 + alpha / A;
  const b0 = (1 + alpha * A) / a0, b1 = -2 * c / a0, b2 = (1 - alpha * A) / a0, a1 = -2 * c / a0, a2 = (1 - alpha / A) / a0;
  let z1 = 0, z2 = 0;
  return (x) => { const y = b0 * x + z1; z1 = b1 * x - a1 * y + z2; z2 = b2 * x - a2 * y; return y; };
}
export function compressorGain(detector, sr, settings = {}) {
  const threshold = settings.threshold ?? -18, ratio = settings.ratio ?? 4;
  const attack = Math.exp(-1 / (sr * (settings.attack ?? .01))), release = Math.exp(-1 / (sr * (settings.release ?? .15)));
  let envelope = 0;
  return (sample) => {
    const level = Math.abs(sample), c = level > envelope ? attack : release;
    envelope = c * envelope + (1 - c) * level;
    const db = 20 * Math.log10(Math.max(envelope, 1e-9)), reduction = Math.max(0, db - threshold) * (1 - 1 / ratio);
    return 10 ** (-reduction / 20);
  };
}
const allpass = (length, coefficient) => {
  const b = new Float64Array(Math.max(2, Math.round(length))); let p = 0;
  return (x) => { const y = b[p] - coefficient * x; b[p] = x + coefficient * y; p = (p + 1) % b.length; return y; };
};
export function reverbProcessor(style, sr, { decay = 2.4 } = {}) {
  if (!REVERBS.includes(style)) throw new Error('Unknown reverb style.');
  const scale = style === 'room' ? .45 : style === 'chamber' ? .75 : 1;
  const lengths = [.0297, .0371, .0411, .0437].map((s) => Math.max(3, Math.round(s * sr * scale)));
  const lines = lengths.map((n) => new Float64Array(n)), positions = [0, 0, 0, 0], filtered = [0, 0, 0, 0];
  const feedback = lengths.map((n) => 10 ** (-3 * n / sr / decay));
  const diffuse = [allpass(sr * .0047, .65), allpass(sr * .0093, .55), allpass(sr * .0127, .45)];
  const spring = Array.from({ length: 8 }, (_, i) => allpass(sr * (.0007 + .00019 * i), .45 + .035 * i));
  const early = new Float64Array(Math.round(sr * .08)); let ep = 0; const shimmerPhases = [0, 0, 0, 0];
  const values = [0, 0, 0, 0];
  return (left, right) => {
    const dry = (left + right) * .5;
    let input = dry;
    for (const ap of diffuse) input = ap(input);
    if (style === 'spring') for (const ap of spring) input = ap(input);
    let sum = 0;
    for (let j = 0; j < 4; j++) {
      values[j] = lines[j][positions[j]];
      filtered[j] += (style === 'plate' ? .65 : .25) * (values[j] - filtered[j]); sum += filtered[j];
    }
    // Householder reflection: orthogonal scattering, with RT60-derived loop loss.
    for (let j = 0; j < 4; j++) {
      let shifted = 0;
      if (style === 'shimmer') {
        const line = lines[j], size = line.length;
        for (const phase of [shimmerPhases[j], (shimmerPhases[j] + .5) % 1]) {
          const at = (positions[j] + phase * size) % size, k = Math.floor(at), u = at - k;
          shifted += (line[k] * (1 - u) + line[(k + 1) % size] * u) * Math.sin(Math.PI * phase) ** 2;
        }
      }
      lines[j][positions[j]] = input * .3 + feedback[j] * (.5 * sum - filtered[j]) * (style === 'shimmer' ? .75 : 1) + .12 * shifted;
      positions[j] = (positions[j] + 1) % lengths[j];
      shimmerPhases[j] = (shimmerPhases[j] + 1 / lengths[j]) % 1;
    }
    let el = 0, er = 0;
    for (const [seconds, gain, side] of [[.011, .5, 0], [.019, .35, 1], [.031, .2, 0], [.053, .16, 1]]) {
      const tap = early[(ep - Math.round(seconds * sr) + early.length) % early.length] * gain;
      if (side) er += tap; else el += tap;
    }
    early[ep] = dry; ep = (ep + 1) % early.length;
    return [(values[0] + values[2] - values[1]) * .4 + el, (values[1] + values[3] - values[2]) * .4 + er];
  };
}

// Uniform partitioned FFT convolution, with overlap-add and no circular wrap.
export function convolve(signal, impulse, block = 256) {
  if (!(signal instanceof Float32Array || signal instanceof Float64Array) || !(impulse instanceof Float32Array || impulse instanceof Float64Array) || !impulse.length || impulse.length > 384000 || !signal.every(Number.isFinite) || !impulse.every(Number.isFinite)) throw new Error('Convolution needs finite typed buffers and an IR of 1–384000 samples.');
  if (!Number.isInteger(block) || block < 32 || block > 4096 || (block & (block - 1))) throw new Error('Convolution block must be a power of two, 32–4096.');
  const size = block * 2, count = Math.ceil(impulse.length / block);
  const kernels = Array.from({ length: count }, (_, p) => {
    const re = new Float64Array(size), im = new Float64Array(size);
    re.set(impulse.subarray(p * block, (p + 1) * block)); fft(re, im); return [re, im];
  });
  const history = Array.from({ length: count }, () => [new Float64Array(size), new Float64Array(size)]), out = new Float32Array(signal.length);
  const overlap = new Float64Array(block); let head = 0;
  for (let offset = 0; offset < signal.length; offset += block) {
    const [xr, xi] = history[head]; xr.fill(0); xi.fill(0); xr.set(signal.subarray(offset, offset + block)); fft(xr, xi);
    const yr = new Float64Array(size), yi = new Float64Array(size);
    for (let p = 0; p < count; p++) {
      const [ar, ai] = history[(head - p + count) % count], [br, bi] = kernels[p];
      for (let k = 0; k < size; k++) { yr[k] += ar[k] * br[k] - ai[k] * bi[k]; yi[k] += ar[k] * bi[k] + ai[k] * br[k]; }
    }
    fft(yr, yi, true);
    for (let k = 0; k < block; k++) { if (offset + k < out.length) out[offset + k] = yr[k] + overlap[k]; overlap[k] = yr[k + block]; }
    head = (head + 1) % count;
  }
  return out;
}
export function reverbBuffer(left, right, sr, settings, impulseResponse) {
  const style = settings.reverb;
  if (!style || !settings.wet) return;
  const input = Float32Array.from(left, (x, i) => (x + right[i]) * .5);
  let wetL, wetR;
  if (['convolution', 'reverse', 'gated'].includes(style)) {
    let ir;
    if (impulseResponse !== undefined) {
      if (!(impulseResponse instanceof Float32Array) || impulseResponse.length > sr * 4) throw new Error('Impulse response must be a Float32Array of at most four seconds.');
      ir = impulseResponse;
    } else {
      const n = Math.round(sr * (style === 'gated' ? .18 : Math.min(3, settings.decay))), rng = random('reverb', style);
      ir = Float32Array.from({ length: n }, (_, i) => (rng() * 2 - 1) * Math.exp(-6.9 * i / n) / Math.sqrt(n) * 4);
      if (style === 'reverse') ir.reverse();
    }
    wetL = convolve(input, ir); wetR = convolve(input, Float32Array.from(ir, (x, i) => i % 2 ? -x : x));
  } else {
    wetL = new Float32Array(left.length); wetR = new Float32Array(left.length);
    const process = reverbProcessor(style, sr, settings);
    for (let i = 0; i < left.length; i++) [wetL[i], wetR[i]] = process(left[i], right[i]);
  }
  let env = 0;
  const rate = 1 - Math.exp(-1 / (sr * .04));
  for (let i = 0; i < left.length; i++) {
    env += rate * (Math.abs(input[i]) - env);
    const duck = style === 'ducked' ? 1 / (1 + env * 12) : 1;
    left[i] += wetL[i] * settings.wet * duck; right[i] += wetR[i] * settings.wet * duck;
  }
}
export function modulate(left, right, sr, style) {
  if (!style) return;
  const buffers = [new Float64Array(Math.ceil(sr * .06)), new Float64Array(Math.ceil(sr * .06))];
  const ap = [Array.from({ length: 4 }, () => ({ previousX: 0, previousY: 0 })), Array.from({ length: 4 }, () => ({ previousX: 0, previousY: 0 }))];
  let at = 0;
  for (let i = 0; i < left.length; i++) {
    for (let side = 0; side < 2; side++) {
      const channel = side ? right : left, x = channel[i], lfo = Math.sin(TAU * i / sr * (style === 'rotary' ? 5.6 : .3) + side * Math.PI / 2);
      if (style === 'phaser') {
        let y = x; const c = .3 + .25 * lfo;
        for (const state of ap[side]) { const z = -c * y + state.previousX + c * state.previousY; state.previousX = y; state.previousY = z; y = z; }
        channel[i] = .65 * x + .35 * y;
      } else {
        const buffer = buffers[side], delay = sr * (style === 'flanger' ? .003 + .002 * lfo : style === 'rotary' ? .004 + .0005 * lfo : .022 + .006 * lfo);
        const p = (at - delay + buffer.length) % buffer.length, k = Math.floor(p), u = p - k, y = buffer[k] * (1 - u) + buffer[(k + 1) % buffer.length] * u;
        buffer[at] = x + (style === 'flanger' ? y * .45 : 0); channel[i] = .7 * x + .3 * y;
        if (style === 'rotary') channel[i] *= .85 + .15 * lfo;
      }
    }
    at = (at + 1) % buffers[0].length;
  }
}
export function processBus(left, right, sr, settings, detector) {
  for (const band of settings.eq ?? []) {
    const filters = [biquad(sr, band.frequency, band.gain, band.q), biquad(sr, band.frequency, band.gain, band.q)];
    for (let i = 0; i < left.length; i++) { left[i] = filters[0](left[i]); right[i] = filters[1](right[i]); }
  }
  modulate(left, right, sr, settings.modulation);
  const gain = compressorGain(null, sr, settings), lowGain = compressorGain(null, sr, { ...settings, threshold: -22, ratio: 3 }), highGain = compressorGain(null, sr, { ...settings, threshold: -24, ratio: 2 });
  let lowL = 0, lowR = 0, highL = 0, highR = 0, prevL = 0, prevR = 0;
  const lc = 1 - Math.exp(-TAU * 220 / sr), hc = 1 - Math.exp(-TAU * 2500 / sr);
  // Tape delay includes wow/flutter; nonlinear stages evaluate four interpolated sub-samples.
  const tapeL = new Float64Array(Math.ceil(sr * .006)), tapeR = tapeL.slice(); let tp = 0;
  for (let i = 0; i < left.length; i++) {
    let l = left[i], r = right[i];
    if (settings.compress || settings.parallel || settings.sidechain) { const g = gain(settings.sidechain && detector ? detector[i] : Math.max(Math.abs(l), Math.abs(r))); const mix = settings.parallel ? .5 : 1; l *= 1 - mix + mix * g; r *= 1 - mix + mix * g; }
    if (settings.multiband || settings.dynamicEq) {
      lowL += lc * (l - lowL); lowR += lc * (r - lowR); highL += hc * (l - highL); highR += hc * (r - highR);
      const lg = lowGain(Math.max(Math.abs(lowL), Math.abs(lowR))), hg = highGain(Math.max(Math.abs(l - highL), Math.abs(r - highR)));
      if (settings.multiband) { l += lowL * (lg - 1); r += lowR * (lg - 1); }
      l += (l - highL) * (hg - 1); r += (r - highR) * (hg - 1);
    }
    if (settings.drive > 1 || settings.tape) {
      const d = settings.drive > 1 ? settings.drive : 1.6;
      let sl = 0, srout = 0;
      for (let k = 1; k <= 4; k++) { sl += Math.tanh((prevL + (l - prevL) * k / 4) * d) / d; srout += Math.tanh((prevR + (r - prevR) * k / 4) * d) / d; }
      prevL = l; prevR = r; l = sl / 4; r = srout / 4;
    }
    if (settings.tape) {
      const delay = sr * (.0025 + .0003 * Math.sin(TAU * .6 * i / sr) + .00006 * Math.sin(TAU * 7 * i / sr));
      const p = (tp - delay + tapeL.length) % tapeL.length, k = Math.floor(p), u = p - k;
      tapeL[tp] = l; tapeR[tp] = r; tp = (tp + 1) % tapeL.length;
      l = tapeL[k] * (1 - u) + tapeL[(k + 1) % tapeL.length] * u; r = tapeR[k] * (1 - u) + tapeR[(k + 1) % tapeR.length] * u;
    }
    left[i] = l; right[i] = r;
  }
}
// Shared stereo lookahead gain; 4x windowed-sinc probes estimate intersample peaks.
export function limiterGains(left, right, sr, ceiling = .79) {
  const n = left.length, look = Math.max(1, Math.round(sr * .003)), peak = new Float32Array(n), gains = new Float32Array(n), deque = new Int32Array(n);
  const kernels = [0, .25, .5, .75].map((phase) => {
    const taps = Array.from({ length: 16 }, (_, j) => { const x = j - 7 - phase; return Math.abs(x) < 1e-10 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x) * (.5 + .5 * Math.cos(Math.PI * x / 8)); });
    const sum = taps.reduce((a, b) => a + b, 0); return taps.map((v) => v / sum);
  });
  for (let i = 0; i < n; i++) {
    let p = 0;
    for (const kernel of kernels) { let l = 0, r = 0; for (let j = 0; j < 16; j++) { const at = i + j - 7; if (at >= 0 && at < n) { l += left[at] * kernel[j]; r += right[at] * kernel[j]; } } p = Math.max(p, Math.abs(l), Math.abs(r)); }
    peak[i] = p;
  }
  let head = 0, tail = 0, cursor = 0, gain = 1;
  const release = Math.exp(-1 / (sr * .08));
  for (let i = 0; i < n; i++) {
    while (cursor < Math.min(n, i + look)) { while (tail > head && peak[deque[tail - 1]] <= peak[cursor]) tail--; deque[tail++] = cursor++; }
    while (head < tail && deque[head] < i) head++;
    const target = Math.min(1, ceiling / Math.max(1e-9, peak[deque[head]])); gain = target < gain ? target : release * gain + (1 - release) * target; gains[i] = gain;
  }
  return gains;
}

// Filter-bank envelope transfer accepts real supplied modulator audio as well as
// the procedural vocoder voice. No speech recognition or remote service is used.
export function vocode(carrier, modulator, sr) {
  if (carrier.length !== modulator.length) throw new Error('Vocoder buffers must have equal length.');
  const out = new Float32Array(carrier.length);
  for (let band = 0; band < 12; band++) {
    const center = 150 * (Math.min(sr * .4, 6000) / 150) ** (band / 11), c = TAU * center / sr;
    const r = Math.exp(-Math.PI * center / 2 / sr), b = 1 - r, a1 = 2 * r * Math.cos(c), a2 = -r * r;
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0, env = 0;
    for (let i = 0; i < out.length; i++) {
      const m = b * modulator[i] + a1 * x1 + a2 * x2; x2 = x1; x1 = m;
      const v = b * carrier[i] + a1 * y1 + a2 * y2; y2 = y1; y1 = v;
      env += (Math.abs(m) > env ? .05 : .002) * (Math.abs(m) - env); out[i] += v * env * 3;
    }
  }
  return out;
}
