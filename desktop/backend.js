import { createHash, randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdir, lstat, open, readdir, realpath, unlink } from 'node:fs/promises';
import { basename, dirname, extname, join } from 'node:path';
import { generatedDirectory } from '../src/output-directory.js';
import { compose, renderAudio, renderStems, prepareVocalSamples, packWav } from '../src/index.js';
import { writeAudio, writeJson } from '../src/export.js';
import { timeAtStep, barStep } from '../src/arrangement.js';
import { suggestDirection } from './suggest-direction.js';
import { applyAudition, applyPartEdits, applyPartVariations, describeEditableScore, describePartParameters, resolvePartPrompt, validateEditableScore } from './score-editor.js';

export const outputDirectory = generatedDirectory;
const formats = new Set(['wav', 'mp3', 'flac']);
const optionNames = new Set(['seed', 'soundSeed', 'phraseSeed', 'intentOverride', 'sauce', 'lyrics', 'hook', 'voice', 'vocals',
  'vocalPitch', 'vocalNote', 'vocalRange', 'vocalDensity', 'vocalChops', 'vocalEvery', 'vocalSection',
  'vocalStretch', 'vocalFormant', 'parts', 'mix', 'timbre', 'tuning', 'development']);

export function validateRequest(request) {
  if (!request || typeof request !== 'object' || Array.isArray(request)) throw new Error('Invalid generation request.');
  const { prompt, options = {}, format = 'wav', output = '', stems = false, saveScore = true } = request;
  if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 10000) throw new Error('Enter a prompt of 1–10000 characters.');
  if (!formats.has(format)) throw new Error('Choose WAV, MP3 or FLAC.');
  if (typeof stems !== 'boolean' || typeof saveScore !== 'boolean') throw new Error('Invalid export settings.');
  if (stems && format === 'mp3') throw new Error('Stems require WAV or FLAC.');
  if (typeof output !== 'string' || output.length > 120 || (output && (!output.trim() || basename(output) !== output || /[\\/\0\x00-\x1f]/.test(output) || output.startsWith('.')))) {
    throw new Error('Output must be a filename of up to 120 characters inside generated_beats/.');
  }
  if (extname(output) && extname(output).toLowerCase() !== '.' + format) throw new Error('Filename extension must match the export format.');
  if (!options || typeof options !== 'object' || Array.isArray(options)) throw new Error('Options must be a JSON object.');
  for (const name of Object.keys(options)) if (!optionNames.has(name)) throw new Error('Unknown engine option: ' + name);
  if (JSON.stringify(options).length > 200000) throw new Error('Engine options are too large.');
  return { prompt: prompt.trim(), options, format, output, stems, saveScore };
}

export function summarize(score) {
  const c = score.config;
  const sound = c.soundDesign ?? {};
  return { intent: c.intent, bpm: c.bpm, key: c.rootName + ' ' + c.scale.replaceAll('_', ' '),
    bars: c.bars, meter: c.timeSignature ?? (c.beatsPerBar ?? 4) + '/4', duration: c.duration, seed: c.seed,
    soundSeed: c.soundSeed ?? c.seed, phraseSeed: c.phraseSeed ?? c.seed, sauce: c.sauce,
    sounds: { harmony: score.keys.length ? score.keys[0].profile ?? c.synthProfile : 'Off',
      bass: score.bass.length ? score.bass[0].profile ?? c.bassProfile : 'Off',
      drums: Object.values(score.drums).some((events) => events.length) ? sound.drumKit : 'Off' },
    messages: c.messages ?? [], interpretation: c.classification?.source ?? 'inferred',
    canSuggest: Boolean(c.classification?.needsInterpretationReview),
    alternatives: (c.classification?.alternatives ?? []).filter((a) => a.score >= .12).map((a) => a.intent),
    cues: (c.classification?.context?.evidence ?? []).map((item) => item.cue),
    sections: score.sections.map(({ name, start, end, startTime, endTime }) => ({ name, start, end,
      startTime: startTime ?? timeAtStep(c, barStep(c, start)), endTime: endTime ?? timeAtStep(c, barStep(c, end)) })) };
}

async function assertAvailable(path) {
  try { await lstat(path); }
  catch (error) { if (error.code === 'ENOENT') return; throw error; }
  throw new Error('Output exists: ' + basename(path) + '. Choose a new filename.');
}

async function readSavedScore(source) {
  const audio = await resolveAudio(source);
  const path = join(dirname(audio), basename(source, extname(source)) + '.json');
  let file;
  try {
    file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  } catch (error) {
    if (['ENOENT', 'ELOOP'].includes(error.code)) throw new Error('This render needs a saved score JSON in the beats folder.');
    throw error;
  }
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > 64 * 1024 * 1024) throw new Error('This score is not a supported regular file of up to 64 MiB.');
    const bytes = Buffer.alloc(stat.size);
    const { bytesRead } = await file.read(bytes, 0, bytes.length, 0);
    const after = await file.stat();
    if (bytesRead !== bytes.length || after.size !== stat.size || after.mtimeMs !== stat.mtimeMs) throw new Error('The score changed while opening it. Try again.');
    let score;
    try { score = JSON.parse(bytes.toString('utf8')); }
    catch { throw new Error('The saved score JSON is invalid.'); }
    return { score: validateEditableScore(score), revision: createHash('sha256').update(bytes).digest('hex') };
  } finally { await file.close(); }
}

export async function runJob(action, input, status = () => {}, renderOptions = {}) {
  if (['inspect-score', 'render-edit', 'audition'].includes(action)) {
    const { score, revision } = await readSavedScore(input?.source);
    if (action === 'inspect-score') return { revision, ...describeEditableScore(score) };
    if (input.revision !== revision) throw new Error('The saved score changed. Reopen it before editing.');
    let variations = input.variations === undefined ? [] : input.variations;
    let interpretation;
    if (action === 'audition' && input.interpretPrompt === true) {
      if (!Array.isArray(variations) || variations.length !== 1 || variations[0]?.track !== input.solo) {
        throw new Error('Choose a soloed part and enter a new part prompt.');
      }
      interpretation = await resolvePartPrompt(score, variations[0], status);
      if (interpretation) variations = [{ ...variations[0], interpretation }];
    }
    applyPartVariations(score, variations);
    if (action === 'audition') {
      applyAudition(score, input);
      if (interpretation) status('Rendering interpreted edit');
      const vocalSamples = await prepareVocalSamples(score, renderOptions);
      return { wav: packWav(renderAudio(score, { ...renderOptions, vocalSamples })), ...(interpretation && { interpretation }),
        ...(input.solo && { parameters: describePartParameters(score, input.solo) }) };
    }
    const edits = input.edits === undefined ? [] : input.edits;
    if (!variations.length || !Array.isArray(edits) || edits.length) applyPartEdits(score, edits);
    if (variations.length) {
      score.partVariation = { source: input.source, revision, changes: variations.map(({ track, mode, seed, prompt, interpretation }) =>
        ({ track, mode, seed, prompt, interpretation })) };
    }
    const format = extname(input.source).slice(1).toLowerCase();
    const output = 'edit-' + randomBytes(8).toString('hex') + '.' + format;
    return renderSavedScore(score, { output, format, saveScore: true, stems: false }, status, renderOptions);
  }
  if (!['preview', 'generate', 'suggest'].includes(action)) throw new Error('Unknown job.');
  const request = validateRequest(input);
  status('Interpreting prompt');
  const score = compose(request.prompt, request.options);
  if (action === 'preview') return { summary: summarize(score) };
  if (action === 'suggest') return { summary: summarize(score), ...await suggestDirection(score, request.options, status) };
  return renderSavedScore(score, request, status, renderOptions);
}

async function renderSavedScore(score, request, status, renderOptions) {
  const summary = summarize(score);
  const name = request.output || summary.intent + '-' + summary.bpm + 'bpm-' + randomBytes(5).toString('hex') + '.' + request.format;
  const filename = extname(name) ? name : name + '.' + request.format;
  const target = join(outputDirectory, filename);
  const stemBase = target.slice(0, -extname(target).length);
  const scoreTarget = stemBase + '.json';
  await mkdir(outputDirectory, { recursive: true });
  await assertAvailable(target);
  if (request.saveScore) await assertAvailable(scoreTarget);
  if (request.stems) {
    const names = [...Object.keys(score.drums), 'keys', 'bass', 'lead', 'arp', ...(score.vocals ? ['vocals'] : []), ...(score.parts ?? []).map((p) => p.name), 'fx'];
    for (const voice of names) await assertAvailable(stemBase + '.stem-' + voice + '.' + request.format);
  }
  status(score.vocals ? 'Synthesizing local vocals' : 'Rendering instruments');
  const vocalSamples = await prepareVocalSamples(score, renderOptions);
  if (score.vocals) {
    score.vocals.sampleHashes = vocalSamples.hashes;
    if (vocalSamples.pitch) score.vocals.pitchResult = vocalSamples.pitch;
    if (vocalSamples.runtime) score.vocals.speechRuntime = vocalSamples.runtime;
  }
  status('Rendering instruments');
  const options = { ...renderOptions, vocalSamples };
  const rendered = request.stems ? renderStems(score, options) : null;
  const audio = rendered?.mix ?? renderAudio(score, options);
  status('Saving ' + request.format.toUpperCase());
  const files = [];
  try {
    await writeAudio(target, audio, { format: request.format });
    files.push(filename);
    if (rendered) for (const [voice, stem] of Object.entries(rendered.stems)) {
      const path = stemBase + '.stem-' + voice + '.' + request.format;
      await writeAudio(path, stem, { format: request.format });
      files.push(basename(path));
    }
    if (request.saveScore) { await writeJson(scoreTarget, score); files.push(basename(scoreTarget)); }
  } catch (error) {
    await Promise.allSettled(files.map((name) => unlink(join(outputDirectory, name))));
    throw error;
  }
  return { summary, filename, files, stats: audio.stats };
}

export async function resolveAudio(name) {
  if (typeof name !== 'string' || basename(name) !== name || /[\\/\0]/.test(name) || !formats.has(extname(name).slice(1).toLowerCase())) throw new Error('Invalid audio filename.');
  const [directory, path] = await Promise.all([realpath(outputDirectory), realpath(join(outputDirectory, name))]);
  if (dirname(path) !== directory || !(await lstat(path)).isFile()) throw new Error('Audio must stay inside generated_beats/.');
  return path;
}

export async function listAudio() {
  let entries;
  try { entries = await readdir(outputDirectory, { withFileTypes: true }); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  const files = await Promise.all(entries.filter((e) => e.isFile() && formats.has(extname(e.name).slice(1).toLowerCase()))
    .map(async (e) => { try { const s = await lstat(join(outputDirectory, e.name)); return { name: e.name, bytes: s.size, modified: s.mtimeMs }; } catch { return null; } }));
  return files.filter(Boolean).sort((a, b) => b.modified - a.modified).slice(0, 50);
}
