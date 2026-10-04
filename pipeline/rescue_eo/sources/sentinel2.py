"""Sentinel-2 L2A imagery (ESA Copernicus): a recent, nearly cloud-free 10 m scene, used for a
true-colour "satellite view" and a water index (NDWI = (green - NIR) / (green + NIR)).

Searched through the Earth Search STAC API on AWS (no account): https://earth-search.aws.element84.com/v1
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from pystac_client import Client
from rasterio.enums import Resampling

from ..area import Area
from ..raster import to_grid

SOURCE = {"name": "Sentinel-2 L2A", "url": "https://registry.opendata.aws/sentinel-2-l2a-cogs/", "license": "Copernicus Sentinel data (free, open)"}

STAC_URL = "https://earth-search.aws.element84.com/v1"
MAX_CLOUD = 10  # percent
SEARCH_LIMIT = 100
MAX_EMPTY_SHARE = 0.005  # reject scenes with more than 0.5% empty pixels over the area
STRETCH_LOW, STRETCH_HIGH = 1, 99  # percentiles for the display stretch
DISPLAY_GAMMA = 0.85


@dataclass
class Scene:
    id: str
    date: str
    cloud_cover: float
    visual: str  # true-colour COG
    green: str
    nir: str


def candidate_scenes(area: Area, date_range: str) -> list[Scene]:
    """Low-cloud scenes whose tile overlaps the area, clearest first."""
    client = Client.open(STAC_URL)
    search = client.search(
        collections=["sentinel-2-l2a"],
        bbox=[area.west, area.south, area.east, area.north],
        datetime=date_range,
        query={"eo:cloud_cover": {"lt": MAX_CLOUD}},
        max_items=SEARCH_LIMIT,
    )
    items = sorted(search.items(), key=lambda it: it.properties.get("eo:cloud_cover", 100))
    href = lambda item, key: f"/vsicurl/{item.assets[key].href}"  # noqa: E731
    return [
        Scene(it.id, it.datetime.date().isoformat(), it.properties["eo:cloud_cover"], href(it, "visual"), href(it, "green"), href(it, "nir"))
        for it in items
    ]


def find_scene(area: Area, date_range: str, max_tries: int = 12) -> tuple[Scene, np.ndarray]:
    """The clearest scene that covers the whole area (tiles at a swath edge are partly empty).

    Returns the scene and its raw true-colour image on the area grid.
    """
    for scene in candidate_scenes(area, date_range)[:max_tries]:
        rgb = read_rgb(area, scene)
        empty = float((rgb.sum(axis=2) == 0).mean())
        if empty < MAX_EMPTY_SHARE:
            return scene, rgb
    raise RuntimeError(f"no Sentinel-2 scene under {MAX_CLOUD}% cloud fully covers {area.id} in {date_range}")


def read_rgb(area: Area, scene: Scene) -> np.ndarray:
    bands = [to_grid(area, [scene.visual], Resampling.bilinear, band=b, nodata=0) for b in (1, 2, 3)]
    return np.dstack(bands)


def true_colour(area: Area, scene: Scene) -> np.ndarray:
    """RGB image (height x width x 3, uint8) with a gentle contrast stretch for display."""
    rgb = read_rgb(area, scene)
    lo, hi = np.percentile(rgb[rgb.sum(axis=2) > 0], [STRETCH_LOW, STRETCH_HIGH])
    stretched = np.clip((rgb - lo) / max(hi - lo, 1), 0, 1) ** DISPLAY_GAMMA
    return (stretched * 255).astype(np.uint8)


def ndwi(area: Area, scene: Scene) -> np.ndarray:
    """Normalised difference water index per cell, -1..1 (water is above ~0.2)."""
    green = to_grid(area, [scene.green], Resampling.bilinear, nodata=0)
    nir = to_grid(area, [scene.nir], Resampling.bilinear, nodata=0)
    total = green + nir
    return np.where(total > 0, (green - nir) / np.maximum(total, 1e-6), 0).astype(np.float32)
