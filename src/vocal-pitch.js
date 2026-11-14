import { midiHz } from './random.js';

const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
function note(text) {
  const match = /^([A-Ga-g])([#b]?)([2-6])$/.exec(String(text));
  if (!match) throw new Error('Vocal notes use scientific pitch notation, such as F3 or C#4.');
  const base = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[match[1].toUpperCase()];
  const midi = (Number(match[3]) + 1) * 12 + base + (match[2] === '#' ? 1 : match[2] === 'b' ? -1 : 0);
  if (midi < 36 || midi > 84) throw new Error('Vocal notes must be between C2 and C6.');
  return { midi, name: names[midi % 12] + (Math.floor(midi / 12) - 1) };
}

export function vocalPitchSettings(config, options = {}) {
  const modes = ['vocalPitch', 'vocalNote', 'vocalRange'].filter((name) => options[name] !== undefined);
  if (!modes.length) return null;
  if (modes.length > 1) throw new Error('Use only one of --vocal-pitch, --vocal-note or --vocal-range.');
  if (options.vocalPitch !== undefined) {
    const value = options.vocalPitch;
    const semitones = Number(value);
    if ((typeof value === 'string' && !value.trim()) || !['number', 'string'].includes(typeof value) || !Number.isFinite(semitones) || Math.abs(semitones) > 24) throw new Error('Vocal pitch must be between -24 and +24 semitones.');
    return { mode: 'shift', semitones };
  }
  if (options.vocalNote !== undefined) {
    if (String(options.vocalNote).toLowerCase() === 'root') return { mode: 'root', pitchClass: config.root };
    const target = note(options.vocalNote);
    return { mode: 'note', note: target.name, midi: target.midi };
  }
  const parts = String(options.vocalRange).split(':');
  if (parts.length !== 2) throw new Error('Vocal range must be two notes, such as C3:C4.');
  const low = note(parts[0]), high = note(parts[1]);
  if (low.midi > high.midi) throw new Error('Vocal range lower note must not exceed its upper note.');
  return { mode: 'range', low: low.name, high: high.name, lowMidi: low.midi, highMidi: high.midi };
}

// A bounded YIN-style cumulative normalized difference estimator. Speech has
// unvoiced regions; only periodic frames contribute to the estimated register.
export function estimateVocalPitch(sources, sampleRate) {
  const frequencies = [];
  for (const [, samples] of Object.entries(sources).filter(([key]) => key.startsWith('word:')).sort(([a], [b]) => a.localeCompare(b, 'en')).slice(0, 24)) {
    const rate = 8000, length = Math.floor(samples.length * rate / sampleRate);
    const data = new Float32Array(length);
    for (let i = 0; i < length; i++) {
      const from = Math.floor(i * sampleRate / rate), to = Math.max(from + 1, Math.floor((i + 1) * sampleRate / rate));
      for (let j = from; j < Math.min(to, samples.length); j++) data[i] += samples[j] / (to - from);
    }
    const frame = 512, maxLag = Math.floor(rate / 60), minLag = Math.ceil(rate / 700);
    if (length < frame) continue;
    const frames = Math.min(8, Math.floor((length - frame) / 128) + 1);
    for (let k = 0; k < frames; k++) {
      const start = frames === 1 ? 0 : Math.floor(k * (length - frame) / (frames - 1));
      let energy = 0;
      for (let i = 0; i < frame; i++) energy += data[start + i] ** 2;
      if (energy / frame < .000064) continue;
      const difference = new Float64Array(maxLag + 1), normalized = new Float64Array(maxLag + 1);
      let cumulative = 0;
      for (let lag = 1; lag <= maxLag; lag++) {
        for (let i = 0; i < frame - maxLag; i++) difference[lag] += (data[start + i] - data[start + i + lag]) ** 2;
        cumulative += difference[lag];
        normalized[lag] = cumulative ? difference[lag] * lag / cumulative : 1;
      }
      for (let lag = minLag; lag < maxLag; lag++) {
        if (normalized[lag] >= .18) continue;
        while (lag + 1 <= maxLag && normalized[lag + 1] < normalized[lag]) lag++;
        const a = normalized[lag - 1], b = normalized[lag], c = normalized[Math.min(maxLag, lag + 1)];
        const denominator = 2 * (a - 2 * b + c);
        const correction = denominator ? Math.max(-1, Math.min(1, (a - c) / denominator)) : 0;
        frequencies.push(rate / (lag + correction));
        break;
      }
    }
  }
  frequencies.sort((a, b) => a - b);
  if (frequencies.length < 3) return null;
  const middle = Math.floor(frequencies.length / 2);
  const hz = frequencies.length % 2 ? frequencies[middle] : (frequencies[middle - 1] + frequencies[middle]) / 2;
  return { hz, midi: 69 + 12 * Math.log2(hz / 440), voicedFrames: frequencies.length };
}

export function resolveVocalPitch(settings, sources, sampleRate) {
  if (settings.mode === 'shift') return { settings, appliedSemitones: settings.semitones };
  const estimate = estimateVocalPitch(sources, sampleRate);
  if (!estimate) throw new Error('No stable voiced pitch was found. Use --vocal-pitch for whispered, noisy or polyphonic voices.');
  let target;
  if (settings.mode === 'note') target = settings.midi;
  else if (settings.mode === 'root') target = settings.pitchClass + 12 * Math.round((estimate.midi - settings.pitchClass) / 12);
  else if (settings.mode === 'range') {
    const margin = Math.min(.5, (settings.highMidi - settings.lowMidi) / 2);
    target = estimate.midi < settings.lowMidi ? settings.lowMidi + margin
      : estimate.midi > settings.highMidi ? settings.highMidi - margin : estimate.midi;
  }
  else throw new Error('Unsupported vocal pitch mode.');
  const semitones = target - estimate.midi;
  if (!Number.isFinite(semitones) || Math.abs(semitones) > 24) throw new Error('Target register needs more than 24 semitones of shift; choose a closer note/range.');
  return { settings, appliedSemitones: semitones, estimatedHz: estimate.hz, targetHz: midiHz(target), voicedFrames: estimate.voicedFrames };
}
