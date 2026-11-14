import { app, BrowserWindow, dialog, ipcMain, Menu, net, protocol, session, shell } from 'electron';
import { Worker } from 'node:worker_threads';
import { mkdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chooseOutputDirectory } from './preferences.js';

protocol.registerSchemesAsPrivileged([{ scheme: 'beat', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }]);
app.setName('Looper');
// isPackaged checks the executable name, which remains Electron in this bundle.
// defaultApp identifies an explicit `electron .` development launch instead.
const isDevelopment = process.defaultApp === true;
if (isDevelopment) {
  const profile = process.env.LOOPER_PROFILE_DIR ?? fileURLToPath(new URL('../.cache/desktop-profile/', import.meta.url));
  mkdirSync(profile, { recursive: true });
  app.setPath('userData', profile);
  app.setPath('sessionData', profile);
}
let window, activeJob;
let listAudio, resolveAudio, outputDirectory;
const uiURL = 'beat://app/index.html';
const assets = new Map(['index.html', 'styles.css', 'renderer.js'].map((name) => ['/' + name, new URL(name, import.meta.url)]));

function trusted(event) {
  if (event.sender !== window?.webContents || event.senderFrame !== window.webContents.mainFrame || event.senderFrame.url !== uiURL) throw new Error('Untrusted application request.');
}

function job(action, request) {
  if (activeJob) throw new Error('A generation job is already running.');
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./worker.js', import.meta.url), { workerData: { action, request } });
    activeJob = worker;
    let completed = false;
    worker.on('message', (message) => {
      if (message.stage && !window?.isDestroyed()) window?.webContents.send('beats:stage', message.stage);
      if (message.result || message.error) {
        completed = true;
        activeJob = null;
        if (message.error) reject(new Error(message.error)); else resolve(message.result);
      }
    });
    worker.on('error', (error) => { if (activeJob === worker) activeJob = null; reject(error); });
    worker.on('exit', (code) => {
      if (activeJob === worker) activeJob = null;
      if (!completed) reject(new Error('The render worker stopped before finishing (exit ' + code + ').'));
    });
  });
}

function createWindow() {
  window = new BrowserWindow({ width: 1240, height: 860, minWidth: 880, minHeight: 650,
    title: 'Looper', backgroundColor: '#101411',
    webPreferences: { preload: fileURLToPath(new URL('./preload.cjs', import.meta.url)), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true } });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  window.on('close', (event) => {
    if (activeJob) { event.preventDefault(); dialog.showMessageBoxSync(window, { type: 'info', message: 'Looper is still working.', detail: 'Wait for the current job to finish before closing the app.' }); }
  });
  window.loadURL(uiURL);
}

async function start() {
  await app.whenReady();
  if (!isDevelopment) {
    const chosen = await chooseOutputDirectory(app.getPath('userData'), async () => {
      const result = await dialog.showOpenDialog({ title: 'Choose a home for your beats',
        message: 'A generated_beats folder will be created here. Your choice is remembered for future launches.',
        buttonLabel: 'Use this folder', properties: ['openDirectory', 'createDirectory'] });
      return result.canceled ? null : result.filePaths[0];
    });
    if (!chosen) { app.quit(); return; }
    process.env.LOCAL_BEATS_OUTPUT_DIR = chosen;
  }
  ({ listAudio, resolveAudio, outputDirectory } = await import('./backend.js'));
  // Finder-launched apps may omit Homebrew from PATH; reuse the existing FFmpeg.
  if (process.platform === 'darwin') process.env.PATH = [...new Set([...(process.env.PATH ?? '').split(':'), '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin'])].join(':');
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => callback({ cancel: /^(?:https?|wss?|ftp):/i.test(details.url) }));
  protocol.handle('beat', async (request) => {
    try {
      const url = new URL(request.url);
      if (url.hostname === 'app' && assets.has(url.pathname)) return net.fetch(pathToFileURL(fileURLToPath(assets.get(url.pathname))).href);
      if (url.hostname === 'audio') {
        const path = await resolveAudio(decodeURIComponent(url.pathname.slice(1)));
        return net.fetch(pathToFileURL(path).href, { headers: request.headers });
      }
      return new Response('Not found', { status: 404 });
    } catch { return new Response('Audio unavailable', { status: 404 }); }
  });
  for (const action of ['preview', 'generate', 'suggest', 'inspect-score', 'render-edit', 'audition']) ipcMain.handle('beats:' + action, (event, request) => { trusted(event); return job(action, request); });
  ipcMain.handle('beats:library', (event) => { trusted(event); return listAudio(); });
  ipcMain.handle('beats:info', (event) => { trusted(event); return { outputDirectory }; });
  ipcMain.handle('beats:reveal', async (event, name) => { trusted(event); shell.showItemInFolder(await resolveAudio(name)); });
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
    { role: 'editMenu' }, { label: 'View', submenu: [{ role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'togglefullscreen' }] }, { role: 'windowMenu' },
  ]));
  app.on('before-quit', (event) => {
    if (activeJob) {
      event.preventDefault();
      dialog.showMessageBoxSync(window, { type: 'info', message: 'Looper is still working.', detail: 'Wait for the current job to finish before quitting.' });
    }
  });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
  createWindow();
}
start().catch((error) => { dialog.showErrorBox('Looper could not start', error.message); app.quit(); });
