import { Color } from 'three';

export const DRONE_COLORS = [
  '#ff4f6d', '#ffb02e', '#ffe14d', '#5df08a', '#38d6ff', '#a98bff',
  '#ff7ad1', '#20e3b2', '#6f9dff', '#ff8a4c', '#c8f560', '#f05bff',
];

export function droneColorHex(id: number): string {
  return DRONE_COLORS[((id % DRONE_COLORS.length) + DRONE_COLORS.length) % DRONE_COLORS.length];
}

export function droneColor(id: number): Color {
  return new Color(droneColorHex(id));
}

export const COLORS = {
  water: new Color('#4aa8e8'),
  waterDeep: new Color('#2f7fc4'),
  ground: new Color('#d8d0c2'),
  road: new Color('#f4efe4'),
  park: new Color('#9ed27f'),
  forest: new Color('#5fa86a'),
  fog: new Color('#1a2240'),
  fogHigh: new Color('#2a3459'),
  frontier: new Color('#3ff6ff'),
  hazard: new Color('#ff4a1c'),
  survivor: new Color('#ff2fa0'),
  survivorGlow: new Color('#ffe14d'),
  disabled: new Color('#6b7280'),
};

export const BUILDING_COLORS = [
  '#f6d5c4', '#f7e6bd', '#d6e2f6', '#e7d3f2', '#fbdcdc', '#d2efe3', '#efede6', '#fde9cf',
].map((c) => new Color(c));

/** Heat ramp for the population overlay: t in 0..1. */
const HEAT_STOPS = ['#3b1c6e', '#c2266b', '#ff7a1a', '#ffe45c'].map((c) => new Color(c));

export function heatColor(t: number, out: Color): Color {
  const stops = HEAT_STOPS;
  const f = Math.min(0.999, Math.max(0, t)) * (stops.length - 1);
  const i = Math.floor(f);
  return out.copy(stops[i]).lerp(stops[i + 1], f - i);
}
