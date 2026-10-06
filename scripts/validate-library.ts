// Validates every queries/**/*.sql file. Run in CI on each pull request.
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadLibrary } from '../vite-plugin-library';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
try {
  const entries = loadLibrary(root);
  console.log(`✓ ${entries.length} library queries are valid`);
  for (const e of entries) console.log(`  ${e.id}${e.params.length ? `  (${e.params.map((p) => ':' + p.name).join(', ')})` : ''}`);
} catch (e) {
  console.error((e as Error).message);
  process.exit(1);
}
