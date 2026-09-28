-- GIS layer for the platform: PostGIS + (in P2) mirrored PES vector layers,
-- AOIs and jurisdictional geometries. Runs in the dev compose (postgis image)
-- and in the managed database; the core pipeline schema (001) does not need it.
CREATE EXTENSION IF NOT EXISTS postgis;
