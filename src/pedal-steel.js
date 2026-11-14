import { barInfo, chordAt, timeAtStep } from './arrangement.js';
import { grooveTime } from './groove.js';
import { clamp, random } from './random.js';

const arrivals = new Set(['chorus', 'drop']);
const quietSections = new Set(['intro', 'breakdown', 'bridge', 'outro']);
const nearRegister = (pitchClass, center) => pitchClass + 12 * Math.round((center - pitchClass) / 12);

export function generatePedalSteel(config, chords, sections, accompaniment, stream = 'lead') {
  const rng = random(config.phraseSeed ?? config.seed, 'pedal-steel:' + stream);
  const replyTone = rng.pick([1, 2]);
  const replyPosition = rng.pick([.375, .4375, .5]);
  const bendSize = rng.pick([1, 2]);
  const attacks = Map.groupBy(accompaniment, (event) => event.bar);
  const events = [];
  let previous = 69;

  for (const [index, section] of sections.entries()) {
    const arrival = arrivals.has(section.name);
    for (let bar = section.start; bar < section.end; bar++) {
      const local = bar - section.start;
      const cadence = bar === config.bars - 1;
      const pickup = !arrival && bar === section.end - 1 && arrivals.has(sections[index + 1]?.name);
      let phrase;
      if (cadence) phrase = 'cadence';
      else if (pickup) phrase = 'pickup';
      else if (arrival && local === 0) phrase = 'arrival';
      else if (quietSections.has(section.name)) {
        if (local === 0 && section.name !== 'intro') phrase = 'sustain';
      } else if (local % 2 === 1) phrase = 'reply';
      else if (local % 4 === 2) phrase = 'pickup';
      if (!phrase) continue;

      const chord = chordAt(chords, bar);
      const { startStep, stepsPerBar, time: barTime } = barInfo(config, bar);
      const barEnd = startStep + stepsPerBar;
      const fraction = { cadence: .125, pickup: .75, arrival: .125, sustain: .375, reply: replyPosition }[phrase];
      const preferred = startStep + Math.floor(stepsPerBar * fraction);
      const nearby = attacks.get(bar)?.findLast((event) => event.step >= preferred - 2 && event.step <= preferred + 1);
      const step = nearby ? Math.min(barEnd - 1.5, Math.max(preferred, nearby.step + 1.5)) : preferred;
      const end = timeAtStep(config, phrase === 'pickup' ? Math.min(step + 3, barEnd - .25) : barEnd - .35);
      const time = clamp(grooveTime(config, step, 'lead'), barTime, end - .0001);
      const center = clamp(previous, 65, 76);
      const tone = cadence ? chord.root : chord.pitchClasses[phrase === 'pickup' ? 2 : replyTone];
      const note = nearRegister(tone, center);
      const bend = phrase === 'pickup' ? 2 : phrase === 'reply' && local % 4 === 3 ? -bendSize : bendSize;
      const velocity = phrase === 'arrival' ? .62 : phrase === 'pickup' ? .48 : .54;
      const event = { voice: 'lead', role: 'lead', profile: 'pedal_steel', bar, step, time, duration: end - time,
        velocity, note, fromNote: cadence ? note : note - bend, pan: -.08, phrase: 'steel_' + phrase,
        steel: phrase === 'pickup' ? 'pickup' : phrase === 'reply' ? 'reply' : 'sustain' };

      // A second string rings through the bend on section entrances and endings.
      if (phrase === 'arrival' || cadence) {
        const anchor = nearRegister(cadence ? chord.pitchClasses[2] : chord.root, note - 6);
        events.push({ ...event, note: anchor, fromNote: anchor, velocity: velocity * .46, pan: .04 });
      }
      events.push(event);
      previous = note;
    }
  }
  return events;
}
