import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const bundle = process.argv[2] ? resolve(process.argv[2]) : join(root, '.cache/build/macos-' + process.arch, 'Looper.app');
const executable = join(bundle, 'Contents/MacOS/Electron');
const app = join(bundle, 'Contents/Resources/app');
await mkdir(join(root, '.cache/tmp'), { recursive: true });
const temporary = await mkdtemp(join(root, '.cache/tmp/verify-package-'));
try {
  const packageJson = JSON.parse(await readFile(join(app, 'package.json'), 'utf8'));
  const sourcePackage = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  assert.equal(packageJson.version, sourcePackage.version);
  assert.equal(packageJson.devDependencies, undefined);
  const startupScript = `import assert from 'node:assert/strict';
    import { checkStartup } from ${JSON.stringify(new URL('./check-startup.js', import.meta.url).href)};
    const result = await checkStartup(${JSON.stringify(join(app, 'desktop/main.js'))});
    assert.deepEqual(result.profileWrites, []);
    assert.equal(result.folderPrompts, 1);
    assert.equal(result.outputDirectory, '/chosen/beats/generated_beats');
    assert.equal(result.loadedURL, 'beat://app/index.html');
    console.log('Read-only App Translocation startup regression check passed.');`;
  const startup = spawnSync(process.execPath, ['--experimental-vm-modules', '--input-type=module', '-e', startupScript], { encoding: 'utf8', timeout: 10000 });
  if (startup.error) throw startup.error;
  assert.equal(startup.status, 0, startup.stderr || startup.stdout);
  console.log(startup.stdout.trim());
  const script = `
    import assert from 'node:assert/strict';
    import { readFile } from 'node:fs/promises';
    import { Worker } from 'node:worker_threads';
    import { pathToFileURL } from 'node:url';
    import { join } from 'node:path';
    const base = process.env.BEATS_VERIFY_APP;
    const backend = await import(pathToFileURL(join(base, 'desktop/backend.js')));
    assert.equal(backend.outputDirectory, process.env.LOCAL_BEATS_OUTPUT_DIR);
    async function runWorker(action, request) {
      const worker = new Worker(pathToFileURL(join(base, 'desktop/worker.js')), {execArgv: [], workerData: {action, request}});
      let result, failure;
      worker.on('message', message => { if (message.result) result=message.result; if (message.error) failure=message.error; });
      await new Promise((resolve,reject) => { worker.on('error',reject); worker.on('exit',code => code ? reject(new Error('Worker exit '+code)) : resolve()); });
      assert.equal(failure, undefined);
      assert.ok(result);
      return result;
    }
    const result = await runWorker('generate', {prompt: 'deep house in F minor 240bpm 8 bars', output: 'package-smoke.wav', options: {seed: 'package-smoke'}});
    assert.equal(result.summary.intent, 'deep_house');
    const wav = await readFile(await backend.resolveAudio(result.filename));
    assert.equal(wav.toString('ascii',0,4), 'RIFF');
    assert.equal(wav.length, 44 + 8 * 44100 * 4);
    assert.ok(result.stats.rms > 0);
    assert.equal((await backend.listAudio()).length, 1);
    const source = result.filename;
    const {revision} = await runWorker('inspect-score', {source});
    const variations = [{track:'voice:bass', mode:'sauce', seed:'package-variation'}];
    const {wav:audition} = await runWorker('audition', {source, revision, solo:'voice:bass', variations});
    assert.equal(Buffer.from(audition).toString('ascii',0,4), 'RIFF');
    assert.equal(audition.length, wav.length);
    assert.notDeepEqual(Buffer.from(audition), wav);
    const edited = await runWorker('render-edit', {source, revision, variations});
    const saved = JSON.parse(await readFile(join(backend.outputDirectory, edited.files[1]), 'utf8'));
    assert.deepEqual(saved.partVariation.changes, variations);
    const {wav:plainBass} = await runWorker('audition', {source, revision, solo:'voice:bass'});
    const {wav:staticBass} = await runWorker('audition', {source, revision, solo:'voice:bass',
      interpretPrompt:true, variations:[{track:'voice:bass', mode:'prompt', prompt:'Add radio static'}]});
    assert.equal(staticBass.length, plainBass.length);
    assert.notDeepEqual(staticBass, plainBass);
    console.log(JSON.stringify({electron:process.versions.electron,node:process.versions.node,frames:(wav.length-44)/4,worker:'passed',export:'passed',audition:'passed',variation:'passed'}));
  `;
  const result = spawnSync(executable, ['--input-type=module', '-e', script], {
    cwd: app, encoding: 'utf8', timeout: 60000,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', BEATS_VERIFY_APP: app, LOCAL_BEATS_OUTPUT_DIR: temporary, TMPDIR: temporary },
  });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, result.stderr || result.stdout);
  console.log(result.stdout.trim());
  const signed = spawnSync('codesign', ['--verify', '--deep', '--strict', bundle], { encoding: 'utf8' });
  assert.equal(signed.status, 0, signed.stderr);
  console.log('Packaged runtime, WAV export, part audition, edited copy, and bundle signature verified headlessly.');
} finally { await rm(temporary, { recursive: true, force: true }); }
