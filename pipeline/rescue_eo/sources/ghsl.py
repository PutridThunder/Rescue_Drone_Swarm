"""GHSL population grid (GHS-POP R2023A, epoch 2020): residents per ~100 m pixel, derived from
satellite-mapped built-up areas and census counts (European Commission JRC).

Open data (no account): https://human-settlement.emergency.copernicus.eu/
"""

from __future__ import annotations

import math
import urllib.request
import numpy as np
import rasterio
from rasterio.enums import Resampling
from rasterio.windows import from_bounds as window_from_bounds

from ..area import CACHE_DIR, Area
from ..raster import to_grid

SOURCE = {"name": "GHSL GHS-POP R2023A (2020)", "url": "https://human-settlement.emergency.copernicus.eu/", "license": "CC BY 4.0"}

PRODUCT = "GHS_POP_E2020_GLOBE_R2023A_4326_3ss"
BASE = f"https://jeodpp.jrc.ec.europa.eu/ftp/jrc-opendata/GHSL/GHS_POP_GLOBE_R2023A/{PRODUCT}/V1-0/tiles"
PIXEL_DEG = 3 / 3600  # 3 arc-seconds


# The tile grid is 10 x 10 degrees but offset slightly from round coordinates (read from the tiles).
TILE_ORIGIN_LAT = 89.09958333862926  # top edge of row 1
TILE_ORIGIN_LON = -180.00791612933938  # left edge of column 1


def tile_id(lat: float, lon: float) -> str:
    """Tile containing (lat, lon); rows count down from the north, columns east from 180 W."""
    return f"R{int((TILE_ORIGIN_LAT - lat) // 10) + 1}_C{int((lon - TILE_ORIGIN_LON) // 10) + 1}"


def download_tile(tid: str) -> str:
    """Download (once) and cache the zipped tile; returns the path of the GeoTIFF inside."""
    name = f"{PRODUCT}_V1_0_{tid}"
    zip_path = CACHE_DIR / f"{name}.zip"
    if not zip_path.exists():
        CACHE_DIR.mkdir(parents=True, exist_ok=True)
        print(f"    downloading GHSL tile {tid} (~45 MB, cached afterwards)")
        urllib.request.urlretrieve(f"{BASE}/{name}.zip", zip_path)
    return f"/vsizip/{zip_path}/{name}.tif"  # a GDAL path (keep as str: Path would drop the "//")


def fetch(area: Area) -> np.ndarray:
    """Residents per grid cell, preserving the GHSL total for the area."""
    tile = download_tile(tile_id((area.south + area.north) / 2, (area.west + area.east) / 2))

    # Resample people-per-pixel smoothly, then convert to people per (much smaller) cell.
    per_pixel = to_grid(area, [tile], Resampling.bilinear, nodata=0)
    lat = math.radians((area.south + area.north) / 2)
    pixel_area = (PIXEL_DEG * 111_320) ** 2 * math.cos(lat)
    grid = np.clip(per_pixel, 0, None) * (area.cell_size_m**2 / pixel_area)

    # Rescale so the grid holds exactly the people GHSL counts inside the bounding box.
    with rasterio.open(tile) as src:
        window = window_from_bounds(area.west, area.south, area.east, area.north, src.transform)
        source = src.read(1, window=window.round_offsets().round_lengths(), boundless=True, fill_value=0)
    source_total = float(np.clip(source, 0, None).sum())
    if grid.sum() > 0 and source_total > 0:
        grid *= source_total / grid.sum()
    return grid.astype(np.float32)
