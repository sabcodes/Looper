export { compilePrompt, classify, archetypes, corpus, SCALES } from './parser.js';
export { compose, euclidean, swingTime, linearMasks, ratchet, generateDrums, generateBass, SECTIONS } from './composition.js';
export { progression, minimalVoiceLeading } from './harmony.js';
export { renderAudio, renderStems, packWav, sliceAudio, duckingGain, glideFrequency } from './dsp.js';
export { analyzeScore } from './score-analysis.js';
export { arrangeVocals, MACOS_VOICES } from './vocals.js';
export { prepareVocalSamples, pitchVocalSamples } from './speech.js';
export { estimateVocalPitch } from './vocal-pitch.js';
export { FORMS, timeAtStep, barStep } from './arrangement.js';
export { REVERBS, convolve, vocode, resolveProduction } from './effects.js';
export { INSTRUMENTS } from './instruments.js';
export { spectralResynthesize, fft } from './synthesis.js';
export { transformMotif } from './development.js';
export { PART_INSTRUMENTS } from './parts.js';

export { resolveTuning, parseScala, tunedHz } from './tuning.js';
export { validateTimbre } from './timbre.js';
export { ACOUSTIC_PROFILES } from './acoustics.js';
export { transformVocalBuffer, transformVocalBank } from './vocal-transform.js';
