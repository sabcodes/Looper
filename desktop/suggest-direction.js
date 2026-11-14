import { readFile } from 'node:fs/promises';
import { archetypes, compose } from '../src/index.js';
import { PERCUSSION_NAMES } from '../src/instruments.js';
import { PIANO_PROFILES, withoutInstrumentExclusions } from '../src/sound-design.js';
import { chooseWithLiquid } from './liquid.js';

const percussion = { ...PERCUSSION_NAMES, kick: 'kicks?|kick drums?', snare: 'snares?', hat: '(?:hi )?hats?' };
const catalog = new URL('../data/analysis-descriptions.json', import.meta.url);

export function keepsRequestedParts(score, options) {
  const { soundDesign: sound, prompt } = score.config;
  const text = withoutInstrumentExclusions(prompt.toLowerCase().replace(/[-_]/g, ' '));
  const layers = (score.parts ?? []).filter((part) => part.events.length);
  const hasRole = (events, role, profiles) =>
    events?.some((event) => !profiles || profiles.has(event.profile))
    || layers.some((part) => part.role === role && (!profiles || profiles.has(part.profile)));
  const roles = { harmony: score.keys, bass: score.bass, lead: score.lead, arp: score.arp };
  if (Object.entries(sound.requestedProfiles).some(([role, profile]) =>
    !hasRole(roles[role], role, new Set([profile])))) return false;
  if (sound.pianoRequested && !hasRole(score.keys, 'harmony', PIANO_PROFILES)) return false;
  if (sound.bassTextureRequested && !hasRole(score.bass, 'bass', new Set([score.config.bassProfile]))) return false;
  if (/\b(?:chords?|pads?|keys)\b/.test(text) && !hasRole(score.keys, 'harmony')) return false;
  if (/\b(?:arps?|arpeggios?|arpeggiated)\b/.test(text) && !hasRole(score.arp, 'arp')) return false;
  if (/\b(?:lead (?:melody|synth|hook)|melodic hook)\b/.test(text) && !hasRole(score.lead, 'lead')) return false;
  if (options.parts?.some((requested) => !layers.some((part) =>
    part.profile === requested.profile && (!requested.name || part.name === requested.name)))) return false;
  if (/\b(?:drums?|percussion|drum kit)\b/.test(text) && !Object.values(score.drums).some((events) => events.length)) return false;
  if (sound.brushRequested && !score.drums.snare.some((event) => event.profile === 'brush')) return false;
  return Object.entries(percussion).every(([voice, names]) =>
    !new RegExp('\\b(?:' + names + ')\\b').test(text)
    || score.drums[voice]?.length || (voice === 'hat' && score.drums.open_hat?.length));
}

export function directionCandidates(score, options) {
  const { classification, bpm, intent, prompt } = score.config;
  if (!classification.needsInterpretationReview) return [];
  const named = classification.scores.some((style) => style.explicit);
  const ranked = classification.scores.filter((style) => style.score > 0 && (!named || style.explicit))
    .map((style) => {
      const [low, high] = archetypes[style.intent].bpm_range;
      const gap = Math.max(low - bpm, bpm - high, 0);
      return { intent: style.intent, rank: style.score / (style.score + .5) - .8 * Math.min(1, gap / 35) };
    }).sort((a, b) => b.rank - a.rank);
  const ids = [];
  for (const id of new Set([intent, ...ranked.slice(0, 12).map((style) => style.intent)])) {
    let candidate;
    try { candidate = id === intent ? score : compose(prompt, { ...options, intentOverride: id }); }
    catch { continue; }
    if (keepsRequestedParts(candidate, options)) ids.push(id);
    if (ids.length === 5) break;
  }
  return ids.sort();
}

export async function suggestDirection(score, options, status) {
  const classification = score.config.classification;
  if (classification.source === 'locked') return { note: 'Choose Follow prompt to unlock the style before asking Liquid.' };
  if (!classification.needsInterpretationReview) return { note: 'Your prompt names a style. Liquid can suggest alternatives for open-ended prompts.' };
  const ids = directionCandidates(score, options);
  if (!ids.some((id) => id !== score.config.intent)) return { note: 'No alternate direction kept the requested parts.' };

  try {
    const { genres } = JSON.parse(await readFile(catalog, 'utf8'));
    const { choice, unavailable } = await chooseWithLiquid({ prompt: score.config.prompt,
      choices: ids.map((id) => [id, genres[id]]) }, status);
    if (unavailable) return { note: 'The installed Liquid model or MLX runtime is unavailable. You can use the current Blueprint.' };
    if (choice === 'none' || choice === score.config.intent) return { note: 'Liquid found no alternate direction.' };
    if (choice) return { suggestion: choice };
  } catch {
    // The current rules-based Blueprint remains usable if local inference fails.
  }
  return { note: 'Liquid couldn’t offer a direction locally. You can use the current Blueprint.' };
}
