/**
 * renderer.js — Orquesta el orden de dibujo y el culling.
 *
 * Tres arreglos importantes frente a la versión anterior:
 *  1. devicePixelRatio. El canvas se dimensionaba en píxeles CSS, así que en
 *     cualquier pantalla con escalado todo salía a media resolución.
 *  2. Culling por caja envolvente del CUERPO, no por la cabeza. Antes una
 *     serpiente larga desaparecía de golpe si su cabeza salía de pantalla.
 *  3. Nivel de detalle: las serpientes lejanas o pequeñas se dibujan con menos
 *     puntos y sin las pasadas caras.
 */

import { Background } from './background.js';
import { drawSnake, drawNameplate } from './snakeRenderer.js';
import { drawMinimap } from './minimap.js';
import { drawTouchControls } from './touchControls.js';
import { orbSprite, glowSprite, tinted, drawSprite } from './sprites.js';
import { rgba, clamp } from '../engine/math.js';
import { ORB_KIND } from '../entities/Orb.js';
import { rng } from '../engine/rng.js';

export class Renderer {
  constructor(canvas, settings) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.settings = settings;
    this.background = new Background();
    this.dpr = 1;
    this.cssW = 0;
    this.cssH = 0;
    this.time = 0;
    this.stats = { snakes: 0, orbs: 0 };
  }

  /**
   * Calidad efectiva. Con el ajuste en 'auto', el valor real lo decide el
   * vigilante de rendimiento de main.js y llega en `resolvedQuality`.
   */
  get quality() {
    const s = this.settings;
    return s.quality === 'auto' ? (s.resolvedQuality ?? 'high') : s.quality;
  }

  /**
   * Redimensiona respetando la densidad de píxeles del dispositivo.
   * En calidad baja se limita a 1× aunque la pantalla sea 3×: es la palanca de
   * rendimiento más eficaz que existe.
   */
  resize() {
    const q = this.quality;
    const maxDpr = q === 'low' ? 1 : q === 'medium' ? 1.5 : 2;
    const dpr = Math.min(window.devicePixelRatio || 1, maxDpr);
    const w = window.innerWidth;
    const h = window.innerHeight;

    this.cssW = w;
    this.cssH = h;
    this.dpr = dpr;

    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  draw(world, camera, theme, fx, alpha, dt, input = null) {
    const ctx = this.ctx;
    const q = this.quality;
    this.time += dt;

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.imageSmoothingEnabled = true;

    // ── Fondo ──
    this.background.ensure(ctx, theme);
    this.background.ensureLayers(theme, world.bounds, rng);
    this.background.draw(ctx, camera, theme, this.time, q);

    // ── Mundo ──
    ctx.save();
    camera.apply(ctx);

    const view = camera.viewRect(140);

    // El vacío va lo primero: la cámara ya no se ajusta a los bordes, así que
    // pegado al límite se ve fuera del mundo y hay que pintarlo como tal.
    this.background.drawVoid(ctx, world, theme, view);
    world.mode.drawUnder?.(ctx, world, theme, this.time, view);
    this.background.drawWorldEdge(ctx, world, theme, this.time);
    this._drawOrbs(ctx, world, view, theme, q);
    this._drawPickups(ctx, world, view, theme);
    world.mode.drawOver?.(ctx, world, theme, this.time, view);

    const visible = this._drawSnakes(ctx, world, view, theme, camera, q, fx);

    fx.drawWorld(ctx);
    ctx.restore();

    // ── Capa de pantalla ──
    for (const s of visible) {
      if (this.settings.showNames || s.isPlayer) {
        drawNameplate(ctx, s, camera, theme);
      }
    }

    fx.drawTexts(ctx, camera);
    drawMinimap(ctx, world, camera, theme, this.settings);
    world.mode.drawHudCanvas?.(ctx, world, camera, theme, this.settings);
    fx.drawOverlay(ctx, this.cssW, this.cssH);

    this._drawEdgeWarning(ctx, world, theme);

    // Ayuda visual del gesto táctil, lo último para que quede sobre todo.
    if (input) {
      const p = world.player;
      const headScreen = p && p.alive ? camera.worldToScreen(p.head.x, p.head.y) : null;
      drawTouchControls(ctx, input.overlay, theme, headScreen);
    }
  }

  _drawOrbs(ctx, world, view, theme, quality) {
    let drawn = 0;
    const boost = theme.orbs?.boost ?? 1;
    ctx.save();
    ctx.globalCompositeOperation = theme.orbs?.blend ?? 'lighter';

    world.orbs.forEach((o) => {
      if (o.x < view.minX || o.x > view.maxX || o.y < view.minY || o.y > view.maxY) return;
      drawn++;
      const pulse = 1 + Math.sin(o.pulse) * 0.16;
      const size = o.r * 5.4 * pulse * boost * (o.attractTo ? 1 + o.attractT * 0.5 : 1);

      if (o.kind === ORB_KIND.POISON) {
        drawSprite(ctx, tinted(glowSprite(64, 'soft'), '#7fc23b'), o.x, o.y, size, 0.85);
        return;
      }
      drawSprite(ctx, orbSprite(o.hue), o.x, o.y, size, o.kind === ORB_KIND.BOOST ? 0.8 : 1);
    });

    ctx.restore();
    this.stats.orbs = drawn;
  }

  _drawPickups(ctx, world, view, theme) {
    for (const p of world.pickups) {
      if (p.x < view.minX || p.x > view.maxX || p.y < view.minY || p.y > view.maxY) continue;
      const bob = Math.sin(p.bob) * 3;
      ctx.save();
      ctx.translate(p.x, p.y + bob);

      ctx.globalCompositeOperation = 'lighter';
      drawSprite(ctx, tinted(glowSprite(128, 'soft'), '#9fe8ff'), 0, 0, p.r * 5, 0.5);
      ctx.globalCompositeOperation = 'source-over';

      ctx.rotate(p.spin);
      ctx.fillStyle = 'rgba(12,20,28,0.9)';
      ctx.strokeStyle = '#9fe8ff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        const x = Math.cos(a) * p.r, y = Math.sin(a) * p.r;
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.rotate(-p.spin);

      ctx.fillStyle = '#e8fbff';
      ctx.font = '700 15px ui-sans-serif, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(p.power.icon, 0, 1);
      ctx.restore();
    }
  }

  _drawSnakes(ctx, world, view, theme, camera, quality, fx) {
    const visible = [];

    for (const s of world.snakes) {
      if (!s.alive) continue;
      // Culling por la caja del cuerpo completo, no por la cabeza.
      const b = s.bounds;
      if (b.maxX < view.minX || b.minX > view.maxX || b.maxY < view.minY || b.minY > view.maxY) continue;

      // Nivel de detalle: lejos de la cámara o muy delgada → versión barata.
      const dx = s.head.x - camera.x;
      const dy = s.head.y - camera.y;
      const far = (dx * dx + dy * dy) > 1400 * 1400;
      const lod = far ? 1 : 0;

      drawSnake(ctx, s, theme, { quality, lod, time: this.time });
      fx.trail(s, theme);
      visible.push(s);
    }

    // El jugador siempre se dibuja encima de los demás.
    const p = world.player;
    if (p && p.alive && visible.includes(p)) {
      drawSnake(ctx, p, theme, { quality, lod: 0, time: this.time });
    }

    this.stats.snakes = visible.length;
    return visible;
  }

  /** Viñeta de aviso al acercarse al borde letal. */
  _drawEdgeWarning(ctx, world, theme) {
    const p = world.player;
    if (!p || !p.alive) return;
    const warn = 220;
    const d = Math.min(
      p.head.x, p.head.y,
      world.bounds.w - p.head.x, world.bounds.h - p.head.y,
    );
    if (d > warn) return;

    const t = clamp(1 - d / warn, 0, 1);
    const w = this.cssW, h = this.cssH;
    const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.28, w / 2, h / 2, Math.max(w, h) * 0.7);
    g.addColorStop(0, rgba('#ff3b52', 0));
    g.addColorStop(1, rgba('#ff3b52', t * 0.55));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }

  /** Vista previa animada para el editor de serpiente. */
  static previewFrame(ctx, w, h, snake, theme, time) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = theme.background.base;
    ctx.fillRect(0, 0, w, h);
    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.scale(0.85, 0.85);
    ctx.translate(-snake.head.x, -snake.head.y);
    drawSnake(ctx, snake, theme, { quality: 'high', lod: 0, time });
    ctx.restore();
  }
}
