import { INSTRUMENTS, PERCUSSION_NAMES } from './instruments.js';
import { random } from './random.js';
// Musical roles and articulation are independent of genre classification.
export const PIANO_PROFILES = new Set(['rhodes_stabs', 'jazz_keys', 'dusty_rhodes', 'fm_piano', 'acoustic_piano']);
const instrumentNames = Object.values(INSTRUMENTS).map((i) => '(?:' + i.names + ')').sort((a, b) => b.length - a.length).join('|');
const percussionNames = Object.values(PERCUSSION_NAMES).join('|');
const instruments = '(?:' + instrumentNames + '|' + percussionNames + '|electric piano|lead (?:melod(?:y|ies)|synths?)|pianos?|rhodes|leads?|arpeggios?|arps?|chords?|(?:synth )?pads?|harmony|keyboards?|keys|bass(?:line)?|sub(?: bass)?|drums?|percussion)';
// A comma followed by a positive phrase ('no lead, bass between kicks') ends the exclusion.
const commaItem = ',\\s*(?:(?:and|or)\\s+)?(?=(?:no\\s+)?' + instruments + '(?=\\s*(?:[,.;!?]|$|and\\b|or\\b)))';
const instrumentExclusions = new RegExp('\\b(?:no|without|avoid|excluding)\\s+(?:(?:any|the)\\s+)?(' + instruments
  + '(?:\\s*(?:' + commaItem + '|\\band\\b|\\bor\\b)\\s*(?:(?:no|any|the)\\s+)?' + instruments + ')*)\\b', 'gi');

export const withoutInstrumentExclusions = (text) => text.replace(instrumentExclusions, ' ');

export function resolveSoundDesign(prompt, archetype, context = {}) {
  const fullText = prompt.toLowerCase().replace(/[-_]/g, ' ');
  const text = withoutInstrumentExclusions(fullText);
  const synthpop = archetype.id === 'synthpop_80s';
  const industrial = archetype.id === 'industrial_bass';
  const jazz = (archetype.id === 'jazz_lounge' || archetype.family === 'jazz');
  const classical = (archetype.id === 'classical_minimal' || archetype.family === 'classical');
  const country = (archetype.id === 'country_acoustic' || archetype.family === 'country');
  const deepHouse = archetype.id === 'deep_house';
  const dubstep = archetype.id === 'dubstep_halftime';
  const excluded = [];
  const percussionExclusions = [];
  const exclude = (name) => { if (!excluded.includes(name)) excluded.push(name); };
  for (const match of fullText.matchAll(instrumentExclusions)) {
    for (const token of match[1].match(new RegExp(instruments, 'g'))) {
      for (const [voice, names] of Object.entries(PERCUSSION_NAMES)) if (new RegExp('^(?:' + names + ')$').test(token)) {
        percussionExclusions.push(voice);
        if (voice === 'cowbell') exclude('cowbell_melody');
      }
      for (const [profile, instrument] of Object.entries(INSTRUMENTS)) {
        if (new RegExp('^(?:' + instrument.names + ')$').test(token)) exclude(profile);
      }
      if (/piano|rhodes/.test(token)) exclude('piano');
      else if (/^lead/.test(token)) exclude('lead');
      else if (/^arp/.test(token)) exclude('arpeggio');
      else if (/^key/.test(token)) for (const role of ['harmony', 'lead', 'arpeggio', 'piano']) exclude(role);
      else if (/bass|sub/.test(token)) exclude('bass');
      else if (/drum|percussion/.test(token)) exclude('drums');
      else if (!Object.values(PERCUSSION_NAMES).some((names) => new RegExp('^(?:' + names + ')$').test(token)) && !Object.values(INSTRUMENTS).some((i) => new RegExp('^(?:' + i.names + ')$').test(token))) exclude('harmony');
    }
  }
  const only = text.match(/\b(drums?|percussion|bass|sub)(?:\s+(?:and|with)\s+(drums?|percussion|bass|sub))?\s+only\b/);
  if (only) {
    for (const role of ['harmony', 'lead', 'arpeggio']) exclude(role);
    if (!/bass|sub/.test(only[0])) exclude('bass');
    if (!/drum|percussion/.test(only[0])) exclude('drums');
  }
  const selected = {};
  for (const match of text.matchAll(new RegExp('\\b(?:' + instrumentNames + ')\\b', 'g'))) {
    for (const [profile, instrument] of Object.entries(INSTRUMENTS)) {
      if (!excluded.includes(profile) && new RegExp('^(?:' + instrument.names + ')$').test(match[0])) selected[instrument.role] = profile;
    }
  }
  if (!selected.harmony && !excluded.includes('piano') && /\b(?:rhodes|electric piano)\b/.test(text)) selected.harmony = jazz ? 'jazz_keys' : 'rhodes_stabs';
  const bassText = text.replace(/\b(?:no|not|without|avoid|excluding)\s+metallic(?:\s+(?:bass(?:line)?|sounds?|timbres?|textures?))?\b/g, ' ');
  const avoidMetallic = bassText !== text;
  const metallic = /\bmetallic(?:\s+(?:reese|fm|synth|sub))*\s+bass(?:line)?\b|\bbass(?:line)?\s+(?:is\s+|sounds?\s+)?metallic\b/.test(bassText);
  const reese = /\breese\b/.test(text);
  const analogBass = /\b(?:dark\s+(?:analog\s+)?synth|(?:deep\s+|dark\s+)?analog(?:\s+synth)?)\s+bass\b/.test(text);
  const distortedAnalog = analogBass && /\b(?:distort\w*|crunch\w*|gritty|overdriven)(?:\s+(?:dark|deep|analog|synth))*\s+bass\b|\b(?:analog|synth)\s+bass\s+(?:with\s+)?(?:distort\w*|crunch\w*|grit|overdrive)\b/.test(text);
  const cleanSub = /\b(?:clean (?:sine |sub )?bass|sine (?:sub|bass)|pure sub|rounded (?:sub(?: bass)?|bass))\b/.test(text);
  const pianoRequested = /\b(?:piano|rhodes)\b/.test(text) && !excluded.includes('piano');
  const widePad = /\b(?:wide|wider|slow attack)\b/.test(text) && /\b(?:synth )?pads?\b/.test(text);
  const growl = /\b(?:wobbl\w*|growl\w*)(?:\s+(?:wobbl\w*|growl\w*|synth))*\s+bass(?:line)?\b|\bbass(?:line)?\s+(?:wobbl\w*|growl\w*)\b/.test(text);
  const explicitTexture = metallic || growl || analogBass || reese || cleanSub;
  const sustained = /\b(?:sustained|held|extended|continuous|long)(?:\s+(?:held|deep|dark|crunchy|metallic|distorted|reese|sub|low|clean|sine|evolving|heavy|analog|synth|overdriven|fm))*\s+bass\b|\bbass\s+(?:notes?\s+)?(?:held|sustained|drone)\b/.test(text)
    && !/\b(?:not|no|without)\s+(?:sustained|held|extended|continuous|drone)\b/.test(text);
  const staccato = /\b(staccato|plucked|short)(?:\s+(?:metallic|dark|deep|analog|synth|distorted))*\s+bass\b/.test(text);
  const throughout = /\b(?:throughout|whole song|whole track|entire song|entire track|continuous bass)\b/.test(text);
  let bassTexture = metallic ? 'metallic_reese' : growl ? 'growl_bass' : analogBass ? distortedAnalog ? 'dark_distorted_bass' : 'dark_analog_bass' : reese ? 'reese_bass' : archetype.bass_profile;
  if (context.airy && !context.dark && !explicitTexture) bassTexture = 'warm_sub';
  if (cleanSub) bassTexture = 'sine_sub';
  if (!explicitTexture && context.nightDrive && !context.rain) bassTexture = 'dark_distorted_bass';
  else if (!explicitTexture && context.heavyBass && !industrial && !dubstep) bassTexture = context.dark ? 'dark_distorted_bass' : 'reese_bass';
  let bassArticulation = industrial ? 'sustained' : dubstep ? 'phrases' : 'genre';
  if (context.airy && archetype.id === 'neutral_groove') bassArticulation = 'sustained';
  if (archetype.id === 'techno_rave' && context.dark && context.heavyBass) bassArticulation = 'phrases';
  if (sustained || throughout) bassArticulation = 'sustained';
  if (staccato) bassArticulation = 'staccato';
  const explicitLead = /\b(lead (?:synth|melody|hook)|melodic hook|memorable (?:lead|melody)|catchy (?:lead|melody)|lead melody|repeating synth hook)\b/.test(text);
  const arp = /\b(arpeggios?|arpeggiated|arps?)\b/.test(text);
  const darkKeys = context.dark && PIANO_PROFILES.has(archetype.synth_profile) && !jazz && !classical && archetype.id !== 'lofi_chill';
  const pads = /\b(pads?|long chords|sustained chords|dreamy|floating|atmospheric)\b/.test(text) || (!pianoRequested && (synthpop || industrial || dubstep || context.nightDrive || context.airy || darkKeys));
  const harmonyRole = excluded.includes('harmony') || (excluded.includes(archetype.synth_profile) && !selected.harmony && !excluded.includes('piano')) ? 'none' : pads || (excluded.includes('piano') && PIANO_PROFILES.has(archetype.synth_profile)) ? 'pads' : 'stabs';
  const brushRequested = /\b(?:brushed (?:drums?|snares?)|(?:drums?|snares?) with brushes)\b/.test(text);
  const quiet = context.reading || context.calm || context.rain;
  const harmonyPattern = selected.harmony === 'bowed_strings' ? 'legato' : country ? 'boom_chuck' : classical ? 'broken_piano' : jazz ? 'jazz_comp' : context.workout ? 'sparse_syncopated'
    : archetype.id === 'techno_rave' && context.dark && context.heavyBass ? 'sparse_syncopated'
    : quiet || archetype.id === 'neutral_groove' ? 'sparse' : context.beach ? 'offbeat' : 'genre';
  // Remove cues owned by other voices before considering an unqualified bass cue.
  const bassPhraseText = text.replace(/\b(?:drums?|percussion|keys|chords?|harmony|lead)\s+call(?: and)? response\b|\bcall(?: and)? response\s+(?:groove|drums?|percussion|keys|chords?|harmony|lead)\b/g, ' ');
  const callResponse = /\b(?:call(?: and)? response|short (?:bass )?(?:answers?|responses?)|answering bass phrases)\b/.test(bassPhraseText);
  const bounce = /\b(?:bouncy|bouncing|syncopated|rhythmic)\s+(?:synth\s+)?(?:bass|bassline|riff)\b/.test(text);
  const bassPhrasing = callResponse ? 'call_response' : bounce ? 'bounce' : bassArticulation === 'sustained' ? 'held' : 'genre';
  const articulation = /\bpizzicato\b/.test(text) ? 'pizzicato' : /\bpalm mute/.test(text) ? 'palm_mute' : /\bmuted\b/.test(text) ? 'muted' : /\blegato\b/.test(text) ? 'legato' : /\bstaccato\b/.test(text) ? 'staccato' : /\bslap bass\b/.test(text) ? 'slap' : /\btongued\b/.test(text) ? 'tongued' : /\bslides?\b/.test(text) ? 'slide' : 'normal';
  return {
    requestedProfiles: { ...selected }, bassTextureRequested: explicitTexture || Boolean(selected.bass), avoidMetallic,
    harmonyTextureRequested: Boolean(selected.harmony) || pianoRequested || widePad,
    articulation, pedal: /\b(?:sustain pedal|pedal down)\b/.test(text), acoustic: archetype.acoustic,
    bassTexture: selected.bass ?? bassTexture, bassPhrasing, bassArticulation, widePad, bassEnabled: !excluded.includes('bass') && (!classical || /\bbass\b/.test(text)), drumsEnabled: !excluded.includes('drums') && !classical && !(context.airy && archetype.id === 'neutral_groove'), bassPresence: throughout ? 'throughout' : 'arranged',
    bassMotion: /\b(?:no|without)\s+(?:filter )?(?:motion|movement|wobble)\b/.test(text) ? 'none'
      : archetype.bass_motion ?? (growl || dubstep ? 'wobble' : industrial || metallic || reese || /\b(filter (?:motion|movement|sweeps?)|evolving)\b/.test(text) ? 'slow' : 'none'),
    bassDrive: /\bclean (?:metallic |reese )?bass\b/.test(text) ? 1.2 : /\b(heavy|crunch\w*|distort\w*|gritty|growl\w*)\b/.test(text) ? 5 : 3,
    harmonyRole, pianoRequested, harmonyPattern, harmonyColor: archetype.harmony_color ?? (jazz || deepHouse ? 'sevenths' : 'triads'),
    harmonyProfile: selected.harmony,
    leadProfile: selected.lead ?? archetype.lead_profile ?? 'analog_lead', arpProfile: selected.arp ?? archetype.arp_profile ?? 'analog_pluck',
    drumKit: /\b808(?: style)? (?:drums|kit)\b/.test(text) ? '808' : /\b909(?: style)? (?:drums|kit)\b/.test(text) ? '909' : /\bsoft(?: acoustic)? (?:drums|kit)\b/.test(text) ? 'soft' : archetype.drum_kit ?? 'standard',
    drumDrive: archetype.drum_drive ?? 1, delayWet: archetype.delay_wet, delayFeedback: archetype.delay_feedback,
    harmonyRegister: context.nightDrive || (context.dark && context.heavyBass && archetype.synth_profile === 'synth_stabs') ? -12 : 0,
    harmonyGain: context.nightDrive ? .35 : context.workout ? .35 : context.dark && context.heavyBass && !industrial && !dubstep ? .45 : quiet || classical ? .65 : jazz ? .8 : 1,
    bassGain: context.heavyBass || (context.nightDrive && !context.rain) || context.workout ? 1.25 : quiet ? .65 : 1,
    drumGain: jazz ? .4 : quiet ? .45 : 1,
    leadEnabled: !excluded.includes('lead') && !excluded.includes(selected.lead ?? archetype.lead_profile) && (Boolean(selected.lead) || explicitLead || (archetype.lead_enabled && !quiet) || (synthpop && !quiet)),
    arpEnabled: !excluded.includes('arpeggio') && (Boolean(selected.arp) || arp || (archetype.arp_enabled && !quiet) || (synthpop && !quiet && !context.road)),
    exclusions: excluded, percussionExclusions, drumFeel: dubstep || /\bhalf\s*time\b/.test(text) ? 'halftime' : 'genre',
    drumDensity: /\b(sparse|minimal)\s+drums\b/.test(text) ? .35 : jazz || quiet ? .45 : 1,
    brushRequested, snareProfile: brushRequested || jazz ? 'brush' : synthpop || /\bgated snares?\b/.test(text) ? 'gated_snare' : 'standard',
  };
}

// Signature acoustic, log and acid voices stay fixed.
const edgyBass = new Set(['metallic_reese', 'reese_bass', 'fm_bass', 'growl_bass', 'dark_distorted_bass']);
const heavyBassStyles = /techno|dnb|dubstep|^(?:hardgroove|neurofunk|jump_up|minimal_rollers|industrial_bass|colour_bass|hardcore)$/;
const bassPalettes = {
  electric_bass: ['electric_bass', 'warm_sub', 'dark_analog_bass'],
  pluck_bass: ['pluck_bass', 'sine_sub', 'dark_analog_bass'],
  warm_sub: ['warm_sub', 'sine_sub', 'dark_analog_bass'],
  sine_sub: ['sine_sub', 'warm_sub'],
  rolling_saw: ['rolling_saw', 'analog_octave', 'dark_analog_bass'],
  analog_octave: ['analog_octave', 'rolling_saw', 'dark_analog_bass'],
  fm_bass: ['fm_bass', 'dark_analog_bass', 'reese_bass'],
  reese_bass: ['reese_bass', 'dark_analog_bass', 'dark_distorted_bass'],
  metallic_reese: ['dark_analog_bass', 'dark_distorted_bass', 'reese_bass'],
  dark_distorted_bass: ['dark_distorted_bass', 'dark_analog_bass', 'reese_bass'],
};
const harmonyPalettes = {
  fm_piano: ['fm_piano', 'rhodes_stabs', 'organ'],
  rhodes_stabs: ['rhodes_stabs', 'jazz_keys', 'organ'],
  dusty_rhodes: ['dusty_rhodes', 'rhodes_stabs', 'jazz_keys'],
  synth_stabs: ['synth_stabs', 'pwm', 'wavetable'],
  analog_saw_pad: ['analog_saw_pad', 'pwm', 'wavetable'],
  dark_pad: ['dark_pad', 'dark_wide_pad'],
  clavinet: ['clavinet', 'rhodes_stabs', 'organ'],
};
export function selectSoundPalette(sound, archetype, synthProfile, seed, soundVariation) {
  const allowed = profile => !sound.exclusions.includes(profile)
    && !(sound.exclusions.includes('piano') && PIANO_PROFILES.has(profile));
  const select = (role, current, bank, locked) => {
    const candidates = [...new Set(locked ? [current] : bank ?? [current])].filter(allowed);
    const profile = candidates.length ? random(seed, 'palette:' + role).pick(candidates) : current;
    return { profile, source: locked ? 'prompt' : candidates.length > 1 ? 'palette' : 'preset', candidates };
  };
  const indie = ['indie_pop', 'bedroom_pop'].includes(archetype.id);
  const harmonyBank = indie && synthProfile === archetype.synth_profile
    ? ['electric_guitar', 'acoustic_guitar', 'rhodes_stabs', 'organ', 'pwm'] : harmonyPalettes[synthProfile];
  // Do not diversify away a deliberately selected acoustic family sound.
  const fixedFamily = ['classical', 'country', 'jazz', 'latin'].includes(archetype.family)
    || ['classical_minimal', 'country_acoustic', 'jazz_lounge'].includes(archetype.id);
  const bassBank = fixedFamily ? [sound.bassTexture] : bassPalettes[sound.bassTexture] ?? [sound.bassTexture];
  const edgedVariation = soundVariation && random(seed, 'palette:bass-edge')() < .125;
  const allowEdge = !sound.avoidMetallic && (sound.bassTextureRequested || heavyBassStyles.test(archetype.id) || edgedVariation);
  const bassChoices = allowEdge ? bassBank : bassBank.filter((profile) => !edgyBass.has(profile));
  const bassLocked = sound.bassTextureRequested && (allowEdge || !edgyBass.has(sound.bassTexture));
  const bass = select('bass', bassLocked ? sound.bassTexture : bassChoices[0] ?? 'warm_sub',
    bassChoices.length ? bassChoices : ['warm_sub', 'dark_analog_bass'], bassLocked);
  const harmony = select('harmony', synthProfile, fixedFamily ? null : harmonyBank, sound.harmonyTextureRequested);
  sound.bassTexture = bass.profile;
  // Phrase choice follows the requested/preset role, so sound-only rerolls do
  // not also reroll strums, rhythms or note counts.
  sound.harmonyBasis = sound.harmonyTextureRequested ? synthProfile : archetype.synth_profile;
  sound.palette = { seed: String(seed), bass, harmony };
  return harmony.profile;
}
