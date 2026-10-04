-- Rescue Drone Swarm: the whole world's map data in your Snowflake (step 3, after setup.sql
-- and token.sql). Uses Overture Maps (built from OpenStreetMap plus other open data:
-- ~2.3 billion buildings, all roads, water, land use), shared for free by CARTO.
--
-- 1) In Snowsight: Data Products > Marketplace, search "Overture Maps", and click "Get" on
--    these CARTO listings, keeping the default database names:
--      Overture Maps - Buildings       -> database OVERTURE_MAPS__BUILDINGS
--      Overture Maps - Transportation  -> database OVERTURE_MAPS__TRANSPORTATION
--      Overture Maps - Base            -> database OVERTURE_MAPS__BASE
--    Nothing is copied: the data stays shared and costs no storage.
-- 2) Run this file as ACCOUNTADMIN ("Run all").
-- 3) The last query counts North Vancouver's buildings. A number in the thousands means it
--    works. If a view fails, send the error: column names may differ slightly per listing.
--
-- The app reads only these four views, so any naming difference is fixed here, in one place.

USE ROLE ACCOUNTADMIN;

GRANT IMPORTED PRIVILEGES ON DATABASE OVERTURE_MAPS__BUILDINGS TO ROLE RESCUE_APP;
GRANT IMPORTED PRIVILEGES ON DATABASE OVERTURE_MAPS__TRANSPORTATION TO ROLE RESCUE_APP;
GRANT IMPORTED PRIVILEGES ON DATABASE OVERTURE_MAPS__BASE TO ROLE RESCUE_APP;

-- Each view: the geometry (GEOGRAPHY), what it is (KIND / CLASS), and its bounding box as
-- numbers, so a 2.5 km map part only reads the small slice of the world it needs.
CREATE OR REPLACE VIEW RESCUE_DRONES.APP.OV_BUILDINGS AS
  SELECT GEOMETRY, HEIGHT, NUM_FLOORS AS LEVELS, COALESCE(CLASS, SUBTYPE) AS KIND,
         BBOX:xmin::FLOAT AS XMIN, BBOX:xmax::FLOAT AS XMAX, BBOX:ymin::FLOAT AS YMIN, BBOX:ymax::FLOAT AS YMAX
  FROM OVERTURE_MAPS__BUILDINGS.CARTO.BUILDING;

CREATE OR REPLACE VIEW RESCUE_DRONES.APP.OV_ROADS AS
  SELECT GEOMETRY, CLASS, NAMES:primary::STRING AS NAME,
         BBOX:xmin::FLOAT AS XMIN, BBOX:xmax::FLOAT AS XMAX, BBOX:ymin::FLOAT AS YMIN, BBOX:ymax::FLOAT AS YMAX
  FROM OVERTURE_MAPS__TRANSPORTATION.CARTO.SEGMENT
  WHERE SUBTYPE = 'road';

CREATE OR REPLACE VIEW RESCUE_DRONES.APP.OV_WATER AS
  SELECT GEOMETRY, COALESCE(SUBTYPE, CLASS) AS KIND,
         BBOX:xmin::FLOAT AS XMIN, BBOX:xmax::FLOAT AS XMAX, BBOX:ymin::FLOAT AS YMIN, BBOX:ymax::FLOAT AS YMAX
  FROM OVERTURE_MAPS__BASE.CARTO.WATER;

CREATE OR REPLACE VIEW RESCUE_DRONES.APP.OV_LAND AS
  SELECT GEOMETRY, COALESCE(SUBTYPE, CLASS) AS KIND,
         BBOX:xmin::FLOAT AS XMIN, BBOX:xmax::FLOAT AS XMAX, BBOX:ymin::FLOAT AS YMIN, BBOX:ymax::FLOAT AS YMAX
  FROM OVERTURE_MAPS__BASE.CARTO.LAND_USE
  UNION ALL
  SELECT GEOMETRY, COALESCE(SUBTYPE, CLASS) AS KIND,
         BBOX:xmin::FLOAT, BBOX:xmax::FLOAT, BBOX:ymin::FLOAT, BBOX:ymax::FLOAT
  FROM OVERTURE_MAPS__BASE.CARTO.LAND;

GRANT SELECT ON VIEW RESCUE_DRONES.APP.OV_BUILDINGS TO ROLE RESCUE_APP;
GRANT SELECT ON VIEW RESCUE_DRONES.APP.OV_ROADS TO ROLE RESCUE_APP;
GRANT SELECT ON VIEW RESCUE_DRONES.APP.OV_WATER TO ROLE RESCUE_APP;
GRANT SELECT ON VIEW RESCUE_DRONES.APP.OV_LAND TO ROLE RESCUE_APP;

-- Check: buildings in Lonsdale, North Vancouver.
USE WAREHOUSE RESCUE_WH;
SELECT COUNT(*) AS LONSDALE_BUILDINGS FROM RESCUE_DRONES.APP.OV_BUILDINGS
WHERE XMIN <= -123.06 AND XMAX >= -123.095 AND YMIN <= 49.327 AND YMAX >= 49.308;
