// Pointy-top axial hex grid math.
// Edge / neighbor order is CLOCKWISE starting at East:
//   0:E  1:SE  2:SW  3:W  4:NW  5:NE
// The opposite of edge i is edge (i+3)%6, so when tile A's edge i touches
// neighbor B, it meets B's edge (i+3)%6.

export const SQRT3 = Math.sqrt(3);

export const DIRS = [
  { q: +1, r: 0 },  // 0 E
  { q: 0, r: +1 },  // 1 SE
  { q: -1, r: +1 }, // 2 SW
  { q: -1, r: 0 },  // 3 W
  { q: 0, r: -1 },  // 4 NW
  { q: +1, r: -1 }, // 5 NE
];

export const key = (q, r) => `${q},${r}`;

export function neighbor(q, r, i) {
  const d = DIRS[i];
  return { q: q + d.q, r: r + d.r };
}

export function opposite(i) {
  return (i + 3) % 6;
}

// Axial -> pixel (relative to layout origin), given hex size (corner radius).
export function hexToPixel(q, r, size) {
  return {
    x: size * SQRT3 * (q + r / 2),
    y: size * 1.5 * r,
  };
}

// Pixel (relative to origin) -> nearest axial hex, via cube rounding.
export function pixelToHex(px, py, size) {
  const q = (SQRT3 / 3 * px - 1 / 3 * py) / size;
  const r = (2 / 3 * py) / size;
  return axialRound(q, r);
}

function axialRound(q, r) {
  let x = q;
  let z = r;
  let y = -x - z;
  let rx = Math.round(x);
  let ry = Math.round(y);
  let rz = Math.round(z);
  const dx = Math.abs(rx - x);
  const dy = Math.abs(ry - y);
  const dz = Math.abs(rz - z);
  if (dx > dy && dx > dz) rx = -ry - rz;
  else if (dy > dz) ry = -rx - rz;
  else rz = -rx - ry;
  return { q: rx, r: rz };
}

// Corner offsets for a pointy-top hex (corner k between edge k-1 and edge k).
// Corner k sits at angle 60*k - 30 degrees. Edge i is centered at 60*i and
// spans corner i -> corner i+1, so a wedge from center through corners
// [i, i+1] visually represents edge i.
export function hexCorner(cx, cy, size, k) {
  const ang = (Math.PI / 180) * (60 * k - 30);
  return { x: cx + size * Math.cos(ang), y: cy + size * Math.sin(ang) };
}
