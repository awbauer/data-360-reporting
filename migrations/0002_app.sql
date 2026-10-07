-- App tables. Salesforce access/refresh tokens are deliberately NOT stored here: they stay in the
-- sealed session cookie, so a leak of this database exposes no org tokens.

-- Every query submitted through the app, by whom, against which org. Rows are not tied to the
-- user table by a foreign key so the record survives the user being deleted.
create table "query_log" (
  "id" text not null primary key,
  "user_id" text not null,
  "user_email" text not null,
  "instance_host" text not null,
  "sf_org_id" text,
  "sf_user_id" text,
  "dataspace" text not null,
  "source" text not null,
  "sql_text" text not null,
  "param_defs" text not null default '[]',
  "params" text not null default '{}',
  "query_id" text,
  "status" text not null,
  "row_count" integer,
  "error" text,
  "started_at" integer not null,
  "finished_at" integer,
  -- "Clear history" only hides rows from the user's own History page; the audit keeps them.
  "hidden" integer not null default 0
);
create index "query_log_user_idx" on "query_log" ("user_id", "started_at");
create index "query_log_started_idx" on "query_log" ("started_at");
create index "query_log_query_idx" on "query_log" ("query_id");

-- Small per-user JSON documents (currently: open query tabs).
create table "user_state" (
  "user_id" text not null references "user" ("id") on delete cascade,
  "key" text not null,
  "value" text not null,
  "updated_at" integer not null,
  primary key ("user_id", "key")
);

-- A user's own External Client App credentials. The secret is AES-256-GCM encrypted with
-- SESSION_KEY and bound to the owning user and row, so it can't be decrypted or moved without it.
create table "sf_credentials" (
  "id" text not null primary key,
  "user_id" text not null references "user" ("id") on delete cascade,
  "label" text not null,
  "client_id" text not null,
  "secret_enc" text,
  "created_at" integer not null,
  "last_used_at" integer
);
create index "sf_credentials_user_idx" on "sf_credentials" ("user_id");
