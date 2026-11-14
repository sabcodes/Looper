import { bounded } from './effects.js';
import { barInfo } from './arrangement.js';
export function resolveDevelopment(prompt, archetype, overrides = {}) {
  if(!overrides || typeof overrides!=='object' || Array.isArray(overrides) || Object.keys(overrides).some(k=>!['chordSize','melodyModel','maxLeap','cadence'].includes(k)))throw new Error('Invalid development settings.');
  const extension = prompt.match(/\b(?:(7|9|11|13)(?:th)?|(seventh))(?:[ -]note)? chords?\b/i);
  const chordSize = overrides.chordSize ?? (extension ? Number(extension[1] ?? 7) : 3);
  const melodyModel=overrides.melodyModel??(/\b(?:second order melody|markov melody)\b/i.test(prompt)?'second_order':'motif');
  const maxLeap=overrides.maxLeap??Number(prompt.match(/\bmax leap (\d+)\b/i)?.[1]??7),cadence=overrides.cadence??/\bphrase cadences\b/i.test(prompt);
  if(![3,7,9,11,13].includes(chordSize)||!['motif','second_order'].includes(melodyModel)||!Number.isInteger(maxLeap)||maxLeap<1||maxLeap>12||typeof cadence!=='boolean')throw new Error('Use chord size 3/7/9/11/13, motif/second_order melody, maxLeap 1–12 and boolean cadence.');
  const text = prompt.toLowerCase();
  const chordBars = Number(text.match(/\bchord every\s+(\d+(?:\.\d+)?)\s+bars?/)?.[1] ?? (/\bfast harmonic rhythm\b/.test(text) ? 1 : /\bslow harmonic rhythm\b/.test(text) ? 4 : (/\b(?:12[ -]bar blues|blues form)\b/.test(text) ? 1 : archetype.chord_bars ?? 2)));
  if (![1, 2, 4].includes(chordBars)) throw new Error('Chord interval must be 1, 2 or 4 bars.');
  const modulation = text.match(/\bmodulate to\s+([a-g])([#b]?)\s+(major|minor|dorian|mixolydian)\s+at bar\s+(\d+)/);
  const root = modulation ? ({ c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 }[modulation[1]] + (modulation[2] === '#' ? 1 : modulation[2] === 'b' ? -1 : 0) + 12) % 12 : null;
  return { chordSize,melodyModel,maxLeap,cadence,chordBars, borrowed: /\b(?:borrowed chords?|modal interchange)\b/.test(text), secondary: /\bsecondary dominants?\b/.test(text), tritone: /\btritone substitutions?\b/.test(text),
    modal: /\bmodal (?:jazz|harmony)\b/.test(text),
    modulation: modulation && { bar: Number(modulation[4]) - 1, root, mode: modulation[3] },
    motif: /\bmotif inversion\b/.test(text) ? 'inversion' : /\bmotif retrograde\b/.test(text) ? 'retrograde' : /\bmotif fragmentation\b/.test(text) ? 'fragmentation' : 'variation',
    transpose: bounded(text.match(/\bmotif transpose\s+(-?\d+)/)?.[1], 0, -7, 7, 'Motif degree transpose'),
    stretch: /\bmotif augmentation\b/.test(text) ? 2 : /\bmotif diminution\b/.test(text) ? .5 : 1 };
}
export function transformMotif(motif, kind = 'variation', transpose = 0) {
  let notes = [...motif];
  if (kind === 'inversion') notes = notes.map((n) => notes[0] * 2 - n);
  if (kind === 'retrograde') notes.reverse();
  if (kind === 'fragmentation') notes = notes.slice(0, Math.max(2, Math.ceil(notes.length / 2)));
  return notes.map((n) => n + transpose);
}

// Supporting attacks step back on the way into a new section. The kick and
// bass keep their existing groove and the final pitched resolution stays clear.
export function shapeSectionDynamics(config, sections, events) {
  const exits = new Map();
  for (let i = 1; i < sections.length; i++) {
    if (sections[i - 1].name === sections[i].name) continue;
    const bar = sections[i].start - 1;
    const { startStep, stepsPerBar } = barInfo(config, bar);
    exits.set(bar, startStep + stepsPerBar - Math.min(4, stepsPerBar / 4));
  }
  for (const event of events) {
    if (event.voice === 'kick' || event.voice === 'bass') continue;
    const exit = exits.get(event.bar);
    if (exit !== undefined && event.step >= exit) event.velocity *= .6;
    const percussion = !['keys', 'arp', 'lead'].includes(event.voice);
    if (percussion && event.bar >= config.bars - 2) event.velocity *= event.bar === config.bars - 1 ? .28 : .65;
    if (event.part && event.bar === config.bars - 1) event.velocity *= .65;
  }
}

// A second-order pitch process: continuation/reversal depends on the last two
// selected scale degrees. Weights also favor nearby chord tones and cadences.
export function melodicDegree(history,length,chordDegree,rng,{cadence=false,maxLeap=7}={}) {
  const previous=history.at(-1)??0,older=history.at(-2)??previous,motion=Math.sign(previous-older);
  const candidates=Array.from({length:length*3},(_,i)=>i-length).filter(d=>Math.abs(d-previous)<=Math.max(1,Math.ceil(maxLeap*length/12)));
  const weighted=candidates.map(d=>{const move=d-previous,pc=((d-chordDegree)%length+length)%length,chord=[0,2%length,4%length].includes(pc);return{d,w:(chord?(cadence?12:2):cadence?.1:1)*Math.exp(-Math.abs(move)*.6)*(move&&Math.sign(move)===motion?1.4:1)};});
  let value=rng()*weighted.reduce((s,c)=>s+c.w,0);for(const c of weighted){value-=c.w;if(value<=0)return c.d;}return previous;
}
