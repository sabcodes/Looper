// A versioned seed plus named streams isolates musical decisions from DSP noise.
export function hash(text) {
  let h = 2166136261;
  for (const c of String(text)) {
    h ^= c.codePointAt(0);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function random(seed, stream = '') {
  let state = hash(String(seed) + ':' + stream);
  const rng = () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  rng.int = (a, b) => a + Math.floor(rng() * (b - a + 1));
  rng.pick = (items) => items[rng.int(0, items.length - 1)];
  return rng;
}

export const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
export const midiHz = (midi) => 440 * 2 ** ((midi - 69) / 12);

// Musical pitches are MIDI values; a 1 Hz floor bounds inverse-frequency delays.
export function eventFrequency(event) {
  for (const name of ['note', 'fromNote']) {
    if (event[name] !== undefined && (!Number.isFinite(event[name]) || event[name] < 0 || event[name] > 127)) {
      throw new Error('Event pitches must be finite MIDI values from 0 to 127.');
    }
  }
  for (const name of ['frequency', 'fromFrequency']) {
    if (event[name] !== undefined && !Number.isFinite(event[name])) throw new Error('Event frequencies must be finite numbers.');
  }
  if (event.pitch !== undefined && !Number.isFinite(event.pitch)) throw new Error('Event pitch offset must be finite.');
  const frequency = (event.frequency ?? midiHz(event.note ?? 60)) * 2 ** ((event.pitch ?? 0) / 12);
  const from = event.fromFrequency ?? (event.fromNote === undefined ? frequency : midiHz(event.fromNote));
  if (![frequency, from].every((value) => Number.isFinite(value) && value >= 1 && value <= 192000)) {
    throw new Error('Effective event frequencies must be finite and between 1 and 192000 Hz.');
  }
  return frequency;
}
