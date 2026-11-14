import { resolveMeter } from './meter.js';
import { clamp } from './random.js';

export const FORMS = {
  club: [['intro', 4], ['verse', 8], ['breakdown', 4], ['build', 4], ['drop', 8], ['outro', 4]],
  pop: [['intro', 4], ['verse', 8], ['chorus', 8], ['verse', 8], ['chorus', 8], ['bridge', 4], ['chorus', 4], ['outro', 4]],
  aaba: [['A', 8], ['A', 8], ['B', 8], ['A', 8]],
  blues: [['blues', 12], ['blues', 12]],
  rondo: [['A', 8], ['B', 8], ['A', 8], ['C', 8], ['A', 8]],
  variations: [['theme', 8], ['variation1', 8], ['variation2', 8], ['variation3', 8]],
  extended: [['intro', 8], ['verse', 16], ['breakdown', 8], ['build', 8], ['drop', 16], ['outro', 8]],
};
const changes = /\b(?:change (?:meter )?to|meter)\s+(-?\d+\/-?\d+)\s+at bar\s+(-?\d+(?:\.\d+)?)|\b(?:change )?tempo\s+(-?\d+(?:\.\d+)?)\s+at bar\s+(-?\d+(?:\.\d+)?)/gi;
export const withoutTimelineChanges = (prompt) => prompt.replace(changes, ' ');
export function resolveArrangement(prompt, archetype, requestedBars, bpm, meter) {
  const text = prompt.toLowerCase();
  const form = /\b(?:pop|verse chorus) form\b/.test(text) ? 'pop' : /\baaba\b/.test(text) ? 'aaba'
    : /\b(?:12[ -]bar blues|blues form)\b/.test(text) ? 'blues' : /\brondo\b/.test(text) ? 'rondo'
    : /\btheme (?:and |with )?variations?\b/.test(text) ? 'variations'
    : /\bextended (?:club|mix|form)\b/.test(text) ? 'extended' : archetype.form ?? 'club';
  const units = FORMS[form];
  const bars = requestedBars ?? (form === 'club' ? 32 : units.reduce((s, [, n]) => s + n, 0));
  if (!Number.isInteger(bars) || bars < 8 || bars > 128) throw new Error('Bar count must be an integer from 8 to 128.');
  const total = units.reduce((sum, [, n]) => sum + n, 0);
  let boundary = 0;
  const sections = units.map(([name], i) => {
    const start = boundary;
    boundary = i === units.length - 1 ? bars : Math.min(bars - (units.length - i - 1), Math.max(start + 1, Math.round(units.slice(0, i + 1).reduce((s, [, n]) => s + n, 0) * bars / total)));
    return { name, start, end: boundary, kick: !['breakdown', 'bridge'].includes(name), snare: name !== 'intro' && name !== 'breakdown', hats: name === 'intro' ? .45 : .85,
      bass: !['intro', 'breakdown', 'build'].includes(name), keys: name === 'intro' ? .7 : 1 };
  });
  const edits = [...prompt.matchAll(changes)].map((m) => ({ bar: Number(m[2] ?? m[4]) - 1, meter: m[1], bpm: m[3] && Number(m[3]) }));
  for (const e of edits) if (!Number.isInteger(e.bar) || e.bar < 0 || e.bar >= bars || e.bpm !== undefined && (e.bpm < 40 || e.bpm > 240)) throw new Error('Timeline changes need a bar inside the song and tempo 40–240.');
  for (const bar of new Set(edits.map((e) => e.bar))) {
    const same = edits.filter((e) => e.bar === bar);
    if (new Set(same.map((e) => e.meter).filter(Boolean)).size > 1 || new Set(same.map((e) => e.bpm).filter(Boolean)).size > 1) throw new Error('Conflicting timeline changes.');
  }
  let current = meter, tempo = bpm, step = 0, time = 0;
  const rubato = /\brubato\b/.test(text), fermata = /\bfermata\b/.test(text);
  const timeline = Array.from({ length: bars }, (_, bar) => {
    for (const edit of edits.filter((e) => e.bar === bar)) {
      if (edit.meter) current = resolveMeter(edit.meter);
      if (edit.bpm !== undefined) tempo = edit.bpm;
    }
    const rate = tempo * (rubato ? 1 + .045 * Math.sin(bar * Math.PI / 4) : 1) * (fermata && bar === bars - 1 ? .65 : 1);
    const stepSeconds = 60 / rate / 4;
    const info = { bar, ...current, bpm: rate, stepSeconds, startStep: step, time, duration: current.stepsPerBar * stepSeconds };
    step += current.stepsPerBar; time += info.duration;
    return info;
  });
  if (time > 600) throw new Error('Arrangement exceeds the ten-minute render limit.');
  return { bars, duration: time, timeline, totalSteps: step, arrangement: { form, sections, longBuild: archetype.long_build ?? false, custom: form !== 'club' || bars !== 32 || edits.length > 0 || rubato || fermata } };
}
export const barInfo = (config, bar) => config.timeline?.[clamp(bar, 0, config.bars - 1)] ?? { stepsPerBar: config.stepsPerBar ?? 16, stepSeconds: config.stepSeconds, startStep: bar * (config.stepsPerBar ?? 16), time: bar * (config.stepsPerBar ?? 16) * config.stepSeconds };
export const barStep = (config, bar) => bar >= config.bars ? config.totalSteps ?? config.bars * (config.stepsPerBar ?? 16) : barInfo(config, bar).startStep;
export function timeAtStep(config, step) {
  if (!config.timeline) return step * config.stepSeconds;
  if (step >= config.totalSteps) return config.duration + (step - config.totalSteps) * config.timeline.at(-1).stepSeconds;
  const info = config.timeline.find((b) => step < b.startStep + b.stepsPerBar) ?? config.timeline[0];
  return info.time + (step - info.startStep) * info.stepSeconds;
}
export const chordAt = (chords, bar) => chords.findLast((c) => c.bar <= bar) ?? chords[0];
