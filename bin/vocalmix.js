#!/usr/bin/env node
// CLI-only experiment. Model inference remains outside the generation engine.
import { parseArgs } from 'node:util';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { lstat, mkdir, rm } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderAudio } from '../src/index.js';
import { writeAudio, writeJson } from '../src/export.js';
import { mixExternalVocal } from '../scripts/lib/vocal-remix.js';
import { alignBacking, planVocalMix, VOCAL_MIX_DEFAULTS } from '../scripts/lib/vocal-mixing.js';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
async function main() {
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length - 1; i++) {
    if (/^--(?:offset|seconds|grid-offset|vocal-db|music-rms|bpm)$/.test(args[i]) && /^-\d/.test(args[i + 1])) {
      args.splice(i, 2, args[i] + '=' + args[i + 1]);
    }
  }
  const { values, positionals } = parseArgs({ args, allowPositionals: true, options: {
    help: { type: 'boolean', short: 'h' }, plan: { type: 'boolean' },
    prompt: { type: 'string' }, seed: { type: 'string', default: '0' },
    bpm: { type: 'string' }, key: { type: 'string' }, 'grid-offset': { type: 'string' },
    offset: { type: 'string', default: '0' }, seconds: { type: 'string', default: '24' },
    'vocal-db': { type: 'string', default: String(VOCAL_MIX_DEFAULTS.vocalDb) },
    'music-rms': { type: 'string', default: String(VOCAL_MIX_DEFAULTS.musicRms) },
    output: { type: 'string', short: 'o' }, python: { type: 'string' }, 'stem-project': { type: 'string' },
    'semantic-python': { type: 'string' }, 'model-dir': { type: 'string' }, 'no-semantics': { type: 'boolean' },
  } });
  if (values.help) {
    console.log(`Usage: npm run vocalmix -- VOCAL.mp3 [options]
Assumes the input is already a vocal stem. Generates a short backing + vocal MP3.
  --offset SECONDS       Source excerpt start (default 0)
  --seconds 4..60        Preview duration (default 24)
  --prompt TEXT          Backing direction; otherwise suggested from embeddings
  --seed VALUE           Backing seed (default 0)
  --bpm NUMBER           Override uncertain vocal-only tempo (40..240)
  --key "C minor"        Override uncertain major/minor key
  --grid-offset SECONDS  Backing beat phase inside excerpt (0 <= value < one beat)
  --vocal-db -24..0      Vocal level (default ${VOCAL_MIX_DEFAULTS.vocalDb})
  --music-rms 0.01..0.2  Backing level before safety gain (default ${VOCAL_MIX_DEFAULTS.musicRms})
  --output NAME          New folder under generated_beats/vocal-mixing/
  --plan                 Print paths/bounds without inference or writing
  --no-semantics         Explicitly skip EmbeddingGemma comparisons
  --python PATH --stem-project PATH --semantic-python PATH --model-dir PATH
Uses existing runtimes/checkpoints in place. No installations or model downloads.
EmbeddingGemma compares delivery/themes; it does not transcribe lyrics.
Existing outputs are protected. The main desktop interface is unchanged.`);
    return;
  }
  if (positionals.length !== 1) throw new Error('Supply one existing vocal stem; use --help.');
  const input = resolve(positionals[0]);
  if (!(await lstat(input)).isFile()) throw new Error('Input must be a regular audio file.');
  const offset = Number(values.offset), seconds = Number(values.seconds);
  const vocalDb = Number(values['vocal-db']), musicRms = Number(values['music-rms']);
  if (!Number.isFinite(offset) || offset < 0 || !Number.isFinite(seconds) || seconds < 4 || seconds > 60) throw new Error('Use a finite nonnegative --offset and --seconds between 4 and 60.');
  if (!Number.isFinite(vocalDb) || vocalDb < -24 || vocalDb > 0 || !Number.isFinite(musicRms) || musicRms < .01 || musicRms > .2) throw new Error('Use --vocal-db -24..0 and --music-rms 0.01..0.2.');
  if (values.bpm !== undefined && (!Number.isFinite(Number(values.bpm)) || Number(values.bpm) < 40 || Number(values.bpm) > 240)) throw new Error('Use --bpm 40..240.');
  if (values.key !== undefined && !/^[A-G](?:#|b)? (major|minor)$/i.test(values.key)) throw new Error('Use --key "C minor" (major/minor).');
  if (values['grid-offset'] !== undefined && (!Number.isFinite(Number(values['grid-offset'])) || Number(values['grid-offset']) < 0)) throw new Error('Use a finite nonnegative --grid-offset.');
  const name = values.output ?? basename(input).replace(/\.[^.]+$/, '').replace(/[^a-z0-9]+/gi, '-').slice(0, 90) + '-s' + values.seed.replace(/[^a-z0-9-]/gi, '').slice(0, 20);
  if (!name || name === '.' || name === '..' || name !== basename(name) || !/^[a-z0-9][a-z0-9._-]{0,119}$/i.test(name)) throw new Error('--output must be a simple folder name inside generated_beats/vocal-mixing/.');
  const output = join(root, 'generated_beats/vocal-mixing', name);
  if (existsSync(output)) throw new Error('Output folder exists; choose another --output.');
  const python = resolve(values.python ?? join(root, '.venv/bin/python'));
  if (!values['stem-project']) throw new Error('Supply --stem-project PATH to a trusted local project exposing cli.py:analyze().');
  const stemProject = resolve(values['stem-project']);
  const semanticPython = resolve(values['semantic-python'] ?? python);
  const modelDir = resolve(values['model-dir'] ?? join(root, 'models/embeddinggemma-2'));
  for (const path of [python, join(stemProject, 'cli.py'), ...(values['no-semantics'] ? [] : [semanticPython, join(modelDir, 'model.safetensors')])]) {
    if (!existsSync(path)) throw new Error('Required existing runtime/checkpoint missing: ' + path + '. Supply an override; downloads are disabled.');
  }
  const budget = 5_000_000;
  if (values.plan) {
    console.log(JSON.stringify({ input, output, offset_seconds: offset, seconds, python, stem_project: stemProject,
      semantic_python: values['no-semantics'] ? null : semanticPython, model_directory: values['no-semantics'] ? null : modelDir,
      maximum_run_bytes: budget, decoded_audio: 'memory only', downloads: 0 }, null, 2));
    return;
  }
  const cache = join(root, 'generated_beats/.analysis-cache');
  await mkdir(cache, { recursive: true });
  const env = { ...process.env, PYTHONDONTWRITEBYTECODE: '1', HF_HUB_OFFLINE: '1', TRANSFORMERS_OFFLINE: '1',
    HF_HUB_DISABLE_TELEMETRY: '1', TORCH_DEVICE_BACKEND_AUTOLOAD: '0', TOKENIZERS_PARALLELISM: 'false',
    NUMBA_CACHE_DIR: join(cache, 'numba'), MPLCONFIGDIR: join(cache, 'matplotlib'), XDG_CACHE_HOME: cache };
  const common = ['--input', input, '--offset', String(offset), '--seconds', String(seconds)];
  const analysis = JSON.parse((await run(python, ['-B', join(root, 'scripts/analyze_vocal.py'), ...common, '--stem-project', stemProject], env, 240000)).toString());
  if (!values['no-semantics']) {
    analysis.semantic = JSON.parse((await run(semanticPython, ['-B', join(root, 'scripts/embed_vocal.py'),
      '--input', input, '--offset', String(offset), '--seconds', String(analysis.excerpt.duration_seconds), '--model-dir', modelDir], env, 600000)).toString());
  } else analysis.semantic = { skipped: true, reason: '--no-semantics' };
  const plan = planVocalMix(analysis, { bpm: values.bpm, key: values.key, prompt: values.prompt, seed: values.seed, gridOffset: values['grid-offset'] });
  console.error(`Rendering ${plan.direction} at ${plan.bpm} BPM, ${plan.key}...`);
  const vocal = await run('ffmpeg', ['-nostdin', '-v', 'error', '-threads', '1', '-protocol_whitelist', 'file,pipe',
    '-ss', String(offset), '-i', input, '-t', String(analysis.excerpt.duration_seconds), '-map', '0:a:0',
    '-ac', '2', '-ar', '44100', '-f', 's16le', 'pipe:1'], env, 90000);
  if (vocal.length % 4 || vocal.length < 4 * 44100 * 4) throw new Error('Invalid decoded vocal excerpt.');
  const music = alignBacking(renderAudio(plan.score), vocal.length / 4, plan.grid_offset_seconds);
  const mixed = mixExternalVocal(music, vocal, { vocalDb, musicRms });
  const { score, ...decision } = plan;
  const report = { ...analysis, experiment: 'CLI vocal mixing v1', backing: decision, mix: mixed.mix,
    mix_stats: mixed.stats, semantic_status: values['no-semantics'] ? 'skipped' : 'experimental comparisons completed',
    human_review: { timing: null, harmonic_fit: null, balance: null, direction: null },
    storage_budget_bytes: budget, downloads: 0 };
  const reportBytes = Buffer.byteLength(JSON.stringify(report)) + Buffer.byteLength(JSON.stringify(score));
  if (reportBytes + seconds * 24000 + 100000 > budget) throw new Error('Run exceeds the 5 MB output budget; shorten --seconds.');
  await mkdir(dirname(output), { recursive: true });
  await mkdir(output);
  try {
    await writeAudio(join(output, 'mix.mp3'), mixed);
    await writeJson(join(output, 'backing.score.json'), score);
    const files = ['mix.mp3', 'backing.score.json'];
    report.retained_bytes_before_report = (await Promise.all(files.map(async name => (await lstat(join(output, name))).size))).reduce((a, b) => a + b, 0);
    if (report.retained_bytes_before_report + Buffer.byteLength(JSON.stringify(report, null, 2)) > budget) throw new Error('Output exceeded the 5 MB budget.');
    await writeJson(join(output, 'analysis.json'), report);
  } catch (error) {
    await rm(output, { recursive: true, force: true });
    throw error;
  }
  console.log('Mix: ' + join(output, 'mix.mp3'));
  console.log('Analysis: ' + join(output, 'analysis.json'));
  console.log(`Used ${plan.bpm} BPM | ${plan.key} | beat offset ${plan.grid_offset_seconds.toFixed(3)} s (estimates; listen to verify)`);
}

function run(command, args, env, timeout) {
  return new Promise((accept, reject) => {
    const child = spawn(command, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks = []; let size = 0, stderr = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('Local processing timed out.')); }, timeout);
    child.stdout.on('data', chunk => {
      size += chunk.length;
      if (size > 60_000_000) { child.kill('SIGKILL'); reject(new Error('Worker exceeded its output bound.')); }
      else chunks.push(chunk);
    });
    child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-8000); process.stderr.write(chunk); });
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => { clearTimeout(timer); code === 0 ? accept(Buffer.concat(chunks)) : reject(new Error('Local worker failed: ' + stderr.slice(-2000))); });
  });
}
main().catch(error => { console.error('vocalmix: ' + error.message); process.exitCode = 1; });
