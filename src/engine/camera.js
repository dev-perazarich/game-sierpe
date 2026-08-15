/**
 * camera.js — Cámara con zoom por tamaño, lookahead y límites de mundo.
 *
 * La cámara anterior estaba clavada en la cabeza con zoom fijo, lo que hacía
 * imposible maniobrar siendo largo y dejaba ver el vacío fuera de los bordes.
 */

import { CFG } from '../config.js';
import { clamp, damp } from './math.js';

export class Camera {
  constructor() {
    this.x = 0;
    this.y = 0;
    this.zoom = 1;
    this.targetZoom = 1;
    this.viewW = 0;
    this.viewH = 0;
    this.shakeX = 0;
    this.shakeY = 0;
  }

  setViewport(w, h) {
    this.viewW = w;
    this.viewH = h;
  }

  snapTo(x, y) {
    this.x = x;
    this.y = y;
  }

  /**
   * @param {Snake|null} target  serpiente seguida
   * @param {object} world       para acotar a los bordes
   */
  /**
   * La cabeza va SIEMPRE clavada en el centro de la pantalla; lo que se mueve es
   * el mundo. Es la convención del género y hace el control mucho más legible:
   * sabes exactamente dónde está tu cabeza sin buscarla.
   *
   * Por eso aquí no hay ni lookahead ni ajuste a los bordes del mundo. Ambos
   * descentraban la cabeza —el segundo justo cuando más importa, pegado al
   * borde letal—. Que se vea el vacío más allá del límite es intencionado: el
   * renderizador lo pinta como tal.
   */
  update(dt, target, world, shake = { x: 0, y: 0 }) {
    const c = CFG.camera;

    if (target && target.alive) {
      const r = target.radius;
      const t = (r - CFG.snake.radiusMin) / (CFG.snake.radiusMax - CFG.snake.radiusMin);
      this.targetZoom = c.zoomMax + (c.zoomMin - c.zoomMax) * clamp(t, 0, 1);

      if (c.lookahead > 0) {
        // Desactivado por defecto. Se deja como palanca en config.js por si
        // algún día se quiere probar, no como comportamiento normal.
        const ahead = c.lookahead * (target.boosting ? 1.35 : 1);
        this.x = damp(this.x, target.head.x + Math.cos(target.angle) * ahead, c.smoothPos, dt);
        this.y = damp(this.y, target.head.y + Math.sin(target.angle) * ahead, c.smoothPos, dt);
      } else {
        this.x = target.head.x;
        this.y = target.head.y;
      }
    }

    this.zoom = damp(this.zoom, this.targetZoom, c.smoothZoom, dt);
    this.shakeX = shake.x;
    this.shakeY = shake.y;
  }

  /** Rectángulo visible en coordenadas de mundo, con margen para el culling. */
  viewRect(pad = 0) {
    const halfW = this.viewW / (2 * this.zoom) + pad;
    const halfH = this.viewH / (2 * this.zoom) + pad;
    return {
      minX: this.x - halfW, maxX: this.x + halfW,
      minY: this.y - halfH, maxY: this.y + halfH,
    };
  }

  screenToWorld(sx, sy) {
    return {
      x: (sx - this.viewW / 2) / this.zoom + this.x,
      y: (sy - this.viewH / 2) / this.zoom + this.y,
    };
  }

  worldToScreen(wx, wy) {
    return {
      x: (wx - this.x) * this.zoom + this.viewW / 2,
      y: (wy - this.y) * this.zoom + this.viewH / 2,
    };
  }

  /** Aplica la transformación al contexto. Todo lo que se dibuje después va en mundo. */
  apply(ctx) {
    ctx.translate(this.viewW / 2 + this.shakeX, this.viewH / 2 + this.shakeY);
    ctx.scale(this.zoom, this.zoom);
    ctx.translate(-this.x, -this.y);
  }
}
