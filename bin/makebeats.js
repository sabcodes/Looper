#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { randomBytes } from 'node:crypto';
import { mkdir, lstat } from 'node:fs/promises';
import { resolve, basename, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { compose, renderAudio, renderStems, sliceAudio, prepareVocalSamples } from '../src/index.js';
import { hash } from '../src/random.js';
import { writeAudio, writeJson } from '../src/export.js';

const generatedDirectory = fileURLToPath(new URL('../generated_beats/', import.meta.url));
const help = `makebeats — offline procedural music (8–128 bars, default 32 bars in 4/4)

Usage:
  node bin/makebeats.js "happy house in F major at 135bpm" [options]
  npm run makebeats -- "dark drill in F minor" --seed 42 --sauce 0.7

Options:
  --seed VALUE       Repeatable variation (default: 0)
  --sound-seed VALUE Reroll unspecified sounds while keeping the musical seed
  --phrase-seed VALUE Reroll accompaniment, lead and designed bass phrases
  --random           Choose and print a new seed; cannot combine with --seed
  --sauce FLOAT      Disruption amount, from 0 to 1 (default: genre preset)
  --format FORMAT    mp3 (default), wav, or flac
  --output, -o NAME  Filename inside generated_beats/ (extension optional)
  --preview SECONDS  Also export a 1–60 second preview starting at the drop
  --lyrics TEXT      Spoken English phrases, separated by punctuation or |
  --hook TEXT        Repeated hook (default: first lyric phrase)
  --vocals MODE      auto or off (default: auto when lyrics are supplied)
  --voice NAME       zarvox (default), ralph, fred, trinoids, whisper,
                     albert, junior, kathy, boing, samantha, karen, moira, tessa
                     (macOS + FFmpeg)
  --vocal-pitch N    Shift -24..+24 semitones, keeping word lengths fixed
  --vocal-note NOTE  Move estimated pitch center to F3, C#4, etc., or root
  --vocal-range A:B  Fit estimated pitch center into a range, e.g. C3:C4
  --vocal-density N  Vocal activity, 0–1 (default: 0.45)
  --vocal-chops N    Word chops/build stutters, 0–1 (default: 0.55)
  --vocal-every BARS Phrase interval: 1, 2, 4 or 8 (default: 4)
  --vocal-section S  auto (all sections), intro, verse, breakdown, build, drop, outro
  --parts JSON       Additional named instrument parts (JSON array; see docs/EXPANSION.md)
  --mix JSON         Master/bus effect settings (JSON object)
  --timbre JSON      Shared excitation, envelope, partial and modulation settings
  --tuning JSON      Tuning system, concert pitch, Scala text or ratio table
  --development JSON Extended chords and phrase-aware melody settings
  --vocal-stretch N  Independent speech duration factor, 0.5–2
  --vocal-formant N  Independent formant shift, -12–12 semitones
  --stems            Export shared-gain stems (requires wav or flac)
  --json             Also write the deterministic composition as JSON
  --dry-run          Print composition JSON without rendering/writing audio
  --force, -f        Replace existing outputs
  --help, -h         Show this help

All output files go in:
  ` + generatedDirectory + `

Instrumental WAV synthesis is pure Node.js. MP3 (192 kbps) and FLAC require local FFmpeg.
Default instrumentals use no models, network access, samples or npm dependencies.
Granular parts may optionally use a user-provided decoded mono sample array.
Optional vocals use local macOS speech and FFmpeg, with no model downloads.
`;

async function assertAvailable(path, force) {
  if (force) return;
  try { await lstat(path); }
  catch (error) { if (error.code === 'ENOENT') return; throw error; }
  throw new Error('Output exists: ' + path + '. Choose another name or use --force.');
}

async function main() {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    seed: { type: 'string' }, 'sound-seed': { type: 'string' }, 'phrase-seed': { type: 'string' }, random: { type: 'boolean' }, sauce: { type: 'string' },
    preview: { type: 'string' }, format: { type: 'string' }, output: { type: 'string', short: 'o' }, json: { type: 'boolean' },
    timbre:{type:'string'},tuning:{type:'string'},development:{type:'string'},'vocal-stretch':{type:'string'},'vocal-formant':{type:'string'},
    parts: { type: 'string' }, mix: { type: 'string' }, stems: { type: 'boolean' },
    lyrics: { type: 'string' }, hook: { type: 'string' }, vocals: { type: 'string' }, voice: { type: 'string' },
    'vocal-pitch': { type: 'string' }, 'vocal-note': { type: 'string' }, 'vocal-range': { type: 'string' },
    'vocal-density': { type: 'string' }, 'vocal-chops': { type: 'string' },
    'vocal-every': { type: 'string' }, 'vocal-section': { type: 'string' },
    'dry-run': { type: 'boolean' }, force: { type: 'boolean', short: 'f' }, help: { type: 'boolean', short: 'h' },
  } });
  if (values.help) { console.log(help); return; }
  if (!positionals.length) throw new Error('Supply a musical prompt. Run with --help for examples.');
  if (values.random && values.seed !== undefined) throw new Error('Use either --seed or --random, not both.');
  if (values.sauce !== undefined && !values.sauce.trim()) throw new Error('Sauce must be a number from 0 to 1.');
  const previewSeconds = values.preview === undefined ? null : Number(values.preview);
  if (previewSeconds !== null && (!Number.isFinite(previewSeconds) || previewSeconds < 1 || previewSeconds > 60)) throw new Error('Preview must be 1–60 seconds.');
  const seed = values.random ? randomBytes(4).readUInt32LE().toString() : values.seed ?? '0';
  const output = values.output;
  if (output !== undefined && (!output.trim() || basename(output) !== output || /[\\/\0]/.test(output) || output === '.' || output === '..')) {
    throw new Error('--output must be a filename; all files stay in generated_beats/.');
  }
  const extension = output ? extname(output).slice(1).toLowerCase() : '';
  const format = values.format ?? (extension || 'mp3');
  if (!['mp3', 'wav', 'flac'].includes(format)) throw new Error('Format must be mp3, wav or flac.');
  if (extension && extension !== format) throw new Error('Output extension must match --format.');
  if (values.stems && format === 'mp3') throw new Error('Use --format wav or flac with --stems for lossless reconstruction.');
  const parseJson = (value, name) => { try { return value === undefined ? undefined : JSON.parse(value); } catch { throw new Error(name + ' must be valid JSON.'); } };
  const parts = parseJson(values.parts, '--parts'), mix = parseJson(values.mix, '--mix'),timbre=parseJson(values.timbre,'--timbre'),tuning=parseJson(values.tuning,'--tuning'),development=parseJson(values.development,'--development');
  const begin = performance.now();
  const score = compose(positionals.join(' '), { seed, soundSeed: values['sound-seed'], phraseSeed: values['phrase-seed'], parts, mix, timbre,tuning,development,vocalStretch:values['vocal-stretch'],vocalFormant:values['vocal-formant'], sauce: values.sauce, lyrics: values.lyrics, hook: values.hook, vocals: values.vocals, voice: values.voice,
    vocalDensity: values['vocal-density'], vocalChops: values['vocal-chops'], vocalEvery: values['vocal-every'], vocalSection: values['vocal-section'],
    vocalPitch: values['vocal-pitch'], vocalNote: values['vocal-note'], vocalRange: values['vocal-range'] });
  const compositionMs = performance.now() - begin;
  if (values['dry-run']) { console.log(JSON.stringify(score, null, 2)); return; }
  const name = output ? output + (extension ? '' : '.' + format)
    : score.config.intent + '-' + score.config.bpm + 'bpm-' + hash(values['sound-seed'] === undefined && values['phrase-seed'] === undefined ? seed : JSON.stringify([seed, score.config.soundSeed, score.config.phraseSeed])).toString(16).padStart(8, '0') + '.' + format;
  const target = resolve(generatedDirectory, name);
  const jsonTarget = target.slice(0, -(format.length + 1)) + '.json';
  const previewTarget = target.slice(0, -(format.length + 1)) + '.preview.' + format;
  const stemNames = [...new Set([...Object.keys(score.drums), 'keys', 'bass', 'lead', 'arp', ...(score.vocals ? ['vocals'] : []), ...score.parts.map((p) => p.name), 'fx'])];
  const stemTargets = Object.fromEntries(stemNames.map((voice) => [voice, target.slice(0, -(format.length + 1)) + '.stem-' + voice + '.' + format]));
  await mkdir(generatedDirectory, { recursive: true });
  await assertAvailable(target, values.force);
  if (values.stems) for (const path of Object.values(stemTargets)) await assertAvailable(path, values.force);
  if (values.json) await assertAvailable(jsonTarget, values.force);
  if (previewSeconds !== null) await assertAvailable(previewTarget, values.force);
  console.error('Style: ' + score.config.intent + ' | ' + score.config.bpm + ' BPM | ' + score.config.rootName + ' ' + score.config.scale);
  console.error('Sound seed: ' + score.config.soundSeed + ' | Phrase seed: ' + score.config.phraseSeed);
  console.error('Seed: ' + seed + ' | Sauce: ' + score.config.sauce + ' | ' + score.config.bars + ' bars in ' + score.config.timeSignature + ' | ' + score.config.duration.toFixed(2) + ' seconds');
  for (const message of score.config.messages) console.error(message);
  const renderStart = performance.now();
  if (score.vocals) console.error('Vocals: ' + score.vocals.voice + ' | ' + score.vocals.events.length + ' events | synthesizing local speech');
  const vocalSamples = await prepareVocalSamples(score);
  if (score.vocals) {
    score.vocals.sampleHashes = vocalSamples.hashes;
    if (vocalSamples.pitch) score.vocals.pitchResult = vocalSamples.pitch;
    if (vocalSamples.runtime) score.vocals.speechRuntime = vocalSamples.runtime;
  }
  const rendered = values.stems ? renderStems(score, { vocalSamples }) : null;
  const audio = rendered?.mix ?? renderAudio(score, { vocalSamples });
  const renderMs = performance.now() - renderStart;
  await writeAudio(target, audio, { format, force: values.force });
  if (rendered) for (const [voice, stem] of Object.entries(rendered.stems)) await writeAudio(stemTargets[voice], stem, { format, force: values.force });
  if (values.json) await writeJson(jsonTarget, score, values.force);
  if (previewSeconds !== null) {
    const preview = sliceAudio(audio, (score.sections.find((s) => s.name === 'drop' || s.name === 'chorus') ?? score.sections[Math.floor(score.sections.length / 2)]).startTime, previewSeconds);
    await writeAudio(previewTarget, preview, { format, force: values.force });
    console.log('Preview: ' + previewTarget);
  }
  console.log('Saved: ' + target);
  if (rendered) console.log('Stems: ' + Object.values(stemTargets).join(', '));
  if (values.json) console.log('Score: ' + jsonTarget);
  console.log('Composition: ' + compositionMs.toFixed(1) + ' ms | Render: ' + renderMs.toFixed(1) + ' ms | Total: ' + (performance.now() - begin).toFixed(1) + ' ms');
}
main().catch((error) => { console.error('makebeats: ' + error.message); process.exitCode = 1; });
