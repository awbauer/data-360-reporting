// Bundled as text by the "rules" entry in wrangler.jsonc. Keep in step with migrations/:
// tests/auth-d1.test.ts fails if a file there is missing here.
import auth from '../migrations/0001_auth.sql';
import app from '../migrations/0002_app.sql';
import admin from '../migrations/0003_admin.sql';
import loginHost from '../migrations/0004_saved_login_host.sql';
import creditPlans from '../migrations/0005_credit_plans.sql';
import estimates from '../migrations/0006_query_estimates.sql';
import type { Migration } from '../server/db';

export const MIGRATIONS: Migration[] = [
  { name: '0001_auth.sql', sql: auth },
  { name: '0002_app.sql', sql: app },
  { name: '0003_admin.sql', sql: admin },
  { name: '0004_saved_login_host.sql', sql: loginHost },
  { name: '0005_credit_plans.sql', sql: creditPlans },
  { name: '0006_query_estimates.sql', sql: estimates },
];
