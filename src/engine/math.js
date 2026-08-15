/** math.js — utilidades geométricas compartidas por motor, IA y render. */

export const TAU = Math.PI * 2;

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp  = (a, b, t) => a + (b - a) * t;

/** Suavizado exponencial independiente de fps. `rate` en unidades por segundo. */
export const damp = (a, b, rate, dt) => lerp(a, b, 1 - Math.exp(-rate * dt));

export function wrapAngle(a) {
  a = (a + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
}

export function angleDiff(from, to) {
  return wrapAngle(to - from);
}

/** Gira `from` hacia `to` como mucho `maxDelta` radianes. */
export function turnToward(from, to, maxDelta) {
  const d = angleDiff(from, to);
  return from + clamp(d, -maxDelta, maxDelta);
}

export const dist2 = (ax, ay, bx, by) => {
  const dx = ax - bx, dy = ay - by;
  return dx * dx + dy * dy;
};

export const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);

/**
 * Distancia al cuadrado de un punto al segmento AB.
 * Es el núcleo de la colisión con barrido: comprobamos el trazo recorrido en el
 * paso, no solo la posición final, para que a alta velocidad nada se atraviese.
 */
export function distToSegment2(px, py, ax, ay, bx, by) {
  const abx = bx - ax, aby = by - ay;
  const apx = px - ax, apy = py - ay;
  const denom = abx * abx + aby * aby;
  let t = denom > 1e-9 ? (apx * abx + apy * aby) / denom : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const cx = ax + abx * t - px;
  const cy = ay + aby * t - py;
  return cx * cx + cy * cy;
}

/** Punto de intercepción para el corte frontal de los bots. */
export function interceptPoint(px, py, tx, ty, tvx, tvy, speed) {
  const dx = tx - px, dy = ty - py;
  const d = Math.hypot(dx, dy);
  const tvLen = Math.hypot(tvx, tvy) || 1;
  // Tiempo aproximado hasta el encuentro; suficiente para una IA, sin resolver la cuadrática.
  const t = d / Math.max(1, speed + tvLen * 0.35);
  return { x: tx + tvx * t, y: ty + tvy * t };
}

export function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const v = h.length === 3
    ? h.split('').map((c) => c + c).join('')
    : h;
  const n = parseInt(v, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function rgba(hex, alpha) {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r},${g},${b},${alpha})`;
}

/** Mezcla dos colores hex. t=0 → a, t=1 → b. */
export function mixHex(a, b, t) {
  const ca = hexToRgb(a), cb = hexToRgb(b);
  const to = (n) => Math.round(clamp(n, 0, 255)).toString(16).padStart(2, '0');
  return `#${to(lerp(ca.r, cb.r, t))}${to(lerp(ca.g, cb.g, t))}${to(lerp(ca.b, cb.b, t))}`;
}
