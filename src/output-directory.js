import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// The desktop entry point supplies a writable destination for packaged apps.
export const generatedDirectory = resolve(process.env.LOCAL_BEATS_OUTPUT_DIR ?? fileURLToPath(new URL('../generated_beats/', import.meta.url)));
