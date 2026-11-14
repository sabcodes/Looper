import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const checker = new URL('../desktop/check-startup.js', import.meta.url).href;
const entry = fileURLToPath(new URL('../desktop/main.js', import.meta.url));
function run(options) {
  const script = `import { checkStartup } from ${JSON.stringify(checker)}; console.log(JSON.stringify(await checkStartup(${JSON.stringify(entry)}, ${JSON.stringify(options)})));`;
  const child = spawnSync(process.execPath, ['--experimental-vm-modules', '--input-type=module', '-e', script], { encoding: 'utf8', timeout: 10000 });
  assert.equal(child.status, 0, child.stderr);
  return JSON.parse(child.stdout.trim());
}

test('received app starts from read-only App Translocation without writing inside its bundle', () => {
  const result = run({ readOnly: true });
  assert.deepEqual(result.profileWrites, []);
  assert.equal(result.folderPrompts, 1);
  assert.equal(result.outputDirectory, '/chosen/beats/generated_beats');
  assert.equal(result.loadedURL, 'beat://app/index.html');
});

test('a writable standalone copy still uses the chosen output folder instead of development paths', () => {
  const result = run({ readOnly: false });
  assert.deepEqual(result.profileWrites, []);
  assert.equal(result.folderPrompts, 1);
});

test('electron . development launch keeps the profile inside the project', () => {
  const result = run({ development: true, readOnly: false });
  assert.equal(result.profileWrites.length, 1);
  assert.ok(result.configuredPaths.userData.endsWith('/.cache/desktop-profile/'));
  assert.equal(result.folderPrompts, 0);
  assert.equal(result.loadedURL, 'beat://app/index.html');
});
