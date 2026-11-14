import { barInfo, timeAtStep } from '../src/arrangement.js';
import { PERCUSSION_VOICES } from '../src/instruments.js';
import { clamp, eventFrequency } from '../src/random.js';
import { tunedHz } from '../src/tuning.js';
import { SCALES } from '../src/scales.js';
import { interpretPartPrompt, partSeedModes, varyPart } from './part-variation.js';

const drumNames = new Set(['kick', 'snare', 'hat', 'tom', ...PERCUSSION_VOICES]);
const pitchedNames = ['keys', 'bass', 'lead', 'arp'];

function scoreTracks(score) {
  return new Map([
    ...Object.entries(score.drums).map(([name, events]) => ['drum:' + name, { name, role: 'drums', pitched: false, events }]),
    ...pitchedNames.filter((name) => score[name]).map((name) => ['voice:' + name, {
      name: name === 'keys' ? 'Harmony / keys' : name, role: name === 'keys' ? 'harmony' : name, pitched: true, events: score[name],
    }]),
    ...(score.parts ?? []).map((part) => ['part:' + part.name, { ...part, pitched: true, part }]),
  ].map(([id, track]) => [id, { ...track, id, key: score.partKeys?.[id] }]));
}

export function describePartParameters(score, id) {
  const track = scoreTracks(score).get(id);
  if (!track?.events.length) return undefined;
  const instrument = [...new Set(track.events.map((event) => event.kit && event.kit !== 'standard'
    ? event.kit + ' ' + track.name : event.profile ?? track.name))].join(', ');
  const key = track.key ?? score.config;
  return { instrument, ...(track.pitched && { key: { root: key.root, rootName: key.rootName, scale: key.scale } }) };
}

export function validateEditableScore(score) {
  const c = score?.config;
  const parts = score?.parts ?? [];
  if (!c || typeof c.intent !== 'string' || !Object.hasOwn(SCALES, c.scale) || !Number.isInteger(c.root) || c.root < 0 || c.root > 11 || !Number.isInteger(c.bars) || c.bars < 8 || c.bars > 128
      || !Number.isFinite(c.duration) || c.duration <= 0 || c.duration > 600
      || !Number.isFinite(c.stepSeconds) || c.stepSeconds <= 0 || c.stepSeconds > 1
      || !Array.isArray(score.sections) || !Array.isArray(score.automation) || !score.sidechain
      || !score.drums || !Array.isArray(score.drums.kick) || !Object.keys(score.drums).every((name) => drumNames.has(name))
      || !Array.isArray(score.keys) || !Array.isArray(score.bass) || !Array.isArray(parts) || parts.length > 16
      || parts.some((part) => !part || typeof part.name !== 'string' || !/^[a-z][a-z0-9_-]{0,39}$/i.test(part.name))
      || new Set(parts.map((part) => part.name)).size !== parts.length
      || (c.timeline && (!Array.isArray(c.timeline) || c.timeline.length !== c.bars || !c.timeline.every((bar) =>
        bar && Number.isFinite(bar.time) && Number.isFinite(bar.startStep) && Number.isFinite(bar.stepSeconds)
        && bar.stepSeconds > 0 && Number.isInteger(bar.stepsPerBar) && bar.stepsPerBar > 0 && bar.stepsPerBar <= 64)))) {
    throw new Error('This file does not contain a supported Looper score.');
  }
  if (score.partKeys && (typeof score.partKeys !== 'object' || Array.isArray(score.partKeys)
      || Object.values(score.partKeys).some((key) => !key || !Number.isInteger(key.root) || key.root < 0
        || key.root > 11 || !Object.hasOwn(SCALES, key.scale)))) throw new Error('This score contains an unsupported part key.');
  for (const { events } of scoreTracks(score).values()) {
    if (!Array.isArray(events) || events.some((event) => !event || typeof event.voice !== 'string'
        || !Number.isInteger(event.bar) || event.bar < 0 || event.bar >= c.bars || !Number.isFinite(event.step)
        || !Number.isFinite(event.time) || event.time < 0 || event.time >= c.duration
        || !Number.isFinite(event.velocity) || !Number.isFinite(event.duration) || event.duration <= 0)) {
      throw new Error('This score contains unsupported events.');
    }
    for (const event of events) eventFrequency(event);
  }
  return score;
}

export function describeEditableScore(score) {
  const { config } = score;
  const provenance = score.partVariation;
  const savedChanges = Array.isArray(provenance?.changes) ? provenance.changes : [];
  const bars = Array.from({ length: config.bars }, (_, index) => barInfo(config, index).stepsPerBar);
  const tracks = [...scoreTracks(score)].filter(([, track]) => track.events.length).map(([id, track]) => {
    const saved = savedChanges.find((change) => change?.track === id);
    return {
      id, name: track.name, role: track.role, pitched: track.pitched, parameters: describePartParameters(score, id),
      ...(typeof saved?.seed === 'string' && saved.seed.length <= 200 && partSeedModes.has(saved.mode)
        ? { savedSeed: saved.seed, savedMode: saved.mode } : {}),
      events: track.events.map((event) => ({
        bar: event.bar, offset: event.step - barInfo(config, event.bar).startStep,
        duration: event.duration, velocity: event.velocity, ...(track.pitched ? { note: event.note } : {}),
      })),
    };
  });
  return { bars, tracks, ...(typeof provenance?.source === 'string' && provenance.source.length <= 255 ? { variationSource: provenance.source } : {}) };
}

export function applyAudition(score, { solo = null, muted = [] }) {
  const tracks = scoreTracks(score);
  const available = (id) => Boolean(tracks.get(id)?.events.length);
  if ((solo !== null && !available(solo)) || !Array.isArray(muted)
      || muted.length > tracks.size || !muted.every(available)) {
    throw new Error('Choose parts available in this score.');
  }
  const silenced = new Set(muted);
  for (const [id, { events }] of tracks) {
    if (solo === null ? silenced.has(id) : id !== solo) events.length = 0;
  }
  if (solo !== null) delete score.vocals;
}

export function applyPartVariations(score, variations) {
  const tracks = scoreTracks(score);
  if (!Array.isArray(variations) || variations.length > tracks.size) throw new Error('Invalid part variations.');
  const seen = new Set();
  for (const variation of variations) {
    const id = variation?.track;
    const track = tracks.get(id);
    if (!track?.events.length || seen.has(id)) throw new Error('Choose a different available part for each variation.');
    seen.add(id);
    varyPart(score, track, variation);
  }
}

export function resolvePartPrompt(score, variation, status) {
  const track = scoreTracks(score).get(variation?.track);
  if (!track?.events.length || variation.mode !== 'prompt' || variation.interpretation !== undefined) {
    throw new Error('Choose a soloed part and enter a new part prompt.');
  }
  return interpretPartPrompt(score.config, track, variation, status);
}

export function applyPartEdits(score, edits) {
  if (!Array.isArray(edits) || !edits.length || edits.length > 4096) throw new Error('Stage between 1 and 4096 part edits.');
  const { config } = score;
  const tracks = scoreTracks(score);
  const changes = new Map();
  const allowed = new Set(['track', 'index', 'action', 'bar', 'offset', 'velocity', 'duration', 'note']);
  for (const edit of edits) {
    if (!edit || !Object.keys(edit).every((key) => allowed.has(key))) throw new Error('Invalid event edit.');
    const { track, index, action } = edit;
    const part = tracks.get(track);
    const event = part?.events[index];
    if (!Number.isInteger(index) || !event || !['update', 'duplicate', 'remove'].includes(action)) throw new Error('Unknown event edit.');
    const pending = changes.get(track) ?? { replacements: new Map(), additions: [] };
    changes.set(track, pending);
    if (action !== 'duplicate' && pending.replacements.has(index)) throw new Error('An event can only be updated or removed once.');
    if (action === 'remove') {
      pending.replacements.set(index, null);
      continue;
    }
    const changed = { ...event };
    if (edit.bar !== undefined || edit.offset !== undefined) {
      const bar = edit.bar ?? event.bar;
      const offset = edit.offset ?? event.step - barInfo(config, event.bar).startStep;
      if (!Number.isInteger(bar) || bar < 0 || bar >= config.bars) throw new Error('Choose a bar inside the arrangement.');
      const info = barInfo(config, bar);
      if (!Number.isFinite(offset) || offset < 0 || offset >= info.stepsPerBar) throw new Error('Choose a step within the selected bar.');
      changed.bar = bar;
      changed.step = info.startStep + offset;
      if (changed.step !== event.step) {
        const drift = event.time - timeAtStep(config, event.step);
        changed.time = clamp(timeAtStep(config, changed.step) + drift, 0, config.duration - .0001);
        if (changed.bpm !== undefined) changed.bpm = info.bpm ?? config.bpm;
        if (changed.beatSeconds !== undefined) changed.beatSeconds = 4 * info.stepSeconds;
        if (changed.stepSeconds !== undefined) changed.stepSeconds *= info.stepSeconds / barInfo(config, event.bar).stepSeconds;
      }
    }
    if (edit.velocity !== undefined) {
      if (!Number.isFinite(edit.velocity) || edit.velocity < 0 || edit.velocity > 2) throw new Error('Velocity must be between 0 and 2.');
      changed.velocity = edit.velocity;
    }
    if (edit.duration !== undefined || changed.time !== event.time) {
      const duration = edit.duration ?? event.duration;
      if (!Number.isFinite(duration) || duration < .0001 || duration > 600) throw new Error('Duration must be between 0.0001 and 600 seconds.');
      changed.duration = Math.min(duration, config.duration - changed.time);
    }
    if (edit.note !== undefined) {
      if (!part.pitched || !Number.isInteger(edit.note) || edit.note < 0 || edit.note > 127) throw new Error('Pitch edits require a MIDI note between 0 and 127.');
      changed.note = edit.note;
      if (changed.fromNote === event.note) changed.fromNote = edit.note;
      if (Number.isFinite(event.frequency)) {
        const detune = 2 ** ((event.cents ?? 0) / 1200);
        changed.frequency = tunedHz(changed.note, config.tuning, 60 + config.root) * detune;
        if (Number.isFinite(changed.fromFrequency)) changed.fromFrequency = tunedHz(changed.fromNote, config.tuning, 60 + config.root) * detune;
      }
    }
    if (action === 'duplicate') pending.additions.push(changed);
    else pending.replacements.set(index, changed);
  }
  for (const [track, { replacements, additions }] of changes) {
    const { events } = tracks.get(track);
    const updated = events.map((event, index) => replacements.has(index) ? replacements.get(index) : event)
      .filter(Boolean).concat(additions).sort((a, b) => a.time - b.time);
    events.length = 0;
    for (const event of updated) events.push(event);
  }
}
