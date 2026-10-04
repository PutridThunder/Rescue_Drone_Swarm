// The world divided into fixed map parts of about 2.5 x 2.1 km (one playable area each).
// Every city search snaps to the same grid, so a part built once (and stored in Snowflake) is
// reused by everyone, and a big city like Tokyo is simply many parts side by side.
// Shared by the browser (area picker) and the server (building parts on demand).

export const PART_W_KM = 2.5;
export const PART_H_KM = 2.1;
const LAT_STEP = PART_H_KM / 111.2; // degrees of latitude per part row
/** Largest grid of parts offered for one search (keeps huge results like "Tokyo" manageable). */
export const MAX_PARTS_SIDE = 8;

/** Degrees of longitude per part in a row (parts stay ~2.5 km wide at every latitude). */
function lonStep(row) {
  const midLat = (row + 0.5) * LAT_STEP;
  return PART_W_KM / (111.32 * Math.max(0.05, Math.cos((midLat * Math.PI) / 180)));
}

const signed = (n) => (n < 0 ? `m${-n}` : String(n));

/** The part containing a point. */
export function partAt(lat, lon) {
  const row = Math.floor(lat / LAT_STEP);
  const col = Math.floor(lon / lonStep(row));
  return part(row, col);
}

/** A part by grid position: id (safe for URLs and Snowflake), bbox [S, W, N, E] and centre. */
export function part(row, col) {
  const step = lonStep(row);
  const south = row * LAT_STEP;
  const west = col * step;
  const bbox = [south, west, south + LAT_STEP, west + step].map((v) => Math.round(v * 1e6) / 1e6);
  return { id: `p-${signed(row)}-${signed(col)}`, row, col, bbox, center: [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2] };
}

/** Parse a part id back into its part (null if it isn't one). */
export function partFromId(id) {
  const m = /^p-(m?\d{1,7})-(m?\d{1,7})$/.exec(id);
  if (!m) return null;
  const num = (s) => (s.startsWith("m") ? -Number(s.slice(1)) : Number(s));
  return part(num(m[1]), num(m[2]));
}

/**
 * The parts covering a place's bounding box [S, W, N, E], at most MAX_PARTS_SIDE per side
 * (centred on `center` when the box is bigger), as rows from north to south.
 */
export function partsCovering(bbox, center) {
  const [S, W, N, E] = bbox;
  const [clat, clon] = center;
  let r0 = Math.floor(S / LAT_STEP);
  let r1 = Math.floor(N / LAT_STEP);
  const crow = Math.floor(clat / LAT_STEP);
  if (r1 - r0 + 1 > MAX_PARTS_SIDE) {
    r0 = crow - Math.floor(MAX_PARTS_SIDE / 2) + 1;
    r1 = r0 + MAX_PARTS_SIDE - 1;
  }
  const rows = [];
  for (let row = r1; row >= r0; row--) {
    const step = lonStep(row);
    let c0 = Math.floor(W / step);
    let c1 = Math.floor(E / step);
    if (c1 - c0 + 1 > MAX_PARTS_SIDE) {
      const ccol = Math.floor(clon / step);
      c0 = ccol - Math.floor(MAX_PARTS_SIDE / 2) + 1;
      c1 = c0 + MAX_PARTS_SIDE - 1;
    }
    const cols = [];
    for (let col = c0; col <= c1; col++) cols.push(part(row, col));
    rows.push(cols);
  }
  return rows;
}
