// Exercise the real entry point with fake Electron APIs and a read-only bundle.
// No Electron process, native window, dialog, or user directory is accessed.
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as vm from 'node:vm';

export async function checkStartup(entry, { development = false, readOnly = true } = {}) {
  const report = { profileWrites: [], configuredPaths: {}, folderPrompts: 0 };
  let finish, fail;
  const ready = new Promise((resolve, reject) => { finish = resolve; fail = reject; });
  const processState = { defaultApp: development ? true : undefined, platform: 'darwin', env: {} };
  const noop = () => {};
  const app = { isPackaged: false, setName: noop, setPath: (name, path) => { report.configuredPaths[name] = path; },
    getPath: () => '/test-user/Application Support/Local Beat Generator', whenReady: async () => {}, on: noop, quit: noop };
  class BrowserWindow {
    static getAllWindows() { return []; }
    constructor() { this.webContents = { setWindowOpenHandler: noop, on: noop }; }
    on() {}
    loadURL(url) { report.loadedURL = url; finish(); }
  }
  const electron = { app, BrowserWindow, protocol: { registerSchemesAsPrivileged: noop, handle: noop },
    dialog: { showOpenDialog: async () => { report.folderPrompts++; return { canceled: false, filePaths: ['/chosen/beats'] }; },
      showErrorBox: (_title, message) => fail(new Error(message)), showMessageBoxSync: noop },
    ipcMain: { handle: noop }, Menu: { setApplicationMenu: noop, buildFromTemplate: noop },
    net: {}, shell: {}, session: { defaultSession: { setPermissionRequestHandler: noop, setPermissionCheckHandler: noop,
      webRequest: { onBeforeRequest: noop } } } };
  const context = vm.createContext({ process: processState, URL, console });
  const modules = new Map();
  function synthetic(name, exports) {
    if (!modules.has(name)) modules.set(name, new vm.SyntheticModule(Object.keys(exports), function () {
      for (const [key, value] of Object.entries(exports)) this.setExport(key, value);
    }, { context, identifier: name }));
    return modules.get(name);
  }
  const stubs = {
    electron, 'node:worker_threads': { Worker: class {} }, 'node:url': { fileURLToPath, pathToFileURL },
    'node:fs': { mkdirSync(path) {
      report.profileWrites.push(path);
      if (readOnly) throw Object.assign(new Error("ENOENT: no such file or directory, mkdir '" + path + "'"), { code: 'ENOENT' });
    } },
    './preferences.js': { chooseOutputDirectory: async (_settings, chooseFolder) => {
      await chooseFolder(); return '/chosen/beats/generated_beats';
    } },
    './backend.js': { listAudio: async () => [], resolveAudio: noop, outputDirectory: '/chosen/beats/generated_beats' },
  };
  const source = await readFile(entry, 'utf8');
  const location = development ? pathToFileURL(entry).href
    : 'file:///test-fixture/AppTranslocation/test/d/Local%20Beat%20Generator.app/Contents/Resources/app/desktop/main.js';
  const module = new vm.SourceTextModule(source, { context, identifier: location,
    initializeImportMeta(meta) { meta.url = location; },
    async importModuleDynamically(specifier) {
      if (!stubs[specifier]) throw new Error('Unexpected startup import: ' + specifier);
      const imported = synthetic(specifier, stubs[specifier]);
      if (imported.status === 'unlinked') await imported.link(() => {});
      await imported.evaluate();
      return imported;
    },
  });
  await module.link((specifier) => {
    if (!stubs[specifier]) throw new Error('Unexpected startup import: ' + specifier);
    return synthetic(specifier, stubs[specifier]);
  });
  await module.evaluate();
  let timer;
  try { await Promise.race([ready, new Promise((_resolve, reject) => { timer = setTimeout(() => reject(new Error('Startup did not load the UI')), 1000); })]); }
  finally { clearTimeout(timer); }
  report.outputDirectory = processState.env.LOCAL_BEATS_OUTPUT_DIR;
  return report;
}
