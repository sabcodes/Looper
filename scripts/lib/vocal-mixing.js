import { compose } from '../../src/index.js';

export const VOCAL_MIX_DEFAULTS = Object.freeze({ musicRms: .12, vocalDb: -6 });

export function planVocalMix(analysis, options = {}) {
  const bpm = Number(options.bpm ?? analysis.tempo_and_key_estimates.bpm);
  if (!Number.isFinite(bpm) || bpm < 40 || bpm > 240) throw new Error('Tempo is undetermined or outside 40–240 BPM; supply --bpm.');
  const key = String(options.key ?? analysis.tempo_and_key_estimates.key).trim();
  if (!/^[A-G](?:#|b)? (?:major|minor)$/i.test(key)) throw new Error('Key is undetermined; supply --key "C minor" (major/minor).');
  const seconds = analysis.excerpt.duration_seconds;
  if (!Number.isFinite(seconds) || seconds < 4 || seconds > 60) throw new Error('A 4–60 second excerpt is required.');
  const delivery = analysis.semantic?.delivery?.[0]?.label;
  const theme = analysis.semantic?.themes?.[0]?.label;
  const suggested = ['rap', 'melodic_rap'].includes(delivery)
    ? 'trap with sparse drums, sine sub and warm sustained pads'
    : delivery === 'gentle_singing' ? 'lofi with soft drums, sine sub and warm sustained pads'
      : 'deep house with sparse drums, sine sub and sustained pads';
  const color = ['heartbreak', 'struggle', 'reflection'].includes(theme) ? ', dark restrained sounds' : ', warm sounds';
  const direction = options.prompt ?? suggested + color;
  const period = 60 / bpm;
  const firstBeat = analysis.estimated_beat_times_seconds.find(t => t >= analysis.excerpt.offset_seconds);
  const inferred = firstBeat === undefined ? 0 : ((firstBeat - analysis.excerpt.offset_seconds) % period + period) % period;
  const gridOffset = Number(options.gridOffset ?? inferred);
  if (!Number.isFinite(gridOffset) || gridOffset < 0 || gridOffset >= period) throw new Error('--grid-offset must be between zero (inclusive) and one beat (exclusive).');
  const bars = Math.max(8, Math.ceil(seconds * bpm / 240) + 1);
  const prompt = `${direction}, aaba, ${bars} bars in ${key} at ${bpm}bpm, no lead, no arpeggios, no vocals`;
  const score = compose(prompt, { seed: options.seed ?? '0', sauce: 0 });
  if (score.config.beatsPerBar !== 4 || score.config.timeline.some(bar => bar.bpm !== bpm || bar.stepsPerBar !== 16)) {
    throw new Error('Vocal-mixing experiments currently require constant tempo and 4/4.');
  }
  return { bpm, key, direction, seed: score.config.seed, grid_offset_seconds: gridOffset,
    tempo_source: options.bpm === undefined ? 'Stem Splitter estimate' : 'CLI override',
    key_source: options.key === undefined ? 'Stem Splitter estimate' : 'CLI override',
    grid_source: options.gridOffset === undefined ? firstBeat === undefined ? 'File origin (no beats detected)' : 'Estimated beat phase' : 'CLI override',
    score };
}

export function alignBacking(music, frames, offsetSeconds) {
  if (music.channels !== 2 || music.sampleRate !== 44100 || !Number.isInteger(frames) || frames <= 0
      || !Number.isFinite(offsetSeconds) || offsetSeconds < 0) throw new Error('Invalid backing alignment.');
  const shift = Math.round(offsetSeconds * music.sampleRate);
  if (shift >= frames || music.frames < frames - shift) throw new Error('Backing does not cover the vocal excerpt.');
  const pcm = Buffer.alloc(frames * 4);
  music.pcm.copy(pcm, shift * 4, 0, (frames - shift) * 4);
  return { ...music, pcm, frames };
}
