"""Earth-observation pipeline for Rescue Drone Swarm.

Reads open satellite data (Copernicus DEM, ESA WorldCover, GHSL population, Sentinel-2) and
OpenStreetMap gathering places, resamples everything onto an area's 10 m simulation grid, and
writes it next to the area's map data so the app can use it offline.
"""
