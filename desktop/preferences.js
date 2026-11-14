import { constants } from 'node:fs';
import { access, mkdir, readFile, stat } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { writeJson } from '../src/export.js';

async function writableFolder(path) {
  if (typeof path !== 'string' || !isAbsolute(path)) return false;
  try {
    if (!(await stat(path)).isDirectory()) return false;
    await access(path, constants.W_OK);
    return true;
  }
  catch (error) { if (['ENOENT', 'EACCES', 'ENOTDIR', 'EROFS'].includes(error.code)) return false; throw error; }
}

export async function chooseOutputDirectory(settingsFolder, chooseFolder) {
  const settingsFile = join(settingsFolder, 'settings.json');
  try {
    const settings = JSON.parse(await readFile(settingsFile, 'utf8'));
    if (await writableFolder(settings?.audioFolder)) return join(settings.audioFolder, 'generated_beats');
  } catch (error) { if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error; }
  const folder = await chooseFolder();
  if (!folder) return null;
  if (!await writableFolder(folder)) throw new Error('Choose an available folder where you can save files.');
  await mkdir(settingsFolder, { recursive: true });
  await writeJson(settingsFile, { audioFolder: folder }, true);
  return join(folder, 'generated_beats');
}
