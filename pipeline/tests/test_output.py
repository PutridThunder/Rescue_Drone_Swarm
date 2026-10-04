"""Pipeline output must be valid JSON the app can read."""

import json

import numpy as np

from rescue_eo.output import grid_json


def test_grid_json_is_flat_row_major():
    grid = np.array([[0.0, 1.25, -0.001], [12.5, 3.0, 100.0]], dtype=np.float32)
    assert json.loads(grid_json(grid, 2)) == [0, 1.25, 0, 12.5, 3, 100]  # the app reads flat arrays


def test_grid_json_integers():
    grid = np.array([[10, 50], [80, 0]], dtype=np.uint8)
    assert json.loads(grid_json(grid, 0)) == [10, 50, 80, 0]
