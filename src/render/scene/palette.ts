// Light, minimal map palette shared by the 3D scene and the HUD.

export const SCENE = {
  background: 0xeef1f5,
  ground: 0xebe9e3,
  park: 0xc9e2b8,
  water: 0x6f9fc8,
  tree: 0x6fae5a,
  road: 0xffffff,
  buildingUnsearched: 0xcdd3dc,
  buildingSearched: 0xffffff,
  buildingTall: 0xb3bfd0, // above flight altitude: drones must go around
  buildingHazard: 0xf1b3a6,
  fogUnknown: [0x6b7385, 0.5] as const,
  fogUnsearched: [0x8d97a8, 0.2] as const,
  frontier: [0x2f6fed, 0.38] as const,
  hazard: [0xe8503f, 0.26] as const,
  population: [0xf29d38, 0.55] as const,
  flood: [0x2f86d6, 0.7] as const,
  truckBody: 0xffffff,
  truckCab: 0x2b3445,
  truckAccent: 0xf08c2e,
  survivorFound: 0xf0445a,
  survivorHidden: 0x8e97a6,
  crowd: 0xf29d38,
  intel: 0x7c5cff, // crowds predicted by crowd intel
};

// Distinct, saturated-but-friendly drone colours that read on a light map.
export const DRONE_COLORS = [
  0x2f6fed, 0x10a37f, 0xe8590c, 0x9b51e0, 0xd6336c, 0x0c9fb8, 0x8a6d00,
  0x4c6ef5, 0x2b8a3e, 0xc2255c, 0x5f3dc4, 0x1098ad,
];

export function droneColor(id: number): number {
  return DRONE_COLORS[(id - 1) % DRONE_COLORS.length];
}

export function droneColorCss(id: number): string {
  return `#${droneColor(id).toString(16).padStart(6, "0")}`;
}

const hex = (c: number) => `#${c.toString(16).padStart(6, "0")}`;

/** Mix two colours (t = 0 -> a, 1 -> b). */
function mix(a: number, b: number, t: number): number {
  const ch = (shift: number) => Math.round(((a >> shift) & 255) * (1 - t) + ((b >> shift) & 255) * t);
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

/** Publish map colours as CSS variables so the legend always matches the 3D scene. */
export function applyPaletteToCss(root: HTMLElement = document.documentElement) {
  const vars: Record<string, number> = {
    "--map-unsearched": SCENE.buildingUnsearched,
    "--map-searched": SCENE.buildingSearched,
    "--map-frontier": mix(SCENE.ground, SCENE.frontier[0], 0.6),
    "--map-tall": SCENE.buildingTall,
    "--map-survivor": SCENE.survivorFound,
    "--map-truck": SCENE.truckAccent,
    "--intel": SCENE.intel,
  };
  for (const [name, color] of Object.entries(vars)) root.style.setProperty(name, hex(color));
}
