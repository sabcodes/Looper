import { open, link, rename, unlink } from 'node:fs/promises';
import { dirname, basename, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { packWav } from './dsp.js';

async function atomicFile(target, force, writer) {
  const temporary = join(dirname(target), '.' + basename(target) + '.' + randomBytes(6).toString('hex') + '.tmp');
  let file;
  try {
    file = await open(temporary, 'wx', 0o644);
    await writer(file);
    await file.close(); file = null;
    if (force) await rename(temporary, target);
    else {
      // Exclusive hard-link creation closes the preflight check/overwrite race.
      await link(temporary, target);
      await unlink(temporary);
    }
  } catch (error) {
    if (error.code === 'EEXIST') throw new Error('Output exists: ' + target + '. Use --force to replace it.');
    throw error;
  } finally {
    if (file) await file.close().catch(() => {});
    await unlink(temporary).catch((error) => { if (error.code !== 'ENOENT') throw error; });
  }
}

export async function writeJson(target, value, force = false) {
  await atomicFile(target, force, (file) => file.writeFile(JSON.stringify(value, null, 2) + '\n'));
}

export async function writeAudio(target, audio, { format = 'mp3', force = false } = {}) {
  if (!['wav', 'mp3', 'flac'].includes(format)) throw new Error('Format must be mp3, wav or flac.');
  await atomicFile(target, force, async (file) => {
    if (format === 'wav') { await file.writeFile(packWav(audio)); return; }
    const args = ['-hide_banner', '-loglevel', 'error', '-f', 's16le', '-ar', String(audio.sampleRate),
      '-ac', String(audio.channels), '-i', 'pipe:0', '-map_metadata', '-1', '-fflags', '+bitexact'];
    if (format === 'mp3') args.push('-c:a', 'libmp3lame', '-b:a', '192k', '-id3v2_version', '0', '-write_xing', '0', '-f', 'mp3', 'pipe:1');
    else args.push('-c:a', 'flac', '-compression_level', '5', '-f', 'flac', 'pipe:1');
    await new Promise((resolve, reject) => {
      const child = spawn('ffmpeg', args, { stdio: ['pipe', file.fd, 'pipe'] });
      let stderr = '';
      child.stderr.on('data', (chunk) => { if (stderr.length < 8192) stderr += chunk.toString(); });
      child.on('error', (error) => reject(error.code === 'ENOENT'
        ? new Error('FFmpeg is required for MP3/FLAC. Use --format wav for dependency-free output.') : error));
      child.on('close', (code) => code === 0 ? resolve() : reject(new Error('FFmpeg failed (' + code + '): ' + stderr.trim())));
      // FFmpeg can close its input on an encoding failure; report its diagnostics.
      child.stdin.on('error', () => {});
      child.stdin.end(audio.pcm);
    });
  });
}
