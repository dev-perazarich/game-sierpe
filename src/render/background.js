/**
 * background.js — Fondo cacheado con parallax.
 *
 * El fondo anterior repintaba la rejilla entera, línea a línea, en cada
 * fotograma. Aquí se dibuja un mosaico una sola vez a un canvas fuera de
 * pantalla y se repite con un patrón; solo se regenera si cambia el tema o el
 * zoom de forma apreciable.
 */

import { rgba } from '../engine/math.js';

export class Background {
  constructor() {
    this.tile = null;
    this.pattern = null;
    this.tileSize = 0;
    this.themeId = null;
    this.layers = [];
    this._layerThemeId = null;
  }

  /** Regenera el mosaico si hace falta. */
  ensure(ctx, theme) {
    if (this.themeId === theme.id && this.pattern) return;
    this.themeId = theme.id;

    const bg = theme.background;
    const size = bg.gridSize ?? 88;
    this.tileSize = size;

    // El mosaico hexagonal necesita una celda no cuadrada para repetirse sin
    // costuras: ancho = √3·s, alto = 3·s (dos filas del panal).
    if (bg.hexes) {
      this.tile = makeHexTile(bg);
      this.tileSize = this.tile.width;
      this.pattern = ctx.createPattern(this.tile, 'repeat');
      return;
    }

    const c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    const g = c.getContext('2d');

    g.fillStyle = bg.base;
    g.fillRect(0, 0, size, size);

    if (bg.gridAlpha > 0) {
      g.strokeStyle = rgba(bg.gridColor, bg.gridAlpha);
      g.lineWidth = bg.gridWidth ?? 1;
      g.beginPath();
      g.moveTo(0.5, 0); g.lineTo(0.5, size);
      g.moveTo(0, 0.5); g.lineTo(size, 0.5);
      g.stroke();
    }

    if (bg.dots) {
      g.fillStyle = rgba(bg.dotColor ?? bg.gridColor, bg.dotAlpha ?? 0.15);
      g.beginPath();
      g.arc(size / 2, size / 2, bg.dotSize ?? 1.6, 0, Math.PI * 2);
      g.fill();
    }

    this.tile = c;
    this.pattern = ctx.createPattern(c, 'repeat');
  }

  /** Motas de parallax, generadas una vez por tema. */
  ensureLayers(theme, world, rng) {
    if (this._layerThemeId === theme.id && this.layers.length) return;
    this._layerThemeId = theme.id;
    this.layers = [];

    const cfg = theme.background.parallax;
    if (!cfg || !cfg.length) return;

    for (const layer of cfg) {
      const motes = [];
      for (let i = 0; i < layer.count; i++) {
        motes.push({
          x: rng.range(0, world.w),
          y: rng.range(0, world.h),
          r: rng.range(layer.rMin, layer.rMax),
          a: rng.range(layer.aMin, layer.aMax),
          drift: rng.range(-6, 6),
          phase: rng.range(0, Math.PI * 2),
        });
      }
      this.layers.push({ ...layer, motes });
    }
  }

  /**
   * Dibuja el fondo. Se llama con el contexto SIN la transformación de cámara,
   * y aplica el desplazamiento del patrón a mano: así el mosaico no se reescala
   * y el coste es un solo fillRect.
   */
  draw(ctx, camera, theme, time, quality) {
    const bg = theme.background;
    const w = camera.viewW;
    const h = camera.viewH;

    ctx.fillStyle = bg.base;
    ctx.fillRect(0, 0, w, h);

    if (bg.gradient) {
      const g = ctx.createLinearGradient(0, 0, 0, h);
      for (const stop of bg.gradient) g.addColorStop(stop[0], stop[1]);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }

    if (this.pattern) {
      const z = camera.zoom;
      ctx.save();
      ctx.translate(w / 2 + camera.shakeX, h / 2 + camera.shakeY);
      ctx.scale(z, z);
      ctx.translate(-camera.x, -camera.y);
      const rect = camera.viewRect(this.tileSize * 2);
      ctx.fillStyle = this.pattern;
      ctx.fillRect(rect.minX, rect.minY, rect.maxX - rect.minX, rect.maxY - rect.minY);
      ctx.restore();
    }

    if (quality !== 'low') this._drawParallax(ctx, camera, theme, time);
    if (bg.vignette > 0) this._drawVignette(ctx, w, h, bg.vignette, bg.vignetteColor ?? '#000000');
  }

  _drawParallax(ctx, camera, theme, time) {
    if (!this.layers.length) return;
    const w = camera.viewW, h = camera.viewH;

    ctx.save();
    ctx.globalCompositeOperation = theme.background.parallaxBlend ?? 'lighter';

    for (const layer of this.layers) {
      const z = camera.zoom * layer.depth;
      const ox = w / 2 - camera.x * z;
      const oy = h / 2 - camera.y * z;

      for (const m of layer.motes) {
        const drift = Math.sin(time * 0.35 + m.phase) * m.drift;
        const sx = m.x * z + ox + drift;
        const sy = m.y * z + oy + Math.cos(time * 0.28 + m.phase) * m.drift * 0.6;
        if (sx < -20 || sy < -20 || sx > w + 20 || sy > h + 20) continue;

        ctx.globalAlpha = m.a * (0.7 + Math.sin(time * 1.4 + m.phase) * 0.3);
        ctx.fillStyle = layer.color;
        ctx.beginPath();
        ctx.arc(sx, sy, m.r * z, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  /**
   * Todo lo que queda fuera de los límites del mundo se pinta como vacío.
   *
   * Hace falta desde que la cámara va clavada en la cabeza y ya no se ajusta a
   * los bordes: al acercarte al límite ves más allá, y sin esto lo que se veía
   * era el mosaico repitiéndose hasta el infinito, como si el mapa siguiera.
   */
  drawVoid(ctx, world, theme, view) {
    const bg = theme.background;
    const w = world.bounds.w, h = world.bounds.h;

    ctx.save();
    ctx.beginPath();
    ctx.rect(view.minX - 40, view.minY - 40,
             (view.maxX - view.minX) + 80, (view.maxY - view.minY) + 80);
    ctx.rect(0, 0, w, h);
    ctx.fillStyle = bg.void ?? 'rgba(0,0,0,0.72)';
    ctx.fill('evenodd');
    ctx.restore();
  }

  _drawVignette(ctx, w, h, strength, color) {
    const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.32, w / 2, h / 2, Math.max(w, h) * 0.78);
    g.addColorStop(0, rgba(color, 0));
    g.addColorStop(1, rgba(color, strength));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }

  /** Muro del mundo. El borde mata, así que tiene que leerse como amenaza. */
  drawWorldEdge(ctx, world, theme, time) {
    const bg = theme.background;
    const w = world.bounds.w, h = world.bounds.h;
    const color = bg.edgeColor ?? '#ff4d5e';
    const pulse = 0.6 + Math.sin(time * 2.2) * 0.18;

    ctx.save();

    // Resplandor hacia dentro: avisa antes de que sea tarde.
    ctx.strokeStyle = rgba(color, 0.10 * pulse);
    ctx.lineWidth = 150;
    ctx.strokeRect(75, 75, w - 150, h - 150);

    ctx.strokeStyle = rgba(color, 0.22 * pulse);
    ctx.lineWidth = 46;
    ctx.strokeRect(23, 23, w - 46, h - 46);

    // Línea dura: aquí se muere.
    ctx.strokeStyle = rgba(color, 0.95);
    ctx.lineWidth = 7;
    ctx.strokeRect(0, 0, w, h);

    ctx.restore();
  }
}

/**
 * Mosaico de panal. Celdas ligeramente más claras que el fondo, separadas por
 * el propio fondo: da textura y sentido de escala al desplazarse, que es justo
 * lo que le falta a una rejilla cuadrada.
 */
function makeHexTile(bg) {
  const s = bg.hexSize ?? 34;          // radio del hexágono
  const w = Math.sqrt(3) * s;
  const tileW = Math.round(w);
  const tileH = Math.round(3 * s);

  const c = document.createElement('canvas');
  c.width = tileW;
  c.height = tileH;
  const g = c.getContext('2d');

  g.fillStyle = bg.base;
  g.fillRect(0, 0, tileW, tileH);

  const scaleX = tileW / w;
  const scaleY = tileH / (3 * s);
  g.scale(scaleX, scaleY);

  g.fillStyle = bg.hexFill ?? 'rgba(255,255,255,0.028)';
  g.strokeStyle = bg.hexStroke ?? 'rgba(255,255,255,0.02)';
  g.lineWidth = bg.hexLine ?? 1;

  const inset = bg.hexGap ?? 1.6;
  // Se dibuja con desbordamiento en las cuatro direcciones para que los
  // hexágonos cortados por el borde encajen con los de la copia contigua.
  for (let row = -2; row <= 3; row++) {
    for (let col = -1; col <= 1; col++) {
      const x = col * w + ((row & 1) ? w / 2 : 0);
      const y = row * 1.5 * s;
      hexPath(g, x, y, s - inset);
      g.fill();
      if (bg.hexStroke) g.stroke();
    }
  }

  return c;
}

function hexPath(g, cx, cy, r) {
  g.beginPath();
  for (let i = 0; i < 6; i++) {
    // Hexágono de punta arriba: -90° de partida.
    const a = (Math.PI / 3) * i - Math.PI / 2;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    i === 0 ? g.moveTo(x, y) : g.lineTo(x, y);
  }
  g.closePath();
}
