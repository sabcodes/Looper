import { midiHz } from './random.js';
const JUST = [1,16/15,9/8,6/5,5/4,4/3,45/32,3/2,8/5,5/3,9/5,15/8,2];
const PYTHAGOREAN = [1,256/243,9/8,32/27,81/64,4/3,729/512,3/2,128/81,27/16,16/9,243/128,2];
// Scala intervals exclude the implicit 1/1 and end with the repeating period.
export function parseScala(text) {
  if (typeof text !== 'string' || text.length > 65536) throw new Error('Scala input must be text, at most 64 KiB.');
  const lines = text.split(/\r?\n/).map(s => s.split('!')[0].trim()).filter(Boolean);
  const count = Number(lines[1]);
  if (!Number.isInteger(count) || count < 1 || count > 128 || lines.length !== count + 2) throw new Error('Scala needs a description, count (1–128) and exactly that many intervals.');
  const intervals = lines.slice(2).map(line => {
    const token = line.split(/\s+/)[0];
    if (/^\d+\/\d+$/.test(token)) { const [a,b] = token.split('/').map(Number); return a / b; }
    if (/^\d+\.\d*$/.test(token)) return 2 ** (Number(token) / 1200);
    if (/^\d+$/.test(token)) return Number(token);
    throw new Error('Invalid Scala ratio or cents interval: ' + token);
  });
  return validateIntervals(intervals);
}
function validateIntervals(intervals) {
  if (!Array.isArray(intervals) || intervals.length < 1 || intervals.length > 128 || intervals.some((x,i) => !Number.isFinite(x) || x <= 1 || x > 16 || i && x <= intervals[i-1])) throw new Error('Tuning intervals must increase above 1/1, with a period no greater than 16/1.');
  return [...intervals];
}
export function resolveTuning(prompt = '', requested = {}) {
  if (!requested || typeof requested !== 'object' || Array.isArray(requested)) throw new Error('Tuning must be an object.');
  const known = ['system','divisions','concertPitch','ratios','scala','mapping'];
  for (const k of Object.keys(requested)) if (!known.includes(k)) throw new Error('Unknown tuning setting: ' + k);
  const edo = prompt.match(/\b(\d+)[ -]?(?:edo|tet)\b/i);
  const concert = prompt.match(/\b(?:concert pitch|a4\s*=?)\s*(\d+(?:\.\d+)?)\s*(?:hz)?/i);
  const system = requested.system ?? (requested.scala !== undefined ? 'scala' : requested.ratios !== undefined ? 'custom' : edo ? 'edo' : /\bjust intonation\b/i.test(prompt) ? 'just' : /\bpythagorean tuning\b/i.test(prompt) ? 'pythagorean' : /\b(?:quarter comma )?meantone\b/i.test(prompt) ? 'meantone' : 'edo');
  if (!['edo','just','pythagorean','meantone','scala','custom'].includes(system)) throw new Error('Unknown tuning system.');
  const concertPitch = requested.concertPitch ?? Number(concert?.[1] ?? 440), divisions = requested.divisions ?? Number(edo?.[1] ?? 12), mapping = requested.mapping ?? 'chromatic';
  if (!Number.isFinite(concertPitch) || concertPitch < 300 || concertPitch > 500 || !Number.isInteger(divisions) || divisions < 1 || divisions > 128 || !['chromatic','degree'].includes(mapping)) throw new Error('Use concert pitch 300–500 Hz, 1–128 divisions and chromatic/degree mapping.');
  let intervals;
  if (system === 'scala') intervals = parseScala(requested.scala);
  else if (system === 'custom') intervals = validateIntervals(requested.ratios);
  else if (system === 'just') intervals = JUST.slice(1);
  else if (system === 'pythagorean') intervals = PYTHAGOREAN.slice(1);
  else if (system === 'meantone') {
    // Twelve notes on a finite chain of quarter-comma fifths, C at chain index 0.
    const fifth = 5 ** .25;
    intervals = Array.from({length:12},(_,i)=> { const k = i - 3; return fifth ** k / 2 ** Math.floor(Math.log2(fifth ** k)); }).sort((a,b)=>a-b).slice(1).concat(2);
  } else intervals = Array.from({length:divisions},(_,i)=>2 ** ((i+1)/divisions));
  return { system, concertPitch, mapping, intervals, period: intervals.at(-1), divisions: intervals.length };
}
export function tunedHz(note, tuning, root = 60) {
  if (!Number.isFinite(note)) throw new Error('Note must be finite.');
  if (!tuning) return midiHz(note);
  const n = tuning.divisions, x = tuning.mapping === 'degree' ? note - root : Math.round((note - root) * n / 12);
  // Continuous degree interpolation preserves vibrato and pitch bends; exact
  // keyboard notes land on exact ratios for 12-note historical tunings.
  const a = Math.floor(x), u = x - a;
  const ratio = degree => { const octave = Math.floor(degree / n), index = ((degree % n) + n) % n; return tuning.period ** octave * (index ? tuning.intervals[index-1] : 1); };
  const base = tuning.concertPitch * 2 ** ((root-69)/12);
  return base * ratio(a) ** (1-u) * ratio(a+1) ** u;
}
