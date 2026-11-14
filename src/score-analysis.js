import { timeAtStep, barStep, barInfo } from './arrangement.js';
import { PIANO_PROFILES } from './sound-design.js';

export function analyzeScore(score) {
  const spans = score.bass.map((e) => [e.time, Math.min(score.config.duration, e.time + e.duration)]).sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const span of spans) {
    const last = merged.at(-1);
    if (last && span[0] <= last[1] + 1e-8) last[1] = Math.max(last[1], span[1]);
    else merged.push([...span]);
  }
  let covered = merged.reduce((sum, [a, b]) => sum + b - a, 0);
  for (const air of score.automation.filter((a) => a.type === 'air')) {
    const start = timeAtStep(score.config, air.startStep), end = timeAtStep(score.config, air.endStep);
    for (const [a, b] of merged) covered -= Math.max(0, Math.min(b, end) - Math.max(a, start));
  }
  const durations = score.bass.map((e) => e.duration / (barInfo(score.config, e.bar).stepSeconds * 4)).sort((a, b) => a - b);
  const patternCount = (events, bass = false) => {
    const bars = new Map();
    for (const e of events) {
      const row = bars.get(e.bar) ?? [];
      row.push([e.step - barStep(score.config, e.bar), Number((e.duration / (barInfo(score.config, e.bar).stepSeconds * 4)).toFixed(3)), ...(bass ? [e.motion === 'wobble' ? e.wobbleBeats ?? 0 : 0] : [])]);
      bars.set(e.bar, row);
    }
    return new Set([...bars.values()].map((v) => JSON.stringify(v))).size;
  };
  const all = [...score.keys, ...score.bass, ...(score.lead ?? []), ...(score.arp ?? []), ...(score.parts ?? []).flatMap((p) => p.events)];
  return {
    durationSeconds: score.config.duration, partCount: (score.parts ?? []).length, form: score.config.arrangement?.form, bassEventCount: score.bass.length,
    bassGateCoverage: covered / score.config.duration,
    bassMedianDurationBeats: durations.length ? durations[Math.floor(durations.length / 2)] : 0,
    bassLongestDurationBeats: durations.at(-1) ?? 0,
    bassPhrasePatterns: patternCount(score.bass, true),
    pianoVoiceCount: all.filter((e) => PIANO_PROFILES.has(e.profile)).length,
    leadNoteCount: (score.lead ?? []).length,
    leadUniquePitches: new Set((score.lead ?? []).map((e) => e.note)).size,
    leadRhythmicPatterns: patternCount(score.lead ?? []),
    arpeggioNoteCount: (score.arp ?? []).length,
    harmonyProfiles: [...new Set(score.keys.map((e) => e.profile))],
    bassProfiles: [...new Set(score.bass.map((e) => e.profile))],
    note: 'Score structure and gate coverage, not proof of audible sustain, perceived texture or musical quality.',
  };
}
