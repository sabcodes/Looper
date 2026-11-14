import { barInfo, chordAt } from '../src/arrangement.js';
import { PERCUSSION_NAMES } from '../src/instruments.js';
import { clamp, random } from '../src/random.js';
import { resolveSoundDesign, withoutInstrumentExclusions } from '../src/sound-design.js';
import { tunedHz } from '../src/tuning.js';
import { PART_INSTRUMENTS } from '../src/parts.js';
import { compilePrompt } from '../src/parser.js';
import { SCALES } from '../src/scales.js';
import { chooseWithLiquid } from './liquid.js';

const palettes = {
  bass: ['sine_sub', 'pluck_bass', 'electric_bass', 'dark_analog_bass', 'rolling_saw'],
  harmony: ['rhodes_stabs', 'organ', 'pwm', 'acoustic_piano'],
  lead: ['analog_lead', 'fm_synth', 'clarinet', 'flute'],
  arp: ['banjo', 'mandolin', 'kora', 'analog_pluck'],
};
const kitVoices = new Set(['kick', 'snare', 'hat']);
const kits = ['standard', '808', '909', 'soft'];
export const partSeedModes = new Set(['sauce', 'rhythm', 'sound', 'key', 'phrase', 'both']);
const partPromptEdits = {
  shorten_notes: { description: 'Shorten the notes or hits for a clipped, staccato feel.', changes: { durationScale: .55 } },
  lengthen_notes: { description: 'Hold notes or hits longer for a sustained, legato feel.', changes: { durationScale: 1.5 } },
  syncopate_rhythm: { description: 'Move some attacks off the beat for a syncopated rhythm.', changes: { rhythm: true } },
  revoice_chords: { description: 'Change the octave placement of chord tones while keeping the same chords.', changes: { notes: true } },
  add_radio_static: { description: 'Layer radio static or hiss onto the sound while keeping the instrument and melody.', changes: { staticNoise: true } },
};
const promptHelp = 'Try a compatible instrument or kit, a key such as D minor, shorter or longer notes, or a syncopated rhythm.';
const liquidInstruments = ['acoustic_piano', 'rhodes_stabs', 'organ', 'acoustic_guitar', 'electric_guitar', 'bowed_strings', 'cello', 'fiddle', 'flute', 'clarinet', 'saxophone', 'trumpet', 'marimba', 'vibraphone', 'harp'];
const instrumentColors = { trumpet: 'bright brassy horn', saxophone: 'breathy reedy jazz horn', bowed_strings: 'lush sustained string ensemble', flute: 'airy breathy woodwind', acoustic_piano: 'acoustic piano keys', rhodes_stabs: 'warm electric piano keys' };
const instrumentNames = Object.values(PART_INSTRUMENTS).map(({ names }) => names).sort((a, b) => b.length - a.length).join('|');

function variationRole(track) {
  const role = track.pitched ? (track.role === 'counterpoint' ? 'lead' : track.role ?? track.events[0].role ?? 'lead') : 'drums';
  if (role !== 'drums' && !Object.hasOwn(palettes, role)) throw new Error('This part has an unsupported role.');
  return role;
}

function supportedPromptEdits(role) {
  const edits = Object.entries(partPromptEdits).filter(([id]) =>
    (id !== 'revoice_chords' || role === 'harmony') && (id !== 'add_radio_static' || role !== 'drums'));
  edits.push(['change_instrument', { description: 'Choose a different instrument or drum sound, keeping all notes and timing.', changes: { alternateSound: true } }]);
  if (role !== 'drums') {
    edits.push(['change_key', { description: 'Transpose only this part to a different key, preserving its instrument and timing.', changes: { key: 'different' } }],
      ...['major', 'minor'].map((scale) => ['key_' + scale, { description: 'Change only this part to ' + scale + ' at its current tonic.', changes: { key: { scale } } }]),
      ...[...new Set([...palettes[role], ...liquidInstruments])].map((profile) => ['instrument_' + profile, {
        description: 'Play the same notes and timing using ' + profile.replaceAll('_', ' ') + (instrumentColors[profile] ? ' (' + instrumentColors[profile] + ')' : '') + '.', changes: { sound: { profile } },
      }]));
  }
  return edits;
}

function promptKey(config, track, text) {
  const mode = '(?:harmonic minor|melodic minor|major pentatonic|minor pentatonic|major|minor|dorian|phrygian|mixolydian|lydian|locrian|blues)';
  const note = '[a-g](?:[#b♯♭]|\\s+(?:flat|sharp))?';
  const matches = [...text.matchAll(new RegExp('\\b(?:(?:in|to|key of)\\s+(' + note + ')(?:\\s+(' + mode + '))?|(' + note + ')\\s+(' + mode + '))(?=$|[\\s,.!?;:])', 'gi'))]
    .filter((match) => match[2] || match[4] || !/^\s+(?!(?:only|please)\b)[a-z]/i.test(text.slice(match.index + match[0].length)));
  const targets = matches.map(([, root, scale, bareRoot, bareScale]) => {
    const parsed = compilePrompt('in ' + (root ?? bareRoot).replace(/^[a-g]/i, (letter) => letter.toUpperCase()) + ' ' + (scale ?? bareScale ?? config.scale.replaceAll('_', ' ')));
    return { root: parsed.root, rootName: parsed.rootName, scale: parsed.scale };
  });
  if (new Set(targets.map(({ root, scale }) => root + ':' + scale)).size > 1) throw new Error('Choose one target key for this part.');
  const changingKey = /\b(?:(?:different|another|new) key|key (?:of|to)|(?:change|switch) (?:the )?(?:song )?key|transpose)\b/i.test(text);
  if (!targets.length && !changingKey) return undefined;
  if (!track.pitched) throw new Error('Key changes need a pitched part. Solo the bass, harmony, lead or another melodic part.');
  return targets[0] ?? 'different';
}

function validatePartPrompt({ seed, prompt }) {
  if (seed !== undefined || typeof prompt !== 'string' || !prompt.trim() || prompt.length > 300) throw new Error('Enter a part prompt of 1–300 characters.');
}

function seededSound(config, track, role, rng) {
  const first = track.events[0];
  if (role === 'drums') {
    if (kitVoices.has(track.name)) {
      return { kit: rng.pick(kits.filter((kit) => kit !== (first.kit ?? 'standard'))), profile: 'standard' };
    }
    return { profile: rng.pick(['clap', 'rim', 'shaker', 'conga', 'tambourine'].filter((profile) => profile !== (first.profile ?? first.voice))) };
  }
  const current = first.profile;
  const exclusions = config.soundDesign?.exclusions ?? [];
  const configured = config.soundDesign?.palette?.[role]?.candidates;
  const alternatives = (bank) => bank.filter((profile) => profile !== current && !exclusions.includes(profile)
    && !(exclusions.includes('piano') && /piano|rhodes|jazz_keys/.test(profile))
    && !(['warm_sub', 'sine_sub'].includes(current) && ['warm_sub', 'sine_sub'].includes(profile)));
  const preferred = alternatives(track.part ? [] : configured ?? []);
  const choices = preferred.length ? preferred : alternatives(palettes[role]);
  if (!choices.length) throw new Error('This part has no alternate sounds under the saved score’s exclusions. Try a prompt or Rhythm.');
  return { profile: rng.pick(choices) };
}

function promptChanges(config, track, role, prompt) {
  const text = withoutInstrumentExclusions(prompt.toLowerCase().replace(/[-_]/g, ' '));
  const key = promptKey(track.key ?? config, track, text);
  const alternateSound = /\b(?:change|switch) (?:the )?(?:type of )?(?:instrument|instrument type|sound)(?: only)?\b|\b(?:different|another|new) (?:instrument|sound)\b/.test(text);
  let sound;
  if (role === 'drums') {
    const kit = text.match(/\b(808|909|soft|standard)\s+(?:drums?|kit|kick|snares?|hats?)\b/)?.[1];
    const percussion = Object.entries(PERCUSSION_NAMES).find(([, alias]) => new RegExp('\\b(?:' + alias + ')\\b').test(text))?.[0];
    if (track.name === 'snare' && /\bbrush(?:ed)?\b/.test(text)) sound = { profile: 'brush' };
    else if (kit && kitVoices.has(track.name)) sound = { kit, profile: 'standard' };
    else if (percussion && percussion !== 'tom') sound = { profile: percussion };
  } else {
    const design = resolveSoundDesign(prompt, { id: config.intent });
    const named = text.match(new RegExp('\\b(?:' + instrumentNames + ')\\b'))?.[0];
    const explicit = Object.entries(PART_INSTRUMENTS).find(([, { names }]) => named && new RegExp('^(?:' + names + ')$').test(named))?.[0];
    const profile = explicit ?? (role === 'bass' && design.bassTextureRequested ? design.bassTexture : design.requestedProfiles[role])
      ?? (design.pianoRequested ? 'acoustic_piano' : undefined);
    if (profile) sound = { profile };
  }
  const shorter = /\b(?:shorter|staccato)\b/.test(text);
  const longer = /\b(?:longer|legato|sustained)\b/.test(text);
  if (shorter && longer) throw new Error('Choose either shorter or longer notes or hits.');
  const durationScale = shorter ? partPromptEdits.shorten_notes.changes.durationScale : longer ? partPromptEdits.lengthen_notes.changes.durationScale : 1;
  const rhythm = /\b(?:syncopat\w*|(?:new|different) rhythm)\b/.test(text);
  const notes = role === 'harmony' && /\b(?:revoice (?:the )?chords|(?:different|new|alternate) (?:chord )?voicings?)\b/.test(text);
  const staticNoise = track.pitched && /\badd (?:a layer of )?(?:radio static|white noise)\b/.test(text);
  if (!sound && !alternateSound && !key && !rhythm && !notes && !staticNoise && durationScale === 1) return null;
  return { sound, alternateSound, key, rhythm, notes, durationScale, staticNoise };
}

export async function interpretPartPrompt(config, track, variation, status) {
  validatePartPrompt(variation);
  const role = variationRole(track);
  if (promptChanges(config, track, role, variation.prompt)) return undefined;
  const mentionsStatic = /\bstatic\b/i.test(variation.prompt);
  const addingStatic = /\b(?:static (?:to|on|over|under|in|noise|hiss)|(?:add|give|layer|some|radio|hiss|noise)\b[^.!?]*\bstatic)\b/i.test(variation.prompt);
  if (mentionsStatic && track.pitched && !addingStatic) throw new Error('For radio noise, try “add radio static”. Less pitch movement is a different edit. ' + promptHelp);
  const choices = supportedPromptEdits(role)
    .filter(([id]) => id !== 'change_instrument')
    .filter(([id]) => !mentionsStatic || id === 'add_radio_static')
    .map(([id, { description }]) => [id, description]);
  if (!choices.length) throw new Error(promptHelp);
  const { choice, unavailable } = await chooseWithLiquid({ role, prompt: variation.prompt, choices }, status);
  if (unavailable) throw new Error('Liquid is unavailable for this part prompt. ' + promptHelp);
  if (!choice) throw new Error('Liquid couldn’t interpret this part prompt locally. ' + promptHelp);
  if (choice === 'none') {
    const example = track.pitched ? ' For noise on this part, try “add radio static”.' : '';
    throw new Error('Liquid couldn’t match the prompt to a supported edit. ' + promptHelp + example);
  }
  return choice;
}

function transpose(event, note, config) {
  if (note === event.note) return;
  if (Number.isFinite(event.fromNote)) event.fromNote = clamp(event.fromNote + note - event.note, 0, 127);
  event.note = note;
  const frequency = (pitch) => tunedHz(pitch, config.tuning, 60 + config.root) * 2 ** ((event.cents ?? 0) / 1200);
  if (Number.isFinite(event.frequency)) event.frequency = frequency(note);
  if (Number.isFinite(event.fromFrequency)) event.fromFrequency = frequency(event.fromNote ?? note);
}

function changePartKey(score, track, requested, prompt) {
  const current = score.partKeys?.[track.id] ?? score.config;
  const target = requested === 'different'
    ? { root: (current.root + random(prompt, 'key:' + track.name).pick([1, 2, 3, 4, 5, 7, 8, 9, 10, 11])) % 12, scale: current.scale }
    : { ...requested, root: requested.root ?? current.root, scale: requested.scale ?? current.scale };
  const sourceIntervals = SCALES[current.scale], targetIntervals = SCALES[target.scale];
  if (!sourceIntervals || !targetIntervals || !Number.isInteger(current.root) || !Number.isInteger(target.root)) throw new Error('This part has an unsupported key.');
  const delta = ((target.root - current.root + 18) % 12) - 6;
  const mapPitch = (note) => {
    if (!Number.isFinite(note) || note < 0 || note > 127) throw new Error('Event pitches must be finite MIDI values from 0 to 127.');
    const relative = ((note - current.root) % 12 + 12) % 12;
    const degree = sourceIntervals.reduce((best, pitch, i) => Math.abs(pitch - relative) < Math.abs(sourceIntervals[best] - relative) ? i : best, 0);
    const targetDegree = Math.min(targetIntervals.length - 1, Math.round(degree * targetIntervals.length / sourceIntervals.length));
    let mapped = note + delta + targetIntervals[targetDegree] - sourceIntervals[degree];
    while (mapped < 0) mapped += 12;
    while (mapped > 127) mapped -= 12;
    return mapped;
  };
  for (const event of track.events) {
    event.note = mapPitch(event.note);
    if (Number.isFinite(event.fromNote)) event.fromNote = mapPitch(event.fromNote);
    const frequency = (note) => tunedHz(note, score.config.tuning, 60 + target.root) * 2 ** ((event.cents ?? 0) / 1200);
    if (Number.isFinite(event.frequency)) event.frequency = frequency(event.note);
    if (Number.isFinite(event.fromFrequency)) event.fromFrequency = frequency(event.fromNote ?? event.note);
  }
  score.partKeys ??= {};
  score.partKeys[track.id] = { ...target, rootName: target.rootName ?? ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'][target.root] };
}

function varyPhrase(score, track, role, seed, rhythm, notes, durationScale) {
  const { config, automation } = score;
  const chords = Array.isArray(score.chords) ? score.chords : [];
  for (const [bar, events] of Map.groupBy(track.events, (event) => event.bar)) {
    const info = barInfo(config, bar);
    const attacks = Map.groupBy(events, (event) => event.step);
    const steps = [...attacks.keys()].sort((a, b) => a - b);
    const rng = random(seed, `bar:${bar % 2}`);
    const chord = chordAt(chords, bar);
    const displaced = rng.int(0, steps.length - 1);
    for (const [index, step] of steps.entries()) {
      const group = attacks.get(step);
      const gap = (steps[index + 1] ?? info.startStep + info.stepsPerBar) - step;
      let shift = rhythm && (index === displaced || rng() < .4) ? Math.max(0, Math.min(rng.pick([.5, 1, 1.5]), gap * .45)) : 0;
      if (automation.some((a) => a.type === 'air' && step + shift >= a.startStep && step + shift < a.endStep)) shift = 0;
      const harmonyNote = role === 'harmony' && notes ? rng.pick(group) : null;
      for (const event of group) {
        if (shift) {
          event.step += shift;
          event.time += Math.min(shift * info.stepSeconds, Math.max(0, config.duration - .0001 - event.time));
          if (event.coupled !== undefined) event.coupled = false;
        }
        if (notes && Number.isFinite(event.note) && (role !== 'harmony' || event === harmonyNote)) {
          const note = event.note;
          const nearby = (role === 'harmony' ? [] : [-6, -5, -4, -3, -2, -1, 1, 2, 3, 4, 5, 6])
            .map((offset) => note + offset).filter((pitch) => chord?.pitchClasses?.includes(pitch % 12));
          const choices = (nearby.length ? nearby : [note - 12, note + 12]).filter((pitch) => pitch >= 0 && pitch <= 127
            && (role !== 'harmony' || !group.some((other) => other.note === pitch)));
          if (choices.length) transpose(event, rng.pick(choices), config);
        }
        if (shift || durationScale !== 1) event.duration = Math.min(event.duration * durationScale, config.duration - event.time);
      }
    }
  }
  if (role === 'bass' && (rhythm || durationScale > 1)) {
    const ordered = [...track.events].sort((a, b) => a.time - b.time);
    for (const [index, event] of ordered.entries()) {
      const next = ordered[index + 1];
      if (next && next.time > event.time) event.duration = Math.min(event.duration, next.time - event.time);
    }
  }
}

export function varyPart(score, track, variation) {
  const { mode, seed, prompt, interpretation } = variation;
  const role = variationRole(track);
  const { config } = score;
  let sound, rhythm, notes, staticNoise, key, alternateSound;
  let durationScale = 1;
  if (mode === 'prompt') {
    validatePartPrompt(variation);
    const direct = promptChanges(config, track, role, prompt);
    const interpreted = supportedPromptEdits(role).find(([id]) => id === interpretation)?.[1];
    if (interpretation !== undefined && (!interpreted || direct)) throw new Error('Invalid Liquid edit for this part prompt.');
    const changes = direct ?? interpreted?.changes;
    if (!changes) throw new Error(promptHelp);
    ({ sound, rhythm, notes, staticNoise, key, alternateSound, durationScale = 1 } = changes);
  } else {
    if (prompt !== undefined || interpretation !== undefined || !partSeedModes.has(mode) || typeof seed !== 'string' || !seed.trim() || seed.length > 200) {
      throw new Error('Choose Sauce, Rhythm, Instrument or Key and enter a seed of 1–200 characters.');
    }
    if (mode === 'key' && !track.pitched) throw new Error('Key changes need a pitched part. Solo the bass, harmony, lead or another melodic part.');
    if (mode === 'sauce' || mode === 'sound' || mode === 'both') sound = seededSound(config, track, role, random(seed, 'sound:' + track.name));
    if (mode === 'key') key = 'different';
    rhythm = mode !== 'sound' && mode !== 'key';
    notes = mode === 'phrase' || mode === 'both';
  }
  if (alternateSound && !sound) sound = seededSound(config, track, role, random(prompt, 'sound:' + track.name));
  if (sound) {
    for (const event of track.events) {
      if (event.profile !== sound.profile) delete event.partials;
      Object.assign(event, sound);
    }
    if (track.part) track.part.profile = sound.profile;
  }
  if (staticNoise) for (const event of track.events) event.radioStatic = true;
  if (rhythm || notes || durationScale !== 1) varyPhrase(score, track, role, `${seed ?? prompt}:${track.name}`, rhythm, notes && track.pitched, durationScale);
  if (key) changePartKey(score, track, key, seed ?? prompt);
}
