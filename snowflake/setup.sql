-- Rescue Drone Swarm: Snowflake setup, step 1 of 2. Run as ACCOUNTADMIN in a SQL worksheet
-- ("Run all"). It creates the database, two tables, a tiny self-suspending warehouse and a
-- restricted service user. Step 2 is snowflake/token.sql.
-- Safe to run again; the existing token keeps working.

USE ROLE ACCOUNTADMIN;

CREATE DATABASE IF NOT EXISTS RESCUE_DRONES;
CREATE SCHEMA IF NOT EXISTS RESCUE_DRONES.APP;

-- X-Small, suspends after 60 s idle, resumes on demand: a few seconds of credit per call.
CREATE WAREHOUSE IF NOT EXISTS RESCUE_WH
  WAREHOUSE_SIZE = XSMALL AUTO_SUSPEND = 60 AUTO_RESUME = TRUE INITIALLY_SUSPENDED = TRUE;

-- One row per finished mission (the algorithm flying the whole fleet).
CREATE TABLE IF NOT EXISTS RESCUE_DRONES.APP.MISSIONS (
  ID               STRING        DEFAULT UUID_STRING(),
  CREATED_AT       TIMESTAMP_LTZ DEFAULT CURRENT_TIMESTAMP(),
  AREA             STRING,        -- e.g. "Lonsdale, North Vancouver"
  SCENARIO         STRING,        -- none | tsunami
  DRONES           NUMBER,
  TRUCKS           NUMBER,
  STREET_MAP       BOOLEAN,       -- were buildings known up front?
  SEARCH_RADIUS_M  FLOAT,         -- drawn search circle radius, NULL = whole map
  SEED             NUMBER,
  SURVIVORS_TOTAL  NUMBER,
  SURVIVORS_FOUND  NUMBER,
  SURVIVORS_LOST   NUMBER,
  DURATION_S       FLOAT,         -- simulated seconds
  AREA_SEARCHED    FLOAT,         -- 0..1
  REDUNDANCY       FLOAT,         -- share of duplicate observations, 0..1
  DISTANCE_KM      FLOAT,
  BATTERY_USED     FLOAT,         -- full charges
  FAILURES         NUMBER,
  TIMELINE         VARIANT        -- [[seconds, area searched, survivors found], ...] every 10 s
);

-- One row per finished challenge game (human vs algorithm).
CREATE TABLE IF NOT EXISTS RESCUE_DRONES.APP.GAMES (
  ID               STRING        DEFAULT UUID_STRING(),
  CREATED_AT       TIMESTAMP_LTZ DEFAULT CURRENT_TIMESTAMP(),
  AREA             STRING,
  SURVIVORS_TOTAL  NUMBER,
  HUMAN_FOUND      NUMBER,
  HUMAN_HECTARES   FLOAT,
  AI_FOUND         NUMBER,
  AI_HECTARES      FLOAT,
  WINNER           STRING,        -- human | algorithm | tie
  DURATION_S       FLOAT
);

-- The app's role: can add rows and read them back, nothing else.
CREATE ROLE IF NOT EXISTS RESCUE_APP;
GRANT USAGE ON WAREHOUSE RESCUE_WH TO ROLE RESCUE_APP;
GRANT USAGE ON DATABASE RESCUE_DRONES TO ROLE RESCUE_APP;
GRANT USAGE ON SCHEMA RESCUE_DRONES.APP TO ROLE RESCUE_APP;
GRANT SELECT, INSERT ON TABLE RESCUE_DRONES.APP.MISSIONS TO ROLE RESCUE_APP;
GRANT SELECT, INSERT ON TABLE RESCUE_DRONES.APP.GAMES TO ROLE RESCUE_APP;

-- A service user (no password, no login) that can only use an access token.
CREATE USER IF NOT EXISTS RESCUE_APP_USER
  TYPE = SERVICE DEFAULT_ROLE = RESCUE_APP DEFAULT_WAREHOUSE = RESCUE_WH;
GRANT ROLE RESCUE_APP TO USER RESCUE_APP_USER;

-- Vercel has no fixed IP address, so allow access tokens without a network policy.
CREATE AUTHENTICATION POLICY IF NOT EXISTS RESCUE_DRONES.APP.RESCUE_TOKEN_POLICY
  AUTHENTICATION_METHODS = ('PROGRAMMATIC_ACCESS_TOKEN')
  PAT_POLICY = (NETWORK_POLICY_EVALUATION = ENFORCED_NOT_REQUIRED);
-- FORCE: replaces the policy if it's already attached (so this file can run again).
ALTER USER RESCUE_APP_USER SET AUTHENTICATION POLICY RESCUE_DRONES.APP.RESCUE_TOKEN_POLICY FORCE;

-- Done. Next: run snowflake/token.sql (on its own) to create the access token.
-- This file is safe to run again.
