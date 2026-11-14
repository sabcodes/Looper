#!/usr/bin/env node
// Optional development tooling: this file is never loaded by makebeats.
import { parseArgs } from 'node:util';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, lstat, readFile, rename, rm } from 'node:fs/promises';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { writeJson } from '../src/export.js';
import { analyzeScore } from '../src/score-analysis.js';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outputDir = join(root, 'generated_beats');
async function main() {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    help: { type: 'boolean', short: 'h' }, semantic: { type: 'boolean' }, score: { type: 'string' },
    python: { type: 'string' }, 'model-dir': { type: 'string' }, 'stem-project': { type: 'string' },
    deconstruct: { type: 'boolean' }, stems: { type: 'boolean' }, 'checkpoint-dir': { type: 'string' },
    offset: { type: 'string' }, seconds: { type: 'string' }, output: { type: 'string', short: 'o' }, force: { type: 'boolean' },
  } });
  if (values.help) {
    console.log('Usage: node bin/analyzebeats.js AUDIO [--score SCORE.json] [--semantic] [--offset SECONDS] [--seconds 1..10]\n'
      + '       node bin/analyzebeats.js AUDIO --deconstruct [--stems] [--offset SECONDS] [--seconds 1..60]\n'
      + 'Options: --python PATH, --model-dir PATH, --stem-project PATH, --checkpoint-dir PATH, --output REPORT.json, --force\n'
      + 'Reuses existing librosa, CLAP or cached Demucs. No installations or model downloads.\n'
      + 'Reports and small analysis caches stay under generated_beats/.');
    return;
  }
  if (positionals.length !== 1) throw new Error('Supply one existing audio file; use --help for options.');
  const input = resolve(positionals[0]);
  if (!(await lstat(input)).isFile()) throw new Error('Input must be a regular audio file.');
  const adjacentScore = input.slice(0, -extname(input).length) + '.json';
  const score = values.score ? resolve(values.score) : existsSync(adjacentScore) ? adjacentScore : null;
  if (values.deconstruct && values.semantic) throw new Error('Run --deconstruct and --semantic separately.');
  if (!values.deconstruct && (values.stems || values['checkpoint-dir'])) throw new Error('--stems and --checkpoint-dir require --deconstruct.');
  const python = resolve(values.python ?? join(root, '.venv/bin/python'));
  if (!existsSync(python)) throw new Error('No existing analysis runtime found. Supply --python PATH; nothing is installed automatically.');
  const name = values.output ?? basename(input, extname(input)) + (values.deconstruct ? '.deconstruction.json' : '.analysis.json');
  if (!name || name !== basename(name) || /[\\/\0]/.test(name) || !name.endsWith('.json')) throw new Error('--output must be a JSON filename inside generated_beats/.');
  const target = join(outputDir, name);
  if (!values.force && existsSync(target)) throw new Error('Report exists; choose another name or use --force.');
  const stemsTarget = values.stems ? join(outputDir, name.slice(0, -5) + '.stems') : null;
  if (stemsTarget && await lstat(stemsTarget).catch((error) => { if (error.code !== 'ENOENT') throw error; })) {
    throw new Error('Stem directory already exists; choose another report name.');
  }
  const offset = values.offset === undefined ? undefined : Number(values.offset);
  const maxSeconds = values.deconstruct ? 60 : 10;
  const seconds = Number(values.seconds ?? maxSeconds);
  if ((offset !== undefined && (!Number.isFinite(offset) || offset < 0)) || !Number.isFinite(seconds) || seconds < 1 || seconds > maxSeconds) {
    throw new Error('Use a nonnegative finite offset and excerpt length between 1 and ' + maxSeconds + ' seconds.');
  }
  if (!values.deconstruct && !values['stem-project']) throw new Error('Supply --stem-project PATH to a trusted local project exposing cli.py:analyze().');
  await mkdir(outputDir, { recursive: true });
  const cache = join(outputDir, '.analysis-cache');
  await mkdir(cache, { recursive: true });
  const args = ['-B', join(root, 'scripts/analyze_audio.py'), '--input', input, '--seconds', String(seconds)];
  if (values.deconstruct) args.push('--deconstruct', '--checkpoint-dir', resolve(values['checkpoint-dir']
    ?? join(homedir(), '.cache/torch/hub/checkpoints')));
  else {
    args.push('--stem-project', resolve(values['stem-project']));
    if (score) args.push('--score', score);
  }
  if (offset !== undefined) args.push('--offset', String(offset));
  if (values.semantic) args.push('--semantic', '--model-dir', resolve(values['model-dir']
    ?? join(root, 'models/clap')));
  const stage = stemsTarget ? await mkdtemp(join(outputDir, '.stems-')) : null;
  if (stage) args.push('--export-stems', stage);
  console.error('Analyzing locally with the existing runtime' + (values.deconstruct ? ' and cached Demucs model' : values.semantic ? ' and cached CLAP model' : '') + '...');
  let result, published = false;
  try {
    result = await runAnalysis(python, args, cache);
    if (score) result.score_structure = analyzeScore(JSON.parse(await readFile(score, 'utf8')));
    if (stage) {
      await mkdir(stemsTarget);
      published = true;
      await rename(stage, stemsTarget);
      result.stem_directory = basename(stemsTarget);
    }
    await writeJson(target, result, values.force);
  } catch (error) {
    if (published) await rm(stemsTarget, { recursive: true, force: true });
    throw error;
  } finally {
    if (stage) await rm(stage, { recursive: true, force: true });
  }
  console.log('Report: ' + target);
  if (values.deconstruct) {
    console.log('Estimated pulse: ' + (result.beat_grid.bpm === null ? 'undetermined' : result.beat_grid.bpm + ' BPM'));
    if (stemsTarget) console.log('Estimated stems: ' + stemsTarget);
    console.log('Analysis time: ' + result.elapsed_seconds.toFixed(1) + ' s');
    return;
  }
  console.log('Estimated tempo/key: ' + result.tempo_and_key_estimates.bpm + ' BPM | ' + result.tempo_and_key_estimates.key);
  if (result.semantic) console.log('CLAP top comparison: ' + result.semantic.genre_ranking[0].intent
    + ' | requested style rank: ' + result.semantic.requested_intent_rank + ' (diagnostic only)');
  console.log('Analysis time: ' + result.elapsed_seconds.toFixed(1) + ' s | completion RSS: ' + result.rss_mb_at_completion.toFixed(0) + ' MB');
}

function runAnalysis(python, args, cache) {
  return new Promise((accept, reject) => {
    const child = spawn(python, args, { env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1',
      NUMBA_CACHE_DIR: join(cache, 'numba'), MPLCONFIGDIR: join(cache, 'matplotlib'),
      HF_HOME: join(cache, 'huggingface'), TORCH_HOME: join(cache, 'torch'), XDG_CACHE_HOME: cache,
      HF_HUB_OFFLINE: '1', TRANSFORMERS_OFFLINE: '1', HF_HUB_DISABLE_TELEMETRY: '1' },
      stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    const timer = setTimeout(() => { child.kill('SIGTERM'); reject(new Error('Analysis exceeded its three-minute limit.')); }, 180000);
    child.stdout.on('data', (b) => {
      stdout += b;
      if (stdout.length > 4e6) { child.kill('SIGTERM'); reject(new Error('Analysis exceeded the report size limit.')); }
    });
    child.stderr.on('data', (b) => { stderr = (stderr + b).slice(-12000); });
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) { reject(new Error('Analysis failed: ' + stderr.trim())); return; }
      try { accept(JSON.parse(stdout)); } catch { reject(new Error('Analysis did not return valid JSON. ' + stderr)); }
    });
  });
}
main().catch((error) => { console.error('analyzebeats: ' + error.message); process.exitCode = 1; });
