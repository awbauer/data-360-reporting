// The slice of Cloudflare D1's API the app uses. On Workers the D1 binding satisfies it directly;
// on Node, `fromNodeSqlite` adapts a node:sqlite DatabaseSync to the same shape.

export type SqlValue = string | number | null;

export interface SqlStatement {
  bind(...values: SqlValue[]): SqlStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  run(): Promise<{ meta: { changes: number } }>;
}

export interface SqlDatabase {
  prepare(sql: string): SqlStatement;
  /** D1 only: runs the statements in one transaction. */
  batch?(statements: SqlStatement[]): Promise<unknown[]>;
}

export interface Migration {
  name: string;
  sql: string;
}

const MIGRATIONS_TABLE =
  'create table if not exists d1_migrations (id integer primary key autoincrement, name text unique, applied_at timestamp not null default current_timestamp)';

/**
 * Migrations that were deployed under an earlier name. A database that recorded the old name has
 * already run the SQL, so the new name is recorded without running it again.
 * 0005_query_estimates.sql shipped (PR #19) and was renumbered when PR #20 took 0005; running its
 * ALTER TABLE twice fails with "duplicate column name: est_rows" on every request.
 */
export const RENAMED_MIGRATIONS: Record<string, string[]> = {
  '0006_query_estimates.sql': ['0005_query_estimates.sql'],
};

const ranAs = (name: string, done: Set<string>) => (RENAMED_MIGRATIONS[name] ?? []).some((old) => done.has(old));

/** Splits a migration file into statements. Our migrations keep `;` and `--` out of string literals. */
export function splitStatements(sql: string): string[] {
  return sql
    .replace(/--[^\n]*/g, '')
    .split(';')
    .map((x) => x.trim())
    .filter(Boolean);
}

/**
 * Brings a D1 database up to date on the Worker's first request, so a deploy never runs against
 * a stale schema. Each migration and its d1_migrations row commit together (D1 batches are
 * transactional); if another isolate got there first, its row is what we find on re-check.
 * `wrangler d1 migrations apply` reads and writes the same table, so either can be used.
 */
export async function migrateD1(db: SqlDatabase, migrations: Migration[]): Promise<string[]> {
  if (!db.batch) throw new Error('migrateD1 needs a D1 binding');
  await db.prepare(MIGRATIONS_TABLE).run();
  const applied = async () => new Set((await db.prepare('select name from d1_migrations').all<{ name: string }>()).results.map((r) => r.name));
  const done = await applied();
  const ran: string[] = [];
  for (const m of [...migrations].sort((a, b) => a.name.localeCompare(b.name))) {
    if (done.has(m.name)) continue;
    if (ranAs(m.name, done)) {
      await db.prepare('insert or ignore into d1_migrations (name) values (?)').bind(m.name).run();
      continue;
    }
    try {
      await db.batch([...splitStatements(m.sql).map((q) => db.prepare(q)), db.prepare('insert into d1_migrations (name) values (?)').bind(m.name)]);
      ran.push(m.name);
    } catch (e) {
      if (!(await applied()).has(m.name)) throw new Error(`Migration ${m.name} failed: ${(e as Error).message}`);
    }
  }
  return ran;
}

/** Structural type for node:sqlite's DatabaseSync, so this file doesn't import the module. */
export interface NodeSqlite {
  prepare(sql: string): {
    get(...args: SqlValue[]): unknown;
    all(...args: SqlValue[]): unknown[];
    run(...args: SqlValue[]): { changes: number | bigint };
  };
  exec(sql: string): void;
}

export function fromNodeSqlite(db: NodeSqlite): SqlDatabase {
  const parts = new WeakMap<SqlStatement, { sql: string; args: SqlValue[] }>();
  const statement = (sql: string, args: SqlValue[]): SqlStatement => {
    const st: SqlStatement = {
      bind: (...values) => statement(sql, values),
      first: async <T>() => (db.prepare(sql).get(...args) as T | undefined) ?? null,
      all: async <T>() => ({ results: db.prepare(sql).all(...args) as T[] }),
      run: async () => ({ meta: { changes: Number(db.prepare(sql).run(...args).changes) } }),
    };
    parts.set(st, { sql, args });
    return st;
  };
  return {
    prepare: (sql) => statement(sql, []),
    // Same all-or-nothing behaviour as D1's batch.
    async batch(statements) {
      db.exec('begin');
      try {
        const out = statements.map((st) => {
          const p = parts.get(st)!;
          return db.prepare(p.sql).run(...p.args);
        });
        db.exec('commit');
        return out;
      } catch (e) {
        db.exec('rollback');
        throw e;
      }
    },
  };
}

/**
 * Applies migrations/*.sql in name order, recording them in the same `d1_migrations` table
 * `wrangler d1 migrations apply` uses, so a database can move between the two.
 */
export function migrateNodeSqlite(db: NodeSqlite, migrations: Migration[]): string[] {
  db.exec(MIGRATIONS_TABLE);
  const done = new Set((db.prepare('select name from d1_migrations').all() as { name: string }[]).map((r) => r.name));
  const applied: string[] = [];
  for (const m of [...migrations].sort((a, b) => a.name.localeCompare(b.name))) {
    if (done.has(m.name)) continue;
    if (ranAs(m.name, done)) {
      db.prepare('insert or ignore into d1_migrations (name) values (?)').run(m.name);
      continue;
    }
    db.exec('begin');
    try {
      db.exec(m.sql);
      db.prepare('insert into d1_migrations (name) values (?)').run(m.name);
      db.exec('commit');
    } catch (e) {
      db.exec('rollback');
      throw new Error(`Migration ${m.name} failed: ${(e as Error).message}`);
    }
    applied.push(m.name);
  }
  return applied;
}
