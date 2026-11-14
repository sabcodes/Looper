import { transformVocalBank } from './vocal-transform.js';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { generatedDirectory } from './output-directory.js';
import { createHash } from 'node:crypto';
import { release } from 'node:os';
import { MACOS_VOICES } from './vocals.js';
import { resolveVocalPitch, estimateVocalPitch } from './vocal-pitch.js';

const generated = generatedDirectory;
function run(command, args, input, maxBytes = 4 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    const chunks = [];
    let bytes = 0, stderr = '', failure;
    const timer = setTimeout(() => { failure = new Error(command + ' timed out.'); child.kill('SIGKILL'); }, 30000);
    child.stdout.on('data', (chunk) => {
      bytes += chunk.length;
      if (bytes > maxBytes) { failure = new Error(command + ' produced too much audio.'); child.kill('SIGKILL'); }
      else chunks.push(chunk);
    });
    child.stderr.on('data', (chunk) => { if (stderr.length < 4096) stderr += chunk.toString(); });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error.code === 'ENOENT' ? new Error(command + ' is required for vocals. Instrumental WAV rendering does not need it.') : error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (failure) reject(failure);
      else if (code !== 0) reject(new Error(command + ' failed (' + code + '): ' + stderr.trim()));
      else resolve(Buffer.concat(chunks));
    });
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}

function decode(buffer, sampleRate) {
  const samples = new Float32Array(Math.floor(buffer.length / 4));
  for (let i = 0; i < samples.length; i++) samples[i] = buffer.readFloatLE(i * 4);
  let start = 0, end = samples.length;
  // Trim the native synthesizer's padding, retaining 8 ms around audible speech.
  while (start < end && Math.abs(samples[start]) < .003) start++;
  while (end > start && Math.abs(samples[end - 1]) < .003) end--;
  const padding = Math.round(sampleRate * .008);
  const trimmed = samples.slice(Math.max(0, start - padding), Math.min(samples.length, end + padding));
  let peak = 0;
  for (const sample of trimmed) peak = Math.max(peak, Math.abs(sample));
  const gain = peak ? Math.min(4, .75 / peak) : 1;
  return trimmed.map((sample) => sample * gain);
}

export async function prepareVocalSamples(score, { sampleRate = 44100 } = {}) {
  const plan = score.vocals;
  if (!plan?.events.length) return { sampleRate, sources: {}, hashes: {} };
  if (process.platform !== 'darwin') throw new Error('The native vocal backend requires macOS. Use --vocals off for instrumental rendering.');
  if (!Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 96000) throw new Error('Invalid vocal sample rate.');
  if (plan.engine !== 'macos-say' || !Object.values(MACOS_VOICES).includes(plan.voice) || plan.rate !== 180) throw new Error('Unsupported speech configuration.');
  // Restrict speech to the supported voices; never install voices or models.
  const sources = {}, hashes = {};
  await mkdir(generated, { recursive: true });
  const directory = await mkdtemp(join(generated, '.speech-'));
  try {
    const needed = new Set(plan.events.flatMap((event) => event.source.startsWith('phrase:')
      ? plan.phrases[Number(event.source.slice(7))].split(' ') : [event.source.slice(5)]));
    const wordSamples = new Map();
    for (const word of needed) {
      if (!/^[a-z0-9]+(?:['-][a-z0-9]+)*$/.test(word)) throw new Error('Invalid speech word.');
      const path = join(directory, 'word.aiff');
      await run('/usr/bin/say', ['-v', plan.voice, '-r', '180', '-o', path, '-f', '-'], word + '\n');
      const raw = await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', path, '-ac', '1', '-ar', String(sampleRate), '-f', 'f32le', 'pipe:1']);
      await unlink(path);
      const audio = decode(raw, sampleRate);
      if (!audio.length || !audio.some((v) => Math.abs(v) > .003)) throw new Error('Speech synthesis returned silence for ' + word);
      wordSamples.set(word, audio);
      sources['word:' + word] = audio;
    }
    for (const event of plan.events) {
      if (!event.source.startsWith('phrase:') || sources[event.source]) continue;
      const tokens = plan.phrases[Number(event.source.slice(7))].split(' ');
      const gap = Math.round(sampleRate * .025);
      const size = tokens.reduce((n, word) => n + wordSamples.get(word).length, gap * (tokens.length - 1));
      const phrase = new Float32Array(size);
      let offset = 0;
      for (const word of tokens) { const audio = wordSamples.get(word); phrase.set(audio, offset); offset += audio.length + gap; }
      sources[event.source] = phrase;
    }
    for (const [key, value] of Object.entries(sources)) {
      const bytes = Buffer.alloc(value.length * 4);
      value.forEach((v, i) => bytes.writeFloatLE(v, i * 4));
      hashes[key] = createHash('sha256').update(bytes).digest('hex');
    }
    const samples = { sampleRate, voice: plan.voice, sources, hashes, runtime: { platform: process.platform, release: release(), sampleRate } };
    let result=plan.pitch ? await pitchVocalSamples(score,samples):samples;
    if(plan.transform)result=transformVocalBank(result,plan.transform,plan.phrases);
    return result;
  } finally { await rm(directory, { recursive: true, force: true }); }
}


// Pitch only generated voice buffers. Rebuilding phrases from shifted words keeps
// the spoken word/chop boundaries consistent, with exact original frame counts.
export async function pitchVocalSamples(score, samples) {
  const settings = score.vocals?.pitch;
  if (!settings) return samples;
  if (samples.pitch) throw new Error('Pitch processing requires an unprocessed vocal sample bank.');
  if (samples.voice !== score.vocals.voice) throw new Error('Prepared speech voice does not match the vocal plan.');
  const { sampleRate } = samples;
  if (!Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 96000) throw new Error('Invalid vocal sample rate.');
  const pitch = resolveVocalPitch(settings, samples.sources, sampleRate);
  if (!Number.isFinite(pitch.appliedSemitones) || Math.abs(pitch.appliedSemitones) > 24) throw new Error('Invalid vocal pitch shift.');
  if (Math.abs(pitch.appliedSemitones) < 1e-8) return { ...samples, pitch };
  const rate = Math.round(sampleRate * 2 ** (pitch.appliedSemitones / 12));
  let tempo = sampleRate / rate;
  const filters = ['asetrate=' + rate, 'aresample=' + sampleRate];
  while (tempo < .5) { filters.push('atempo=0.5'); tempo /= .5; }
  while (tempo > 2) { filters.push('atempo=2'); tempo /= 2; }
  filters.push('atempo=' + tempo);
  const sources = {};
  for (const [key, audio] of Object.entries(samples.sources)) {
    if (!key.startsWith('word:')) continue;
    const padding = Math.round(sampleRate * .1);
    const input = Buffer.alloc((audio.length + 2 * padding) * 4);
    for (let i = 0; i < audio.length; i++) {
      if (!Number.isFinite(audio[i])) throw new Error('Vocal sample contains non-finite audio.');
      input.writeFloatLE(audio[i], (padding + i) * 4);
    }
    const filter = [...filters, 'apad', 'atrim=start_sample=' + padding + ':end_sample=' + (padding + audio.length)].join(',');
    const raw = await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'f32le', '-ar', String(sampleRate), '-ac', '1', '-i', 'pipe:0', '-af', filter, '-f', 'f32le', 'pipe:1'], input);
    const shifted = new Float32Array(audio.length);
    for (let i = 0; i < Math.min(audio.length, raw.length / 4); i++) shifted[i] = raw.readFloatLE(i * 4);
    let peak = 0;
    for (const sample of shifted) { if (!Number.isFinite(sample)) throw new Error('Pitch processing produced invalid audio.'); peak = Math.max(peak, Math.abs(sample)); }
    if (peak > .95) for (let i = 0; i < shifted.length; i++) shifted[i] *= .95 / peak;
    sources[key] = shifted;
  }
  for (const key of Object.keys(samples.sources).filter((key) => key.startsWith('phrase:'))) {
    const tokens = score.vocals.phrases[Number(key.slice(7))].split(' ');
    const gap = Math.round(sampleRate * .025);
    const phrase = new Float32Array(tokens.reduce((size, word) => size + sources['word:' + word].length, gap * (tokens.length - 1)));
    let offset = 0;
    for (const word of tokens) { const audio = sources['word:' + word]; phrase.set(audio, offset); offset += audio.length + gap; }
    sources[key] = phrase;
    if (phrase.length !== samples.sources[key].length) throw new Error('Pitch processing changed phrase length.');
  }
  const hashes = {};
  for (const [key, audio] of Object.entries(sources)) {
    const bytes = Buffer.alloc(audio.length * 4);
    audio.forEach((sample, i) => bytes.writeFloatLE(sample, i * 4));
    hashes[key] = createHash('sha256').update(bytes).digest('hex');
  }
  let result = { ...samples, sources, hashes, pitch: { ...pitch, method: 'ffmpeg-asetrate-atempo', durationPreserved: true }, inputHashes: samples.hashes };
  if (settings.mode !== 'shift') {
    // The voiced-frame population can change after time stretching. Refine the
    // center on the original bank, avoiding cumulative processing degradation.
    for (let attempt = 0; attempt < 3; attempt++) {
      const measured = estimateVocalPitch(result.sources, sampleRate);
      if (!measured) break;
      const correction = 12 * Math.log2(pitch.targetHz / measured.hz);
      result.pitch.achievedHz = measured.hz;
      result.pitch.residualCents = -correction * 100;
      result.pitch.refinementPasses = attempt;
      if (Math.abs(correction) <= .25 || attempt === 2) break;
      const semitones = result.pitch.appliedSemitones + correction;
      if (Math.abs(semitones) > 24) break;
      const shiftedScore = { ...score, vocals: { ...score.vocals, pitch: { mode: 'shift', semitones } } };
      const refined = await pitchVocalSamples(shiftedScore, samples);
      result = { ...refined, pitch: { ...pitch, appliedSemitones: semitones, method: 'ffmpeg-asetrate-atempo', durationPreserved: true } };
    }
  }
  return result;
}
