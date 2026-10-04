"""ESA WorldCover 2021: 10 m global land cover from Sentinel-1 and Sentinel-2.

Open data on AWS (no account): https://registry.opendata.aws/esa-worldcover-vito/
"""

from __future__ import annotations

import numpy as np
from rasterio.enums import Resampling

from ..area import Area
from ..raster import degree_tiles, to_grid

SOURCE = {"name": "ESA WorldCover 10 m 2021 v200", "url": "https://esa-worldcover.org/", "license": "CC BY 4.0"}

# WorldCover class codes.
CLASSES = {
    10: "tree cover",
    20: "shrubland",
    30: "grassland",
    40: "cropland",
    50: "built-up",
    60: "bare / sparse vegetation",
    70: "snow and ice",
    80: "permanent water",
    90: "herbaceous wetland",
    95: "mangroves",
    100: "moss and lichen",
}
TREE, BUILT, WATER = 10, 50, 80


def tile_url(lat: int, lon: int) -> str:
    ns = f"{'N' if lat >= 0 else 'S'}{abs(lat):02d}"
    ew = f"{'E' if lon >= 0 else 'W'}{abs(lon):03d}"
    return f"/vsicurl/https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map/ESA_WorldCover_10m_2021_v200_{ns}{ew}_Map.tif"


def fetch(area: Area) -> np.ndarray:
    """WorldCover class code per grid cell (0 where no data)."""
    grid = to_grid(area, [tile_url(lat, lon) for lat, lon in degree_tiles(area, 3)], Resampling.mode, nodata=0)
    return grid.astype(np.uint8)
