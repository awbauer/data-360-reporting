# Data 360 Workbench

A web workbench for Salesforce **Data 360** (formerly Data Cloud). Sign in with Salesforce, then:

- **Overview**: high-level abstracts of the org's model (objects by category, field-type mix, relationship hubs, objects with no relationships). These come from metadata only, so they use no query credits.
- **Explorer**: browse data model objects (DMOs), data lake objects (DLOs) and calculated insights, with fields, keys and relationships. Count rows, profile fields (non-null %, approximate distinct, min/max) and sample top values on demand.
- **Query**: a SQL editor with autocomplete from your metadata, `:named` parameters, cancel, paging and CSV export.
- **Library**: a shared set of saved queries that lives in this repository (`queries/`) and changes through pull requests.
- **History**: your recent runs, kept in your browser only.

The connection is user-initiated: the app never redirects to Salesforce on load.

## Quick start (no Salesforce needed)

```bash
npm install
npm run dev        # API on :8787 in mock mode + Vite on :5173; open http://localhost:5173
```

Mock mode (`DATA360_MOCK=1`) serves sample objects backed by an in-memory SQLite database, so you can try every screen. The server refuses to start in mock mode when `NODE_ENV=production`.

## Connecting a real org

Data 360 is reached through the **Connect REST API** on the org's own `instance_url` with the normal OAuth access token (`/services/data/vXX.X/ssot/...`). No separate Data 360 token exchange is needed.

**Recommended setup: PKCE, no client secret.** The app always signs in with the authorization-code flow plus PKCE, which protects the code exchange without any secret. A secret only adds something to protect and leak, so prefer an app that doesn't need one.

1. In Salesforce Setup, create an **External Client App** (a Connected App also works):
   - Enable OAuth with the **authorization-code** flow, **require PKCE**, and turn **off** "Require secret for Web Server flow" (setting labels vary slightly by release).
   - **Callback URL:** `https://<your-host>/auth/callback` (for local dev with the Vite server, `http://localhost:5173/auth/callback`)
   - **Scopes:** `api`, `refresh_token`, `cdp_query_api`, `cdp_profile_api`
2. Set `SF_CLIENT_ID` and `APP_BASE_URL`, plus `SESSION_KEY` in production (see `.env.example`). Leave `SF_CLIENT_SECRET` unset.
3. Users need **View Data 360** (or equivalent) access, and permission to the data spaces they pick.

Only if your org requires a secret for the web-server flow: set `SF_CLIENT_SECRET` for the shared app, or let users enter theirs (below). Treat that as the fallback, not the default.

**One app, many orgs?** An External Client App only authorizes the org that owns it. To connect another org, users can enter that org's own **consumer key** (and **secret**, if the app requires one) under *Your own External Client App* on the Connect screen:

- The credentials go to the server in a POST body, never a URL, and are parked in a 10-minute sealed cookie for the login redirect. The secret then lives only inside the encrypted session cookie (needed for token refresh). Nothing is stored server-side.
- With **Remember on this device**, the browser keeps a blob that the server encrypted with AES-GCM under `SESSION_KEY`. It is unreadable without the server, expires after 180 days, and is bound to its purpose so it can't be replayed as a session. **Forget** deletes it. Rotating `SESSION_KEY` invalidates every saved blob and session; users just re-enter their credentials.
- Without a secret (preferred) the app signs in with PKCE alone. The server's own `SF_CLIENT_SECRET` is never sent with a user-supplied key.
- Anyone who can run JavaScript on the page (XSS) could use a saved blob against this server, which is one reason the CSP is strict. Another reason to prefer an app without a secret.

### Verify against your org

I could not reach a live Data 360 org while building this, so the adapter is built from the published OpenAPI spec (v68.0) and tested against its examples and a mock. Before relying on it, run the smoke test on your machine against a **sandbox**:

```bash
sf org login web --instance-url https://<mydomain> --client-id <consumer key>
npm run smoke                       # or: SF_TARGET_ORG=<alias> npm run smoke
```

It exercises data spaces, metadata, submit/status/rows/cancel and a parameterised query, and prints HTTP statuses and response *shapes* only (no tokens, no row values), so the output is safe to share.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `SESSION_KEY` | random (dev only) | 32+ chars, encrypts session cookies. **Required in production.** |
| `APP_BASE_URL` | `http://localhost:8787` | Public URL; OAuth callback is `${APP_BASE_URL}/auth/callback`. `https://` turns on `Secure` cookies. |
| `SF_CLIENT_ID` | none | The app's External Client App (consumer key). |
| `SF_CLIENT_SECRET` | none | Only if your app requires a secret. PKCE without a secret is preferred. |
| `SF_LOGIN_URL` | `https://login.salesforce.com` | Login host for the "Production" option. |
| `SF_SCOPES` | `api refresh_token cdp_query_api cdp_profile_api` | Requested OAuth scopes. |
| `SF_API_VERSION` | `v65.0` | Connect REST API version (needs ≥ v63.0 for `query-sql`). |
| `ALLOWED_SF_HOST_SUFFIXES` | `.salesforce.com,.force.com` | Outbound hosts the server may call. |
| `QUERY_WORKLOAD_NAME` | `data360-workbench` | Sent as `workloadName` so Salesforce support can trace queries. |
| `QUERY_TIMEOUT_MS` | `300000` | Per-query timeout (`querySettings.query_timeout`). |
| `FIRST_CHUNK_ROWS` | `1000` | Rows returned with the submit call; the UI pages the rest. |
| `MAX_EXPORT_ROWS` | `100000` | Cap for CSV export. |
| `VITE_LIBRARY_REPO`, `VITE_LIBRARY_BRANCH` | this repo, `main` | Where "Propose to library" and "Edit on GitHub" point (build time). |

## Deploying

```bash
npm run build && npm start         # or: docker build -t data360-workbench . 
```

The app is one stateless Node process: no database, no server-side session store. Session state lives in an encrypted, HttpOnly cookie, so you can run several replicas behind a load balancer as long as they share `SESSION_KEY`.

### Cloudflare Workers

`wrangler.jsonc` deploys the built SPA as static assets and runs the same Hono app in a Worker for `/api/*` and `/auth/*` (a pure static deploy can't work: the OAuth code exchange, the API proxy and the session cookie all need server code). Preview URLs are disabled.

```bash
npx wrangler secret put SESSION_KEY        # 32+ random chars
npx wrangler secret put SF_CLIENT_ID       # or set it under "vars"
npx wrangler secret put SF_CLIENT_SECRET   # skip: PKCE without a secret is preferred
npm run deploy                             # builds, then wrangler deploy
```

The OAuth callback follows the hostname the Worker is reached on (`https://<host>/auth/callback`); set `APP_BASE_URL` only if a different public URL fronts it. Static assets get their security headers from `web/public/_headers`. `npm run cf:dev` runs it locally in workerd (put `SESSION_KEY` and `SF_CLIENT_ID` in `.dev.vars`). The mock adapter isn't available on Workers.

**Access control is up to you.** The app has no user management of its own; it is designed to sit behind something like Cloudflare Access. Anyone who can reach it can start a Salesforce login, but can only see data their own Salesforce user can see. The shared library is the same for everyone.

Security notes:

- OAuth uses the web-server flow with PKCE and a state check; the transaction cookie lasts 10 minutes. Every sealed value (session, transaction, credentials, saved blob) is authenticated with its purpose, so one can't be substituted for another.
- The server only calls hosts under `ALLOWED_SF_HOST_SUFFIXES` over HTTPS (login domain, `instance_url`), so a public deployment can't be used to reach arbitrary or internal addresses.
- Mutating requests need an `X-D360` header (CSRF guard); there is no CORS. A strict CSP is set.
- Query ids and data space names are validated before being used in upstream URLs.
- CSV export neutralizes spreadsheet formulas in text cells (a leading `=`, `+`, `@` or `-` gets a `'` prefix).
- There is no built-in rate limiting. Put it at the edge if the host is public.

## Cost awareness

Data 360 bills queries as consumption credits. The app never scans data on its own: the Overview uses metadata only, and row counts, profiling and top-values run only when you click, after a confirmation that states how many queries will run. Results are cached in your browser with a timestamp. Counts and profiles are approximate by design (`APPROX_COUNT_DISTINCT`).

## Query library

Saved queries are `.sql` files under [`queries/`](queries/README.md) with a small YAML header. To add one, use **Propose to library** in the Query editor (it opens a pre-filled GitHub "new file" page) or open a pull request yourself. CI runs `npm run validate:library` on every change, and the build fails on an invalid file.

Parameters use Data 360's native `:name` binding, sent as typed `sqlParameters`, so values are never concatenated into SQL.

## Development

```bash
npm run dev               # API (mock) + Vite with proxying
npm test                  # unit + route tests (vitest)
npm run lint && npm run typecheck
npm run validate:library
npm run e2e               # builds, then runs Playwright against mock mode
```

Layout:

```
server/    Hono app: OAuth, sealed-cookie session, Connect API client, mock adapter
shared/    SQL helpers, library file format, types (used by server, web and scripts)
web/       React + Vite SPA (CodeMirror 6 editor, TanStack Query)
queries/   The shared query library
scripts/   validate-library, smoke
tests/ e2e/
```

Design choices worth knowing:

- **No ORM or query builder.** Data 360 is read-only and reached over REST, so there is no driver, schema, migration or pool for a tool like Knex to manage, and the app has no database of its own. Generated SQL only needs identifier quoting, which `shared/sql.ts` does and tests.
- **Data 360 SQL is Hyper SQL** (PostgreSQL-like): always double-quote object and field names (they are case-sensitive), and alias expressions so result columns have stable names.
- The `queryId` Salesforce returns is already percent-encoded (it contains `%2F`); it is passed through to upstream URLs untouched.
