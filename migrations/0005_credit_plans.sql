-- Credit estimates consultants keep per client: the plan is one JSON document (activities,
-- contract, actuals). Plans hold no org data beyond what the consultant typed or seeded.
create table "credit_plan" (
  "id" text not null primary key,
  "user_id" text not null references "user" ("id") on delete cascade,
  "name" text not null,
  "client" text,
  "doc" text not null,
  "created_at" integer not null,
  "updated_at" integer not null
);
create index "credit_plan_user_idx" on "credit_plan" ("user_id", "updated_at");
