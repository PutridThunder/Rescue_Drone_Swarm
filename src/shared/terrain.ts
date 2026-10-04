// Terrain codes stored per grid cell in world.json. Shared by the app and the data scripts
// (a plain object rather than a `const enum` so Node can run the scripts without a build step).
export const Terrain = {
  Water: 0,
  Ground: 1,
  Road: 2,
  Park: 3, // parks, forest, green space
  Building: 4,
} as const;

export type TerrainCode = (typeof Terrain)[keyof typeof Terrain];
