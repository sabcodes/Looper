import { resolveTuning } from './tuning.js';
import { validateTimbre } from './timbre.js';
import { resolveAccompaniment } from './accompaniment.js';
import { readFileSync } from 'node:fs';
import { resolveDevelopment } from './development.js';
import { resolveProduction } from './effects.js';
import { resolveArrangement, withoutTimelineChanges } from './arrangement.js';
import { resolveMeter } from './meter.js';
import { resolveGroove } from './groove.js';
import { interpretContext } from './intent-context.js';
import { clamp, random } from './random.js';
import { resolveSoundDesign, selectSoundPalette, withoutInstrumentExclusions, PIANO_PROFILES } from './sound-design.js';

const readData = (name) => JSON.parse(readFileSync(new URL('../data/' + name, import.meta.url), 'utf8'));
const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const rules = readData('genre-rules.json');
export const corpus = readData('intent-corpus.json');
import { SCALES } from './scales.js';
export { SCALES } from './scales.js';
const definitions = [
  ['deep_house', 'deep_house', ['deep house'], .5, .18],
  ['speed_garage', 'speed_garage', ['speed garage'], .65, .3],
  ['trap_halftime', 'trap', ['trap', 'trap music'], .65, .45],
  ['afro_house', 'afro_house', ['afro house', 'afrohouse'], .65, .2],
  ['liquid_dnb', 'liquid_dnb', ['liquid drum and bass', 'liquid dnb', 'liquid funk', 'drum and bass', 'dnb'], .7, .3],
  ['country_acoustic', 'country', ['country', 'country folk'], .4, .05],
  ['uk_garage_2step', 'uk_garage', ['uk garage', 'garage', '2step', '2 step'], .58, .38],
  ['chicago_footwork', 'footwork', ['footwork', 'juke', 'ghetto house'], .82, .7],
  ['jersey_club', 'jersey_club', ['jersey', 'newark'], .7, .57],
  ['amapiano_log', 'amapiano', ['amapiano', 'log drum', 'pretoria', 'south african'], .55, .36],
  ['drill_sliding', 'drill', ['drill'], .62, .52],
  ['baile_funk_tambor', 'baile_funk', ['baile funk', 'funk carioca', 'tamborzao', 'carioca', 'brazilian funk'], .8, .58],
  ['synthwave_retro', 'synthwave', ['synthwave', 'outrun', 'retro electro'], .55, .25],
  ['idm_glitch', 'idm', ['idm', 'braindance', 'glitch', 'glitchy', 'neuro hop'], .85, .8],
  ['lofi_chill', 'lofi', ['lo fi', 'lofi', 'study beat'], .4, .2],
  ['house_bright', 'house', ['house'], .6, .35],
  ['techno_rave', 'techno', ['techno', 'rave techno', 'detroit techno'], .75, .3],
  ['synthpop_80s', 'synthpop', ['synthpop', 'synth pop', 'eighties pop', '80s pop'], .55, .2],
  ['industrial_bass', 'industrial_bass', ['industrial bass'], .35, .2],
  ['jazz_lounge', 'jazz', ['jazz', 'lounge jazz', 'jazz lounge'], .3, .05],
  ['classical_minimal', 'classical', ['classical', 'neoclassical', 'solo piano', 'piano prelude', 'piano nocturne'], .2, 0],
  ['neutral_groove', 'neutral', ['neutral groove'], .4, .1],
  ['dubstep_halftime', 'dubstep', ['dubstep', 'brostep'], .6, .45],
  ...Object.entries(rules).filter(([, rule]) => rule.aliases).map(([id, rule]) => [id, id, rule.aliases, rule.density ?? .6, rule.sauce ?? .25]),
];
export const archetypes = Object.fromEntries(definitions.map(([id, key, aliases, density, sauce]) => [id, {
  id, ...rules[key], aliases, density, sauce,
  synth_profile: id === 'jersey_club' ? 'synth_stabs' : rules[key].synth_profile,
}]));

function words(text) {
  return text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[_-]/g, ' ').replace(/\b2\s*step\b/g, 'two step').match(/[a-z]+/g) ?? [];
}
function features(text) {
  const stop = new Set('a an the this that to for with and or some something make me my please song music track beat instrumental at in of it sounds soundtrack'.split(' '));
  const w = words(text).filter((word) => !stop.has(word));
  const counts = new Map();
  for (let i = 0; i < w.length; i++) {
    const keys = i ? [w[i], w[i - 1] + ' ' + w[i]] : [w[i]];
    for (const k of keys) counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return counts;
}
const documents = Object.entries(corpus).flatMap(([id, prompts]) => prompts.map((p) => ({ id, f: features(p) })));
const df = new Map();
for (const { f } of documents) for (const k of f.keys()) df.set(k, (df.get(k) ?? 0) + 1);
const idf = new Map([...df].map(([k, n]) => [k, 1 + Math.log((documents.length + 1) / (n + 1))]));
function normalize(map) {
  const norm = Math.hypot(...map.values()) || 1;
  return new Map([...map].map(([k, v]) => [k, v / norm]));
}
function vector(f) {
  return normalize(new Map([...f].filter(([k]) => idf.has(k)).map(([k, n]) => [k, (1 + Math.log(n)) * idf.get(k)])));
}
const centroids = Object.fromEntries(Object.keys(corpus).map((id) => {
  const sum = new Map();
  for (const d of documents.filter((d) => d.id === id)) {
    for (const [k, v] of vector(d.f)) sum.set(k, (sum.get(k) ?? 0) + v);
  }
  return [id, normalize(sum)];
}));

// Match longest aliases first so "ghetto house" is one footwork cue.
const aliasIntents = new Map(Object.values(archetypes).flatMap((a) => a.aliases.map((alias) => [words(alias).join(' '), a.id])));
const aliasPattern = [...aliasIntents.keys()].sort((a, b) => b.length - a.length || a.localeCompare(b, 'en')).join('|');
function namedStyles(text) {
  return [...text.matchAll(new RegExp('\\b(' + aliasPattern + ')\\b', 'g'))]
    .filter((m) => !(aliasIntents.get(m[1]) === 'jazz_lounge' && /^\s+(?:keys|chords|voicings)\b/.test(text.slice(m.index + m[0].length))))
    .filter((m) => !(m[1] === 'bassline' && /\b(?:rolling|skipping|rave|synth|deep|heavy|a|the)\s*$/.test(text.slice(0, m.index))))
    .map((m) => aliasIntents.get(m[1]));
}

export function classify(prompt, options = {}) {
  const excluded = new Set();
  const stylePrompt = prompt.replace(/\b(?:dry|cinematic|dub|extended) mix\b|\b(?:mpc|bossa|samba|cascara|songo|train|second line) groove\b/gi, ' ');
  const normalized = words(stylePrompt).join(' ');
  // Bounded keyword grammar: "not garage", "no house", "without trap or drill".
  const phrase = '(?:' + aliasPattern + ')';
  const negative = new RegExp('\\b(?:not|no|without|excluding|avoid)\\s+(?:(?:any|a|an|the)\\s+)?('
    + phrase + '(?:\\s+(?:or|and)\\s+' + phrase + ')*)\\b', 'g');
  for (const [, clause] of normalized.matchAll(negative)) {
    for (const intent of namedStyles(clause)) excluded.add(intent);
  }
  const positive = words(withoutInstrumentExclusions(stylePrompt.replace(/[-_]/g, ' '))).join(' ').replace(negative, ' ');
  const explicitStyles = new Set(namedStyles(positive));
  const override = options.intentOverride;
  if (override !== undefined) {
    if (typeof override !== 'string' || !Object.hasOwn(archetypes, override)) throw new Error('Unknown Blueprint style.');
    if (excluded.has(override)) throw new Error('Blueprint style is excluded by the prompt.');
    if (explicitStyles.size && !explicitStyles.has(override)) throw new Error('Blueprint style conflicts with the style named in the prompt.');
  }
  const context = interpretContext(positive);
  const v = vector(features(positive));
  const scores = Object.values(archetypes).map((a) => {
    let similarity = 0;
    for (const [k, value] of v) similarity += value * (centroids[a.id].get(k) ?? 0);
    const explicit = explicitStyles.has(a.id);
    const contextScore = context.weights[a.id] ?? 0;
    return { intent: a.id, score: excluded.has(a.id) ? -1 : similarity + contextScore + (explicit ? 10 : 0),
      tfidfScore: similarity, contextScore, explicit };
  }).sort((a, b) => b.score - a.score || a.intent.localeCompare(b.intent, 'en'));
  const fallback = override === undefined && scores[0].score < .12;
  const alternatives = scores.filter((s) => s.score >= 0 && (!explicitStyles.size || s.explicit)).slice(0, 3);
  const plausible = alternatives.filter((s) => s.contextScore > 0 && scores[0].score - s.score <= .22);
  const selected = !explicitStyles.size && plausible.length > 1
    ? random(options.seed ?? '0', 'interpretation').pick(plausible) : scores[0];
  if (fallback && excluded.has('neutral_groove')) throw new Error('No positive style recognized; name a style to use.');
  return { intent: override ?? (fallback ? 'neutral_groove' : selected.intent), fallback,
    source: override !== undefined ? 'locked' : fallback ? 'default' : explicitStyles.size ? 'explicit' : selected.contextScore > 0 ? 'context' : 'inferred',
    needsInterpretationReview: override === undefined && explicitStyles.size !== 1, excludedIntents: [...excluded].sort(), alternatives,
    context, scores };

}

function uniqueSlot(values, label) {
  const distinct = [...new Set(values)];
  if (distinct.length > 1) throw new Error('Conflicting ' + label + ': ' + distinct.join(', '));
  return distinct[0];
}

export function compilePrompt(prompt, options = {}) {
  if (typeof prompt !== 'string' || !prompt.trim()) throw new Error('A non-empty prompt is required.');
  if (prompt.length > 10000) throw new Error('Prompt is too long (maximum 10000 characters).');
  const intent = classify(prompt, options);
  const a = archetypes[intent.intent];
  const basePrompt = withoutTimelineChanges(prompt);
  const tempo = [...basePrompt.matchAll(/(?<![\w.])(-?\d+(?:\.\d+)?)\s*bpm\b|\btempo\s+(?:of\s+)?(-?\d+(?:\.\d+)?)(?![\d.])/gi)]
    .map((m) => Number(m[1] ?? m[2]));
  const context = intent.context;
  const bpm = uniqueSlot(tempo, 'tempos') ?? (context.tempo === undefined ? a.default_bpm : clamp(context.tempo, ...a.bpm_range));
  if (!Number.isFinite(bpm) || bpm < 40 || bpm > 240) throw new Error('BPM must be between 40 and 240.');
  const requestedBars = uniqueSlot([...basePrompt.replace(/12[ -]bar blues|chord every\s+\d+(?:\.\d+)?\s+bars?|\b\d+[ -]bar (?:accompaniment )?phrases?\b/gi, '').matchAll(/(?<![\w.])(-?\d+(?:\.\d+)?)\s*(?:bars?|measures?)\b/gi)].map((m) => Number(m[1])), 'bar counts');
  const keys = [...prompt.matchAll(/\b(in\s+)?([a-g])([#b\u266f\u266d]|\s+(?:flat|sharp))?(?:\s+(major[ _-]pentatonic|minor[ _-]pentatonic|melodic[ _-]minor|harmonic[ _-]minor|whole[ _-]tone|quarter[ _-]tone|diminished|chromatic|lydian|locrian|blues|major|minor|dorian|phrygian|mixolydian|aeolian|ionian))?(?=\s|$|[,.!?;:])/gi)]
    .filter((match) => {
      const [key, prefix, note, accidental, mode] = match;
      if (prefix) return mode || note === note.toUpperCase();
      // A bare key needs a mode and a clause boundary, as in "A minor, 110 BPM".
      return mode && (accidental || note === note.toUpperCase())
        && /^(?:\s*(?:$|[,.;:!?])|\s+(?:at|with|and|in|\d+)\b)/i.test(prompt.slice(match.index + key.length))
        && !/\bmodulate to\s+$/i.test(prompt.slice(0, match.index));
    })
    .map(([, , note, accidental, mode]) => ({ root: note.toUpperCase() + (accidental ?? '').trim().replace(/sharp|\u266f/i, '#').replace(/flat|\u266d/i, 'b'), mode: mode?.toLowerCase().replace(/[ -]/g, '_') }));
  const rootName = uniqueSlot(keys.map((k) => k.root), 'root keys') ?? 'C';
  const mood = context.mood;
  let scale = uniqueSlot(keys.map((k) => k.mode).filter(Boolean), 'modes')
    ?? (mood === 'bright' ? 'major' : mood === 'dark' ? 'minor' : a.scale);
  scale = ({ aeolian: 'minor', ionian: 'major' })[scale] ?? scale;
  const natural = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[rootName[0]];
  const root = (natural + (rootName[1] === '#' ? 1 : rootName[1] === 'b' ? -1 : 0) + 12) % 12;
  const sauce = options.sauce === undefined ? a.sauce : Number(options.sauce);
  if (!Number.isFinite(sauce) || sauce < 0 || sauce > 1) throw new Error('Sauce must be a finite number between 0 and 1.');
  for (const key of ['seed', 'soundSeed', 'phraseSeed']) {
    if (options[key] !== undefined && (!['string', 'number'].includes(typeof options[key]) || typeof options[key] === 'number' && !Number.isFinite(options[key]))) throw new Error(key + ' must be a string or finite number.');
  }
  const soundDesign = resolveSoundDesign(prompt, a, context);
  const groove = resolveGroove(prompt, a);
  const meter = resolveMeter(basePrompt, a, options);
  const arrangement = resolveArrangement(prompt, a, requestedBars, bpm, meter);
  let synthProfile = a.synth_profile;
  if (soundDesign.harmonyRole === 'pads' && !synthProfile.endsWith('pad')) synthProfile = mood === 'dark' ? 'dark_pad' : 'analog_saw_pad';
  if (soundDesign.widePad && soundDesign.harmonyRole === 'pads') synthProfile = 'dark_wide_pad';
  if (soundDesign.exclusions.includes('piano') && PIANO_PROFILES.has(synthProfile)) synthProfile = 'dark_pad';
  if (soundDesign.pianoRequested && soundDesign.harmonyRole !== 'none') synthProfile = PIANO_PROFILES.has(a.synth_profile) ? a.synth_profile : 'fm_piano';
  if (soundDesign.harmonyProfile && soundDesign.harmonyRole !== 'none') synthProfile = soundDesign.harmonyProfile;
  synthProfile = selectSoundPalette(soundDesign, a, synthProfile, options.soundSeed ?? options.seed ?? '0', options.soundSeed !== undefined);
  const messages = [];
  if (intent.fallback) messages.push('No supported style or useful context recognized; using a neutral groove. Style remains unresolved.');
  else if (intent.needsInterpretationReview) messages.push('Style inferred from context/keywords or mixed; review the alternatives and cue evidence. Scores are not probabilities.');
  if (tempo.length && (bpm < a.bpm_range[0] || bpm > a.bpm_range[1])) messages.push('Explicit BPM overrides the archetype tempo range.');
  if(options.timbre!==undefined)validateTimbre(options.timbre,{strict:true});
  const config = {
    version, prompt, intent: a.id, seed: String(options.seed ?? '0'),
    soundSeed: String(options.soundSeed ?? options.seed ?? '0'), phraseSeed: String(options.phraseSeed ?? options.seed ?? '0'), bpm, bars: arrangement.bars,
    ...meter, stepSeconds: 60 / bpm / 4, ...arrangement,
    development: resolveDevelopment(prompt, a, options.development), tuning: resolveTuning(prompt, options.tuning), timbre: validateTimbre({...(/\b(white|pink|brown|blue|violet) noise\b/i.test(prompt)?{noiseColor:prompt.match(/\b(white|pink|brown|blue|violet) noise\b/i)[1].toLowerCase()}:{}),...options.timbre},{strict:true}),
    production: resolveProduction(prompt, options.mix), ensemble: a.ensemble, family: a.family, harmonyCycle: a.harmony_cycle,
    rhythm: { kick: a.kick_patterns, snare: a.snare_patterns, hat: a.hat_pattern, ghosts: a.ghost_steps, bass: a.bass_patterns, bassLength: a.bass_length, keys: a.key_pattern, percussion: a.percussion ?? [] },
    root, rootName, scale, intervals: SCALES[scale], swing: groove.swing, groove,
    density: clamp((context.energy === undefined ? a.density : .15 + context.energy * .75) + (/\b(minimal|sparse)\b/i.test(prompt) ? -.2 : /\b(dense|busy)\b/i.test(prompt) ? .15 : 0), .15, 1),
    sauce, mood, bassMode: a.bass_mode, bassProfile: soundDesign.bassTexture, synthProfile, soundDesign,
    kickAnchors: [...a.kick_anchors], snareAnchors: soundDesign.drumFeel === 'halftime' ? [8] : [...a.snare_anchors],
    classification: intent, messages,
  };
  config.accompaniment = resolveAccompaniment(config);
  return config;
}
