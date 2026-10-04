// Building look: the search colour (vertex colour) plus detail added in the shader, so the
// recolouring as the fleet searches stays cheap:
//   - a window grid on walls (3.4 m floors), faded out when too small to see (no shimmer)
//   - darker wall bases (cheap ambient occlusion where buildings meet the ground)
//   - walls a shade darker than roofs, and a small per-building tint variation
//
// Attributes: `facade` = (metres along the wall, metres above the base), or (-1, -1) on roofs;
// `tint` = per-building brightness factor (about 0.94..1.06).

import * as THREE from "three";

const FLOOR_M = 3.4;
const BAY_M = 3.0;

export function createBuildingMaterial(): THREE.MeshLambertMaterial {
  const material = new THREE.MeshLambertMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
         attribute vec2 facade;
         attribute float tint;
         varying vec2 vFacade;
         varying float vTint;`,
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
         vFacade = facade;
         vTint = tint;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
         varying vec2 vFacade;
         varying float vTint;`,
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
         diffuseColor.rgb *= vTint;
         if (vFacade.y < 0.0) {
           diffuseColor.rgb *= 1.05; // roof
         } else {
           diffuseColor.rgb *= 0.88 * mix(0.8, 1.0, clamp(vFacade.y / 7.0, 0.0, 1.0)); // walls a shade darker than roofs, darker still at the ground
           vec2 grid = vec2(vFacade.x / ${BAY_M.toFixed(1)}, vFacade.y / ${FLOOR_M.toFixed(1)});
           vec2 f = fract(grid);
           float pane = step(0.24, f.x) * step(f.x, 0.76) * step(0.32, f.y) * step(f.y, 0.78);
           float visible = clamp(1.6 - 2.2 * max(fwidth(grid.x), fwidth(grid.y)), 0.0, 1.0); // fade when tiny
           float aboveDoor = step(${FLOOR_M.toFixed(1)} * 0.6, vFacade.y);
           diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.6, 0.67, 0.78), pane * visible * aboveDoor * 0.7);
         }`,
      );
  };
  return material;
}
