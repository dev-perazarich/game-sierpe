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
    this.lastSource = 'none';       // 'pointer' | 'keys' | 'touch'
    this.deadzone = 26;
    this.toggleBoost = false;       // ajuste: mantener frente a alternar

    /**
     * Esquema de control táctil. Los tres son patrones estándar de juego móvil
     * y cada uno gana en un contexto distinto:
     *
     *   'clasico'  — la serpiente va hacia donde tienes el dedo. Directo, pero
     *                el dedo tapa justo la zona a la que te diriges.
     *   'flecha'   — arrastras desde cualquier punto y la dirección es la del
     *                arrastre. Permite jugar con el dedo lejos de la cabeza.
     *   'joystick' — mando virtual flotante donde apoyas el dedo. El más
     *                preciso para giros sostenidos.
     */
    this.touchMode = 'flecha';

    // Estado del control táctil activo.
    this.touch = {
      active: false, id: -1,
      ox: 0, oy: 0,       // origen del gesto
      x: 0, y: 0,         // posición actual
      dx: 0, dy: 0,       // desplazamiento desde el origen
      angle: 0,
      magnitude: 0,       // 0..1, para dibujar el indicador
    };
    this.boostTouches = new Set();

    this._detachers = [];
    this._onPause = null;

    // ── Giroscopio / rotación del juego ──
    this.gyroEnabled = false;
    this.gameRotation = 0;          // 0 | 180 (grados)
    this.screenOrientation = 'landscape-primary';
    this.gyroAvailable = false;
  }

  /** Lo que necesita el renderizador para dibujar el indicador en pantalla. */
  get overlay() {
    if (!this.touch.active || this.lastSource !== 'touch') return null;
    return {
      mode: this.touchMode,
      ox: this.touch.ox, oy: this.touch.oy,
      x: this.touch.x, y: this.touch.y,
      angle: this.touch.angle,
      magnitude: this.touch.magnitude,
      boosting: this.boosting,
    };
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
    const onBlur = () => { this.keys.clear(); this.boosting = false; this.touch.active = false; };

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

    /* ── Táctil ──────────────────────────────────────────────
     * El PRIMER dedo dirige, con el esquema elegido en ajustes. Cualquier dedo
     * adicional acelera, se apoye donde se apoye. Repartir la pantalla en
     * mitades (lo que hacía antes) obligaba a usar las dos manos y dejaba media
     * pantalla inútil en vertical.
     */
    add(c, 'touchstart', (e) => {
      const r = c.getBoundingClientRect();
      for (const t of e.changedTouches) {
        if (!this.touch.active) {
          const x = t.clientX - r.left, y = t.clientY - r.top;
          this.touch.active = true;
          this.touch.id = t.identifier;
          this.touch.ox = x; this.touch.oy = y;
          this.touch.x = x;  this.touch.y = y;
          this.touch.dx = 0; this.touch.dy = 0;
          this.touch.magnitude = 0;
          this.lastSource = 'touch';
        } else {
          this.boostTouches.add(t.identifier);
          this._setBoost(true);
        }
      }
      e.preventDefault();
    }, { passive: false });

    add(c, 'touchmove', (e) => {
      const r = c.getBoundingClientRect();
      for (const t of e.changedTouches) {
        if (t.identifier !== this.touch.id) continue;
        this.touch.x = t.clientX - r.left;
        this.touch.y = t.clientY - r.top;
        this.touch.dx = this.touch.x - this.touch.ox;
        this.touch.dy = this.touch.y - this.touch.oy;
        this.lastSource = 'touch';
      }
      e.preventDefault();
    }, { passive: false });

    const endTouch = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === this.touch.id) {
          this.touch.active = false;
          this.touch.id = -1;
          this.touch.magnitude = 0;
        }
        if (this.boostTouches.delete(t.identifier) && this.boostTouches.size === 0) {
          this._setBoost(false);
        }
      }
    };
    add(c, 'touchend', endTouch, { passive: false });
    add(c, 'touchcancel', endTouch, { passive: false });

    // ── Giroscopio / orientación ──
    const onDeviceOrientation = () => {
      this.gyroAvailable = true;
    };
    add(window, 'deviceorientation', onDeviceOrientation);

    const updateOrientation = () => {
      this.screenOrientation = screen.orientation?.type
        || (window.matchMedia?.('(orientation: portrait)').matches ? 'portrait-primary' : 'landscape-primary');
      this._updateGameRotation();
    };
    add(window, 'orientationchange', updateOrientation);
    if (screen.orientation?.addEventListener) {
      add(screen.orientation, 'change', updateOrientation);
    }
    updateOrientation();

    return () => this.detach();
  }

  detach() {
    for (const fn of this._detachers) fn();
    this._detachers.length = 0;
    this.keys.clear();
    this.boosting = false;
    this.touch.active = false;
    this.touch.id = -1;
    this.boostTouches.clear();
  }

  _updateGameRotation() {
    if (this.gyroEnabled && this.gyroAvailable) {
      const isLandscape = this.screenOrientation.startsWith('landscape');
      this.gameRotation = isLandscape && this.screenOrientation === 'landscape-secondary' ? 180 : 0;
    }
    // Cuando el giroscopio está desactivado o no disponible, se preserva la
    // rotación manual del usuario sin modificarla automáticamente.
  }

  setGyroEnabled(val) {
    this.gyroEnabled = val;
    this._updateGameRotation();
  }

  setManualRotation(val) {
    this.gameRotation = val;
  }

  toggleManualRotation() {
    this.gameRotation = this.gameRotation === 0 ? 180 : 0;
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
    let angle = null;
    let fromKeys = false;

    if (this.lastSource === 'keys' && kv) {
      angle = Math.atan2(kv.y, kv.x);
      fromKeys = true;
    } else if (this.lastSource === 'touch' && this.touch.active) {
      angle = this._aimTouch(snake, camera);
    } else if (this.pointerActive) {
      const head = camera.worldToScreen(snake.head.x, snake.head.y);
      const dx = this.pointerX - head.x;
      const dy = this.pointerY - head.y;
      // Zona muerta: junto a la cabeza el ángulo es ruido puro y la serpiente vibra.
      if (Math.hypot(dx, dy) < this.deadzone) return null;
      angle = Math.atan2(dy, dx);
    }
    // Si solo hay teclas pulsadas aunque la última fuente fuera el ratón, obedécelas.
    if (kv && !fromKeys) angle = Math.atan2(kv.y, kv.x);

    // Rotación del juego: ajusta el ángulo según la orientación actual.
    // El teclado (WASD/flechas) es absoluto y no se gira.
    if (angle !== null && this.gameRotation && !fromKeys) {
      const rad = this.gameRotation * Math.PI / 180;
      angle += rad;
    }
    return angle;
  }

  /**
   * Traduce el gesto táctil a un ángulo según el esquema elegido.
   * Devuelve null si el gesto aún no expresa una intención clara, y entonces la
   * serpiente sigue recta en vez de dar un tirón.
   *
   * El ángulo devuelto está en espacio de pantalla; la rotación del juego
   * (orientación landscape invertida) la aplica `aim()`.
   */
  _aimTouch(snake, camera) {
    const t = this.touch;

    if (this.touchMode === 'clasico') {
      // La cabeza va hacia el punto donde está el dedo, igual que con el ratón.
      const head = camera.worldToScreen(snake.head.x, snake.head.y);
      const dx = t.x - head.x;
      const dy = t.y - head.y;
      const d = Math.hypot(dx, dy);
      t.magnitude = Math.min(1, d / 160);
      if (d < this.deadzone) return null;
      t.angle = Math.atan2(dy, dx);
      return t.angle;
    }

    // 'flecha' y 'joystick' comparten la matemática —dirección del arrastre
    // desde el origen del gesto— y se diferencian en cómo se dibujan y en el
    // recorrido necesario: el joystick tiene tope, la flecha no.
    const range = this.touchMode === 'joystick' ? 62 : 90;
    const mag = Math.hypot(t.dx, t.dy);
    t.magnitude = Math.min(1, mag / range);

    // Umbral pequeño: por debajo, el ángulo es ruido del pulso del dedo.
    if (mag < 10) return null;

    t.angle = Math.atan2(t.dy, t.dx);
    return t.angle;
  }

  wantsBoost() {
    return this.boosting;
  }
}

export { TAU };
