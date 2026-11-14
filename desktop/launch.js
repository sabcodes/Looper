import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const env = { ...process.env, electron_config_cache: fileURLToPath(new URL('../.cache/electron/', import.meta.url)),
  TMPDIR: fileURLToPath(new URL('../.cache/tmp/', import.meta.url)) };
mkdirSync(env.TMPDIR, { recursive: true });
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(process.execPath, [fileURLToPath(new URL('../node_modules/electron/cli.js', import.meta.url)), root], {
  cwd: root, stdio: 'inherit', env,
});
child.on('error', (error) => { console.error(error.message); process.exitCode = 1; });
child.on('exit', (code) => { process.exitCode = code ?? 1; });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
