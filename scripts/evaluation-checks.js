import { analyzeScore } from '../src/score-analysis.js';

// Expectations concern observable events/settings. They do not score musical quality.
export function checkCase(score, expected) {
  const c = score.config, metrics = analyzeScore(score), checks = [];
  const check = (name, actual, wanted, passed = actual === wanted) => checks.push({ name, actual, expected: wanted, passed });
  for (const key of ['intent', 'bpm', 'root', 'scale', 'mood', 'bassProfile']) if (key in expected) check(key, c[key], expected[key]);
  for (const key of ['harmonyRole', 'bassPhrasing', 'bassPresence', 'drumFeel']) if (key in expected) check(key, c.soundDesign[key], expected[key]);
  if (expected.allowedIntents) check('allowedIntent', c.intent, expected.allowedIntents, expected.allowedIntents.includes(c.intent));
  if (expected.bassProfiles) check('bassProfileFamily', c.bassProfile, expected.bassProfiles, expected.bassProfiles.includes(c.bassProfile));
  if (expected.minBpm !== undefined) check('minBpm', c.bpm, '>=' + expected.minBpm, c.bpm >= expected.minBpm);
  if (expected.maxBpm !== undefined) check('maxBpm', c.bpm, '<=' + expected.maxBpm, c.bpm <= expected.maxBpm);
  if (expected.minDensity !== undefined) check('minDensity', c.density, '>=' + expected.minDensity, c.density >= expected.minDensity);
  if (expected.maxDensity !== undefined) check('maxDensity', c.density, '<=' + expected.maxDensity, c.density <= expected.maxDensity);
  const drums = Object.values(score.drums).flat().length;
  for (const [key, count] of [['Piano', metrics.pianoVoiceCount], ['Lead', score.lead.length], ['Arp', score.arp.length], ['Harmony', score.keys.length], ['Bass', score.bass.length], ['Drums', drums]]) {
    if (expected['no' + key]) check('no' + key, count, 0);
    const positive = key[0].toLowerCase() + key.slice(1);
    if (expected[positive]) check(positive, count, '> 0', count > 0);
  }
  if (expected.coverageMin !== undefined) check('bassGateCoverage', metrics.bassGateCoverage, '>=' + expected.coverageMin, metrics.bassGateCoverage >= expected.coverageMin);
  if (expected.glides) check('glidingBassEvents', score.bass.filter((e) => e.glide && e.fromNote !== e.note).length, '> 0', score.bass.some((e) => e.glide && e.fromNote !== e.note));
  if (expected.coupling === 'counterpoint') {
    const kickSteps = new Set(score.drums.kick.map((e) => e.step));
    const clashes = score.bass.filter((e) => kickSteps.has(e.step)).length;
    check('counterpointKickClashes', clashes, 0, score.bass.length > 0 && clashes === 0);
  }
  return { passed: checks.every((c) => c.passed), checks, metrics };
}
