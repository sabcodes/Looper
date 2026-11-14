import { validateTimbre, TIMBRE_FIELDS } from './timbre.js';
import { grooveTime } from './groove.js';
import { resolveAccompaniment, accompanimentCells } from './accompaniment.js';
import { INSTRUMENTS } from './instruments.js';
import { barInfo, barStep, chordAt, timeAtStep } from './arrangement.js';
import { random } from './random.js';
import { bounded, resolveProduction } from './effects.js';
import { generatePedalSteel } from './pedal-steel.js';

export const PART_INSTRUMENTS = { ...INSTRUMENTS,
  rhodes_stabs: { names: 'rhodes|electric piano', role: 'harmony' },
  analog_saw_pad: { names: 'analog saw pad|analog pad', role: 'harmony' },
  analog_lead: { names: 'analog lead', role: 'lead' },
  reese_bass: { names: 'reese bass', role: 'bass' },
  sine_sub: { names: 'sine sub', role: 'bass' },
};

export function resolveParts(prompt, config, requested = []) {
  if (!Array.isArray(requested) || requested.length > 16 || requested.some((p) => !p || typeof p !== 'object' || Array.isArray(p))) throw new Error('Use at most sixteen additional parts.');
  const sound = config.soundDesign, active = new Set([config.synthProfile, sound.bassEnabled && config.bassProfile, sound.leadEnabled && sound.leadProfile, sound.arpEnabled && sound.arpProfile]);
  const detected = [];
  const text = prompt.toLowerCase().replace(/[-_]/g, ' ');
  // Longest match prevents electric guitar from also adding an acoustic guitar.
  const names = Object.values(PART_INSTRUMENTS).map((i) => i.names).sort((a, b) => b.length - a.length).join('|');
  for (const match of text.matchAll(new RegExp('\\b(?:' + names + ')\\b', 'g'))) {
    const [profile, instrument] = Object.entries(PART_INSTRUMENTS).find(([, i]) => new RegExp('^(?:' + i.names + ')$').test(match[0])) ?? [];
    if (!profile || active.has(profile) || detected.some((p) => p.profile === profile) || sound.exclusions.includes(profile) || sound.exclusions.includes(instrument.role === 'arp' ? 'arpeggio' : instrument.role)) continue;
    detected.push({ name: profile, profile, role: instrument.role });
  }
  const customHarmony = [...detected, ...requested].some(p => (p.role ?? PART_INSTRUMENTS[p.profile]?.role) === 'harmony');
  const defaults = (config.ensemble ?? []).filter((p) => p.pattern !== 'answer' || (
    config.accompaniment.source === 'genre' && config.accompaniment.style !== 'sustain'
    && (config.intent !== 'dancehall' || config.accompaniment.shortStabs)
    && sound.harmonyRole !== 'none' && ['organ', 'steelpan'].includes(config.synthProfile)
    && !customHarmony && detected.length + requested.length < 16
    && !/\bindependent accompaniment\b/.test(text)
    && !requested.some((part) => part.name === p.name || part.profile === p.profile)
  ));
  const excluded = (p) => { const role = p.role ?? PART_INSTRUMENTS[p.profile]?.role; return sound.exclusions.includes(p.profile) || sound.exclusions.includes(role === 'arp' ? 'arpeggio' : role === 'counterpoint' ? 'lead' : role) || sound.exclusions.includes('piano') && /piano|rhodes|jazz_keys/.test(p.profile); };
  const result = [...defaults.filter((p) => !active.has(p.profile) && !sound.exclusions.includes(p.profile) && !sound.exclusions.includes(p.role === 'arp' ? 'arpeggio' : p.role)), ...detected.filter((p) => !defaults.some((d) => d.profile === p.profile)), ...requested].filter((p) => !excluded(p));
  if (result.length > 16) throw new Error('Use at most sixteen additional parts.');
  const seen = new Set();
  return result.map((p, i) => {
    if (!p || !Object.hasOwn(PART_INSTRUMENTS, p.profile)) throw new Error('Unknown part instrument.');
    const name = p.name ?? p.profile + '-' + i, role = p.role ?? PART_INSTRUMENTS[p.profile].role;
    if (typeof name !== 'string' || !/^[a-z][a-z0-9_\-]{0,39}$/i.test(name) || seen.has(name) || ['kick', 'snare', 'hat', 'tom', 'keys', 'bass', 'lead', 'arp', 'vocals', 'fx'].includes(name)) throw new Error('Part names must be unique identifiers, distinct from built-in voices.');
    seen.add(name);
    if (!['harmony', 'bass', 'lead', 'arp', 'counterpoint'].includes(role)) throw new Error('Unknown part role.');
    const cycle = p.cycle ?? Number(text.match(new RegExp('\\b' + name + ' cycle (\\d+) steps'))?.[1] ?? 0);
    if (!Number.isInteger(cycle) || cycle !== 0 && (cycle < 3 || cycle > 64)) throw new Error('Part cycle must be 3–64 steps.');
    if (p.fmRatios && (!Array.isArray(p.fmRatios) || p.fmRatios.length !== 4 || p.fmRatios.some((n) => !Number.isFinite(n) || n <= 0 || n > 16))) throw new Error('FM requires four positive ratios, at most 16.');
    if (p.fmIndices && (!Array.isArray(p.fmIndices) || p.fmIndices.length !== 3 || p.fmIndices.some((n) => !Number.isFinite(n) || n < 0 || n > 12))) throw new Error('FM requires three indices from 0 to 12.');
    if (p.vowel && !['a','i','u'].includes(p.vowel)) throw new Error('Vowel must be a, i or u.');
    const articulation = defaults.includes(p) && p.pattern === 'answer' && sound.articulation !== 'normal'
      ? sound.articulation : p.articulation ?? sound.articulation;
    if (p.pattern !== undefined) {
      if (role !== 'harmony' || cycle) throw new Error('Accompaniment patterns require a harmony part without an independent cycle.');
      resolveAccompaniment(config, p.profile, p.pattern);
    }
    if (articulation && !['legato', 'staccato', 'pizzicato', 'muted', 'palm_mute', 'slap', 'slide', 'tongued', 'normal'].includes(articulation)) throw new Error('Unknown articulation.');
    return { ...p, ...validateTimbre({...config.timbre,...p}), name, role, cycle, articulation, detune: bounded(p.detune, 7, 0, 40, 'Unison detune'), pressure: bounded(p.pressure, .6, .1, 1, 'Bow pressure'), drive: bounded(p.drive, 3, 1, 8, 'Instrument drive'), gain: bounded(p.gain, .6, 0, 2, 'Part gain'), pan: bounded(p.pan, (i % 2 ? 1 : -1) * .35, -1, 1, 'Part pan'),
      register: bounded(p.register, 0, -24, 24, 'Part register'), send: bounded(p.send, 1, 0, 2, 'Part send'), mix: resolveProduction('', p.mix) };
  });
}
export function generateParts(config, chords, sections, definitions, bass = [], keys = []) {
  return definitions.map((part, index) => {
    const timbre = Object.fromEntries(TIMBRE_FIELDS.filter((key) => part[key] !== undefined).map((key) => [key, part[key]]));
    if (part.profile === 'pedal_steel' && ['lead', 'counterpoint'].includes(part.role) && !part.cycle) {
      const events = generatePedalSteel(config, chords, sections, keys, part.name).map((event) => ({
        ...timbre, ...event, part: part.name, role: part.role, bpm: barInfo(config, event.bar).bpm,
        note: event.note + part.register, fromNote: event.fromNote + part.register, pan: part.pan,
        velocity: event.velocity * part.gain, articulation: part.articulation,
        duration: ['muted', 'staccato'].includes(part.articulation) ? event.duration * .5 : event.duration,
      }));
      return { ...part, events };
    }
    const rng = random(config.seed, 'part:' + part.name), events = [];
    const accompaniment = part.role === 'harmony' && !part.cycle ? resolveAccompaniment(config, part.profile, part.pattern) : null;
    let previous = null;
    for (let bar = 0; bar < config.bars; bar++) {
      const info = barInfo(config, bar), chord = chordAt(chords, bar), section = sections.find((s) => bar >= s.start && bar < s.end);
      const n = info.stepsPerBar;
      if (part.role === 'bass' && !section.bass) continue;
      const spacing = part.role === 'harmony' ? 8 : part.role === 'bass' ? 4 : part.role === 'arp' ? 2 : 4;
      const cells = accompaniment ? accompanimentCells(config, chords, bar, accompaniment, section, part.name, bass)
        : Array.from({length:n},(_,step)=>({step})).filter(({step})=>part.cycle ? (barStep(config,bar)+step)%part.cycle===(index*2)%part.cycle : step%spacing===index%2);
      for (const [cellIndex, cell] of cells.entries()) {
        const step = cell.step, global = barStep(config, bar) + step;
        const voice = part.role === 'harmony' ? 'keys' : part.role === 'bass' ? 'bass' : part.role === 'arp' ? 'arp' : 'lead';
        let notes = part.role === 'harmony' ? [...chord.notes] : [chord.notes[(Math.floor(step / spacing) + bar + index) % chord.notes.length] + (part.role === 'bass' ? -24 : part.role === 'arp' ? 12 : 0)];
        if (accompaniment?.style === 'answer') notes = notes.sort((a, b) => a - b).slice(-2);
        if (accompaniment && ['broken','riff'].includes(cell.shape)) notes = [chord.notes[cell.tone % chord.notes.length]];
        if (part.role === 'counterpoint') {
          // Bounded candidate search penalizes large leaps and parallel perfect
          // intervals against a chord-root cantus; it is not a full species solver.
          const cantus = 60 + chord.root, old = previous ?? 72;
          const candidates = chord.pitchClasses.flatMap((pc) => [60 + pc, 72 + pc]).filter((note) => note > cantus && note - cantus < 24);
          notes = [candidates.sort((a, b) => {
            const cost = (note) => Math.abs(note - old) + (previous !== null && [0, 7].includes((note - cantus) % 12) ? 9 : 0) + Math.abs(note - 72) * .1;
            return cost(a) - cost(b);
          })[0] ?? cantus + 12];
        }
        if (cell.shape === 'strum' && bar % 2) notes.reverse();
        for (const [noteIndex, note] of notes.entries()) {
          const length = cell.length === undefined ? Math.min(n - step, spacing * (part.articulation === 'staccato' ? .35 : .9)) : cell.length * (part.articulation === 'staccato' ? .5 : 1);
          const time = (accompaniment ? grooveTime(config, global, 'keys') : timeAtStep(config, global)) + (cell.shape === 'strum' ? noteIndex * .009 : 0);
          const nextAttack = accompaniment?.style === 'answer' ? grooveTime(config, global + 1, 'keys') : Infinity;
          const end = Math.min(config.duration, timeAtStep(config, global + length), nextAttack);
          events.push({ ...timbre, bpm:info.bpm, voice, part: part.name, role: part.role, profile: part.profile, bar, step: global, note: note + part.register, fromNote: previous ?? note,
            time, duration: Math.max(.0001, end - time),
            velocity: (.35 + rng() * .08) * (cell.accent ?? 1) * part.gain * (section.keys ?? 1), pan: part.pan, articulation: part.articulation, pedal: part.pedal ?? config.soundDesign.pedal, fmRatios: part.fmRatios, fmIndices: part.fmIndices, detune: part.detune, vowel: part.vowel, drive: part.drive, pressure: part.pressure });
          previous = note;
        }
      }
    }
    return { ...part, ...(accompaniment ? {accompaniment} : {}), events };
  });
}
