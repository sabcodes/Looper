import { barInfo, barStep, timeAtStep } from './arrangement.js';
import { fitPattern, meterAccents } from './meter.js';
import { clamp, random } from './random.js';
import { PERCUSSION_VOICES, PERCUSSION_NAMES } from './instruments.js';

export function swingTime(step, stepSeconds, swing) {
  const whole = Math.floor(step);
  return step * stepSeconds + (whole % 2 ? ((swing - 50) / 50) * stepSeconds : 0);
}

export const GROOVE_TEMPLATES = {
  mpc: { timing: [0, .004, .012, -.003], accents: [1, .65, .85, .55] },
  bossa: { kick: [0,6,8,14], snare: [4,10], hat: [0,2,4,6,8,10,12,14], timing: [0,0,-.002,.002], accents: [1,.55,.8,.6] },
  samba: { kick: [0,3,8,11], snare: [4,7,12,15], hat: [0,2,4,6,8,10,12,14], timing: [0,-.003,0,.003], accents: [1,.65,.85,.75] },
  cascara: { kick: [0,8], snare: [4,12], hat: [0,2,4,6,7,9,11,12,14,15], timing: [0,0,.002,0], accents: [1,.6,.9,.65] },
  songo: { kick: [0,7,10], snare: [4,11,14], hat: [0,2,3,6,8,10,11,14], timing: [0,.002,0,-.002], accents: [1,.6,.9,.7] },
  train: { kick: [0,8], snare: [2,4,6,10,12,14], hat: [0,4,8,12], timing: [0,0,.004,0], accents: [1,.5,.95,.5] },
  second_line: { kick: [0,6,10], snare: [3,4,7,10,12,15], hat: [0,2,4,6,8,10,12,14], timing: [0,.003,.005,-.003], accents: [1,.7,.85,.65] },
};
export function resolveGroove(prompt, archetype) {
  const text = prompt.toLowerCase().replace(/[_-](?=[a-z])/g, ' ');
  const swings = { ...(archetype.voice_swing ?? {}) }, offsets = {};
  const names = { hats: 'hat', percussion: 'percussion', keys: 'keys', bass: 'bass', kick: 'kick', snare: 'snare', lead: 'lead', arp: 'arp' };
  let swing = archetype.swing, globalOverride = false;
  const explicit = {};
  for (const m of text.matchAll(/\b(?:(kick|snare|hats?|percussion|bass|keys|lead|arp)\s+)?swing\s+(-?\d+(?:\.\d+)?)(?![\d./])\s*%?/g)) {
    const value = Number(m[2]);
    if (value < 50 || value > 75) throw new Error('Swing must be between 50 and 75 percent.');
    if (m[1]) explicit[names[m[1]] ?? m[1]] = value; else { swing = value; globalOverride = true; }
  }
  if (/\b(?:late snares?|laid back snares?)\b/.test(text)) offsets.snare = .012;
  if (/\bpushed percussion\b/.test(text)) offsets.percussion = -.006;
  for (const m of text.matchAll(/\b(kick|snare|hats?|percussion|bass|keys|lead|arp)\s+(?:delay|offset)\s+(-?\d+(?:\.\d+)?)\s*ms\b/g)) {
    const value = Number(m[2]);
    if (Math.abs(value) > 30) throw new Error('Instrument timing offsets must be between -30 and 30 ms.');
    offsets[names[m[1]] ?? m[1]] = value / 1000;
  }
  const cycle = text.match(/\bpercussion cycle(?:\s+of)?\s+(-?\d+(?:\.\d+)?)(?:\s*steps?\b|(?!\w|\.\d))/);
  const cycleSteps = cycle ? Number(cycle[1]) : /\blong(?:er)? percussion cycles?\b/.test(text) ? 20 : null;
  if (cycleSteps !== null && (!Number.isInteger(cycleSteps) || cycleSteps < 3 || cycleSteps > 64)) throw new Error('Percussion cycle must be 3–64 whole steps.');
  const clave = /\b(?:2[- :/]3|two three) (?:son )?clave\b/.test(text) ? '2-3'
    : /\b(?:(?:3[- :/]2|three two) (?:son )?)?clave\b/.test(text) ? '3-2' : null;
  const poly = text.match(/\b(\d+)\s*(?:against|:)\s*(\d+)\s*polyrhythm/);
  const ratio = poly ? [Number(poly[1]), Number(poly[2])] : null;
  if (ratio && ratio.some((n) => n < 2 || n > 16)) throw new Error('Polyrhythm pulses must be 2–16.');
  const template = Object.keys(GROOVE_TEMPLATES).find((name) => text.includes(name.replace('_', ' ') + ' groove')) ?? archetype.groove_template ?? null;
  const tuplet = /\bquintuplet (?:hats?|groove)\b/.test(text) ? 5 : /\bseptuplet (?:hats?|groove)\b/.test(text) ? 7 : null;
  return { ratio, template, tuplet, eighthSwing: /\beighth(?: note)? swing\b/.test(text), humanize: /\b(?:humanize|humanized|humanisation|humanization)\b/.test(text),
    subdivision: /\b(?:triplet (?:groove|hats?)|true triplets?)\b/.test(text) ? 'triplet' : /\bshuffle(?:d)? (?:groove|hats?)\b/.test(text) ? 'shuffle' : 'straight',
    funk: /\bfunk (?:groove|ghost notes?)\b/.test(text), tresillo: /\btresillo\b/.test(text),
    callResponse: /\b(?:drums? call and response|call and response (?:groove|drums?))\b/.test(text), clave, cycleSteps,
    polyrhythm: /\b(?:3 against 2|3:2|three against two)\s*(?:polyrhythm)?\b/.test(text),
    swing, swings: { ...(globalOverride ? {} : swings), ...explicit }, offsets };
}

export function grooveTime(config, step, voice) {
  const groove = config.groove;
  const group = voice === 'open_hat' ? 'hat' : PERCUSSION_VOICES.includes(voice) ? 'percussion' : voice;
  const swing = groove?.swings?.[voice] ?? groove?.swings?.[group] ?? config.swing;
  const offset = groove?.offsets?.[voice] ?? groove?.offsets?.[group] ?? 0;
  const info = config.timeline?.find((b) => step < b.startStep + b.stepsPerBar);
  const local = step - (info?.startStep ?? 0), seconds = info?.stepSeconds ?? config.stepSeconds;
  const unit = groove?.eighthSwing ? 2 : 1;
  const template = GROOVE_TEMPLATES[groove?.template];
  const drift = groove?.humanize ? .004 * Math.sin((info?.bar ?? Math.floor(step / 16)) * .71 + (voice === 'bass' ? .4 : 0)) + .001 * Math.sin(local * .31) : 0;
  return clamp(timeAtStep(config, step) + (swingTime(local / unit, seconds * unit, swing) - local * seconds) + offset + (template?.timing[Math.floor(local) % 4] ?? 0) + drift, 0, config.duration - .0001);
}

// A repeated phrase with an answering ending keeps genre identity across seeds.
export function drumPhrase(config, bar) {
  const n = config.stepsPerBar ?? 16;
  let kick = config.rhythm?.kick?.[bar % config.rhythm.kick.length] ?? config.kickAnchors;
  let snare = config.rhythm?.snare?.[bar % config.rhythm.snare.length] ?? config.snareAnchors;
  const template = GROOVE_TEMPLATES[config.groove?.template];
  if (template) { kick = template.kick ?? kick; snare = template.snare ?? snare; }
  if (config.intent === 'trap_halftime') kick = bar % 4 === 3 ? [0, 6, 10, 15] : [0, 7, 10];
  if (config.intent === 'liquid_dnb') kick = bar % 4 === 3 ? [0, 6, 10, 14] : [0, 10];
  if (config.groove?.callResponse) kick = bar % 2 ? [2, 7, 12, 15] : [0, 6, 10];
  if (config.groove?.tresillo) kick = [0, 6, 12];
  if (config.timeSignature && config.timeSignature !== '4/4') {
    kick = meterAccents(config);
    snare = config.denominator === 8 && config.numerator % 3 === 0
      ? kick.filter((_, i) => i % 2) : config.timeSignature === '3/4' ? [4, 8]
      : config.timeSignature === '7/8' ? [4, 10] : kick.map((step) => step + 8).filter((step) => step < n);
  }
  if (config.soundDesign?.drumFeel === 'halftime') snare = [Math.floor(n / 2)];
  return config.timeSignature && config.timeSignature !== '4/4' ? { kick, snare } : { kick: fitPattern(kick, n), snare: fitPattern(snare, n) };
}

export function addPercussion(drums, config, sections) {
  if (config.soundDesign?.drumsEnabled === false) return drums;
  const text = (config.prompt ?? '').toLowerCase().replace(/[_-](?=[a-z])/g, ' ');
  const jazz = config.intent === 'jazz_lounge' || config.soundDesign?.snareProfile === 'brush';
  const dance = ['deep_house', 'speed_garage', 'afro_house', 'liquid_dnb'].includes(config.intent);
  const n = config.stepsPerBar ?? 16;
  const country = config.intent === 'country_acoustic';
  const defaults = { clap: dance && config.intent !== 'liquid_dnb', rim: country,
    open_hat: dance, shaker: country || config.intent === 'afro_house', conga: config.intent === 'afro_house', ride: jazz };
  for (const voice of config.rhythm?.percussion ?? []) defaults[voice] = true;
  const aliases = PERCUSSION_NAMES;
  const names = Object.values(aliases).join('|');
  let positive = text;
  const excluded = new Set(config.soundDesign?.percussionExclusions ?? []);
  positive = positive.replace(new RegExp('\\b(?:no|without|avoid|excluding)\\s+((?:' + names + ')(?:\\s*(?:,|and|or)\\s*(?:' + names + '))*)\\b', 'g'), (_, clause) => {
    for (const [voice, alias] of Object.entries(aliases)) if (new RegExp('\\b(?:' + alias + ')\\b').test(clause)) excluded.add(voice);
    return ' ';
  });
  const rng = random(config.seed, 'percussion');
  const add = (voice, bar, step, velocity, duration, extra = {}) => {
    const globalStep = barStep(config, bar) + step;
    (drums[voice] ??= []).push({ voice, profile: voice, bar, step: globalStep,
      time: grooveTime(config, globalStep, voice), kit: config.soundDesign.drumKit, drumDrive: config.soundDesign.drumDrive, velocity: velocity * (.9 + .2 * rng()), duration,
      pan: voice === 'shaker' ? .4 : voice === 'conga' ? -.35 : voice === 'ride' ? .3 : 0, ...extra });
  };
  for (const [voice, alias] of Object.entries(aliases)) {
    if ((['agogo', 'woodblock'].includes(voice) && (config.groove?.polyrhythm || config.groove?.ratio)) || (voice === 'woodblock' && config.groove?.cycleSteps) || (voice === 'claves' && config.groove?.clave) || excluded.has(voice) || !(defaults[voice] || new RegExp('\\b(?:' + alias + ')\\b').test(positive))) continue;
    for (let bar = 0; bar < config.bars - 2; bar++) {
      const n = barInfo(config, bar).stepsPerBar;
      const section = sections.find((s) => bar >= s.start && bar < s.end);
      if (voice === 'crash') {
        if ([4, 20, 28].includes(bar)) add(voice, bar, 0, .5, 1.3);
      } else if (voice === 'ride') {
        for (const step of fitPattern([0, 4, 4 + 8 / 3, 8, 12, 12 + 8 / 3], n)) add(voice, bar, step, .42 * section.hats, .5);
      } else if (voice === 'shaker' || voice === 'tambourine') {
        for (let step = 0; step < n; step += voice === 'tambourine' ? 2 : 1) add(voice, bar, step, (step % 2 ? .18 : .3) * section.hats, .075);
      } else if (section.snare && bar >= 4) {
        if (['conga', 'bongo', 'agogo', 'cowbell', 'woodblock', 'tom', 'claves'].includes(voice)) {
          for (const step of fitPattern(voice === 'bongo' ? [2, 7, 11, 15] : voice === 'claves' ? [0, 6, 12] : [1, 6, 10, bar % 4 === 3 ? 14 : 15], n)) add(voice, bar, step, .45, .22, { note: voice === 'bongo' ? 67 : voice === 'tom' ? 45 : step % 2 ? 55 : 60 });
        } else for (const step of voice === 'open_hat' ? fitPattern([2, 6, 10, 14], n) : drumPhrase({ ...config, ...barInfo(config, bar) }, bar).snare) add(voice, bar, step, voice === 'open_hat' ? .35 : .5, voice === 'open_hat' ? .4 : .15);
      }
    }
  }
  const groove = config.groove ?? {};
  for (let bar = 4; bar < config.bars - 2; bar++) {
    const n = barInfo(config, bar).stepsPerBar;
    if (groove.clave && !excluded.has('claves')) {
      const first = groove.clave === '3-2' ? bar % 2 === 0 : bar % 2 !== 0;
      for (const step of fitPattern(first ? [0, 6, 12] : [4, 8], n)) add('claves', bar, step, .4, .04);
    }
    if (groove.polyrhythm || groove.ratio) {
      const [a, b] = groove.ratio ?? [3, 2];
      if (!excluded.has('agogo')) for (let i = 0; i < a; i++) add('agogo', bar, i * n / a, .35, .2, { time: clamp(timeAtStep(config, barStep(config, bar) + i * n / a) + (groove.offsets.percussion ?? 0), 0, config.duration - .0001) });
      if (!excluded.has('woodblock')) for (let i = 0; i < b; i++) add('woodblock', bar, i * n / b, .3, .07, { time: clamp(timeAtStep(config, barStep(config, bar) + i * n / b) + (groove.offsets.percussion ?? 0), 0, config.duration - .0001) });
    }
    if (groove.cycleSteps && !excluded.has('woodblock')) for (let step = 0; step < n; step++) {
      const global = barStep(config, bar) + step, length = groove.cycleSteps;
      if (Math.floor((global + 1) * 2 / length) !== Math.floor(global * 2 / length)) add('woodblock', bar, step, .35, .06);
    }
  }
  if (jazz && (!config.groove?.subdivision || config.groove.subdivision === 'straight')) drums.hat = [];
  if (drums.open_hat?.length) {
    const openings = new Set(drums.open_hat.map((e) => e.step));
    drums.hat = drums.hat.filter((e) => !openings.has(e.step));
    const hats = [...drums.hat, ...drums.open_hat].sort((a, b) => a.time - b.time);
    hats.forEach((e, i) => { if (e.voice === 'open_hat' && hats[i + 1]) e.duration = Math.min(e.duration, Math.max(.001, hats[i + 1].time - e.time)); });
  }
  return drums;
}
