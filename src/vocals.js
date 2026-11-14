import { barInfo, barStep, timeAtStep } from './arrangement.js';
import { random } from './random.js';
import { vocalTransformSettings } from './vocal-transform.js';
import { vocalPitchSettings } from './vocal-pitch.js';

export const MACOS_VOICES = Object.freeze({ zarvox: 'Zarvox', ralph: 'Ralph', fred: 'Fred', trinoids: 'Trinoids', whisper: 'Whisper', albert: 'Albert', junior: 'Junior', kathy: 'Kathy', boing: 'Boing', samantha: 'Samantha', karen: 'Karen', moira: 'Moira', tessa: 'Tessa' });

const sectionNames = ['intro', 'verse', 'breakdown', 'build', 'drop', 'outro', 'chorus', 'bridge', 'A', 'B', 'C', 'theme', 'variation1', 'variation2', 'variation3', 'blues'];
function amount(value, fallback, name) {
  if (value === undefined) return fallback;
  if (typeof value === 'string' && !value.trim()) throw new Error(name + ' must be a number from 0 to 1.');
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 1) throw new Error(name + ' must be a number from 0 to 1.');
  return number;
}
function words(text) {
  return text.toLowerCase().replaceAll('’', "'").match(/[a-z0-9]+(?:['-][a-z0-9]+)*/g) ?? [];
}

// This stream never consumes the instrument arranger's random numbers.
export function arrangeVocals(config, sections, automation, options = {}) {
  const pitch = vocalPitchSettings(config, options);
  const mode = options.vocals ?? (options.lyrics !== undefined ? 'auto' : 'off');
  if (!['auto', 'off'].includes(mode)) throw new Error('Vocals must be auto or off.');
  const density = amount(options.vocalDensity, .45, 'Vocal density');
  const chops = amount(options.vocalChops, .55, 'Vocal chops');
  const every = Number(options.vocalEvery ?? 4);
  if (![1, 2, 4, 8].includes(every)) throw new Error('Vocal repeat interval must be 1, 2, 4 or 8 bars.');
  const section = options.vocalSection ?? 'auto';
  if (section !== 'auto' && !sectionNames.includes(section)) throw new Error('Unknown vocal section: ' + section);
  const voiceKey = String(options.voice ?? 'zarvox').toLowerCase();
  const voice = Object.hasOwn(MACOS_VOICES, voiceKey) ? MACOS_VOICES[voiceKey] : null;
  if (!voice) throw new Error('Supported vocal voices: ' + Object.keys(MACOS_VOICES).join(', ') + '.');
  const text = options.lyrics;
  if (text !== undefined && (typeof text !== 'string' || !text.trim() || text.length > 1200 || /[^\x20-\x7e\n\r\t’]/.test(text))) {
    throw new Error('Lyrics must contain 1–1200 characters of English text.');
  }
  if (options.hook !== undefined && (typeof options.hook !== 'string' || !options.hook.trim() || options.hook.length > 200 || /[^\x20-\x7e’]/.test(options.hook))) {
    throw new Error('Hook must contain 1–200 characters of English text.');
  }
  if (mode === 'off') {
    if (text === undefined && ['hook', 'voice', 'vocalDensity', 'vocalChops', 'vocalEvery', 'vocalSection', 'vocalPitch', 'vocalNote', 'vocalRange'].some((key) => options[key] !== undefined)) {
      throw new Error('Supply --lyrics to use vocal controls.');
    }
    return null;
  }
  if (text === undefined) throw new Error('Supply --lyrics when vocals are auto.');
  const phrases = text.split(/[.!?\n;|/]+/).map(words).filter((p) => p.length);
  const hook = options.hook === undefined ? phrases[0] : words(options.hook);
  if (!phrases.length || !hook?.length) throw new Error('Lyrics and hook must contain spoken words.');
  if (phrases.length > 16 || [...phrases, hook].some((p) => p.length > 32)) throw new Error('Use at most 16 lyric phrases, with at most 32 words per phrase.');
  let hookIndex = phrases.findIndex((p) => p.join(' ') === hook.join(' '));
  if (hookIndex < 0) { hookIndex = phrases.length; phrases.push(hook); }
  const uniqueWords = [...new Set(phrases.flat())];
  if (uniqueWords.length > 96) throw new Error('Use at most 96 unique vocal words.');
  const rng = random(config.seed, 'vocals:arrangement');
  const events = [];
  const stepSeconds = config.stepSeconds;
  const stepsPerBar = config.stepsPerBar ?? 16;
  const dropSection = sections.find((s) => s.name === 'drop');
  const dropStart = dropSection ? barStep(config, dropSection.start) : Infinity;
  const gapStart = dropStart - 4;
  function add(source, step, endStep, kind, name, velocity = .8) {
    const owner = sections.find((s) => s.name === name && step >= barStep(config, s.start) && step < barStep(config, s.end));
    if (!owner) return;
    endStep = Math.min(endStep, barStep(config, owner.end));
    // Leave the final beat before the drop silent, even when sauce is zero.
    if (step >= gapStart && step < dropStart) return;
    if (step < gapStart && endStep > gapStart) endStep = gapStart;
    for (const a of automation) if (a.type === 'air' && step < a.endStep && endStep > a.startStep) {
      if (step >= a.startStep) return;
      endStep = Math.min(endStep, a.startStep);
    }
    endStep = Math.min(endStep, config.totalSteps ?? config.bars * stepsPerBar);
    if (step >= (config.totalSteps ?? config.bars * stepsPerBar) || endStep <= step) return;
    const bar = config.timeline?.findLast((b) => b.startStep <= step)?.bar ?? Math.floor(step / stepsPerBar);
    events.push({ voice: 'vocals', source, kind, section: name, bar, step,
      stepSeconds: barInfo(config, bar).stepSeconds, time: timeAtStep(config, step), duration: timeAtStep(config, endStep) - timeAtStep(config, step), velocity });
  }
  let verseIndex = 0;
  for (const s of sections) {
    if (section !== 'auto' && s.name !== section) continue;
    if (!density) continue;
    if (s.name === 'build') {
      const fragment = 'word:' + hook.at(-1);
      add('phrase:' + hookIndex, barStep(config, s.start), barStep(config, s.start + 2), 'phrase', s.name);
      if (chops) {
        // Accelerate a real spoken word from quarters to eighths/sixteenths.
        for (let step = barStep(config, s.start + 2); step < gapStart;) {
          const spacing = step < dropStart - stepsPerBar ? 4 : chops >= .7 ? 1 : 2;
          if (rng() < density) add(fragment, step, step + spacing * .8, 'stutter', s.name, .65);
          step += spacing;
        }
      }
      continue;
    }
    if (s.name === 'intro' || s.name === 'outro') {
      if (rng() < density) add('word:' + hook.at(-1), barStep(config, s.start + 2), barStep(config, s.start + 3), 'word', s.name, .55);
      continue;
    }
    for (let bar = s.start; bar < s.end; bar += every) {
      const first = bar === s.start;
      if (!first && rng() > density) continue;
      const index = s.name === 'verse' ? verseIndex++ % phrases.length : hookIndex;
      const end = Math.min(barStep(config, s.end), barStep(config, bar + every));
      add('phrase:' + index, barStep(config, bar), Math.min(end, barStep(config, bar + 2)), 'phrase', s.name);
      // A call takes two bars; its answer occupies the next bar, leaving a gap.
      if (s.name !== 'breakdown' && every >= 4 && bar + 2 < s.end && rng() < chops) {
        const selectedWord = rng.pick(phrases[index]);
        const offset = config.intent === 'uk_garage_2step' ? 2 : 0;
        const spacing = ['chicago_footwork', 'jersey_club', 'idm_glitch'].includes(config.intent) ? 2 : 4;
        for (let n = 0; n < 3; n++) {
          const step = barStep(config, bar + 2) + offset + n * spacing;
          add('word:' + selectedWord, step, Math.min(step + spacing * .8, end), 'chop', s.name, .7 - n * .08);
        }
      }
    }
  }
  return { ...(pitch ? { pitch } : {}), ...(vocalTransformSettings(options)?{transform:vocalTransformSettings(options)}:{}), version: 1, stepSeconds, engine: 'macos-say', voice, rate: 180, density, chops, every, section,
    phrases: phrases.map((p) => p.join(' ')), words: uniqueWords, hookIndex,
    events: events.sort((a, b) => a.time - b.time) };
}

// Vocals have their own finite echoes, then share full-mix automation/normalization.
// Keeping them out of the instrument delay prevents tails leaking into vocal gaps.
export function mixVocals(plan, samples, left, right, sampleRate) {
  if (!plan?.events.length) return;
  if (!samples || samples.sampleRate !== sampleRate) throw new Error('Prepare vocal samples at the render sample rate before rendering vocals.');
  if ((plan.pitch || samples.pitch) && JSON.stringify(samples.pitch?.settings ?? null) !== JSON.stringify(plan.pitch ?? null)) throw new Error('Prepared speech pitch does not match the vocal plan.');
  if (JSON.stringify(samples.transform ? {stretch:samples.transform.stretch,formant:samples.transform.formant}:null)!==JSON.stringify(plan.transform??null))throw new Error('Prepared vocal transform does not match the plan.');
  if (samples.voice && samples.voice !== plan.voice) throw new Error('Prepared speech voice does not match the vocal plan.');
  for (const event of plan.events) {
    const source = samples.sources[event.source];
    if (!(source instanceof Float32Array) || !source.length) throw new Error('Missing vocal sample: ' + event.source);
    const start = Math.round(event.time * sampleRate);
    const window = Math.floor(event.duration * sampleRate);
    const full = event.kind === 'phrase' || event.kind === 'word';
    const rate = full ? Math.max(1, source.length / Math.max(1, window)) : 1;
    if (full && rate > 1.8) throw new Error('Vocal phrase is too long for its slot; shorten the lyrics or use a slower tempo: ' + event.source);
    const count = Math.min(window, Math.ceil(source.length / rate), left.length - start);
    // Quiet beat-synced stereo echoes stop at the event's allocated window.
    const delay = Math.round((event.stepSeconds ?? plan.stepSeconds) * 3 * sampleRate);
    for (const [tap, gain] of [[0, 1], [1, .18], [2, .08]]) {
      const offset = tap * delay;
      const length = Math.min(count, window - offset, left.length - start - offset);
      for (let i = 0; i < length; i++) {
        const position = i * rate;
        const index = Math.floor(position), fraction = position - index;
        const value = source[index] * (1 - fraction) + source[Math.min(index + 1, source.length - 1)] * fraction;
        const fade = Math.min(1, i / (sampleRate * .004), (length - 1 - i) / (sampleRate * .008));
        const sample = value * fade * event.velocity * .65 * gain;
        left[start + offset + i] += sample * (tap === 2 ? .5 : 1);
        right[start + offset + i] += sample * (tap === 1 ? .5 : 1);
      }
    }
  }
}
