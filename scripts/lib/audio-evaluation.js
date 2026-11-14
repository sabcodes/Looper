import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { writeAudio } from '../../src/export.js';

export const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
export async function nextBatch(directory, prefix) {
  const names = await readdir(directory);
  let index = 1;
  while (names.some((f) => f.startsWith(prefix + '-' + String(index).padStart(3, '0')))) index++;
  return prefix + '-' + String(index).padStart(3, '0');
}
export async function run(executable, args, input) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { stdio: [input ? 'pipe' : 'ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    const timer = setTimeout(() => { child.kill('SIGTERM'); reject(new Error('Audio measurement timed out.')); }, 120000);
    child.stdout.on('data', (b) => { stdout += b; });
    child.stderr.on('data', (b) => { stderr = (stderr + b).slice(-20000); });
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('close', (code) => {
      clearTimeout(timer);
      code === 0 ? resolve({ stdout, stderr }) : reject(new Error(stderr || executable + ' exited ' + code));
    });
    if (input) { child.stdin.on('error', () => {}); child.stdin.end(input); }
  });
}
export async function measure(input) {
  const args = ['-hide_banner', '-nostats', '-nostdin', '-protocol_whitelist', 'file,pipe'];
  if (typeof input !== 'string') args.push('-f', 's16le', '-ar', String(input.sampleRate), '-ac', '2');
  args.push('-i', typeof input === 'string' ? input : 'pipe:0', '-af', 'ebur128=framelog=verbose:peak=true', '-f', 'null', '-');
  const { stderr } = await run('ffmpeg', args, typeof input === 'string' ? undefined : input.pcm);
  const integratedLufs = Number([...stderr.matchAll(/I:\s+(-?[\d.]+) LUFS/g)].at(-1)?.[1]);
  const truePeakDbfs = Number([...stderr.matchAll(/Peak:\s+(-?[\d.]+) dBFS/g)].at(-1)?.[1]);
  assert(Number.isFinite(integratedLufs) && Number.isFinite(truePeakDbfs), 'Missing/invalid loudness measurements.');
  return { integratedLufs, truePeakDbfs };
}
export function attenuate(audio, gainDb) {
  assert(Number.isFinite(gainDb) && gainDb <= 0, 'Matching must only attenuate.');
  const pcm = Buffer.alloc(audio.pcm.length), gain = 10 ** (gainDb / 20);
  for (let at = 0; at < pcm.length; at += 2) pcm.writeInt16LE(Math.round(audio.pcm.readInt16LE(at) * gain), at);
  return { ...audio, pcm };
}
export async function encodePreview(path, audio, { targetLufs = -16, raw = null } = {}) {
  raw ??= await measure(audio);
  let gainDb = Math.min(0, targetLufs - raw.integratedLufs, -2 - raw.truePeakDbfs);
  let encoded;
  for (let round = 0; round < 3; round++) {
    await writeAudio(path, attenuate(audio, gainDb), { format: 'mp3', force: round > 0 });
    encoded = await measure(path);
    const target = Math.min(targetLufs, raw.integratedLufs);
    const error = target - encoded.integratedLufs;
    if (encoded.truePeakDbfs <= -1 && Math.abs(error) <= .25) break;
    // If transient headroom prevents matching loudness, retain the quieter result.
    if (encoded.truePeakDbfs <= -1 && error > 0 && gainDb + error > -2 - raw.truePeakDbfs) break;
    gainDb += Math.min(error, 0 - gainDb, encoded.truePeakDbfs > -1 ? -1.5 - encoded.truePeakDbfs : Infinity);
  }
  assert(encoded.truePeakDbfs <= -1, 'Encoded preview lacks true-peak headroom.');
  const probe = JSON.parse((await run('ffprobe', ['-protocol_whitelist', 'file,pipe', '-v', 'error', '-show_entries', 'format=duration:stream=sample_rate,channels', '-of', 'json', path])).stdout);
  assert(Math.abs(Number(probe.format.duration) - audio.frames / audio.sampleRate) < .12, 'Incorrect preview duration.');
  assert(probe.streams[0].channels === 2 && Number(probe.streams[0].sample_rate) === audio.sampleRate, 'Incorrect audio format.');
  return { raw, gainDb, encoded, probe, pcmSha256: hash(audio.pcm), audioSha256: hash(await readFile(path)) };
}
export async function sourceIdentity(root) {
  const paths = ['package.json', 'data/genre-rules.json', 'data/intent-corpus.json',
    ...(await readdir(new URL('src/', root))).filter((f) => f.endsWith('.js')).map((f) => 'src/' + f)];
  return Promise.all(paths.sort().map(async (path) => ({ path, sha256: hash(await readFile(new URL(path, root))) })));
}
export async function verifySources(root, sources) {
  for (const source of sources) assert.equal(hash(await readFile(new URL(source.path, root))), source.sha256, 'Source changed during batch: ' + source.path);
}
