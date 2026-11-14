import { tunedHz } from './tuning.js';
import { accompanimentCells, ensembleAnswerStep } from './accompaniment.js';
import { random, clamp } from './random.js';
import { compilePrompt, SCALES } from './parser.js';
import { progression } from './harmony.js';
import { barInfo, barStep, chordAt, timeAtStep } from './arrangement.js';
import { fitPattern } from './meter.js';
import { GROOVE_TEMPLATES, grooveTime, drumPhrase, addPercussion } from './groove.js';
export { swingTime } from './groove.js';
import { melodicDegree, shapeSectionDynamics, transformMotif } from './development.js';
import { resolveParts, generateParts } from './parts.js';
import { generatePedalSteel } from './pedal-steel.js';
import { arrangeVocals } from './vocals.js';
import { SYNTH_PROFILES } from './synthesis.js';

export const SECTIONS = [
  { name: 'intro', start: 0, end: 4, kick: true, snare: false, hats: .45, bass: false, keys: .7 },
  { name: 'verse', start: 4, end: 12, kick: true, snare: true, hats: .75, bass: true, keys: .75 },
  { name: 'breakdown', start: 12, end: 16, kick: false, snare: false, hats: .2, bass: false, keys: 1 },
  { name: 'build', start: 16, end: 20, kick: true, snare: true, hats: .85, bass: false, keys: .85 },
  { name: 'drop', start: 20, end: 28, kick: true, snare: true, hats: 1, bass: true, keys: 1 },
  { name: 'outro', start: 28, end: 32, kick: true, snare: true, hats: .5, bass: true, keys: .55 },
];
export function sectionsFor(config) {
  if (config?.arrangement?.custom) return config.arrangement.sections;
  return config?.arrangement?.longBuild ? SECTIONS.map((s) => ({ ...s,
    ...(s.name === 'verse' ? { end: 10 } : s.name === 'breakdown' ? { start: 10, end: 12 } : s.name === 'build' ? { start: 12 } : {}) })) : SECTIONS;
}
export const sectionAt = (bar, config) => sectionsFor(config).find((s) => bar >= s.start && bar < s.end);

// Continuous interval quantization requested by the spec; phase rotates right.
export function euclidean(k, n, phase = 0) {
  if (!Number.isInteger(n) || n < 1 || n > 4096 || !Number.isInteger(k) || k < 0 || k > n || !Number.isInteger(phase)) {
    throw new Error('Euclidean rhythm requires integers 0 <= k <= n <= 4096 and an integer phase.');
  }
  const base = Array.from({ length: n }, (_, i) => Math.floor((i + 1) * k / n) - Math.floor(i * k / n));
  return base.map((_, i) => base[((i - phase) % n + n) % n]);
}

export function linearMasks({ kick, snare, hat, aux }, snareAnchors = []) {
  const anchors = new Set(snareAnchors);
  // Intentional electronic backbeats can layer; generated ghosts yield to kick.
  const s = snare.map((v, i) => kick[i] && !anchors.has(i) ? 0 : v);
  const h = hat.map((v, i) => s[i] >= .65 ? 0 : v);
  const a = aux.map((v, i) => kick[i] || s[i] || h[i] ? 0 : v);
  return { kick: [...kick], snare: s, hat: h, aux: a };
}

export function ratchet(event, count) {
  if (![2, 3, 4, 8].includes(count)) throw new Error('Ratchet count must be 2, 3, 4 or 8.');
  return Array.from({ length: count }, (_, i) => ({
    ...event, step: event.step + i / count, time: event.time + i * event.stepSeconds / count,
    duration: Math.min(event.duration, event.stepSeconds / count * .85),
    velocity: event.velocity * Math.exp(-.48 * i), pitch: (event.pitch ?? 0) + [0, 1, -1, 2][i % 4],
    ratchet: count,
  }));
}

function eventAt(config, bar, step, voice, velocity, rng, extra = {}) {
  const globalStep = barStep(config, bar) + step;
  // Tiny jitter follows swing and never moves an event outside its grid cell.
  const jitter = voice === 'kick' ? 0 : rng() * .003;
  const time = Math.min(config.duration - .0001, grooveTime(config, globalStep, voice) + jitter);
  return {
    voice, bar, step: globalStep, time,
    velocity: velocity * (GROOVE_TEMPLATES[config.groove?.template]?.accents[Math.floor(step) % 4] ?? 1), duration: voice === 'kick' ? .25 : voice === 'snare' ? .2 : .055,
    // Ratchets divide the actual swung cell, including its shorter odd half.
    stepSeconds: Math.max(.0001, grooveTime(config, globalStep + 1, voice) - time),
    kit: config.soundDesign?.drumKit, drumDrive: config.soundDesign?.drumDrive,
    pan: voice === 'hat' ? .25 : voice === 'tom' ? -.25 : 0,
    pitch: 0, ...extra,
  };
}

export function generateDrums(config) {
  const rng = random(config.seed, 'drums');
  const fillRng = random(config.seed, 'fills');
  const drums = { kick: [], snare: [], hat: [], tom: [] };
  if (config.soundDesign?.drumsEnabled === false) return drums;
  const phrased = Boolean(config.rhythm?.kick) || (config.timeSignature ?? '4/4') !== '4/4' || ['deep_house', 'speed_garage', 'trap_halftime', 'afro_house', 'liquid_dnb', 'country_acoustic', 'jazz_lounge'].includes(config.intent);
  for (let bar = 0; bar < config.bars; bar++) {
    const n = barInfo(config, bar).stepsPerBar;
    const s = sectionAt(bar, config);
    const phrase = drumPhrase({ ...config, ...barInfo(config, bar) }, bar);
    const kick = Array(n).fill(0), snare = Array(n).fill(0), hat = Array(n).fill(0), aux = Array(n).fill(0);
    const intro = bar < 2;
    const fading = bar >= config.bars - 2;
    if (s.kick && !intro && !fading) for (const i of phrase.kick) kick[i] = .88 + .12 * rng();
    if (s.snare && !fading) for (const i of phrase.snare) snare[i] = .82 + .15 * rng();
    const extras = euclidean(Math.min(n, Math.round(config.density * 5)), n, bar % 3);
    for (let i = 0; i < n; i++) {
      if (!phrased && !intro && !fading && s.kick && extras[i] && !kick[i] && !snare[i]
          && !['offbeat_pump', 'techno_roll'].includes(config.bassMode) && !['synthwave_retro', 'synthpop_80s'].includes(config.intent) && rng() < .22 * (config.soundDesign?.drumDensity ?? 1)) kick[i] = .62;
      if (!phrased && s.snare && extras[i] && !snare[i] && rng() < config.density * .2 * (config.soundDesign?.drumDensity ?? 1)) snare[i] = .3;
      if (GROOVE_TEMPLATES[config.groove?.template]?.hat ? fitPattern(GROOVE_TEMPLATES[config.groove.template].hat, n).includes(i) : config.rhythm?.hat ? fitPattern(config.rhythm.hat, n).includes(i) : i % 2 === 0 || rng() < config.density * .65) {
        if (rng() < s.hats * (config.soundDesign?.drumDensity ?? 1)) hat[i] = (i % 4 === 2 ? .65 : .38) * (.85 + .3 * rng());
      }
    }
    for (const i of fitPattern(config.groove?.funk ? [3, 7, 11, 15] : config.rhythm?.ghosts ?? [], n)) if (s.snare && !fading && !snare[i]) snare[i] = .18;
    if (config.intent === 'liquid_dnb' && s.snare && !fading) {
      for (const i of fitPattern(bar % 2 ? [3, 7, 15] : [3, 11], n)) snare[i] = .22;
    }
    const turnaround = bar % 4 === 3;
    if (turnaround && fillRng() < config.sauce) {
      const count = Math.min(n, 2 + Math.floor(config.sauce * 6));
      // Fills replace hats in their cells, then still yield to kick/snare.
      for (let i = n - count; i < n; i++) {
        hat[i] = 0;
        if (config.soundDesign?.acoustic) snare[i] = i % 2 ? .18 : .4;
        else aux[i] = .45 + (i - (n - count)) / count * .4;
      }
    }
    if (s.name === 'build' && !['jazz_lounge', 'country_acoustic'].includes(config.intent)) {
      const remaining = s.end - bar;
      const spacing = remaining > 2 ? 4 : remaining === 2 ? 2 : 1;
      for (let i = 0; i < n; i += spacing) if (!snare[i]) snare[i] = .32 + (bar - s.start) / Math.max(1, s.end - s.start) * .28;
    }
    const masked = linearMasks({ kick, snare, hat, aux }, phrase.snare);
    for (const [key, voice] of [['kick', 'kick'], ['snare', 'snare'], ['hat', 'hat'], ['aux', 'tom']]) {
      masked[key].forEach((velocity, i) => {
        if (!velocity) return;
        const e = eventAt(config, bar, i, voice, velocity, rng, voice === 'tom' ? { note: 45 - (i % 4) * 2, duration: .18 }
          : voice === 'snare' && config.soundDesign?.snareProfile && config.soundDesign.snareProfile !== 'standard' ? { profile: config.soundDesign.snareProfile, duration: .27 } : {});
        const rolling = (voice === 'hat' || (voice === 'snare' && velocity < .65))
          && rng() < config.sauce * (turnaround ? .3 : .065);
        const fillRoll = voice === 'tom' && i >= n - 2;
        const pulses = config.intent === 'trap_halftime' && voice === 'hat' ? (i % 4 === 3 ? 4 : 2) : fillRoll ? (i === n - 1 && config.sauce > .7 ? 8 : i === n - 1 ? 4 : 2) : rng.pick([2, 3, 4, 8]);
        drums[voice].push(...(rolling || fillRoll ? ratchet(e, pulses) : [e]));
      });
    }
  }
  if (config.groove?.tuplet || config.groove?.subdivision !== 'straight' && config.groove?.subdivision) {
    drums.hat = [];
    for (let bar = 0; bar < config.bars; bar++) {
    const n = barInfo(config, bar).stepsPerBar;
      const section = sectionAt(bar, config);
      for (let beat = 0; beat < n; beat += 4) {
        const offsets = config.groove.tuplet ? Array.from({ length: config.groove.tuplet }, (_, i) => i * 4 / config.groove.tuplet) : config.groove.subdivision === 'shuffle' ? [0, 8 / 3] : [0, 4 / 3, 8 / 3];
        for (const offset of offsets) if (beat + offset < n && rng() < section.hats * (config.soundDesign?.drumDensity ?? 1)) {
          const event = eventAt(config, bar, beat + offset, 'hat', offset ? .3 : .48, rng);
          event.time = clamp(timeAtStep(config, barStep(config, bar) + beat + offset) + (config.groove.offsets.hat ?? 0), 0, config.duration - .0001);
          event.stepSeconds = barInfo(config, bar).stepSeconds * 4 / (config.groove.tuplet ?? 3);
          drums.hat.push(event);
        }
      }
    }
  }
  return addPercussion(drums, config, sectionsFor(config));
}

function degreeNote(config, chord, rng) {
  const pc = rng() < .75 ? chord.root : chord.pitchClasses[2];
  // Octave 1 keeps a musical low sub; C/B fall just outside nominal 35–60 Hz.
  return 24 + pc;
}

// Sustained/phrase bass still consumes final kick timings; kick ducking does
// not retrigger the held oscillator. Explicit presence can span every section.
function generateDesignedBass(kicks, chords, config) {
  const sound = config.soundDesign;
  const events = [];
  const phrasing = sound.bassPhrasing ?? 'genre';
  const shaped = ['bounce', 'call_response'].includes(phrasing);
  const sustained = !shaped && (sound.bassArticulation === 'sustained' || config.bassMode === 'sustained');
  const staccato = sound.bassArticulation === 'staccato';
  const phase = random(config.phraseSeed ?? config.seed, 'bass-phrasing').int(0, 3);
  const bouncePatterns = [ [[0, 5.5], [7, 1.5], [10, 3], [15, 1]], [[0, 7], [9, 2], [12, 3.5]], [[0, 3], [4, 1.5], [7, 5], [14, 1.5]], [[0, 6], [8, 4], [13, 2.5]] ];
  const responsePatterns = [ [[0, 11], [13, 2]], [[0, 3], [5, 2], [9, 5], [15, .75]], [[0, 15]], [[2, 3], [7, 2], [11, 4]] ];
  const patterns = [ [[0, 12], [14, 2]], [[0, 6], [8, 7]], [[0, 15]], [[0, 4], [6, 6], [14, 2]] ];
  for (let bar = 0; bar < config.bars; bar++) {
    const n = barInfo(config, bar).stepsPerBar;
    const section = sectionAt(bar, config);
    if (sound.bassPresence !== 'throughout' && (!section.bass || bar >= config.bars - 2)) continue;
    const local = bar - section.start;
    const chordBoundary = chords.some(c => c.bar === bar);
    if (sustained && !staccato && local % 2 && !chordBoundary) continue;
    // An opening motif repeats before its answer; do not rotate to an unrelated
    // rhythm every bar. Chorus/drop endings develop the same phrase.
    const phraseIndex = (phase + (local % 4 === 3 ? 2 : local % 2)) % 4;
    const chord = chordAt(chords, bar);
    const pattern = phrasing === 'bounce' ? bouncePatterns[phraseIndex]
      : phrasing === 'call_response' ? responsePatterns[phraseIndex]
      : sustained && !staccato ? [[0, 32]] : staccato ? [[0, 1.4], [4, 1.4], [8, 1.4], [12, 1.4]] : patterns[bar % patterns.length];
    for (let p = 0; p < pattern.length; p++) {
      let [at, length] = pattern[p];
      if (at >= n) continue;
      const nextChord = chords.find(c => c.bar > bar)?.bar ?? config.bars;
      length = sustained && !staccato ? barStep(config, Math.min(bar + 2, section.end, nextChord)) - barStep(config, bar) : Math.min(length, n - at);
      const step = barStep(config, bar) + at;
      const kick = config.groove?.offsets.bass !== undefined || config.groove?.swings.bass !== undefined ? null : kicks.find((k) => k.step === step);
      const time = kick?.time ?? grooveTime(config, step, 'bass');
      const end = Math.min(config.duration, grooveTime(config, step + length, 'bass'));
      const responding = shaped ? p > 0 || (phrasing === 'call_response' && local % 2) : !sustained && bar % 2 && p > 0;
      const accent = shaped ? [1, .78, .9, .68][p % 4] : 1;
      events.push({ voice: 'bass', bar, step, time, duration: end - time,
        note: 24 + (responding ? chord.pitchClasses[(bar + p) % 2 + 1] : chord.root), velocity: (section.name === 'breakdown' ? .55 : .88) * accent,
        durationIsSeconds: true, profile: sound.bassTexture, pan: 0, glide: true, coupled: Boolean(kick),
        drive: sound.bassDrive, motion: sound.bassMotion,
        wobbleBeats: [1, .5, 2, .5][bar % 4], beatSeconds: config.stepSeconds * 4,
        phrase: shaped ? phrasing + '-' + phraseIndex : sustained ? 'held' : 'answer-' + bar % 4,
      });
    }
  }
  for (let i = 0; i < events.length; i++) {
    events[i].fromNote = i ? events[i - 1].note : events[i].note;
    if (events[i + 1]) events[i].duration = Math.min(events[i].duration, events[i + 1].time - events[i].time);
  }
  return events;
}

// No bass patterns exist until the final drum array has been generated.
export function generateBass(kicks, chords, config) {
  if (config.soundDesign?.bassEnabled === false) return [];
  if (config.soundDesign?.drumsEnabled === false) return generateDesignedBass(kicks, chords, config);
  if (config.soundDesign && (config.soundDesign.bassArticulation !== 'genre' || ['bounce', 'call_response'].includes(config.soundDesign.bassPhrasing) || ['sustained', 'bass_phrases'].includes(config.bassMode))) return generateDesignedBass(kicks, chords, config);
  const rng = random(config.seed, 'bass');
  const local = (steps, bar) => fitPattern(steps, barInfo(config, bar).stepsPerBar).map((i) => barStep(config, bar) + i);
  const events = [];
  for (let bar = 0; bar < config.bars; bar++) {
    const n = barInfo(config, bar).stepsPerBar;
    if (!sectionAt(bar, config).bass || bar >= config.bars - 2) continue;
    const chord = chordAt(chords, bar);
    const barKicks = kicks.filter((k) => k.bar === bar);
    const occupied = new Map(barKicks.map((k) => [k.step, k]));
    let steps;
    switch (config.bassMode) {
      case 'unison_lock': case 'sliding_808': steps = barKicks.map((k) => k.step); break;
      case 'counterpoint': steps = Array.from({ length: n }, (_, i) => barStep(config, bar) + i)
        .filter((step) => !occupied.has(step) && (step % 2 === 1 || step % 4 === 2) && rng() < .52); break;
      case 'offbeat_pump': steps = local([2, 6, 10, 14], bar); break;
      case 'octave_pulse': steps = local([0, 2, 4, 6, 8, 10, 12, 14], bar); break;
      case 'root_fifth': steps = [0, Math.floor(n / 2)].map((i) => barStep(config, bar) + i); break;
      case 'garage_phrases': steps = local(bar % 2 ? [1, 6, 11, 14] : [0, 3, 7, 10], bar); break;
      case 'afro_response': steps = local(bar % 2 ? [2, 7, 10, 15] : [0, 6, 11], bar); break;
      case 'liquid_phrases': steps = local(bar % 2 ? [0, 7, 10] : [0, 10], bar); break;
      case 'walking': steps = Array.from({ length: Math.ceil(n / 4) }, (_, i) => barStep(config, bar) + i * 4); break;
      case 'pattern': steps = local(config.rhythm.bass[bar % config.rhythm.bass.length], bar); break;
      case 'none': steps = []; break;
      case 'techno_roll': steps = local([0, 3, 4, 6, 8, 11, 12, 14], bar); break;
      case 'rolling_16th': steps = Array.from({ length: n }, (_, i) => barStep(config, bar) + i); break;
      case 'syncopated_fm': steps = euclidean(Math.min(n, 5 + bar % 2), n, 2 + bar % 3)
        .flatMap((on, i) => on ? [barStep(config, bar) + i] : []); break;
      case 'polymetric': steps = Array.from({ length: n }, (_, i) => barStep(config, bar) + i).filter((step) => euclidean(5, 15)[step % 15]); break;
      case 'syncopated_sub': steps = [...new Set([...barKicks.map((k) => k.step), ...local([7, 15], bar)])]; break;
      default: steps = barKicks.map((k) => k.step);
    }
    if (config.groove?.tresillo) steps = local([0, 6, 12], bar);
    for (const step of steps.sort((a, b) => a - b)) {
      const position = Math.floor(((step - barStep(config, bar))) / 4);
      const nextChord = chordAt(chords, bar + 1);
      // Quarter-note walking line: root, third, fifth, approach to the following root.
      const walking = [36 + chord.root, 36 + chord.pitchClasses[1], 36 + chord.pitchClasses[2], 36 + nextChord.root - 1];
      const note = config.bassMode === 'walking' ? walking[position % 4]
        : config.bassMode === 'root_fifth' ? 36 + ((step - barStep(config, bar)) === 0 ? chord.root : chord.pitchClasses[2]) : degreeNote(config, chord, rng);
      const coupling = config.bassMode === 'walking' || config.groove?.offsets.bass !== undefined || config.groove?.swings.bass !== undefined ? null : occupied.get(step);
      const rolling = config.bassMode === 'rolling_16th';
      const octave = config.bassMode === 'octave_pulse';
      events.push({
        voice: 'bass', bar, step, time: coupling?.time ?? grooveTime(config, step, 'bass'),
        note: (rolling || octave) && step % 4 === 2 ? note + 12 : note,
        velocity: .76 + rng() * .18, duration: config.stepSeconds * (config.rhythm?.bassLength ?? (config.bassMode === 'walking' ? 3.7 : config.bassMode === 'root_fifth' ? 6.5 : config.bassMode === 'liquid_phrases' ? 6 : octave ? 1.5 : rolling ? .88 : config.bassMode === 'offbeat_pump' ? 1.65 : 2.8)),
        profile: config.bassProfile, pan: 0, drive: config.soundDesign?.bassDrive, motion: config.soundDesign?.bassMotion, beatSeconds: config.stepSeconds * 4, glide: (config.bassMode === 'sliding_808' || config.bassProfile === 'acid_bass') && rng() < .65,
        coupled: Boolean(coupling),
      });
    }
  }
  for (let i = 0; i < events.length; i++) {
    events[i].fromNote = events[i].glide && i ? events[i - 1].note : events[i].note;
    // Monophonic bass avoids overlapping fundamentals muddying the sub region.
    if (events[i + 1]) events[i].duration = Math.min(events[i].duration, events[i + 1].time - events[i].time);
  }
  return events;
}

function generateKeys(config, chords, bass, reserveAnswers) {
  const rng = random(config.seed, 'keys'), events = [];
  const sound = config.soundDesign ?? {}, settings = config.accompaniment;
  if (sound.harmonyRole === 'none') return events;
  for (let bar = 0; bar < config.bars; bar++) {
    const chord = chordAt(chords, bar), intervals = SCALES[chord.mode] ?? config.intervals;
    const section = sectionAt(bar, config), voicing = [...chord.notes];
    if (['sevenths', 'ninths'].includes(sound.harmonyColor) && (config.development?.chordSize??3)===3) {
      const pc = chord.color !== 'diatonic' ? (chord.root + 10) % 12 : ((chord.keyRoot ?? config.root) + intervals[(chord.degree + 6) % intervals.length]) % 12;
      voicing.push(60 + pc);
      if (sound.harmonyColor === 'ninths') voicing.push(72 + ((chord.keyRoot ?? config.root) + intervals[(chord.degree + 1) % intervals.length]) % 12);
    }
    const cells = accompanimentCells(config, chords, bar, settings, section, 'keys', bass);
    const reply = reserveAnswers ? ensembleAnswerStep(config, bar, section) : null;
    const replyTime = reply === null ? Infinity : grooveTime(config, barStep(config, bar) + reply, 'keys');
    for (const [index, cell] of cells.entries()) {
      if (cell.step === reply) continue;
      let notes = cell.shape === 'broken' ? [voicing[cell.tone % voicing.length] + (index >= 4 ? 12 : 0)]
        : cell.shape === 'riff' ? [voicing[cell.tone % voicing.length]]
        : ['dark_bells','fm_plucks'].includes(config.synthProfile) ? [cell.cadence ? 60 + chord.root : rng.pick(voicing) + 12] : [...voicing];
      if (cell.shape === 'broken' && cell.step === 0 && sound.harmonyPattern === 'broken_piano') notes.push(36 + chord.root);
      if (cell.shape === 'strum' && bar % 2) notes.reverse();
      const step = barStep(config, bar) + cell.step;
      for (const [string, note] of notes.entries()) {
        const time = Math.min(config.duration - .0001, grooveTime(config, step, 'keys') + (cell.shape === 'strum' ? string * .009 : 0));
        const end = Math.min(timeAtStep(config, step + cell.length), reply !== null && cell.step < reply ? replyTime : Infinity);
        events.push({ voice: 'keys', bar, step, time, note: note + (sound.harmonyRegister ?? 0),
          velocity: (.34 + .12 * rng()) * section.keys * cell.accent,
          duration: Math.max(.0001, end - time), durationIsSeconds: true,
          pan: clamp((note - 64) / 30, -.55, .55), profile: config.synthProfile,
          role: settings.style === 'sustain' ? 'pad' : cell.shape === 'broken' ? 'piano_figure' : 'chords',
          phrase: settings.style + '-' + Math.floor((bar - section.start) / settings.phraseBars) % 2 });
      }
    }
  }
  return events;
}

function generateMelody(config, chords, keys) {
  const sound = config.soundDesign;
  const steel = sound?.leadEnabled && sound.leadProfile === 'pedal_steel';
  const lead = steel ? generatePedalSteel(config, chords, sectionsFor(config), keys)
    .map((event) => ({ ...event, durationIsSeconds: true })) : [];
  const arp = [];
  if (!sound?.leadEnabled && !sound?.arpEnabled) return { lead, arp };
  const rng = random(config.phraseSeed ?? config.seed, 'melody');
  const hook = rng.pick([[0, 2, 4, 5, 4, 2, 1, 2], [0, 4, 2, 6, 5, 4, 2, 1], [0, 1, 2, 4, 3, 2, 5, 4], [4, 5, 4, 2, 0, 1, 2, 6]]);
  const kind = config.development?.motif ?? 'variation';
  const transformed = transformMotif(hook, kind === 'variation' ? 'retrograde' : kind, config.development?.transpose ?? 0);
  const answer = kind === 'variation' && !config.development?.transpose ? [...hook.slice(0, 2), ...transformed.slice(2)] : transformed;
  const melodicRng=random(config.phraseSeed??config.seed,'second-order-melody'),history=[];
  const timingOffset = rng.int(0, 3);
  const timing = [[0, 2, 5, 8, 10, 13], [0, 3, 6, 8, 11, 14], [0, 2, 4, 7, 10, 12], [0, 4, 6, 9, 12, 14]];
  for (let bar = 0; bar < config.bars; bar++) {
    const n = barInfo(config, bar).stepsPerBar;
    const chord = chordAt(chords, bar);
    const intervals = SCALES[chord.mode] ?? config.intervals;
    const section = sectionAt(bar, config);
    const localBar = bar - section.start;
    const opening = section.name === 'intro';
    const breakSection = section.name === 'breakdown';
    const outro = section.name === 'outro';
    const arrival = ['drop', 'chorus'].includes(section.name);
    const ending = bar === config.bars - 1;
    const pickup = section.name === 'build' && bar === section.end - 1;
    const echo = opening || breakSection || outro;
    const playLead = ending || (opening ? bar === section.end - 1 : breakSection || outro ? localBar === 0 : true);
    const phrasePosition = localBar % 4;
    const isAnswer = phrasePosition % 2 === 1;
    if (sound.leadEnabled && !steel && playLead) {
      const development = section.name === 'B' ? 'inversion' : section.name === 'C' || section.name === 'variation3' ? 'fragmentation' : section.name === 'variation1' ? 'retrograde' : 'variation';
      const motif = echo ? hook : development === 'variation' ? isAnswer ? answer : hook : transformMotif(hook, development, section.name === 'B' ? 2 : 0);
      const stretch = (config.development?.stretch ?? 1) * (section.name === 'variation2' ? 2 : 1);
      const rhythmIndex = (timingOffset + (phrasePosition === 3 ? 1 : 0)) % timing.length;
      let steps = fitPattern(timing[rhythmIndex].map((s) => s * stretch).filter((s) => s < 16), n);
      if (ending) steps = [0, Math.max(1, Math.floor(n / 4))];
      else if (echo) steps = steps.slice(0, 2);
      else if (isAnswer) steps = steps.slice(0, Math.max(1, steps.length - (arrival ? 1 : 2)));
      const phraseEnd = pickup ? n - Math.min(4, n / 4) : n;
      if (pickup) steps = steps.filter((step) => step < phraseEnd);
      for (let i = 0; i < steps.length; i++) {
        const last = i === steps.length - 1;
        const cadence = last && (ending || config.development?.cadence && phrasePosition === 3);
        const degree = config.development?.melodyModel==='second_order' ? melodicDegree(history,intervals.length,chord.degree,melodicRng,{maxLeap:config.development.maxLeap,cadence}) : cadence ? chord.degree : motif[(ending ? i + 1 : i) % motif.length];
        history.push(degree);
        const root = chord.keyRoot ?? config.root;
        const register = sound.leadProfile === 'cello' ? 48 : ['fiddle', 'saxophone'].includes(sound.leadProfile) ? 60 : 72;
        let note = register + root + intervals[((degree % intervals.length) + intervals.length) % intervals.length] + Math.floor(degree / intervals.length) * 12;
        if (ending && last) note = register + chord.root;
        if(config.development?.melodyModel==='second_order'&&lead.length){
          const old=lead.at(-1).note,max=config.development.maxLeap;
          let candidates=Array.from({length:9},(_,o)=>intervals.map(pc=>24+12*o+root+pc)).flat().filter(n=>Math.abs(n-old)<=max);
          if(cadence){const tones=candidates.filter(n=>chord.pitchClasses.includes(n%12));if(tones.length)candidates=tones;}
          if(ending&&last){const roots=candidates.filter(n=>n%12===chord.root);if(roots.length)candidates=roots;}
          if(candidates.length)note=candidates.sort((a,b)=>Math.abs(a-note)-Math.abs(b-note))[0];else note=old;
        }
        const step = barStep(config, bar) + steps[i];
        const length = Math.min((steps[i + 1] ?? phraseEnd) - steps[i], ending && last ? n / 2 : (isAnswer || echo) && last ? 2 : n);
        const time = grooveTime(config, step, 'lead');
        lead.push({ voice: 'lead', role: 'lead', profile: sound.leadProfile ?? 'analog_lead', bar, step,
          time, duration: Math.max(.0001, timeAtStep(config, step + length * .86) - time), durationIsSeconds: true,
          velocity: ending ? .56 : echo ? .42 : arrival ? .78 : .62, note, fromNote: lead.at(-1)?.note ?? note, pan: -.08,
          phrase: isAnswer ? 'answer' : 'hook' });
      }
    }
    if (sound.arpEnabled && bar >= 2 && !ending && !outro) {
      const pattern = isAnswer ? answer : hook;
      const spacing = opening || breakSection ? 4 : 2;
      for (let i = 0; i * spacing < (pickup ? n - Math.min(4, n / 4) : n); i++) {
        const step = barStep(config, bar) + i * spacing;
        const degree = (pattern[i % pattern.length] % chord.notes.length + chord.notes.length) % chord.notes.length;
        const time = grooveTime(config, step, 'arp');
        const length = sound.arpProfile === 'banjo' ? 1.8 : 1.3;
        arp.push({ voice: 'arp', role: 'arpeggio', profile: sound.arpProfile ?? 'analog_pluck', bar, step,
          time, duration: Math.max(.0001, timeAtStep(config, Math.min(barStep(config, bar + 1), step + length)) - time), durationIsSeconds: true,
          note: sound.arpProfile === 'banjo' && i % 4 === 3 ? 72 + chord.pitchClasses[2] : chord.notes[degree] + 12,
          velocity: (.22 + rng() * .07) * (opening || breakSection ? .65 : sound.leadEnabled && !isAnswer ? .82 : 1), pan: i % 2 ? .5 : -.5 });
      }
    }
  }
  return { lead, arp };
}

function sauceAutomation(config) {
  const rng = random(config.seed, 'sauce');
  const result = [];
  const drop = sectionsFor(config).find((s) => s.name === 'drop');
  if (drop && rng() < config.sauce && config.soundDesign?.bassPresence !== 'throughout') result.push({ type: 'air', startStep: barStep(config, drop.start) - 4, endStep: barStep(config, drop.start) });
  for (let bar = 3; bar < config.bars; bar += 4) {
    const n = barInfo(config, bar).stepsPerBar;
    if (rng() < config.sauce * .85) result.push({ type: 'stutter', startStep: barStep(config, bar) + n * .875, endStep: barStep(config, bar + 1), sliceSteps: rng() < .5 ? .5 : .25 });
  }
  if (rng() < config.sauce) result.push({ type: 'brake', startStep: barStep(config, config.bars - 1) + barInfo(config, config.bars - 1).stepsPerBar / 2, endStep: barStep(config, config.bars) });
  return result;
}

export function compose(prompt, options = {}) {
  const config = compilePrompt(prompt, options);
  const chords = progression(config);
  const drums = generateDrums(config);
  const bass = generateBass(drums.kick, chords, config);
  const definitions = resolveParts(prompt, config, options.parts);
  const reserveAnswers = definitions.some(part => part.pattern === 'answer');
  const keys = generateKeys(config, chords, bass, reserveAnswers);
  const melody = generateMelody(config, chords, keys);
  // Context changes the actual mix balance, not only the reported style name.
  const sound = config.soundDesign;
  for (const events of Object.values(drums)) for (const e of events) e.velocity *= sound.drumGain ?? 1;
  for (const e of bass) e.velocity *= sound.bassGain ?? 1;
  const synthPopPad = config.intent === 'synthpop_80s' && config.accompaniment.style === 'sustain'
    && (config.synthProfile.endsWith('_pad') || Object.hasOwn(SYNTH_PROFILES, config.synthProfile));
  const harmonyGain = (sound.harmonyGain ?? 1) * (synthPopPad ? .55 : 1);
  for (const e of keys) e.velocity *= harmonyGain;
  const acoustic = config.soundDesign.acoustic ?? ['jazz_lounge', 'classical_minimal', 'country_acoustic'].includes(config.intent);
  const automation = acoustic ? [] : sauceAutomation(config);
  // Remove triggers inside an air pocket as well as muting rendered effect tails.
  const audible = (event) => !automation.some((a) => a.type === 'air' && event.step >= a.startStep && event.step < a.endStep);
  for (const voice of Object.keys(drums)) drums[voice] = drums[voice].filter(audible);
  for (const e of [...bass, ...keys, ...melody.lead, ...melody.arp]) {
    const seconds = e.durationIsSeconds ? e.duration : timeAtStep(config, e.step + e.duration / config.stepSeconds) - timeAtStep(config, e.step);
    e.duration = Math.max(.0001, Math.min(config.duration - e.time, seconds));
    delete e.durationIsSeconds;
  }
  for (let i = 0; i < bass.length - 1; i++) bass[i].duration = Math.max(.0001, Math.min(bass[i].duration, bass[i + 1].time - bass[i].time));
  for (const e of [...bass, ...keys, ...melody.lead, ...melody.arp]) {
    e.articulation = sound.articulation; e.pedal = sound.pedal;
    if (sound.articulation === 'staccato' || sound.articulation === 'muted') e.duration *= .5;
  }
  const parts = generateParts(config, chords, sectionsFor(config), definitions, bass, keys);
  for (const part of parts) part.events = part.events.filter(audible);
  shapeSectionDynamics(config, sectionsFor(config), [...Object.values(drums).flat(), ...keys, ...melody.arp, ...parts.flatMap(p=>p.events)]);
  const pitched = [...bass,...keys,...melody.lead,...melody.arp,...parts.flatMap(p=>p.events)];
  const standardTuning=config.tuning.system==='edo'&&config.tuning.divisions===12&&config.tuning.concertPitch===440&&config.tuning.mapping==='chromatic';
  for(const e of pitched){
    for(const [k,v] of Object.entries(config.timbre))if(e[k]===undefined)e[k]=v;
    if(Object.keys(config.timbre).length||e.modulation)e.bpm=barInfo(config,e.bar).bpm;
    if(!standardTuning||e.cents){e.frequency=tunedHz(e.note,config.tuning,60+config.root)*2**((e.cents??0)/1200);if(Number.isFinite(e.fromNote))e.fromFrequency=tunedHz(e.fromNote,config.tuning,60+config.root)*2**((e.cents??0)/1200);}
  }
  const vocals = arrangeVocals(config, sectionsFor(config), automation, options);
  return {
    ...(vocals ? { vocals } : {}),
    config, parts, sections: sectionsFor(config).map((s) => ({ ...s, startTime: timeAtStep(config, barStep(config, s.start)), endTime: timeAtStep(config, barStep(config, s.end)) })), chords, drums,
    bass: bass.filter(audible), keys: keys.filter(audible), lead: melody.lead.filter(audible), arp: melody.arp.filter(audible), automation,
    sidechain: { duckDb: acoustic ? -3 : -21, tauSeconds: .055 },
  };
}
