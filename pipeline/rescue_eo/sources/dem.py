"""Copernicus DEM GLO-30: 30 m elevation from the TanDEM-X radar mission (ESA / Airbus).

Open data on AWS (no account): https://registry.opendata.aws/copernicus-dem/
It is a surface model: heights include buildings and trees, so the app combines it with land
cover before using it for the flood zone.
"""

from __future__ import annotations

import numpy as np
from rasterio.enums import Resampling

from ..area import Area
from ..raster import degree_tiles, to_grid

SOURCE = {"name": "Copernicus DEM GLO-30", "url": "https://registry.opendata.aws/copernicus-dem/", "license": "Copernicus DEM licence (free)"}


def tile_url(lat: int, lon: int) -> str:
    ns = f"{'N' if lat >= 0 else 'S'}{abs(lat):02d}_00"
    ew = f"{'E' if lon >= 0 else 'W'}{abs(lon):03d}_00"
    name = f"Copernicus_DSM_COG_10_{ns}_{ew}_DEM"
    return f"/vsicurl/https://copernicus-dem-30m.s3.amazonaws.com/{name}/{name}.tif"


def fetch(area: Area) -> np.ndarray:
    """Elevation in metres per grid cell."""
    return to_grid(area, [tile_url(lat, lon) for lat, lon in degree_tiles(area, 1)], Resampling.bilinear)
