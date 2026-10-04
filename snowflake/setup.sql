-- Rescue Drone Swarm: Snowflake setup, step 1 of 2. Run as ACCOUNTADMIN in a SQL worksheet
-- ("Run all"). It creates the database, two tables, a tiny self-suspending warehouse and a
-- restricted service user. Step 2 is snowflake/token.sql.
-- Already set up? Run this file again to add new tables: it is safe to re-run, and the
-- existing token keeps working.

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

-- ---- Maps: the website loads areas from here; the Python pipeline uploads them. ----------

-- One row per area the website can open.
CREATE TABLE IF NOT EXISTS RESCUE_DRONES.APP.AREAS (
  AREA_ID      STRING,        -- e.g. lonsdale (used in the URL: ?area=lonsdale)
  NAME         STRING,        -- e.g. "Lonsdale, North Vancouver"
  SOUTH FLOAT, WEST FLOAT, NORTH FLOAT, EAST FLOAT,
  WIDTH        NUMBER,        -- grid cells
  HEIGHT       NUMBER,
  CELL_SIZE_M  FLOAT,
  BUILDINGS    NUMBER,
  POPULATION   FLOAT,
  VERSION      NUMBER,        -- changes on every upload (so caches refresh)
  UPDATED_AT   TIMESTAMP_LTZ DEFAULT CURRENT_TIMESTAMP()
);

-- The files the app loads for an area (world.json, map.json, places.json, eo.json,
-- satellite.jpg), stored base64-encoded (JSON gzipped first, about 0.5 MB per area in total).
CREATE TABLE IF NOT EXISTS RESCUE_DRONES.APP.AREA_FILES (
  AREA_ID   STRING,
  FILE      STRING,
  ENCODING  STRING,           -- gzip | identity
  BYTES     NUMBER,           -- original size
  CONTENT   STRING
);

-- The same maps as tables, for SQL analysis (coordinates in WGS84 lat/lon).
CREATE TABLE IF NOT EXISTS RESCUE_DRONES.APP.BUILDINGS (
  AREA_ID STRING, BUILDING_ID NUMBER, HEIGHT_M FLOAT, AREA_M2 FLOAT,
  CENTER_LAT FLOAT, CENTER_LON FLOAT, FOOTPRINT_WKT STRING
);
CREATE TABLE IF NOT EXISTS RESCUE_DRONES.APP.ROADS (
  AREA_ID STRING, ROAD_ID NUMBER, NAME STRING, WIDTH_M FLOAT, LENGTH_M FLOAT, PATH_WKT STRING
);
CREATE TABLE IF NOT EXISTS RESCUE_DRONES.APP.PLACES (
  AREA_ID STRING, PLACE_ID STRING, NAME STRING, KIND STRING, TYPE STRING,
  LAT FLOAT, LON FLOAT, CAPACITY NUMBER, CAPACITY_SOURCE STRING
);
-- With real geography columns, for Snowflake's geospatial functions and map charts.
CREATE OR REPLACE VIEW RESCUE_DRONES.APP.BUILDINGS_GEO AS
  SELECT *, TRY_TO_GEOGRAPHY(FOOTPRINT_WKT) AS FOOTPRINT FROM RESCUE_DRONES.APP.BUILDINGS;
CREATE OR REPLACE VIEW RESCUE_DRONES.APP.ROADS_GEO AS
  SELECT *, TRY_TO_GEOGRAPHY(PATH_WKT) AS PATH FROM RESCUE_DRONES.APP.ROADS;

-- The app's role: add and read results; read, add and replace maps; nothing else.
CREATE ROLE IF NOT EXISTS RESCUE_APP;
GRANT USAGE ON WAREHOUSE RESCUE_WH TO ROLE RESCUE_APP;
GRANT USAGE ON DATABASE RESCUE_DRONES TO ROLE RESCUE_APP;
GRANT USAGE ON SCHEMA RESCUE_DRONES.APP TO ROLE RESCUE_APP;
GRANT SELECT, INSERT ON TABLE RESCUE_DRONES.APP.MISSIONS TO ROLE RESCUE_APP;
GRANT SELECT, INSERT ON TABLE RESCUE_DRONES.APP.GAMES TO ROLE RESCUE_APP;
GRANT SELECT, INSERT, DELETE ON TABLE RESCUE_DRONES.APP.AREAS TO ROLE RESCUE_APP;
GRANT SELECT, INSERT, DELETE ON TABLE RESCUE_DRONES.APP.AREA_FILES TO ROLE RESCUE_APP;
GRANT SELECT, INSERT, DELETE ON TABLE RESCUE_DRONES.APP.BUILDINGS TO ROLE RESCUE_APP;
GRANT SELECT, INSERT, DELETE ON TABLE RESCUE_DRONES.APP.ROADS TO ROLE RESCUE_APP;
GRANT SELECT, INSERT, DELETE ON TABLE RESCUE_DRONES.APP.PLACES TO ROLE RESCUE_APP;
GRANT SELECT ON VIEW RESCUE_DRONES.APP.BUILDINGS_GEO TO ROLE RESCUE_APP;
GRANT SELECT ON VIEW RESCUE_DRONES.APP.ROADS_GEO TO ROLE RESCUE_APP;

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
