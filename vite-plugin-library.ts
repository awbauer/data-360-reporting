import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';
import { parseLibraryFile } from './shared/library-parse';
import type { LibraryEntry } from './shared/types';

const VIRTUAL = 'virtual:query-library';
const RESOLVED = `\0${VIRTUAL}`;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith('.sql') ? [p] : [];
  });
}

/** Load and validate every queries/**\/*.sql file. Throws on the first invalid library. */
export function loadLibrary(root: string): LibraryEntry[] {
  const dir = join(root, 'queries');
  const files = walk(dir).sort();
  const errors: string[] = [];
  const entries: LibraryEntry[] = [];
  for (const file of files) {
    const id = relative(dir, file).split(sep).join('/').replace(/\.sql$/, '');
    try {
      entries.push(parseLibraryFile(id, readFileSync(file, 'utf8')));
    } catch (e) {
      errors.push((e as Error).message);
    }
  }
  if (errors.length) throw new Error(`Invalid query library:\n${errors.join('\n')}`);
  return entries;
}

/** Exposes the validated query library to the client as `virtual:query-library`. */
export function queryLibrary(): Plugin {
  const root = dirname(fileURLToPath(import.meta.url));
  return {
    name: 'query-library',
    resolveId: (id) => (id === VIRTUAL ? RESOLVED : undefined),
    load(id) {
      if (id !== RESOLVED) return undefined;
      const dir = join(root, 'queries');
      this.addWatchFile(dir);
      const entries = loadLibrary(root);
      for (const f of walk(dir)) this.addWatchFile(f);
      return `export default ${JSON.stringify(entries)};`;
    },
    handleHotUpdate({ file, server }) {
      if (file.endsWith('.sql') && file.includes(`${sep}queries${sep}`)) {
        const mod = server.moduleGraph.getModuleById(RESOLVED);
        if (mod) {
          server.moduleGraph.invalidateModule(mod);
          return [mod];
        }
      }
      return undefined;
    },
  };
}
