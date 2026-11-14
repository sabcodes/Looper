// Offline semantic cues are musical priors, not probabilities or full language understanding.
// Rules combine concepts; none identify an evaluation prompt by its complete text.
export function interpretContext(prompt) {
  const text = prompt.toLowerCase().replace(/[-_]/g, ' ')
    .replace(/\b(?:not|no|without|avoid|less)\s+(?:dark|bright|happy|calm|heavy|intense|nostalgic)\b/g, ' ')
    .replace(/\b(?:not|no|without|avoid|excluding)\s+(?:(?:any|a|an|the)\s+)?(?:hammond(?: organ)?|organ|dance ?floor|four on the floor)\b/g, ' ');
  const evidence = [];
  const cue = (name, pattern) => {
    const match = text.match(pattern);
    if (match) evidence.push({ feature: name, cue: match[0] });
    return Boolean(match);
  };
  const reading = cue('reading', /\b(?:read(?:ing)?|books?|library|pages?)\b/);
  const calm = cue('calm', /\b(?:calm|relax\w*|unwind\w*|peaceful|tranquil|gentle|quiet|meditat\w*|sleep\w*)\b(?!\s+(?:(?:male|female|spoken|vocal)\s+)*(?:vocals?|hook|voice|spoken phrase)\b)/);
  const rain = cue('rain', /\b(?:rain\w*|drizzle|overcast)\b/);
  const nostalgic = cue('nostalgia', /\b(?:nostalg\w*|memories|reminisc\w*|sentimental)\b/);
  const road = cue('road_trip', /\b(?:road trip|roadtrip|open road)\b/);
  const beach = cue('beach', /\b(?:beach|seaside|coast\w*|tropical|summer|sunshine)\b/);
  const night = cue('night', /\b(?:night|midnight|nocturnal|after dark)\b/);
  const driving = cue('driving', /\b(?:driv\w*|cruis\w*|highway|motorway)\b/);
  const bounce = cue('bounce', /\b(?:bounce|bouncy|bouncing|galloping|head nod\w*)\b(?!\s+(?:synth\s+)?(?:bass|bassline|riff)\b)/);
  const workout = cue('workout', /\b(?:workout|gym|exercise|cardio|sprint\w*|fitness|training|running|jogging|weightlifting)\b/);
  const intense = cue('high_energy', /\b(?:intense|energetic|aggressive|high energy|frantic|upbeat)\b/);
  const dark = cue('dark', /\b(?:dark|ominous|menacing|scary|spooky|eerie|haunt\w*|melanchol\w*|sad)\b/);
  const bright = cue('bright', /\b(?:happy|bright|uplifting|sunny|joyful|cheerful)\b/);
  const airy = cue('atmosphere', /\b(?:atmospher\w*|ambient|dreamy|floating|ethereal)\b/);
  const slow = cue('slow', /\b(?:slow|downtempo|laid back)\b/);
  const fast = cue('fast', /\b(?:fast|rapid|uptempo|high tempo)\b/);
  const heavyBass = cue('bass_weight', /\b(?:heavy|massive|huge|thick|powerful|deep)\s+(?:bass|subs?|low end)\b|\bbass heavy\b/);
  const warm = cue('warm', /\b(?:warm|mellow|soft)\b/);
  const dancefloor = cue('dancefloor', /\b(?:dance ?floor|four on the floor)\b/);
  const organDance = dancefloor && cue('organ', /\b(?:hammond|organ)\b/);
  const islandGroove = /\b(?:riddims?|steel ?pans?)\b/.test(text) && cue('caribbean_groove', /\b(?:caribbean|islands?)\b/);
  const electronic = cue('electronic', /\b(?:synth\w*|electronic|analog|pads?|arpeggios?)\b/);
  const experimentalRhythm = cue('experimental_rhythm', /\b(?:polymetric|polyrhythmic|fractured|modular percussion|irregular ghost notes)\b/);
  const london = cue('london_rhythm', /\b(?:london|pirate radio|british)\b/);
  const brazil = cue('brazilian_rhythm', /\b(?:brazil\w*|favela|rio|tambor\w*|surdo)\b/);
  const social = cue('social', /\b(?:friends?|guests?|gathering|together|company)\b/);
  const daylight = cue('daylight', /\b(?:sunlight|sunlit|daylight|breezy)\b/);
  const homeActivity = cue('home_activity', /\b(?:cook\w*|kitchen|lunch|brunch|dinner)\b/);
  const commute = cue('commute', /\b(?:commut\w*|last train|(?:train|bus)(?: ride| journey)?(?: back)? home|heading home)\b/);
  const reflective = cue('reflective', /\b(?:reflect\w*|pensive|wistful|tired|weary|hopeful)\b/);
  const playful = cue('playful', /\b(?:playful|restless|mischievous|bustling)\b/);
  const walking = cue('walking', /\b(?:walk\w*|stroll\w*)\b/);
  const socialDay = social && (daylight || homeActivity);
  const reflectiveCommute = commute && reflective;
  const playfulWalk = playful && walking;
  const nightDrive = night && driving;
  const weights = {};
  const prefer = (pairs) => { for (const [id, value] of pairs) weights[id] = (weights[id] ?? 0) + value; };
  if (socialDay) prefer([['indie_pop', 2.6], ['nu_disco', 1]]);
  if (reflectiveCommute) prefer([['alternative_rnb', 2.6], ['lofi_chill', 2.4], ['synthwave_retro', 1.2]]);
  if (playfulWalk) prefer([['nu_disco', 2.6], ['afropop', 2.5]]);
  if (reading) prefer([['jazz_lounge', electronic ? .4 : 2.4], ['classical_minimal', electronic ? .3 : 2.3]]);
  if (calm) prefer([['jazz_lounge', .6], ['classical_minimal', .65], ['lofi_chill', .5]]);
  if (rain) prefer([['lofi_chill', 3.5], ['jazz_lounge', .5]]);
  if (nostalgic) prefer(electronic ? [['synthwave_retro', 3.6], ['synthpop_80s', 1.2]] : [['jazz_lounge', 2.1], ['lofi_chill', 1.6], ['indie_pop', 1.1], ['synthwave_retro', .4]]);
  if (organDance) prefer([['soulful_house', 4], ['deep_house', 2.8]]);
  if (islandGroove) prefer([['dancehall', 4.6], ['dub', 3.2]]);
  if (road) prefer([['synthpop_80s', 2.2], ['synthwave_retro', 1.3], ['house_bright', .5]]);
  if (beach) prefer([['house_bright', 2.1], ['amapiano_log', 1.9]]);
  if (nightDrive) prefer([['techno_rave', 3], ['industrial_bass', 1.8], ['synthwave_retro', 2.2]]);
  if (bounce && !islandGroove) prefer([['jersey_club', 2.4], ['chicago_footwork', 2.2], ['drill_sliding', 1.4]]);
  if (london && /\b(?:bounce|swung|shuffle\w*|skipping)\b/.test(text)) prefer([['uk_garage_2step', 4]]);
  if (experimentalRhythm) prefer([['idm_glitch', 2]]);
  if (brazil) prefer([['baile_funk_tambor', 4]]);
  if (workout) prefer([['chicago_footwork', 3], ['techno_rave', 2.4], ['jersey_club', 1.8]]);
  if (dark && !nightDrive) prefer([['industrial_bass', 1], ['dubstep_halftime', .45]]);
  if (airy) prefer([['industrial_bass', .7], ['neutral_groove', 1.4], ['classical_minimal', .3]]);
  if (electronic && calm && !nightDrive) prefer([['neutral_groove', 1.6], ['industrial_bass', dark ? 1.5 : .2]]);
  if (bright && !reading && !calm) prefer([['house_bright', .3], ['synthpop_80s', .25]]);
  let energy = workout ? .95 : organDance ? .62 : islandGroove ? .55 : bounce ? .78 : road ? .72 : beach ? .62 : nightDrive ? .66
    : reading || calm || rain ? .2 : airy ? .28 : nostalgic ? .38 : intense ? .85 : socialDay ? .48 : reflectiveCommute ? .36 : playfulWalk ? .72 : undefined;
  if (intense && !calm && !reading) energy = Math.max(energy ?? .5, .85);
  if (slow) energy = Math.min(energy ?? .4, .3);
  if (fast && !slow) energy = Math.max(energy ?? .7, .8);
  let tempo = workout ? 160 : organDance ? 122 : islandGroove ? 98 : bounce ? 138 : road ? 122 : beach ? 120 : nightDrive && !rain ? 130
    : rain ? 78 : reading || calm ? 80 : nostalgic ? 92 : airy || slow ? 82 : fast || intense ? 145 : socialDay ? 104 : reflectiveCommute ? 86 : playfulWalk ? 118 : undefined;
  if (slow && !fast) tempo = Math.min(tempo ?? 90, 90);
  if (fast && !slow) tempo = Math.max(tempo ?? 145, 145);
  return { text, evidence, weights, energy, tempo, mood: bright ? 'bright' : dark ? 'dark' : 'neutral',
    reading, calm, rain, nostalgic, road, beach, nightDrive, bounce, workout, airy, slow, fast, dark, bright, heavyBass, warm, electronic, socialDay, reflectiveCommute, playfulWalk };
}
