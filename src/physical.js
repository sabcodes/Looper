import { midiHz, clamp } from './random.js';
import { StateVariableFilter } from './filter.js';
export const PHYSICAL_PROFILES = {
  trumpet: { names: 'trumpet', role: 'lead' }, trombone: { names: 'trombone', role: 'lead' }, french_horn: { names: 'french horn|horn section', role: 'harmony' },
  clarinet: { names: 'clarinet', role: 'lead' }, oboe: { names: 'oboe', role: 'lead' }, bassoon: { names: 'bassoon', role: 'lead' },
  accordion: { names: 'accordion', role: 'harmony' }, harmonica: { names: 'harmonica|mouth organ', role: 'lead' }, bandoneon: { names: 'bandoneon', role: 'harmony' },
  electric_guitar: { names: 'electric guitar|rhythm guitar|lead guitar', role: 'harmony' }, mandolin: { names: 'mandolin', role: 'arp' }, ukulele: { names: 'ukulele', role: 'harmony' },
  twelve_string: { names: '12 string guitar|twelve string guitar', role: 'harmony' }, sitar: { names: 'sitar', role: 'lead' }, choir: { names: 'choir|choral voices', role: 'harmony' },
  tabla: { names: 'tabla', role: 'arp' }, djembe: { names: 'djembe', role: 'arp' }, cajon: { names: 'cajon', role: 'arp' }, pandeiro: { names: 'pandeiro', role: 'arp' },
  frame_drum: { names: 'frame drum', role: 'arp' }, timpani: { names: 'timpani|kettle drums?', role: 'bass' }, gong: { names: 'gong', role: 'harmony' }, tubular_bells: { names: 'tubular bells|orchestral bells', role: 'harmony' },
};
const TAU = 2 * Math.PI;
function string(f, sr, rng, decay, detune = 1, bridge = false) {
  const delay = Math.max(2, sr / (f * detune) - .5), length = Math.ceil(delay) + 2;
  const line = Float64Array.from({ length }, () => rng() * 2 - 1);
  let at = 0, previous = 0;
  const feedback = Math.exp(-1 / (f * decay));
  return () => {
    const p = (at - delay + length) % length, i = Math.floor(p), u = p - i;
    let y = line[i] * (1 - u) + line[(i + 1) % length] * u;
    if (bridge) y = .85 * y + .15 * Math.tanh(y * 4);
    line[at] = clamp((y + previous) * .5 * feedback, -2, 2); previous = y; at = (at + 1) % length;
    return y;
  };
}
export function physicalVoice(e, sr, rng) {
  if (!Object.hasOwn(PHYSICAL_PROFILES, e.profile)) return null;
  const p = e.profile, f = (e.frequency ?? midiHz(e.note ?? 60)) * 2 ** ((e.pitch ?? 0) / 12);
  const noise = () => rng() * 2 - 1;
  if (['trumpet', 'trombone', 'french_horn', 'clarinet', 'oboe', 'bassoon'].includes(p)) {
    const brass = ['trumpet', 'trombone', 'french_horn'].includes(p), half = p === 'clarinet';
    const delay = Math.max(2, sr / f * (half ? .5 : 1)), line = new Float64Array(Math.ceil(delay) + 2);
    const filter = new StateVariableFilter(sr);
    let at = 0, phase = 0, last = 0;
    return (t) => {
      const position = (at - delay + line.length) % line.length, i = Math.floor(position), u = position - i;
      const reflected = line[i] * (1 - u) + line[(i + 1) % line.length] * u;
      const pressure = Math.min(1, t / (e.articulation === 'legato' ? .015 : .06)) * (.65 + .05 * Math.sin(TAU * 5 * t));
      phase += f / sr;
      // Nonlinear lip/reed excitation, lossy bore feedback and radiated bell difference.
      const excitation = brass ? .18 * Math.tanh(2 * (Math.sin(TAU * phase) * pressure - reflected))
        : .15 * clamp((pressure - reflected) * (1 - Math.abs(pressure - reflected)), -.8, .8) + .012 * noise();
      const bore = excitation + (half ? -.88 : .86) * reflected;
      line[at] = filter.process(bore, brass ? (p === 'trumpet' ? 2200 : p === 'trombone' ? 1300 : 800) + 1600 * pressure : p === 'oboe' ? 4300 : p === 'bassoon' ? 1800 : 3300, .7); at = (at + 1) % line.length;
      const radiation = line[(at + line.length - 1) % line.length] - .82 * last; last = bore;
      return .35 * radiation + .12 * Math.sin(TAU * phase) * pressure;
    };
  }
  if (['accordion', 'harmonica', 'bandoneon', 'choir'].includes(p)) {
    const choir = p === 'choir', vowel = e.vowel ?? 'a', formants = vowel === 'i' ? [270, 2290, 3010] : vowel === 'u' ? [300, 870, 2240] : [730, 1090, 2440];
    const harmonics = Array.from({ length: Math.min(40, Math.floor(sr * .43 / f)) }, (_, i) => i + 1);
    let phase = 0;
    return (t) => {
      phase += f * (1 + .002 * Math.sin(TAU * 5.2 * t)) / sr;
      const breath = Math.min(1, t / .08), beat = p === 'accordion' ? 1.004 : p === 'bandoneon' ? 1.001 : 1;
      return .23 * breath * harmonics.reduce((sum, h) => {
        const weight = choir ? formants.reduce((v, center) => v + Math.exp(-(((h * f - center) / 150) ** 2)), .04) / h ** .7 : (h % 2 ? 1 : .55) / h ** 1.3;
        return sum + weight * .5 * (Math.sin(TAU * phase * h) + Math.sin(TAU * phase * h * beat));
      }, 0) + (choir ? .008 * noise() : 0);
    };
  }
  if (['electric_guitar', 'mandolin', 'ukulele', 'twelve_string', 'sitar'].includes(p)) {
    const decay = e.articulation === 'muted' || e.articulation === 'palm_mute' ? .12 : p === 'mandolin' ? .65 : p === 'ukulele' ? .9 : 2.3;
    const strings = [string(f, sr, rng, decay, 1, p === 'sitar')];
    if (['mandolin', 'twelve_string'].includes(p)) strings.push(string(f, sr, rng, decay, p === 'twelve_string' ? 2.003 : 1.004));
    const cabinet = new StateVariableFilter(sr);
    let pickup = 0;
    return (t) => {
      const raw = strings.reduce((sum, fn) => sum + fn(), 0) / strings.length;
      const picked = raw - .4 * pickup; pickup = raw;
      const sympathetic = p === 'sitar' ? [1, 1.5, 2, 3].reduce((sum, ratio) => sum + .025 * Math.sin(TAU * f * ratio * t) * Math.exp(-t / 3), 0) : 0;
      return p === 'electric_guitar' ? .45 * cabinet.process(Math.tanh(picked * (e.drive ?? 3)), 3500, .7) : .5 * raw + sympathetic;
    };
  }
  const ratios = p === 'tabla' ? [1, 2, 3, 4.1] : p === 'gong' ? [1, 1.47, 2.13, 2.67, 3.8, 5.2]
    : p === 'tubular_bells' ? [1, 2.76, 5.4, 8.93] : [1, 1.594, 2.136, 2.296, 2.653];
  const decay = p === 'frame_drum' ? .75 : p === 'djembe' ? .36 : p === 'gong' ? 4 : p === 'tubular_bells' ? 2.8 : p === 'timpani' ? 1.5 : p === 'cajon' ? .13 : .5;
  const base = ['tabla', 'djembe', 'cajon', 'pandeiro', 'frame_drum'].includes(p) ? f * .5 : f;
  const partials = ratios.map((r, i) => ({ f: base * r, a: 1 / (i + 1) ** 1.3, decay: decay / (1 + i * .6) })).filter((v) => v.f < sr * .44);
  return (t) => .4 * partials.reduce((sum, v) => sum + v.a * Math.sin(TAU * v.f * t + (p === 'tabla' ? .4 * Math.exp(-t * 20) : 0)) * Math.exp(-t / v.decay), 0)
    + noise() * (p === 'pandeiro' ? .18 : p === 'cajon' ? .2 : .04) * Math.exp(-t / (p === 'pandeiro' ? .1 : .015));
}
