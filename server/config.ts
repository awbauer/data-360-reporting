import { randomBytes } from 'node:crypto';
import { z } from 'zod';

const bool = z
  .enum(['1', '0', 'true', 'false', ''])
  .optional()
  .transform((v) => v === '1' || v === 'true');

const schema = z.object({
  NODE_ENV: z.string().default('development'),
  PORT: z.coerce.number().int().default(8787),
  APP_BASE_URL: z.string().url().default('http://localhost:8787'),
  SESSION_KEY: z.string().min(32).optional(),
  SF_CLIENT_ID: z.string().optional(),
  SF_CLIENT_SECRET: z.string().optional(),
  SF_LOGIN_URL: z.string().url().default('https://login.salesforce.com'),
  SF_SCOPES: z.string().default('api refresh_token cdp_query_api cdp_profile_api'),
  SF_API_VERSION: z.string().regex(/^v\d+\.\d$/).default('v65.0'),
  ALLOWED_SF_HOST_SUFFIXES: z.string().default('.salesforce.com,.force.com'),
  QUERY_WORKLOAD_NAME: z.string().default('data360-workbench'),
  QUERY_TIMEOUT_MS: z.coerce.number().int().positive().default(300_000),
  FIRST_CHUNK_ROWS: z.coerce.number().int().positive().default(1000),
  MAX_EXPORT_ROWS: z.coerce.number().int().positive().default(100_000),
  DATA360_MOCK: bool,
});

export interface Config {
  nodeEnv: string;
  port: number;
  appBaseUrl: string;
  secureCookies: boolean;
  sessionKey: string;
  clientId?: string;
  clientSecret?: string;
  loginUrl: string;
  scopes: string;
  apiVersion: string;
  allowedHostSuffixes: string[];
  workloadName: string;
  queryTimeoutMs: number;
  firstChunkRows: number;
  maxExportRows: number;
  mock: boolean;
}

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const e = schema.parse(env);
  const prod = e.NODE_ENV === 'production';
  if (e.DATA360_MOCK && prod) throw new Error('DATA360_MOCK must not be enabled when NODE_ENV=production');
  if (prod && !e.SESSION_KEY) throw new Error('SESSION_KEY (>= 32 chars) is required in production');
  if (!e.DATA360_MOCK && !e.SF_CLIENT_ID) {
    console.warn('SF_CLIENT_ID is not set: users must supply a consumer key on the Connect screen.');
  }
  return {
    nodeEnv: e.NODE_ENV,
    port: e.PORT,
    appBaseUrl: e.APP_BASE_URL.replace(/\/$/, ''),
    secureCookies: e.APP_BASE_URL.startsWith('https://'),
    // Dev fallback: sessions simply don't survive a restart.
    sessionKey: e.SESSION_KEY ?? randomBytes(32).toString('hex'),
    clientId: e.SF_CLIENT_ID,
    clientSecret: e.SF_CLIENT_SECRET,
    loginUrl: e.SF_LOGIN_URL.replace(/\/$/, ''),
    scopes: e.SF_SCOPES,
    apiVersion: e.SF_API_VERSION,
    allowedHostSuffixes: e.ALLOWED_SF_HOST_SUFFIXES.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
    workloadName: e.QUERY_WORKLOAD_NAME,
    queryTimeoutMs: e.QUERY_TIMEOUT_MS,
    firstChunkRows: e.FIRST_CHUNK_ROWS,
    maxExportRows: e.MAX_EXPORT_ROWS,
    mock: e.DATA360_MOCK,
  };
}
