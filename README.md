# Data 360 Workbench

A web workbench for Salesforce **Data 360** (formerly Data Cloud). Sign in to the workbench (GitHub or Google), connect a Salesforce org, then:

- **Overview**: high-level abstracts of the org's model (objects by category, field-type mix, relationship hubs, objects with no relationships), plus data stream and segment counts and which streams' last run failed. These come from metadata and list endpoints only, so they use no query credits. Two exports build on it, also without running queries:
  - **Data dictionary** (Excel, CSV zip or Markdown): every object and field with type, keys, key qualifiers and calculated-insight roles, plus relationships, and any row counts and profile statistics cached in your browser (each marked with when it was computed). No row data.
  - **Health check** (printable HTML, or Markdown): model inventory, objects without relationships, data streams and failed runs, segments by publish status, and field completeness for objects you've profiled. It lists any section it couldn't produce and why. Print the HTML to PDF to hand to a client.
- **Explorer**: browse data model objects (DMOs), data lake objects (DLOs) and calculated insights, with fields, keys and relationships. Count rows, profile fields (non-null %, approximate distinct, min/max) and see each field's distribution on demand: a **histogram** for numbers and dates (nice bucket edges, or `date_trunc` by hour/day/week/month/quarter/year, with the null share) and top values for everything else. Each object has a clickable **relationship map**, and **Build JOIN** opens a ready-made JOIN of two related objects in the editor. **Lineage**: a DMO shows which data lake object fields map to each of its fields (and which data stream loads them), plus the fields nothing maps to; a DLO shows the DMOs it feeds (Salesforce can only list mappings into one DMO at a time, so this walks the data space's DMOs when you click, one API call each and no query credits, and reuses the results). Calculated insights show their **definition** (SQL expression, how each dimension and measure is computed, status and schedule).
- **Segments**: every segment in the data space with status, publish status, last member count, the object it's built on, and its include/exclude rules (read-only).
- **Query**: a SQL editor with autocomplete from your metadata, `:named` parameters, **multiple tabs**, **Format**, cancel, paging, CSV export and a **Table / Chart** toggle (bar or line of one measure against one dimension). Queries with no `LIMIT` ask first, showing cached row counts for the objects they read.
- **Library**: a shared set of saved queries that lives in this repository (`queries/`) and changes through pull requests. `queries/identity/` holds identity-resolution diagnostics: consolidation rate, cluster-size distribution, largest clusters, profiles by source, overlap between sources and individuals without a unified profile.
- **History**: your recent editor runs, on any device you sign in from.
- **Credits**: credit plans for consultants, saved to your workbench account and usable before any org is connected (the Connect page links to it). See [Credit planning](#credit-planning).
- **Admin** (people in `AUTH_ADMIN_EMAILS`):
  - **Users**: everyone who has signed in, with provider, last sign-in, active sessions and query count. Open one to see their sessions and sign-in history, sign them out everywhere, or **block** them. Blocking ends their sessions at once and refuses future sign-ins, whatever the allowlist says. Admins can't block themselves or another admin.
  - **Sign-ins**: every successful sign-in, and every attempt the allowlist or a block turned away, with IP and browser.
  - **Queries**: every query run through the workbench, by whom, against which org, with its outcome. Downloadable as CSV.
  - **Admin log**: who blocked, unblocked or signed out whom.

The Salesforce connection is user-initiated: the app never redirects to Salesforce on load.

## Two sign-ins, two jobs

| | Workbench account | Salesforce connection |
|---|---|---|
| What | [Better Auth](https://www.better-auth.com) with GitHub and/or Google | OAuth web-server flow + PKCE to the org |
| Decides | Who may use the app (`AUTH_ALLOWED_DOMAINS` / `AUTH_ALLOWED_EMAILS`) | What data they can see (their own Salesforce permissions) |
| Stored | Users, sessions, saved credentials, tabs, audit log in **D1** (SQLite on Node) | Access/refresh tokens in an encrypted HttpOnly cookie only, **never in the database** |

The Salesforce cookie is bound to the workbench user who connected, so it is useless to anyone else who signs in on the same browser. A leak of the database alone exposes no org tokens, and saved consumer secrets in it are encrypted with `SESSION_KEY`.

## Quick start (no Salesforce needed)

```bash
npm install
npm run dev        # API on :8787 in mock mode + Vite on :5173; open http://localhost:5173
```

Mock mode (`DATA360_MOCK=1`) serves sample objects backed by an in-memory SQLite database, so you can try every screen, and offers a local **demo user** instead of GitHub/Google sign-in. The server refuses to start in mock mode when `NODE_ENV=production`. App data goes to `./data/workbench.db` (`DATABASE_PATH`); migrations in `migrations/` apply on start.

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

- The credentials go to the server in a POST body, never a URL, and are parked in a 10-minute sealed cookie for the login redirect. The secret then lives inside the encrypted session cookie (needed for token refresh).
- With **Save this connection to my account**, they are stored in the database under a name (say "Acme sandbox") together with where they sign in (Production, Sandbox or the My Domain), so a consultant can keep one per client org and connect with one click from any device. The page shows only a masked key (`3MVG9A…x7Qk`); the full key never goes back to the browser. Connections saved before the sign-in host was stored ask for it once. The secret is AES-256-GCM encrypted with `SESSION_KEY` and bound to the owning user and row, so neither a database dump nor a copied row reveals it. Saved credentials are listed without secrets and can be deleted from the Connect screen. Rotating `SESSION_KEY` makes saved secrets unreadable (the app says so); users re-enter them.
- Without a secret (preferred) the app signs in with PKCE alone. The server's own `SF_CLIENT_SECRET` is never sent with a user-supplied key.

**If the browser offers to download a file called `authorize`**, Salesforce rejected the sign-in request with a plain-text error that browsers can't display (iOS Safari offers a download). The app now asks Salesforce first and shows the reason instead, usually one of: the consumer key isn't recognised in that org (wrong org, app not enabled, key truncated), or `https://<your-host>/auth/callback` isn't registered as a callback URL on the app.

### Verify against your org

I could not reach a live Data 360 org while building this, so the adapter is built from the published OpenAPI spec (v68.0) and tested against its examples and a mock. Before relying on it, run the smoke test on your machine against a **sandbox**:

```bash
sf org login web --instance-url https://<mydomain> --client-id <consumer key>
npm run smoke                       # or: SF_TARGET_ORG=<alias> npm run smoke
```

It exercises data spaces, metadata, submit/status/rows/cancel and a parameterised query, and prints HTTP statuses and response *shapes* only (no tokens, no row values), so the output is safe to share.

Lineage, insight definitions, segment rules and the identity queries were built from the spec and have been **checked against its schemas and example payloads** (field names, required parameters, the join columns Salesforce's own insight example uses), but not against a live org. What a first sandbox run still needs to confirm, and what `npm run smoke` prints for it:

- `/ssot/data-model-object-mappings` returns what the spec's example shows (it requires `dmoDeveloperName`; `dloDeveloperName` only narrows), and its object names match the names in `/ssot/metadata`.
- `/ssot/calculated-insights/{apiName}` and the segment list return the documented fields, including for objects outside the default data space.
- The identity queries use `IndividualIdentityLink__dlm` (`SourceRecordId__c`, `KQ_SourceRecordId__c`, `UnifiedRecordId__c`) and `UnifiedIndividual__dlm`, the names Salesforce's examples use. The smoke test lists your org's identity-resolution rulesets with the link and unified object names each one writes to; if a ruleset uses other names, edit them in the queries.
- Credit seeding reads a stream's connector type (`connectorInfo.connectorType`), refresh mode and frequency (`refreshConfig`) and last-run rows (`lastNumberOfRowsAddedCount`) under key names that are guesses, not from the spec; the smoke test reports which ones your org returns. Without them it falls back to the stream's name and a daily schedule.

The lineage and definition cards include a **Raw API response** toggle so you can compare against what the normalizer understood.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `SESSION_KEY` | random (dev only) | 32+ chars, encrypts the Salesforce session cookie and saved secrets; Better Auth's key is derived from it. **Required in production.** |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | none | GitHub OAuth app for workbench sign-in. Callback `${APP_BASE_URL}/api/auth/callback/github`. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | none | Google OAuth client. Callback `${APP_BASE_URL}/api/auth/callback/google`. At least one provider is **required in production.** |
| `AUTH_ALLOWED_DOMAINS`, `AUTH_ALLOWED_EMAILS` | none | Who may sign in, comma-separated. Only provider-verified emails match; subdomains don't. **Required in production** (empty means nobody). |
| `AUTH_ADMIN_EMAILS` | none | Who can open the Audit page (and is allowed in). |
| `AUDIT_RETENTION_DAYS` | `180` | Audit entries older than this are purged daily. |
| `BETTER_AUTH_SECRET` | derived | Override Better Auth's signing key. |
| `DATABASE_PATH` | `./data/workbench.db` | SQLite file on Node. Cloudflare uses the `DB` D1 binding. |
| `APP_BASE_URL` | `http://localhost:8787` | Public URL; OAuth callback is `${APP_BASE_URL}/auth/callback`. `https://` turns on `Secure` cookies. |
| `SF_CLIENT_ID` | none | The app's External Client App (consumer key). |
| `SF_CLIENT_SECRET` | none | Only if your app requires a secret. PKCE without a secret is preferred. |
| `SF_LOGIN_URL` | `https://login.salesforce.com` | Login host for the "Production" option. |
| `SF_SCOPES` | `api refresh_token cdp_query_api cdp_profile_api` | Requested OAuth scopes. |
| `SF_AUTHORIZE_PREFLIGHT` | `1` | Before sending someone to Salesforce, ask it whether the consumer key and callback URL are acceptable, and show its reason on the Connect page if not. Set `0` to skip (tests do). |
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

On Node, app data (users, sessions, saved credentials, tabs, audit log) is a SQLite file at `DATABASE_PATH` via `node:sqlite` (still flagged experimental in Node 22, so it logs a warning). Run **one** replica, and put the file on a persistent volume (the Docker image declares `/data`). For several replicas, deploy to Cloudflare, where it's D1.

### Cloudflare Workers

`wrangler.jsonc` deploys the built SPA as static assets and runs the same Hono app in a Worker for `/api/*` and `/auth/*` (a pure static deploy can't work: the OAuth code exchange, the API proxy and the session cookie all need server code). Preview URLs are disabled.

```bash
npx wrangler secret put SESSION_KEY            # 32+ random chars (keep the one you have)
npx wrangler secret put GITHUB_CLIENT_ID       # and GITHUB_CLIENT_SECRET, and/or the GOOGLE_ pair
npx wrangler secret put GITHUB_CLIENT_SECRET
npx wrangler secret put AUTH_ADMIN_EMAILS      # optional: who sees the audit log
npm run deploy                                 # wrangler deploy; it runs the build first
```

**D1.** `wrangler.jsonc` binds a D1 database named `data360-workbench` as `DB` without a `database_id`, so the first `wrangler deploy` creates it and records the id. Commit that change, or add the id of a database you made with `npx wrangler d1 create data360-workbench`. The Worker applies `migrations/` itself on its first request (recorded in `d1_migrations`, the same table `npx wrangler d1 migrations apply DB --remote` uses), so a git-triggered deploy never runs against an old schema. A daily cron trigger purges old audit entries.

**Allowlist.** `AUTH_ALLOWED_DOMAINS` is set in `wrangler.jsonc` to `publicissapient.com, publicisgroupe.net, publicis.com`; change it there by pull request. Add individuals (say, a client contact) with `AUTH_ALLOWED_EMAILS`.

**Before deploying this version over an existing one**, set a provider and an allowlist: in production the Worker refuses to start without them, and every request returns 500 until they're set.

The OAuth callback follows the hostname the Worker is reached on (`https://<host>/auth/callback`); set `APP_BASE_URL` only if a different public URL fronts it. Static assets get their security headers from `web/public/_headers`. With a Cloudflare git (Workers Builds) integration, the deploy command is just `npx wrangler deploy`; no separate build command is needed. `npm run cf:dev` runs it locally in workerd (put `SESSION_KEY` and `SF_CLIENT_ID` in `.dev.vars`). The mock adapter isn't available on Workers.

**Access control.** Every `/api/*` and `/auth/*` route needs a signed-in workbench user on the allowlist; the allowlist is checked again on every request (so removing someone takes effect within the 5-minute session cache) and on every returning GitHub/Google sign-in. You can still put Cloudflare Access in front, but it's no longer required. The static SPA bundle, which includes the shared query library, is served without sign-in, so treat library queries as visible to anyone who can reach the host.

Security notes:

- OAuth uses the web-server flow with PKCE and a state check; the transaction cookie lasts 10 minutes. Every sealed value (session, transaction, credentials, saved blob) is authenticated with its purpose, so one can't be substituted for another.
- The server only calls hosts under `ALLOWED_SF_HOST_SUFFIXES` over HTTPS (login domain, `instance_url`), so a public deployment can't be used to reach arbitrary or internal addresses.
- Mutating requests need an `X-D360` header (CSRF guard); there is no CORS. A strict CSP is set.
- Query ids and data space names are validated before being used in upstream URLs.
- CSV export neutralizes spreadsheet formulas in text cells (a leading `=`, `+`, `@` or `-` gets a `'` prefix).
- Better Auth rate-limits its own sign-in endpoints (in memory, per instance). There is no rate limiting on the query API; put it at the edge if the host is public.
- Better Auth stores GitHub/Google tokens in `account`, encrypted (`encryptOAuthTokens`); the app never uses them after sign-in.

## Who runs the queries

Everything runs as the person who signed in. Sign-in is the OAuth authorization-code flow, so the access token is that user's, and the server uses only that token for Connect API calls (there is no integration user or client-credentials flow). Salesforce documents the `cdp_query_api` scope as running SQL "on behalf of the user", and the query endpoints require that user to have permission to the data space. So data access follows the user's own permissions, and the user is the one Salesforce sees.

The workbench also keeps its own record: every query (from the editor, Explorer and Overview) is written to `query_log` **before** it is sent to Salesforce, with the workbench user's email, the org host, the Salesforce org and user ids from their token, the data space, SQL, parameter values, status, row count and timing. If that write fails, the query does not run. Parameter values are stored as typed, so treat the audit log as sensitive. Users see their own editor runs under History ("Clear" hides them there; the audit keeps them). Admins see everything under Admin → Queries and can download it as CSV.

Sign-ins are recorded too (`login_event`): successes, and attempts refused by the allowlist or a block, with IP (from `CF-Connecting-IP` on Cloudflare, otherwise the first `X-Forwarded-For` hop, which a client can forge when Node isn't behind a proxy) and user agent. Both logs are purged after `AUDIT_RETENTION_DAYS`. Admin actions (`admin_action`) are not purged.

## Credit planning

The **Credits** page estimates what a client's Data 360 work will consume and tracks it against the contract.

- **Estimate.** A plan lists *activities* in units a consultant can reason about: rows per run and how often, rows per day for streaming, one-time volumes (a backfill, the first full identity resolution run), production or sandbox, and the months each runs in. The rate card maps each activity to a billed usage type.
- **Two rate cards, transcribed as published:** the [Flex Credits Rate Card](https://www.salesforce.com/en-us/wp-content/uploads/sites/4/assets/pdf/agentforce/Flex-Credits-Rate-Card-06.17.2026.pdf) (June 17, 2026) and the [Data Services credits rate card](https://www.salesforce.com/en-us/wp-content/uploads/sites/4/documents/platform/data-cloud-platform-services-rate-sheet-dc-9-04.pdf) (August 2025). Every plan is also priced on the other card, for clients moving between them. Those are different credits at different prices, so compare cost, not counts. Multipliers can be overridden per usage type for negotiated or updated rates. Check them against the client's order form; Salesforce changes them.
- **Flex tiers are simulated, not averaged.** Multipliers fall with credits used per usage type in the calendar month (300k / 1.5M / 12.5M), and reset monthly. Runs are laid out in time order, and a run that crosses into a tier is billed entirely at that tier, as Salesforce's Trailhead example shows. A big first unification run therefore bills at tier 2, not base. Flex sandbox is flat and draws on the same credits; Data Services sandbox credits are a separate entitlement and are shown apart.
- **What maps where** follows Salesforce's Data Services → Flex mapping (Trailhead, *Maximize Your Data 360 Credits*): batch transforms and batch insights are *Prep*; streaming ingestion, transforms, insights and data actions are *Streaming Pipeline*. Batch ingestion, federation and rows shared have no Flex usage type and show as **not billed**. Activities a card doesn't price (inferences and Private Connect on Flex; intelligent processing and code extensions on Data Services) show as **not priced**, count as 0 and raise a warning. Streaming activations on Flex are assumed to bill as *Activation*; Salesforce's table lists batch only.
- **Plan.** Contract start and length, entitlement, price per 100,000 credits and annual growth give monthly credits, a running total against the entitlement (and the month it runs out), and the cost. **Ways to cut the estimate** re-prices concrete changes (a streaming flow as a daily batch, a segment, insight or activation refreshed daily instead of hourly) and can apply them.
- **Track.** Enter each month's credits from Digital Wallet; the running total uses actuals where entered and the estimate after. If the org has the Tenant Consumption Insights DMO, the page points to it, but doesn't read it: its fields count usage units, not credits, and haven't been checked against a real org.
- **Start from the org.** *Add from this org* proposes activities from data streams, identity resolution, calculated insights (from the objects their SQL reads and their schedule) and segments (every object they read, not their member count), with published segments' activations. It uses metadata and the row counts cached on the Overview page, so it runs no queries. Each proposal states its assumptions (for example, the share of rows changing per run), and ones missing a row count start unticked. Stream connector type, refresh mode, frequency and last-run rows are read under keys from the spec; `npm run smoke` reports whether a real org returns them. Without them, streams are classified by name and assumed daily.
- **Export** to Excel or Markdown: summary, activities with their assumptions, months, usage types (with the highest Flex tier reached), the rate card and the levers.

Plans live in the `credit_plan` table, one JSON document per plan, at most 50 per user. Saving checks the version you opened, so a save from a second tab or device is reported rather than silently overwritten.

## Cost awareness

Data 360 bills queries as consumption credits, by rows scanned: 3 Flex Credits per million rows at the base rate (2 Data Services credits), so queries are rarely what drives a bill. Unification, streaming and frequent segment refreshes are; the Credits page shows by how much. The app never scans data on its own: the Overview uses metadata only, and row counts, profiling and top-values run only when you click, after a confirmation that states how many queries will run. Results are cached in your browser with a timestamp. Counts and profiles are approximate by design (`APPROX_COUNT_DISTINCT`). Running a query with no `LIMIT` asks first (and can add one for you); the guard is a text heuristic, so it can miss a `LIMIT` inside a subquery or warn on an unusual query. It can be silenced for the browser session.

### Credit estimates for queries run here

**Salesforce's API reports no credit consumption at all.** A query's status carries only a result row count; there is no usage endpoint in the Connect API, so nothing in the workbench is a measurement. Every credit figure is an estimate: rows (from counts you already have) times the base-tier Flex multiplier for Data 360 Queries (3 credits per million rows scanned; tiers lower it as a month's usage grows, so this is an upper bound).

- **Query editor, Overview, Explorer:** the editor shows an estimate chip ("est. ≈ 0.4 credits") from the objects the SQL names and the row counts cached in your browser. It assumes every named object is read once in full, and says so when a count is missing or a `LIMIT` might stop the read early. Confirmation dialogs state the same estimate before a count or profile runs.
- **History, Audit, Admin → Usage:** each run records the estimate it was shown (`est_rows`, `est_complete` on `query_log`), so admins can total estimated rows and credits per user and org. It counts only queries run through this workbench, not what else consumes credits in the org; ingestion, unification, segmentation and activation are what the Credits page is for.

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
server/    Hono app: Better Auth sign-in, Salesforce OAuth + sealed cookie, audit/store, Connect API client, mock adapter
migrations/ D1/SQLite schema (applied by the Worker or the Node server on start)
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
