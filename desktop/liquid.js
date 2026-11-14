import { execFile } from 'node:child_process';
import { access } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const worker = fileURLToPath(new URL('./suggest-direction.py', import.meta.url));

export async function chooseWithLiquid(payload, status) {
  const python = process.env.LOOPER_LIQUID_PYTHON;
  const model = process.env.LOOPER_LIQUID_MODEL;
  if (!isAbsolute(python ?? '') || !isAbsolute(model ?? '')) return { unavailable: true };
  try {
    await Promise.all([access(python), access(join(model, 'config.json')), access(join(model, 'model.safetensors'))]);
  } catch {
    return { unavailable: true };
  }

  status('Asking the local Liquid model');
  try {
    const choice = await new Promise((resolve, reject) => {
      const child = execFile(python, ['-I', '-B', worker, model], {
        env: { ...process.env, HF_HUB_OFFLINE: '1', TRANSFORMERS_OFFLINE: '1', HF_HUB_DISABLE_TELEMETRY: '1' },
        timeout: 20000, killSignal: 'SIGKILL', maxBuffer: 64 * 1024,
      }, (error, stdout) => error ? reject(error) : resolve(stdout.trim()));
      child.stdin.on('error', () => {});
      child.stdin.end(JSON.stringify(payload));
    });
    if (choice === 'none' || payload.choices.some(([id]) => id === choice)) return { choice };
  } catch {
    // The local worker can fail or time out. Callers provide their own fallback.
  }
  return {};
}
