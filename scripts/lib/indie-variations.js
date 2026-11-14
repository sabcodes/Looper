import assert from 'node:assert/strict';
import { random } from '../../src/random.js';

// A listening experiment: loosen #8's fixed slots explicitly, then save the
// expanded prompts. This does not silently change ordinary --seed behavior.
export function planIndieVariations(seed) {
  const rng = random(seed, 'indie-palette-plan-v1');
  const shuffle = (items) => {
    const result = [...items];
    for (let i = result.length - 1; i > 0; i--) {
      const j = rng.int(0, i); [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  };
  const basses = shuffle([
    ...Array(4).fill(['sine_sub', 'clean sine bass']),
    ...Array(4).fill(['dark_analog_bass', 'dark analog bass']),
    ...Array(4).fill(['electric_bass', 'electric bass guitar']),
    ...Array(3).fill(['upright_bass', 'upright bass']),
    ...Array(2).fill(['fm_bass', 'FM bass']),
    ['acid_bass', 'acid bass'], ['reese_bass', 'Reese bass'],
    ['dark_distorted_bass', 'distorted dark analog bass'],
  ]);
  const harmonies = shuffle(Array(2).fill([
    ['acoustic_piano', 'acoustic piano'], ['rhodes_stabs', 'Rhodes'],
    ['clavinet', 'clavinet'], ['organ', 'organ'], ['electric_guitar', 'electric guitar'],
    ['acoustic_guitar', 'acoustic guitar'], ['ukulele', 'ukulele'],
    ['vibraphone', 'vibraphone'], ['pwm', 'PWM synth'], ['wavetable', 'wavetable synth'],
  ]).flat());
  const styles = shuffle(['sustain','broken','riff','strum','comp','offbeat','sustain','broken','riff','strum','comp','offbeat','sustain','broken','riff','strum','comp','offbeat','sustain','broken']);
  const cues = {sustain:'held chords', broken:'broken chords', riff:'chord riff', strum:'strummed chords', comp:'syncopated comping', offbeat:'offbeat chords'};
  const forms = shuffle(Array(4).fill(['pop','aaba','rondo','variations','club']).flat());
  const formCues = {pop:'verse chorus form',aaba:'AABA',rondo:'rondo',variations:'theme and variations',club:''};
  const keys = shuffle(['C','Db','D','Eb','E','F','F#','G','Ab','A','Bb','B','C','D','E','F','G','A','Bb','Eb']);
  const bassPatterns = shuffle(Array(4).fill(['bouncy bass','call and response','staccato bass','sustained bass','']).flat());
  const leads = shuffle([...Array(12).fill([null,'no lead']),...Array(3).fill(['flute','flute']),...Array(2).fill(['clarinet','clarinet']),...Array(2).fill(['harmonica','harmonica']),['analog_lead','lead synth']]);
  const grooves = shuffle(Array(4).fill(['humanized','drum call and response','tresillo','funk groove','shuffle hats']).flat());
  return basses.map(([bass, bassCue], i) => {
    const [harmony, harmonyCue] = harmonies[i], [lead, leadCue] = leads[i];
    const style = styles[i], form = forms[i], root = keys[i];
    const swing = rng.pick([50,52,54,56,58]), phraseBars = rng.pick([2,4,8]);
    const chordBars = rng.pick([1,2,4]), bpm = rng.pick([118,122,126,130,132,134]);
    const extra = i % 4 === 0 ? rng.pick(['ukulele','acoustic_guitar','organ','clavinet','acoustic_piano']) : null;
    const parts = extra && extra !== harmony ? [{name:'answer',profile:extra,role:'harmony',pattern:rng.pick(['sustain','broken','riff','offbeat']),gain:.28,register:0,pan:.35}] : [];
    const prompt = ['upbeat driving indie pop instrumental, 32 bars', `in ${root} major at ${bpm}bpm, 4/4`, formCues[form],
      `with ${bassCue} and ${harmonyCue}`, bassPatterns[i], cues[style], `${phraseBars}-bar accompaniment phrases`,
      `chord every ${chordBars} bars`, grooves[i], `swing ${swing}`, leadCue, 'no arpeggios',
      rng.pick(['soft kit','808 kit','909 kit']), rng.pick(['open hats','tambourine','shaker']),
      rng.pick(['motif inversion','motif retrograde','motif augmentation','motif fragmentation'])].filter(Boolean).join(', ');
    return {id:String(i+1).padStart(2,'0'), seed:String(rng.int(0,0xffffffff)), prompt,
      options:{sauce:Number((.08+rng()*.18).toFixed(3)),vocals:'off',parts},
      expect:{intent:'indie_pop',bass,harmony,lead,style,form,root,bpm,swing,phraseBars,chordBars,groove:grooves[i],bassCue:bassPatterns[i]||'genre'}};
  });
}

export function checkIndieVariation(row, score) {
  const c=score.config, e=row.expect;
  assert.equal(c.intent,e.intent); assert.equal(c.bassProfile,e.bass); assert.equal(c.synthProfile,e.harmony);
  assert.equal(c.accompaniment.style,e.style); assert.equal(c.arrangement.form,e.form);
  const bassPhrasing = e.bassCue === 'call and response' ? 'call_response' : e.bassCue === 'bouncy bass' ? 'bounce' : e.bassCue === 'sustained bass' ? 'held' : 'genre';
  assert.equal(c.soundDesign.bassPhrasing, bassPhrasing);
  if (e.bassCue === 'staccato bass') assert.equal(c.soundDesign.bassArticulation, 'staccato');
  assert.equal(c.rootName,e.root); assert.equal(c.bpm,e.bpm); assert.equal(c.swing,e.swing);
  assert.equal(c.accompaniment.phraseBars,e.phraseBars); assert.equal(c.development.chordBars,e.chordBars);
  assert.equal(c.timeSignature,'4/4'); assert.equal(c.bars,32); assert(!score.vocals);
  assert(score.bass.length); assert(score.keys.length);
  assert(score.bass.every(x=>x.profile===e.bass)); assert(score.keys.every(x=>x.profile===e.harmony));
  assert(score.lead.every(x=>x.profile===e.lead)); assert.equal(Boolean(score.lead.length),Boolean(e.lead));
  assert.equal(score.arp.length,0);
  assert(![...score.bass,...score.keys,...score.lead,...score.parts.flatMap(p=>p.events)].some(x=>x.profile==='metallic_reese'));
  assert(score.bass.every((x,i)=>!i||score.bass[i-1].time+score.bass[i-1].duration<=x.time+1e-8));
  for(const part of row.options.parts) assert(score.parts.some(p=>p.profile===part.profile&&p.accompaniment.style===part.pattern&&p.events.length));
}

