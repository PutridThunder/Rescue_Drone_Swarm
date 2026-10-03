// Graphics quality: phones and tablets get a lighter setup so the scene stays smooth.

export interface Quality {
  mobile: boolean;
  maxPixelRatio: number;
  antialias: boolean;
  shadowMapSize: number;
  softShadows: boolean;
  treeDensity: number; // share of park cells that get a tree
  droneCamByDefault: boolean;
}

const mobile =
  typeof window !== "undefined" && window.matchMedia("(max-width: 760px), (pointer: coarse) and (max-width: 1100px)").matches;

export const QUALITY: Quality = mobile
  ? { mobile, maxPixelRatio: 1.5, antialias: false, shadowMapSize: 2048, softShadows: false, treeDensity: 0.2, droneCamByDefault: false }
  : { mobile, maxPixelRatio: 2, antialias: true, shadowMapSize: 4096, softShadows: true, treeDensity: 0.45, droneCamByDefault: true };
