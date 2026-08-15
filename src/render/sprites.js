/**
 * sprites.js — Atlas pre-renderizados.
 *
 * El código anterior llamaba a createRadialGradient para cada orbe visible, para
 * uno de cada cuatro segmentos de cada serpiente y para el halo de cada cabeza,
 * sesenta veces por segundo. Con 600 orbes en pantalla eso era, de largo, el
 * mayor coste del fotograma.
 *
 * Aquí cada halo se dibuja UNA vez a un canvas pequeño y luego se pinta con
 * drawImage teñido. Mismo resultado visual, una fracción del coste.
 */

const cache = new Map();

function makeCanvas(size) {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  return c;
}

/** Halo radial blanco. Se tiñe al dibujar con globalCompositeOperation. */
export function glowSprite(size = 128, falloff = 'soft') {
  const key = `glow:${size}:${falloff}`;
  if (cache.has(key)) return cache.get(key);

  const c = makeCanvas(size);
  const ctx = c.getContext('2d');
  const r = size / 2;
  const g = ctx.createRadialGradient(r, r, 0, r, r, r);

  if (falloff === 'soft') {
    g.addColorStop(0.00, 'rgba(255,255,255,1)');
    g.addColorStop(0.28, 'rgba(255,255,255,0.55)');
    g.addColorStop(0.62, 'rgba(255,255,255,0.13)');
    g.addColorStop(1.00, 'rgba(255,255,255,0)');
  } else if (falloff === 'tight') {
    g.addColorStop(0.00, 'rgba(255,255,255,1)');
    g.addColorStop(0.42, 'rgba(255,255,255,0.85)');
    g.addColorStop(0.70, 'rgba(255,255,255,0.22)');
    g.addColorStop(1.00, 'rgba(255,255,255,0)');
  } else { // 'wide'
    g.addColorStop(0.00, 'rgba(255,255,255,0.7)');
    g.addColorStop(0.45, 'rgba(255,255,255,0.22)');
    g.addColorStop(1.00, 'rgba(255,255,255,0)');
  }

  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  cache.set(key, c);
  return c;
}

/** Orbe: núcleo brillante con halo, ya teñido por tono HSL. */
export function orbSprite(hue) {
  const bucket = Math.round(hue / 12) * 12;   // 30 variantes bastan
  const key = `orb:${bucket}`;
  if (cache.has(key)) return cache.get(key);

  const size = 64;
  const c = makeCanvas(size);
  const ctx = c.getContext('2d');
  const r = size / 2;

  const halo = ctx.createRadialGradient(r, r, 0, r, r, r);
  halo.addColorStop(0.00, `hsla(${bucket},100%,88%,1)`);
  halo.addColorStop(0.18, `hsla(${bucket},100%,72%,0.95)`);
  halo.addColorStop(0.42, `hsla(${bucket},100%,55%,0.42)`);
  halo.addColorStop(1.00, `hsla(${bucket},100%,45%,0)`);
  ctx.fillStyle = halo;
  ctx.fillRect(0, 0, size, size);

  // Núcleo compacto: da el punto de luz que hace que se lea como "comestible".
  ctx.globalCompositeOperation = 'lighter';
  const core = ctx.createRadialGradient(r, r, 0, r, r, r * 0.3);
  core.addColorStop(0, 'rgba(255,255,255,0.9)');
  core.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = core;
  ctx.fillRect(0, 0, size, size);

  cache.set(key, c);
  return c;
}

/** Partícula genérica, teñida en el momento de dibujar. */
export function particleSprite() {
  const key = 'particle';
  if (cache.has(key)) return cache.get(key);
  const size = 32;
  const c = makeCanvas(size);
  const ctx = c.getContext('2d');
  const r = size / 2;
  const g = ctx.createRadialGradient(r, r, 0, r, r, r);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.5, 'rgba(255,255,255,0.4)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  cache.set(key, c);
  return c;
}

/**
 * Dibuja un sprite teñido de un color arbitrario.
 * Usa una capa intermedia cacheada por color para no repetir el tintado.
 */
const tintCache = new Map();

export function tinted(sprite, color) {
  const key = `${sprite.width}:${color}`;
  let out = tintCache.get(key);
  if (out) return out;

  out = makeCanvas(sprite.width);
  const ctx = out.getContext('2d');
  ctx.drawImage(sprite, 0, 0);
  ctx.globalCompositeOperation = 'source-in';
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, out.width, out.height);

  // Tope de seguridad: si un modo genera muchos colores, se recicla la caché.
  if (tintCache.size > 220) tintCache.clear();
  tintCache.set(key, out);
  return out;
}

export function drawSprite(ctx, sprite, x, y, size, alpha = 1) {
  const h = size / 2;
  if (alpha !== 1) {
    const prev = ctx.globalAlpha;
    ctx.globalAlpha = prev * alpha;
    ctx.drawImage(sprite, x - h, y - h, size, size);
    ctx.globalAlpha = prev;
  } else {
    ctx.drawImage(sprite, x - h, y - h, size, size);
  }
}

export function clearSpriteCache() {
  cache.clear();
  tintCache.clear();
}
