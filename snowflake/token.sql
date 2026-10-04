-- Rescue Drone Swarm: Snowflake setup, step 2 of 2 (after setup.sql).
--
-- IMPORTANT: a worksheet's "Run all" only shows the result of the LAST statement, and the token
-- secret is shown only once. So run these statements ONE AT A TIME (put the cursor in a
-- statement, press Ctrl/Cmd + Enter) and copy the result right away.

USE ROLE ACCOUNTADMIN;

-- 1) The token. The result has a column "token_secret": copy it NOW into Vercel as SNOWFLAKE_TOKEN.
--    It can't be shown again; if it's lost, change the name (RESCUE_VERCEL_2, _3, ...) and run
--    this again. Each name works once. Old tokens can stay: they expire after 90 days.
ALTER USER RESCUE_APP_USER ADD PROGRAMMATIC ACCESS TOKEN RESCUE_VERCEL
  ROLE_RESTRICTION = 'RESCUE_APP' DAYS_TO_EXPIRY = 90;

-- 2) Your account identifier: copy it into Vercel as SNOWFLAKE_ACCOUNT (looks like MYORG-MYACCOUNT).
SELECT CURRENT_ORGANIZATION_NAME() || '-' || CURRENT_ACCOUNT_NAME() AS SNOWFLAKE_ACCOUNT;

-- Optional: list the user's tokens (names and expiry only, never the secret).
-- SHOW USER PROGRAMMATIC ACCESS TOKENS FOR USER RESCUE_APP_USER;
