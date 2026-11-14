import { random } from './random.js';
import { SCALES } from './scales.js';

export const FUNCTIONS = {
  tonic: [0, 2, 5], predominant: [1, 3], dominant: [4, 6],
};
const TRANSITIONS = {
  tonic: [['tonic', .22], ['predominant', .6], ['dominant', 1]],
  predominant: [['tonic', .12], ['predominant', .3], ['dominant', 1]],
  dominant: [['tonic', .82], ['predominant', .94], ['dominant', 1]],
};

export function permutations(items) {
  if (items.length === 0) return [[]];
  return items.flatMap((item, i) => permutations(items.filter((_, j) => j !== i)).map((rest) => [item, ...rest]));
}
const assignments = permutations([0, 1, 2]);

// Enumerate voice assignments, inversions and independent octave registrations.
// Three voices keep this exhaustive search bounded at 6 * 27 candidates.
export function minimalVoiceLeading(previous, pitchClasses) {
  if (pitchClasses.length !== 3 || previous.length !== 3) throw new Error('Voice leading requires three voices.');
  let best = null;
  let bestDistance = Infinity;
  let bestCenter = Infinity;
  for (const assignment of assignments) {
    for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) for (let c = 0; c < 3; c++) {
      const octaves = [a, b, c];
      const candidate = assignment.map((j, i) => 48 + pitchClasses[j] + 12 * octaves[i]);
      if (new Set(candidate).size !== 3) continue;
      const distance = candidate.reduce((sum, note, i) => sum + Math.abs(note - previous[i]), 0);
      const center = candidate.reduce((sum, n) => sum + Math.abs(n - 64), 0);
      if (distance < bestDistance || (distance === bestDistance && center < bestCenter)) {
        best = candidate;
        bestDistance = distance;
        bestCenter = center;
      }
    }
  }
  return { notes: best, distance: bestDistance };
}

export function progression(config) {
  const rng = random(config.seed, 'harmony');
  let state = 'tonic';
  let previous = [60 + config.root, 60 + config.root + config.intervals[2], 60 + config.root + config.intervals[Math.min(4,config.intervals.length-1)]];
  const development = config.development ?? {}, spacing = development.chordBars ?? 2;
  const count = Math.ceil(config.bars / spacing);
  if (development.modulation && (development.modulation.bar < 0 || development.modulation.bar >= config.bars)) throw new Error('Modulation bar is outside the song.');
  const modes = SCALES;
  const theme = [];
  return Array.from({ length: count }, (_, index) => {
    const bar = index * spacing;
    const key = development.modulation && bar >= development.modulation.bar ? development.modulation : { root: config.root, mode: config.scale };
    const intervals = modes[key.mode] ?? config.intervals;
    if (index) {
      const p = rng();
      state = TRANSITIONS[state].find(([, threshold]) => p <= threshold)[0];
    }
    const cycle = config.harmonyCycle ?? (config.intent === 'jazz_lounge' ? [1, 4, 0, 0]
      : config.intent === 'country_acoustic' ? [0, 0, 3, 0, 4, 3, 0, 4] : null);
    // Resolve the final cadence back to tonic.
    if (index === count - 1) state = 'tonic';
    let degree = index === 0 || index === count - 1 ? 0 : cycle ? cycle[(index - 1) % cycle.length] : rng.pick(FUNCTIONS[state]);
    const section = config.arrangement?.sections?.find((s) => bar >= s.start && bar < s.end);
    if (section?.name === 'A' || config.arrangement?.form === 'variations') {
      const position = Math.floor((bar - section.start) / spacing);
      if (theme[position] !== undefined) degree = theme[position]; else theme[position] = degree;
    }
    if (section?.name === 'B' && config.arrangement?.form === 'aaba') degree = [1,4,1,4][index % 4];
    if (config.arrangement?.form === 'blues') degree = [0,0,0,0,3,3,0,0,4,3,0,4][bar % 12];
    if (development.modal) degree = bar % 16 < 12 ? 0 : 1;
    const closesOnTonic = index === count - 1 && config.arrangement?.form !== 'blues';
    if (closesOnTonic) degree = 0;
    if (cycle) state = degree === 4 ? 'dominant' : degree === 1 || degree === 3 ? 'predominant' : 'tonic';
    degree=degree%intervals.length;
    const pitchClasses = [0, 2, 4].map((offset) => (key.root + intervals[(degree + offset) % intervals.length]) % 12);
    let color = 'diatonic';
    if (!closesOnTonic && development.borrowed && index % 8 === 2) { pitchClasses.splice(0, 3, (key.root + 5) % 12, (key.root + 8) % 12, key.root); color = 'borrowed iv'; }
    if (!closesOnTonic && development.secondary && index % 4 === 1) { const next = (key.root + intervals[(cycle ? cycle[index % cycle.length] : 4)%intervals.length]) % 12, r = (next + 7) % 12; pitchClasses.splice(0, 3, r, (r + 4) % 12, (r + 7) % 12); color = 'secondary dominant'; }
    if (development.tritone && degree === 4 && color === 'diatonic') { const r = (key.root + 1) % 12; pitchClasses.splice(0, 3, r, (r + 4) % 12, (r + 7) % 12); color = 'tritone substitution'; }
    const voicing = minimalVoiceLeading(previous, pitchClasses);
    if(development.chordSize>3){
      const count=(development.chordSize+1)/2;
      for(let k=3;k<count;k++){const degreeIndex=(degree+2*k)%intervals.length,pc=(key.root+intervals[degreeIndex])%12;pitchClasses.push(pc);voicing.notes.push(60+pc+(k>=4?12:0));}
    }
    previous = voicing.notes.slice(0,3);
    return { bar, keyRoot: key.root, mode: key.mode, color, function: state, degree, root: pitchClasses[0], pitchClasses, ...voicing };
  });
}
