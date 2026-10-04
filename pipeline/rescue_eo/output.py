"""Writing pipeline results next to an area's map data (public/areas/<id>/)."""

from __future__ import annotations

import json
from datetime import datetime, timezone

import numpy as np
from PIL import Image

from .area import Area


def grid_json(values: np.ndarray, decimals: int) -> str:
    """A grid as a JSON array with one row per line (diff-friendly, like world.json)."""
    rows = []
    for row in values:
        if decimals == 0:
            items = ",".join(str(int(v)) for v in row)
        else:
            items = ",".join(f"{v:.{decimals}f}".rstrip("0").rstrip(".") for v in row)
        rows.append(f"    {items}")
    return "[\n" + ",\n".join(rows) + "\n  ]"


def write_eo(area: Area, layers: dict[str, tuple[np.ndarray, int]], sources: list[dict], extra: dict) -> None:
    """eo.json: grid-aligned layers (name -> (array, decimals)) plus where each came from."""
    meta = {"area": area.id, "width": area.width, "height": area.height, "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"), "sources": sources, **extra}
    parts = [f'  "meta": {json.dumps(meta, indent=2).replace(chr(10), chr(10) + "  ")}']
    for name, (values, decimals) in layers.items():
        assert values.shape == area.shape, f"{name} has shape {values.shape}, expected {area.shape}"
        parts.append(f'  "{name}": {grid_json(values, decimals)}')
    (area.folder / "eo.json").write_text("{\n" + ",\n".join(parts) + "\n}\n")


def write_satellite(area: Area, rgb: np.ndarray) -> None:
    Image.fromarray(rgb, "RGB").save(area.folder / "satellite.jpg", quality=85, optimize=True)


def write_places(area: Area, places: list[dict], source: dict) -> None:
    bbox = [area.south, area.west, area.north, area.east]
    fetched = datetime.now(timezone.utc).isoformat(timespec="seconds")
    (area.folder / "places.json").write_text(json.dumps({"bbox": bbox, "fetchedAt": fetched, "source": source, "places": places}))
