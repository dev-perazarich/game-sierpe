/**
 * input.js — Entrada unificada de ratón, teclado y táctil.
 *
 * Dos defectos del código anterior se corrigen aquí:
 *  1. Los listeners se registraban de nuevo en cada partida sin quitar los viejos.
 *     Ahora `attach()` devuelve un `detach()` y `main.js` está obligado a llamarlo.
 *  2. El ratón sobrescribía el teclado en cada fotograma, dejando WASD muerto.
 *     Ahora gana la última fuente que se usó de verdad (`lastSource`).
 */

import { TAU } from './math.js';

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.pointerX = 0;
    this.pointerY = 0;
    this.pointerActive = false;
    this.boosting = false;
    this.lastSource = 'none';       // 'pointer' | 'keys'
    this.deadzone = 26;
    this.toggleBoost = false;       // ajuste: mantener frente a alternar

    // Joystick virtual (táctil)
    this.stick = { active: false, id: -1, ox: 0, oy: 0, x: 0, y: 0, dx: 0, dy: 0 };
    this.boostTouchId = -1;

    this._detachers = [];
    this._onPause = null;
  }

  onPause(fn) { this._onPause = fn; }

  attach() {
    this.detach();
    const c = this.canvas;
    const add = (target, type, fn, opts) => {
      target.addEventListener(type, fn, opts);
      this._detachers.push(() => target.removeEventListener(type, fn, opts));
    };

    // ── Teclado ──
    const onKeyDown = (e) => {
      if (e.code === 'Escape') { this._onPause?.(); return; }
      if (e.repeat) return;
      this.keys.add(e.code);
      if (this._isDirKey(e.code)) this.lastSource = 'keys';
      if (e.code === 'Space' || e.code === 'ShiftLeft') {
        this._setBoost(true);
        e.preventDefault();
      }
    };
    const onKeyUp = (e) => {
      this.keys.delete(e.code);
      if (e.code === 'Space' || e.code === 'ShiftLeft') this._setBoost(false);
    };
    const onBlur = () => { this.keys.clear(); this.boosting = false; this.stick.active = false; };

    add(window, 'keydown', onKeyDown);
    add(window, 'keyup', onKeyUp);
    add(window, 'blur', onBlur);

    // ── Ratón ──
    add(c, 'mousemove', (e) => {
      const r = c.getBoundingClientRect();
      this.pointerX = e.clientX - r.left;
      this.pointerY = e.clientY - r.top;
      this.pointerActive = true;
      this.lastSource = 'pointer';
    });
    add(c, 'mousedown', (e) => { if (e.button === 0) { this._setBoost(true); e.preventDefault(); } });
    add(window, 'mouseup', (e) => { if (e.button === 0) this._setBoost(false); });
    add(c, 'contextmenu', (e) => e.preventDefault());

    // ── Táctil: joystick flotante a la izquierda, turbo a la derecha ──
    add(c, 'touchstart', (e) => {
      for (const t of e.changedTouches) {
        const r = c.getBoundingClientRect();
        const x = t.clientX - r.left, y = t.clientY - r.top;
        if (x < r.width * 0.5 && !this.stick.active) {
          this.stick.active = true;
          this.stick.id = t.identifier;
          this.stick.ox = x; this.stick.oy = y;
          this.stick.x = x;  this.stick.y = y;
          this.stick.dx = 0; this.stick.dy = 0;
          this.lastSource = 'stick';
        } else if (this.boostTouchId === -1) {
          this.boostTouchId = t.identifier;
          this._setBoost(true);
        }
      }
      e.preventDefault();
    }, { passive: false });

    add(c, 'touchmove', (e) => {
      const r = c.getBoundingClientRect();
      for (const t of e.changedTouches) {
        if (t.identifier === this.stick.id) {
          this.stick.x = t.clientX - r.left;
          this.stick.y = t.clientY - r.top;
          this.stick.dx = this.stick.x - this.stick.ox;
          this.stick.dy = this.stick.y - this.stick.oy;
          this.lastSource = 'stick';
        }
      }
      e.preventDefault();
    }, { passive: false });

    const endTouch = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === this.stick.id) { this.stick.active = false; this.stick.id = -1; }
        if (t.identifier === this.boostTouchId) { this.boostTouchId = -1; this._setBoost(false); }
      }
    };
    add(c, 'touchend', endTouch);
    add(c, 'touchcancel', endTouch);

    return () => this.detach();
  }

  detach() {
    for (const fn of this._detachers) fn();
    this._detachers.length = 0;
    this.keys.clear();
    this.boosting = false;
    this.stick.active = false;
    this.boostTouchId = -1;
  }

  _setBoost(down) {
    if (this.toggleBoost) {
      if (down) this.boosting = !this.boosting;
    } else {
      this.boosting = down;
    }
  }

  _isDirKey(code) {
    return code === 'ArrowLeft' || code === 'ArrowRight' || code === 'ArrowUp' || code === 'ArrowDown'
        || code === 'KeyA' || code === 'KeyD' || code === 'KeyW' || code === 'KeyS';
  }

  _keyVector() {
    const k = this.keys;
    let x = 0, y = 0;
    if (k.has('ArrowLeft')  || k.has('KeyA')) x -= 1;
    if (k.has('ArrowRight') || k.has('KeyD')) x += 1;
    if (k.has('ArrowUp')    || k.has('KeyW')) y -= 1;
    if (k.has('ArrowDown')  || k.has('KeyS')) y += 1;
    return (x || y) ? { x, y } : null;
  }

  /**
   * Traduce la entrada a un ángulo objetivo para la serpiente.
   * Devuelve null si no hay intención nueva, y entonces la serpiente sigue recta.
   */
  aim(snake, camera) {
    const kv = this._keyVector();

    if (this.lastSource === 'keys' && kv) {
      return Math.atan2(kv.y, kv.x);
    }
    if (this.lastSource === 'stick' && this.stick.active) {
      const mag = Math.hypot(this.stick.dx, this.stick.dy);
      if (mag > 12) return Math.atan2(this.stick.dy, this.stick.dx);
      return null;
    }
    if (this.pointerActive) {
      const head = camera.worldToScreen(snake.head.x, snake.head.y);
      const dx = this.pointerX - head.x;
      const dy = this.pointerY - head.y;
      // Zona muerta: junto a la cabeza el ángulo es ruido puro y la serpiente vibra.
      if (Math.hypot(dx, dy) < this.deadzone) return null;
      return Math.atan2(dy, dx);
    }
    // Si solo hay teclas pulsadas aunque la última fuente fuera el ratón, obedécelas.
    if (kv) return Math.atan2(kv.y, kv.x);
    return null;
  }

  wantsBoost() {
    return this.boosting;
  }
}

export { TAU };
