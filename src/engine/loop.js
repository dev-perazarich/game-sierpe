/**
 * loop.js — Bucle de paso fijo con acumulador e interpolación de render.
 *
 * Este archivo es el que arregla el defecto número uno del juego anterior: allí
 * el movimiento sumaba píxeles por *fotograma*, así que a 144 Hz todo corría 2,4
 * veces más rápido que a 60. Aquí la simulación siempre avanza en pasos de
 * 16,6 ms, pase lo que pase con la tasa de refresco, y el render interpola.
 */

import { STEP, MAX_FRAME } from '../config.js';

export class Loop {
  constructor({ update, render, onStats }) {
    this.update = update;
    this.render = render;
    this.onStats = onStats;

    this.running = false;
    this.paused = false;
    this.rafId = 0;
    this.acc = 0;
    this.prev = 0;

    this.frameMs = 16.6;      // media móvil, para la degradación automática de calidad
    this.fps = 60;
    this._fpsAcc = 0;
    this._fpsFrames = 0;

    this._frame = this._frame.bind(this);
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.paused = false;
    this.acc = 0;
    this.prev = performance.now();
    this.rafId = requestAnimationFrame(this._frame);
  }

  stop() {
    this.running = false;
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = 0;
  }

  setPaused(paused) {
    if (this.paused === paused) return;
    this.paused = paused;
    // Al reanudar hay que reiniciar el reloj: si no, el acumulador se traga el
    // tiempo que el juego estuvo en pausa y la simulación da un salto.
    if (!paused) {
      this.prev = performance.now();
      this.acc = 0;
    }
  }

  _frame(now) {
    if (!this.running) return;
    this.rafId = requestAnimationFrame(this._frame);

    const rawDt = (now - this.prev) / 1000;
    this.prev = now;

    // Media móvil del coste de fotograma, que consume el gestor de calidad.
    this.frameMs += (rawDt * 1000 - this.frameMs) * 0.06;
    this._fpsAcc += rawDt;
    this._fpsFrames++;
    if (this._fpsAcc >= 0.5) {
      this.fps = Math.round(this._fpsFrames / this._fpsAcc);
      this._fpsAcc = 0;
      this._fpsFrames = 0;
      this.onStats?.({ fps: this.fps, frameMs: this.frameMs });
    }

    if (!this.paused) {
      this.acc += Math.min(rawDt, MAX_FRAME);
      let steps = 0;
      while (this.acc >= STEP && steps < 5) {
        this.update(STEP);
        this.acc -= STEP;
        steps++;
      }
      // Si el navegador se ha quedado muy atrás, se descarta el resto en lugar
      // de intentar recuperarlo y entrar en espiral.
      if (steps === 5) this.acc = 0;
    }

    this.render(this.acc / STEP, rawDt);
  }
}
