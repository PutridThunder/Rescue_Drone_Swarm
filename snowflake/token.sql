-- Rescue Drone Swarm: Snowflake setup, step 2 of 2 (after setup.sql).
--
-- IMPORTANT: a worksheet's "Run all" only shows the result of the LAST statement, and the token
-- secret is shown only once. So run ONE statement at a time: select it, then press
-- Ctrl/Cmd + Enter, and copy the result right away.

USE ROLE ACCOUNTADMIN;

-- 1) The token: run ONE of these two. The result has a column "token_secret": copy it NOW into
--    Vercel as SNOWFLAKE_TOKEN (it can't be shown again).

--    1a) First time: create the token.
ALTER USER RESCUE_APP_USER ADD PROGRAMMATIC ACCESS TOKEN RESCUE_VERCEL
  ROLE_RESTRICTION = 'RESCUE_APP' DAYS_TO_EXPIRY = 90;

--    1b) Token already exists (e.g. 1a said "already exists", or the secret was lost):
--        issue a new secret for it. The old secret stops working at once.
ALTER USER RESCUE_APP_USER ROTATE PROGRAMMATIC ACCESS TOKEN RESCUE_VERCEL
  EXPIRE_ROTATED_TOKEN_AFTER_HOURS = 0;

-- 2) Your account identifier: copy it into Vercel as SNOWFLAKE_ACCOUNT (looks like MYORG-MYACCOUNT).
SELECT CURRENT_ORGANIZATION_NAME() || '-' || CURRENT_ACCOUNT_NAME() AS SNOWFLAKE_ACCOUNT;

-- Optional: list the user's tokens (names and expiry only, never the secret).
-- SHOW USER PROGRAMMATIC ACCESS TOKENS FOR USER RESCUE_APP_USER;
