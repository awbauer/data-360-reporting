-- User administration: sign-in history, blocks, and a log of what admins did.

-- Every sign-in, and every attempt the allowlist or a block turned away. Kept for
-- AUDIT_RETENTION_DAYS like the query log. user_id is null for people who never got an account.
create table "login_event" (
  "id" text not null primary key,
  "user_id" text,
  "email" text not null,
  "outcome" text not null,
  "method" text,
  "ip" text,
  "user_agent" text,
  "reason" text,
  "at" integer not null
);
create index "login_event_user_idx" on "login_event" ("user_id", "at");
create index "login_event_at_idx" on "login_event" ("at");
create index "login_event_email_idx" on "login_event" ("email", "at");

-- A blocked user can't sign in or use the API, whatever the allowlist says.
create table "user_block" (
  "user_id" text not null primary key references "user" ("id") on delete cascade,
  "reason" text,
  "blocked_by" text not null,
  "blocked_at" integer not null
);

-- Admins are accountable too: blocks, unblocks and session revocations.
create table "admin_action" (
  "id" text not null primary key,
  "admin_email" text not null,
  "action" text not null,
  "target_user_id" text,
  "target_email" text,
  "detail" text,
  "at" integer not null
);
create index "admin_action_at_idx" on "admin_action" ("at");
