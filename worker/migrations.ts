// Bundled as text by the "rules" entry in wrangler.jsonc. Keep in step with migrations/:
// tests/auth-d1.test.ts fails if a file there is missing here.
import auth from '../migrations/0001_auth.sql';
import app from '../migrations/0002_app.sql';
import type { Migration } from '../server/db';

export const MIGRATIONS: Migration[] = [
  { name: '0001_auth.sql', sql: auth },
  { name: '0002_app.sql', sql: app },
];
