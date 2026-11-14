// Generate and evaluate a fixed prompt set; retain all evidence in generated_beats/.
import { readFile, readdir, mkdir, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { parseArgs } from 'node:util';
import { analyzeScore } from '../src/score-analysis.js';
import { compilePrompt } from '../src/parser.js';
import { writeJson } from '../src/export.js';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const output = join(root, 'generated_beats');
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'));
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const quote = (text) => "'" + String(text).replaceAll("'", "'\\''") + "'";

async function run(executable, args) {
  return new Promise((accept, reject) => {
    const process = spawn(executable, args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    process.stdout.on('data', (bytes) => { stdout += bytes; });
    process.stderr.on('data', (bytes) => { stderr += bytes; });
    process.on('error', reject);
    process.on('close', (code) => code === 0 ? accept({ stdout, stderr })
      : reject(new Error(executable + ' exited ' + code + ': ' + stderr + stdout)));
  });
}

async function main() {
  const { values } = parseArgs({ options: { fixture: { type: 'string', default: 'data/generation-evaluation-prompts.json' } } });
  const fixturePath = resolve(root, values.fixture);
  await mkdir(output, { recursive: true });
  const existing = await readdir(output);
  let number = 1;
  while (existing.some((name) => name.startsWith('eval-' + String(number).padStart(3, '0') + '.manifest.'))) number++;
  const batch = 'eval-' + String(number).padStart(3, '0');
  const fixture = await readJson(fixturePath);
  const descriptions = await readJson(join(root, 'data/analysis-descriptions.json'));
  const engineFiles = ['package.json', 'bin/makebeats.js', 'bin/analyzebeats.js', 'scripts/analyze_audio.py',
    'scripts/generate-evaluation-batch.js', 'data/genre-rules.json', 'data/intent-corpus.json',
    'data/analysis-descriptions.json', values.fixture,
    ...(await readdir(join(root, 'src'))).filter((name) => name.endsWith('.js')).map((name) => 'src/' + name)];
  const hashes = [];
  for (const path of engineFiles.sort()) hashes.push({ path, sha256: sha256(await readFile(join(root, path))) });
  const ffmpeg = (await run('ffmpeg', ['-version'])).stdout.split('\n')[0];
  const manifest = {
    batch, status: 'planned', createdAt: new Date().toISOString(), fixtureVersion: fixture.version,
    purpose: fixture.purpose, engineVersion: (await readJson(join(root, 'package.json'))).version,
    nodeVersion: process.version, ffmpeg, files: hashes, evaluationDescriptions: descriptions,
    format: { container: 'mp3', bitRate: 192000, sampleRate: 44100, channels: 2 },
    caveat: 'File verification and completed analysis do not establish musical quality. Cosines, BPM and key are estimates. Human review remains unfilled.',
    cases: fixture.cases.map((c, i) => {
      const prefix = batch + '-' + String(i + 1).padStart(2, '0') + '-' + c.id;
      const args = ['bin/makebeats.js', c.prompt, '--seed', c.seed, '--sauce', String(c.sauce), '--output', prefix + '.mp3', '--json'];
      if (fixture.previewSeconds) args.push('--preview', String(fixture.previewSeconds));
      const analysisArgs = ['bin/analyzebeats.js', join('generated_beats', prefix + '.mp3'), '--semantic', '--output', prefix + '.analysis.json'];
      const config = compilePrompt(c.prompt, { seed: c.seed, sauce: c.sauce });
      assert(config.intent === c.expectedIntent, 'Unexpected parser intent for ' + c.id);
      return { ...c, status: 'planned', audio: prefix + '.mp3', preview: fixture.previewSeconds ? prefix + '.preview.mp3' : null, previewStartSeconds: 20 * config.beatsPerBar * 60 / config.bpm, previewSeconds: fixture.previewSeconds ?? null, score: prefix + '.json', analysis: prefix + '.analysis.json',
        expectedBpm: config.bpm, expectedKey: config.rootName + ' ' + config.scale, expectedDuration: config.duration,
        generationArgv: [process.execPath, ...args], generationCommand: 'node ' + args.map(quote).join(' '),
        analysisArgv: [process.execPath, ...analysisArgs], analysisCommand: 'node ' + analysisArgs.map(quote).join(' '),
        humanReview: { genreMatch: null, promptMatch: null, soundQuality: null, notes: null } };
    }),
  };
  const manifestPath = join(output, batch + '.manifest.json');
  await writeJson(manifestPath, manifest);
  await writeJson(join(output, batch + '.prompts.json'), fixture);
  const persist = () => writeJson(manifestPath, manifest, true);
  let totalBytes = 0;
  for (let i = 0; i < manifest.cases.length; i++) {
    const c = manifest.cases[i];
    try {
      console.log('[' + (i + 1) + '/' + manifest.cases.length + '] Rendering ' + c.label + '...');
      c.generationLog = await run(c.generationArgv[0], c.generationArgv.slice(1));
      const path = join(output, c.audio);
      const probe = JSON.parse((await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration,size:stream=codec_name,sample_rate,channels,bit_rate', '-of', 'json', path])).stdout);
      const stream = probe.streams[0];
      assert(stream.codec_name === 'mp3' && Number(stream.sample_rate) === 44100 && stream.channels === 2 && Number(stream.bit_rate) === 192000, 'Invalid encoded format: ' + c.audio);
      assert(Math.abs(Number(probe.format.duration) - c.expectedDuration) < .12, 'Unexpected audio duration: ' + c.audio);
      await run('ffmpeg', ['-v', 'error', '-threads', '1', '-i', path, '-f', 'null', '-']);
      const score = await readJson(join(output, c.score));
      assert(score.config.prompt === c.prompt && score.config.seed === c.seed && score.config.sauce === c.sauce
        && score.config.intent === c.expectedIntent && score.config.bars === 32, 'Score/configuration mismatch: ' + c.id);
      c.structure = analyzeScore(score);
      const e = c.expectations ?? {};
      c.propertyChecks = {
        ...(e.noPiano ? { noPiano: c.structure.pianoVoiceCount === 0 } : {}),
        ...(e.minLeadPitches ? { leadPitchVariety: c.structure.leadUniquePitches >= e.minLeadPitches } : {}),
        ...(e.minLeadRhythms ? { leadRhythmicVariety: c.structure.leadRhythmicPatterns >= e.minLeadRhythms } : {}),
        ...(e.minArpNotes ? { arpeggiosPresent: c.structure.arpeggioNoteCount >= e.minArpNotes } : {}),
        ...(e.minBassGateCoverage ? { continuousBassGates: c.structure.bassGateCoverage >= e.minBassGateCoverage } : {}),
        ...(e.minBassMedianBeats ? { heldBassDuration: c.structure.bassMedianDurationBeats >= e.minBassMedianBeats } : {}),
        ...(e.minBassPhrasePatterns ? { bassPhraseVariety: c.structure.bassPhrasePatterns >= e.minBassPhrasePatterns } : {}),
        ...(e.minBassLongestBeats ? { longBassPhrases: c.structure.bassLongestDurationBeats >= e.minBassLongestBeats } : {}),
      };
      assert(Object.values(c.propertyChecks).every(Boolean), 'Requested score properties failed: ' + c.id);
      if (c.preview) {
        c.previewSha256 = sha256(await readFile(join(output, c.preview)));
        const p = JSON.parse((await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'json', join(output, c.preview)])).stdout);
        assert(Math.abs(Number(p.format.duration) - c.previewSeconds) < .12, 'Unexpected preview duration');
      }
      c.audioSha256 = sha256(await readFile(path));
      c.scoreSha256 = sha256(await readFile(join(output, c.score)));
      c.encodedDuration = Number(probe.format.duration);
      c.audioBytes = (await stat(path)).size;
      c.status = 'rendered';
      await persist();
      console.log('[' + (i + 1) + '/' + manifest.cases.length + '] Analyzing ' + c.label + ' with librosa and cached CLAP...');
      c.analysisLog = await run(c.analysisArgv[0], c.analysisArgv.slice(1));
      const analysis = await readJson(join(output, c.analysis));
      assert(analysis.source_sha256 === c.audioSha256, 'Analysis/audio identity mismatch: ' + c.id);
      assert(analysis.expected.prompt === c.prompt && analysis.expected.seed === c.seed, 'Analysis prompt identity mismatch: ' + c.id);
      c.analysisSummary = {
        estimatedBpm: analysis.tempo_and_key_estimates.bpm, estimatedKey: analysis.tempo_and_key_estimates.key,
        tempoComparison: analysis.tempo_comparison, keyMargin: analysis.key_margin,
        loudness: analysis.loudness, semanticTop: analysis.semantic.genre_ranking[0],
        requestedIntentRank: analysis.semantic.requested_intent_rank, genreCount: analysis.semantic.genre_ranking.length, soundContrasts: analysis.semantic.sound_contrasts, elapsedSeconds: analysis.elapsed_seconds,
      };
      c.analysisSha256 = sha256(await readFile(join(output, c.analysis)));
      c.status = 'analyzed';
      for (const name of [c.audio, c.score, c.analysis, ...(c.preview ? [c.preview] : [])]) totalBytes += (await stat(join(output, name))).size;
      if (totalBytes >= 24 * 1024 * 1024) throw Object.assign(new Error('Batch reached its 24 MiB output limit.'), { storageLimit: true });
      console.log('[' + (i + 1) + '/' + manifest.cases.length + '] Saved ' + c.audio + ' | requested style rank ' + c.analysisSummary.requestedIntentRank + '/' + c.analysisSummary.genreCount);
    } catch (error) {
      c.error = error.message;
      c.status = 'failed';
      if (error.storageLimit) { await persist(); throw error; }
      console.error('[' + (i + 1) + '/' + manifest.cases.length + '] Failed: ' + error.message);
    }
    await persist();
  }
  assert(new Set(manifest.cases.filter((c) => c.audioSha256).map((c) => c.audioSha256)).size
    === manifest.cases.filter((c) => c.audioSha256).length, 'Generated audio files are not distinct.');
  for (const file of hashes) assert(sha256(await readFile(join(root, file.path))) === file.sha256, 'Source changed during evaluation: ' + file.path);
  manifest.status = manifest.cases.every((c) => c.status === 'analyzed') ? 'complete' : 'incomplete';
  manifest.completedAt = new Date().toISOString();
  manifest.retainedCaseBytes = totalBytes;
  await persist();
  const lines = ['# ' + batch + ' — listening and sound-evaluation set', '',
    'All files are 32-bar stereo MP3s. Exact prompts, seeds and parameters were frozen before analysis.',
    'Model/algorithm estimates are diagnostic; no human ratings have been assigned.', '',
    'Manifest: [' + batch + '.manifest.json](<' + manifestPath + '>)', '',
    'Engine: ' + manifest.engineVersion + ' | Node: ' + manifest.nodeVersion, ''];
  for (let i = 0; i < manifest.cases.length; i++) {
    const c = manifest.cases[i];
    lines.push('## ' + (i + 1) + '. ' + c.label, '',
      '[' + c.audio + '](<' + join(output, c.audio) + '>)', '',
      '> ' + c.prompt, '',
      'Seed: ' + c.seed + ' | Sauce: ' + c.sauce + ' | ' + c.expectedBpm + ' BPM | ' + c.expectedKey + ' | ' + c.expectedDuration.toFixed(2) + ' seconds', '',
      'Generation command:', '', '```sh', c.generationCommand, '```', '',
      '[Score](<' + join(output, c.score) + '>) · [Analysis](<' + join(output, c.analysis) + '>)', '');
    if (c.preview) lines.push('[Play ' + c.previewSeconds + '-second preview](<' + join(output, c.preview) + '>)', '');
    lines.push('Requested score-property checks: ' + JSON.stringify(c.propertyChecks), '');
    if (c.analysisSummary) lines.push('Estimated tempo/key: ' + c.analysisSummary.estimatedBpm + ' BPM / ' + c.analysisSummary.estimatedKey
      + '. CLAP requested-style rank: ' + c.analysisSummary.requestedIntentRank + '/' + c.analysisSummary.genreCount + '; top comparison: ' + c.analysisSummary.semanticTop.intent + '.', '');
    if (c.error) lines.push('Error: ' + c.error, '');
    lines.push('Listening feedback: genre match ___ | prompt match ___ | sound quality ___ | notes ___', '');
  }
  const md = join(output, batch + '.listening.md');
  // Use the same safe JSON writer for evidence, then an exclusive direct text write.
  const { writeFile } = await import('node:fs/promises');
  await writeFile(md, lines.join('\n') + '\n', { flag: 'wx' });
  console.log('Batch ' + manifest.status + ': ' + manifestPath);
  console.log('Listening sheet: ' + md);
  console.log('Case audio/scores/reports: ' + (totalBytes / 1e6).toFixed(2) + ' MB');
  if (manifest.status !== 'complete') process.exitCode = 1;
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
