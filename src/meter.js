import { random } from './random.js';
const SUPPORTED = new Set(['3/4', '4/4', '5/4', '7/4', '6/8', '7/8', '9/8', '12/8']);

export function resolveMeter(prompt, archetype = {}, options = {}) {
  const matches = [...prompt.matchAll(/(?<![\w.])(-?\d+)\s*\/\s*(-?\d+)(?![\d.])/g)].filter((m) => !((m[1] === '2' && m[2] === '3' || m[1] === '3' && m[2] === '2') && /^\s+(?:son )?(?:clave|polyrhythm)/i.test(prompt.slice(m.index + m[0].length))))
    .map((m) => `${Number(m[1])}/${Number(m[2])}`);
  if (new Set(matches).size > 1) throw new Error('Conflicting time signatures.');
  const text = prompt.toLowerCase().replace(/\b(?:not|no|without)\s+(?:a\s+)?(?:waltz|slip jig|jig|random meter|varied meter|seeded meter|vary meter)\b/g, ' ');
  const form = /\bslip jig\b/.test(text) ? '9/8' : /\bjig\b/.test(text) ? '6/8' : /\bwaltz\b/.test(text) ? '3/4' : null;
  const acoustic = /^(?:jazz_lounge|country_acoustic|bluegrass|western_swing|honky_tonk|classical_minimal)$/.test(archetype.id) || ['jazz','classical','country'].includes(archetype.family);
  const choices = archetype.meter_options ?? (archetype.family === 'classical' || archetype.id === 'classical_minimal' ? ['4/4','3/4','6/8','12/8']
    : acoustic ? ['4/4','3/4','6/8'] : archetype.id === 'idm_glitch' ? ['4/4','5/4','7/8'] : ['4/4']);
  if (!Array.isArray(choices) || !choices.length || choices.some(m => !SUPPORTED.has(m)) || archetype.default_meter && !SUPPORTED.has(archetype.default_meter)) throw new Error('Invalid genre meter options.');
  const vary = /\b(?:vary meter|varied meter|random meter|seeded meter|choose a suitable meter)\b/.test(text);
  const timeSignature = matches[0] ?? form ?? (vary ? random(options.seed ?? '0','meter:' + (archetype.id ?? '')).pick(choices) : archetype.default_meter ?? '4/4');
  const meterSource = matches.length ? 'explicit' : form ? 'form' : vary ? 'seeded' : archetype.default_meter ? 'genre' : 'default';
  if (!SUPPORTED.has(timeSignature)) throw new Error('Supported meters: ' + [...SUPPORTED].join(', '));
  const [numerator, denominator] = timeSignature.split('/').map(Number);
  return { timeSignature, meterSource, meterChoices: [...choices], numerator, denominator, beatsPerBar: numerator * 4 / denominator, stepsPerBar: numerator * 16 / denominator };
}

// Extend or clip a sixteenth-note phrase to the actual bar; never stretch the beat.
export function fitPattern(steps, n) {
  const result = [];
  for (let start = 0; start < n; start += 16) for (const step of steps) if (start + step < n) result.push(start + step);
  return [...new Set(result)].sort((a, b) => a - b);
}

export function meterAccents(config) {
  const n = config.stepsPerBar ?? 16;
  if (config.denominator === 8 && config.numerator % 3 === 0) return Array.from({ length: n / 6 }, (_, i) => i * 6);
  if (config.timeSignature === '7/8') return [0, 4, 8];
  if (config.timeSignature === '5/4') return [0, 12];
  if (config.timeSignature === '7/4') return [0, 12, 20];
  return Array.from({ length: Math.ceil(n / 4) }, (_, i) => i * 4);
}
