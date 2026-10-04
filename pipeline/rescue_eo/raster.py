"""Resampling source rasters (any projection, one or many tiles) onto an area's grid."""

from __future__ import annotations

from typing import Iterable

import numpy as np
import rasterio
from rasterio.crs import CRS
from rasterio.enums import Resampling
from rasterio.warp import reproject

from .area import Area

WGS84 = CRS.from_epsg(4326)


def to_grid(area: Area, sources: Iterable[str], resampling: Resampling, band: int = 1, nodata: float = np.nan) -> np.ndarray:
    """Mosaic `sources` (paths or GDAL URLs) into a float32 array on the area grid.

    Later sources fill only cells earlier ones left empty, so overlapping tiles are fine.
    """
    out = np.full(area.shape, np.nan, dtype=np.float32)
    for src_path in sources:
        tile = np.full(area.shape, np.nan, dtype=np.float32)
        with rasterio.open(src_path) as src:
            reproject(
                source=rasterio.band(src, band),
                destination=tile,
                src_nodata=src.nodata,
                dst_transform=area.transform,
                dst_crs=WGS84,
                dst_nodata=np.nan,
                resampling=resampling,
            )
        fill = np.isnan(out) & ~np.isnan(tile)
        out[fill] = tile[fill]
    if not np.isnan(nodata):
        out[np.isnan(out)] = nodata
    return out


def degree_tiles(area: Area, size: int) -> list[tuple[int, int]]:
    """South-west corners (lat, lon) of the `size`-degree tiles the area touches."""
    lats = range(int(np.floor(area.south / size)) * size, int(np.floor(area.north / size)) * size + 1, size)
    lons = range(int(np.floor(area.west / size)) * size, int(np.floor(area.east / size)) * size + 1, size)
    return [(lat, lon) for lat in lats for lon in lons]
