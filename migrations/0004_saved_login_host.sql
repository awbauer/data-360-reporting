-- Saved connections remember where they sign in (login.salesforce.com, test.salesforce.com or
-- a My Domain), so picking one needs no further choices. Null for rows saved before this.
alter table "sf_credentials" add column "login_host" text;
