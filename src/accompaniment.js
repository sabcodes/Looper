import { random } from './random.js';
import { barInfo, barStep, chordAt } from './arrangement.js';
import { meterAccents } from './meter.js';

const STYLES = new Set(['sustain', 'broken', 'riff', 'strum', 'comp', 'offbeat', 'funk', 'answer']);
const offbeatPhrase = String.raw`off[ -]?beat\s+(?:(?:electric piano|acoustic piano|organ|hammond|piano|rhodes|synth|guitar|clavinet|strings?|pads?|harpsichord)\s+)?(?:chord stabs?|chords?|stabs?|comping)\b`;
const offbeatRequest = new RegExp('\\b' + offbeatPhrase);
const negativeOffbeat = new RegExp('\\b(?:no|not|without|avoid)\\s+' + offbeatPhrase, 'g');
const stabPhrase = String.raw`(?:(?:chord|organ|hammond|synth|piano|rhodes|keyboard|sparse) stabs?|short chords?)\b`;
const stabRequest = new RegExp('\\b' + stabPhrase);
const negativeStabs = new RegExp('\\b(?:no|not|without|avoid)\\s+' + stabPhrase, 'g');
const banks = {
  comp: [[0,6,10], [2,7,12], [0,5,11], [3,8,14]],
  offbeat: [[2,6,10,14], [2,6,14], [2,10,14]],
  funk: [[0,3,6,10,14], [2,5,7,11,14], [0,3,7,10,15]],
  riff: [[0,3,6,10,13], [0,2,7,10,14], [2,5,8,11,14]],
  strum: [[0,4,8,12], [0,6,10], [0,7,10,14], [2,6,10,14]],
};

// One phrase policy is shared by built-in keys and additional harmony parts.
export function resolveAccompaniment(config, profile = config.synthProfile, override) {
  const rawText = config.prompt.toLowerCase();
  const positiveOffbeats = rawText.replace(negativeOffbeat, ' ');
  const text = positiveOffbeats.replace(/\b(?:no|not|without)\s+(?:(?:held|sustained|long|legato|broken|strummed|offbeat)\s+chords?|chord riffs?|rolling piano)\b/g, ' ');
  const positiveStabs = text.replace(negativeStabs, ' ');
  const stabs = stabRequest.test(positiveStabs);
  const steelpanChords = profile === 'steelpan' && /\bsteel[ -]?pan chords?\b/.test(text);
  const requested = /\b(?:held|sustained|long|legato|whole[ -]note)[ -]?(?:chords?|voicings?)\b|\bno (?:chord )?stabs\b/.test(text) ? 'sustain'
    : /\b(?:broken chords?|rolling piano|fingerpicked accompaniment|arpeggiated accompaniment)\b/.test(text) ? 'broken'
    : /\b(?:chord riffs?|repeating chord riffs?)\b/.test(text) ? 'riff'
    : /\b(?:strummed chords?|strumming accompaniment)\b/.test(text) ? 'strum'
    : offbeatRequest.test(text) ? 'offbeat'
    : stabs || /\bsyncopated comping\b/.test(text) ? 'comp' : null;
  if (override !== undefined && !STYLES.has(override)) throw new Error('Unknown accompaniment pattern: ' + override);
  const primary = profile === config.synthProfile;
  const basis = primary ? config.soundDesign?.harmonyBasis ?? profile : profile;
  const rng = random(config.phraseSeed ?? config.seed, 'accompaniment:' + (primary ? 'keys' : profile));
  const phraseBars = Number(text.match(/\b(\d+)[ -]bar (?:accompaniment )?phrases?\b/)?.[1] ?? rng.pick([2,4,8]));
  if (![2,4,8].includes(phraseBars)) throw new Error('Accompaniment phrases must be 2, 4 or 8 bars.');
  const pattern = config.soundDesign?.harmonyPattern;
  const strings = /strings|cello|fiddle|choir|bowed/.test(basis);
  const atmospheric = /^(?:melodic_house|progressive_house|progressive_trance|synthwave_retro|synthpop_80s|dream_pop|shoegaze|cloud_rap|liquid_dnb|dancefloor_dnb)$/.test(config.intent);
  const guitar = /guitar|twelve_string|mandolin/.test(basis);
  const indie = ['indie_pop', 'bedroom_pop'].includes(config.intent);
  const dancehallChops = primary && config.intent === 'dancehall' && ['organ', 'steelpan'].includes(basis);
  let style = config.soundDesign?.harmonyRole === 'pads' && primary ? 'sustain'
    : basis === 'clavinet' ? rng.pick(['funk','riff'])
    : strings || basis.endsWith('pad') || atmospheric && !guitar ? 'sustain'
    : pattern === 'broken_piano' || config.family === 'classical' ? 'broken'
    : pattern === 'boom_chuck' ? 'strum'
    : indie ? rng.pick(['strum','broken','riff','sustain','offbeat'])
    : guitar ? 'strum'
    : pattern === 'jazz_comp' || config.family === 'jazz' ? 'comp'
    : /^(?:lofi_chill|alternative_rnb|trip_hop|bedroom_pop|neutral_groove)$/.test(config.intent) ? rng.pick(['sustain','broken','comp'])
    : /^(?:soulful_house|deep_house|house_bright|disco|afropop|dancehall|dub)$/.test(config.intent) ? rng.pick(['offbeat','comp','broken'])
    : config.intent === 'salsa' ? 'broken' : 'comp';
  if (dancehallChops && config.soundDesign.harmonyRole === 'stabs') style = rawText === positiveOffbeats ? 'offbeat' : 'comp';
  if (!override && !requested && style === 'broken' && (steelpanChords || config.soundDesign?.exclusions.includes('arpeggio'))) style = 'comp';
  const coordination = /\bindependent accompaniment\b/.test(text) ? 'independent'
    : /\binterlocking (?:accompaniment|chords?|harmony)\b/.test(text) || !override && !requested && (indie || config.intent === 'synth_funk') ? 'interlock' : 'independent';
  style = override ?? requested ?? style;
  const shortStabs = !override && (stabs && ['comp', 'offbeat'].includes(style)
    || dancehallChops && !requested && style === 'offbeat' && positiveStabs === text);
  return { style, source: override ? 'part' : requested ? 'prompt' : 'genre', phraseBars, variant: rng.int(0,3), coordination,
    ...(shortStabs ? { shortStabs } : {}),
    ...(style === 'answer' && guitar ? { strum: true } : {}) };
}

export function ensembleAnswerStep(config, bar, section) {
  if (config.accompaniment.source !== 'genre' || config.accompaniment.style === 'sustain' || config.soundDesign.harmonyRole === 'none'
      || !section.bass || ['intro', 'breakdown', 'bridge', 'outro'].includes(section.name) || bar === config.bars - 1
      || (bar - section.start) % 2 === 0 && section.end - section.start > 1) return null;
  const info = barInfo(config, bar), n = info.stepsPerBar;
  return config.intent === 'dancehall' ? meterAccents(info).findLast(step => step + 3 <= n) + 2 : n - 5;
}

export function accompanimentCells(config, chords, bar, settings, section, name = 'keys', bass = []) {
  const info = barInfo(config, bar), n = info.stepsPerBar;
  if (settings.style === 'answer') {
    const step = ensembleAnswerStep(config, bar, section);
    return step === null ? [] : [{ step, shape: settings.strum ? 'strum' : 'chord', length: 1 }];
  }
  if (bar === config.bars - 1 && name === 'keys' && settings.source === 'genre' && settings.style !== 'sustain'
      && config.arrangement?.form !== 'blues') {
    return [{ step: 0, shape: 'chord', accent: .9, length: n * .66, cadence: true }];
  }
  const local = bar - section.start, pos = local % settings.phraseBars;
  const answer = local % 2 === 1, turnaround = pos === settings.phraseBars - 1;
  const cycle = Math.floor(local / settings.phraseBars) % 2;
  const quiet = ['intro','breakdown','bridge','outro'].includes(section.name);
  const energy = ['drop','chorus','build'].includes(section.name);
  const rng = random(config.phraseSeed ?? config.seed, 'accompaniment:' + name);
  const phase = (settings.variant + rng.int(0,3)) % 4;
  const chord = chordAt(chords, bar);
  // Chord boundaries and section boundaries end held voicings, even across meter edits.
  const nextChord = chords.find(c => c.bar > bar)?.bar ?? config.bars;
  const endBar = Math.min(section.end, nextChord, bar + 2);
  const accents = new Set(meterAccents(info));
  const contour = [[0,2,1,2,0,1,2,1], [0,1,2,1,0,2,1,0], [2,1,0,1,2,0,1,2], [0,0,2,1,0,2,2,1]][phase];
  const maxLength = settings.shortStabs ? 1.5 : Infinity;
  const make = (steps, shape, gate, accent = 1) => [...new Set(steps)].filter(s => s >= 0 && s < n).sort((a,b)=>a-b)
    .map((step,index,array) => ({ step, shape, tone: contour[(index + (answer ? 2 : 0)) % contour.length], accent: accent * (accents.has(step) ? 1.1 : index % 2 ? .82 : 1),
      length: Math.min(n - step, maxLength, Math.max(.3, ((array[index+1] ?? n) - step) * gate)) }));
  if (settings.style === 'sustain') {
    const boundary = chord?.bar === bar || local === 0;
    if (!boundary && local % 2) return [];
    return [{ step: 0, shape: 'chord', accent: quiet ? .72 : 1,
      length: Math.max(.5, barStep(config,endBar) - info.startStep - .2) }];
  }
  if (settings.style === 'broken') {
    const spacing = quiet ? 4 : 2;
    const steps = Array.from({length:Math.ceil(n/spacing)},(_,i)=>i*spacing);
    // Repeat the opening figure, answer it at the end of the phrase.
    if (turnaround && !quiet) steps.splice(-2,1);
    else if (answer && steps.length > 3) steps.splice(2,1);
    if (cycle && !quiet && steps.length > 1) steps[1] += 1;
    return make(steps,'broken',.88,quiet ? .75 : 1);
  }
  if (settings.style === 'strum') {
    const country = config.soundDesign.harmonyPattern === 'boom_chuck';
    const steps = info.timeSignature === '4/4' ? country ? [4,12] : [...banks.strum[phase]] : meterAccents(info);
    if (answer && !quiet) steps.push(Math.max(0,n-2));
    return make(quiet ? steps.slice(0,1) : steps,'strum',.87);
  }
  let steps;
  if (info.timeSignature !== '4/4') {
    // Build from this meter's groups; do not loop/clip a four-beat bar.
    steps = meterAccents(info).map(s => s + (settings.style === 'offbeat' ? 2 : 0)).filter(s=>s<n);
    if (answer) steps.push(n-2);
  } else {
    const bank = banks[settings.style] ?? banks.comp;
    // Select one motif for the phrase instead of always restoring the preset's
    // three-stab grid. The opening repeats; the answer changes only its ending.
    steps = [...bank[phase % bank.length]];
    if (answer) {
      steps = steps.slice(0,-1);
      if (settings.style !== 'offbeat') steps.push(Math.min(15,steps.at(-1) + (phase % 2 ? 3 : 1)));
    }
    if (turnaround) steps = [steps[0], settings.style === 'offbeat' ? n-2 : Math.max(steps[0]+1, n-3)];
  }
  // A phrase has deliberate space, with a fuller response in the chorus/drop.
  if (quiet) steps = local % 2 ? [] : steps.slice(0,1);
  else if (!energy && turnaround && settings.phraseBars >= 4) steps = [];
  else if (energy && (pos === 2 || pos === 0 && cycle)) steps.push(Math.max(0,n-2));
  if (settings.coordination === 'interlock' && ['comp','funk','riff'].includes(settings.style)) {
    const bassAttacks = bass.filter(e => e.bar === bar).map(e => e.step - info.startStep);
    // Keep beat anchors, but leave space around the bass's syncopated pickups.
    let space = steps.length > 2 ? 1 : 0;
    steps = steps.filter(step => {
      if (space && step % 4 !== 0 && bassAttacks.some(at => Math.abs(at - step) < 1.5)) { space--; return false; }
      return true;
    });
  }
  const cells = make(steps,settings.style === 'riff' ? 'riff' : 'chord',settings.style === 'funk' || settings.style === 'riff' ? .48 : .84);
  if (!quiet && answer && cells.length && ['funk','riff'].includes(settings.style) && !turnaround) {
    cells[0].length = Math.min(n-cells[0].step,6);
    return cells.filter((cell,i)=>!i || cell.step>=cells[0].step+cells[0].length);
  }
  return cells;
}
