import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fromNodeSqlite, migrateNodeSqlite, type NodeSqlite, type SqlDatabase } from './db';

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

export function loadMigrations(dir = MIGRATIONS_DIR): { name: string; sql: string }[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .map((name) => ({ name, sql: readFileSync(join(dir, name), 'utf8') }));
}

/**
 * Opens (creating if needed) the SQLite file Node deployments use in place of D1, and brings it
 * up to date with migrations/. `raw` goes to Better Auth, `db` to the app's own store.
 */
export function openNodeDatabase(path: string): { raw: NodeSqlite; db: SqlDatabase } {
  // Loaded via require: Vite/Vitest don't recognise the newer `node:sqlite` builtin.
  const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const raw = new DatabaseSync(path) as unknown as NodeSqlite;
  raw.exec('pragma foreign_keys = on');
  if (path !== ':memory:') raw.exec('pragma journal_mode = wal');
  migrateNodeSqlite(raw, loadMigrations());
  return { raw, db: fromNodeSqlite(raw) };
}
