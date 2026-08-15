/*
 * Sierpe — soporte de aplicación instalable.
 * Copyright (C) 2026 dev-perazarich · GNU AGPL v3.0
 */

/**
 * pwa.js — Registro del service worker, aviso de actualización, bloqueo de
 * suspensión de pantalla y detección de instalación.
 *
 * Todo lo de aquí es opcional por diseño: si el navegador no soporta algo, se
 * omite en silencio y el juego funciona igual. Nada de esto debe poder impedir
 * que la partida arranque.
 */

/** Registra el service worker y avisa cuando hay una versión nueva esperando. */
export function registerServiceWorker({ onUpdateReady } = {}) {
  if (!('serviceWorker' in navigator)) return null;
  // Los service workers exigen origen seguro. En local, localhost cuenta.
  if (location.protocol !== 'https:' && location.hostname !== 'localhost'
      && location.hostname !== '127.0.0.1') {
    return null;
  }

  let registration = null;

  window.addEventListener('load', async () => {
    try {
      registration = await navigator.serviceWorker.register('sw.js', { scope: './' });

      // Ya había una versión nueva esperando de una visita anterior.
      if (registration.waiting && navigator.serviceWorker.controller) {
        onUpdateReady?.(() => activateUpdate(registration));
      }

      registration.addEventListener('updatefound', () => {
        const nuevo = registration.installing;
        if (!nuevo) return;
        nuevo.addEventListener('statechange', () => {
          // `controller` distingue una actualización de la primera instalación.
          if (nuevo.state === 'installed' && navigator.serviceWorker.controller) {
            onUpdateReady?.(() => activateUpdate(registration));
          }
        });
      });
    } catch (err) {
      console.warn('[pwa] no se pudo registrar el service worker:', err);
    }
  });

  // Cuando el service worker nuevo toma el control, se recarga una sola vez.
  let recargando = false;
  navigator.serviceWorker.addEventListener?.('controllerchange', () => {
    if (recargando) return;
    recargando = true;
    location.reload();
  });

  return () => registration;
}

function activateUpdate(registration) {
  registration.waiting?.postMessage('skip-waiting');
}

/**
 * Impide que la pantalla se apague durante la partida.
 *
 * En móvil es un problema real: se juega con el dedo en movimiento continuo
 * pero sin tocar, y el sistema apaga la pantalla a mitad de partida. El bloqueo
 * se suelta al salir del juego para no gastar batería de más.
 */
export class WakeLock {
  constructor() {
    this.sentinel = null;
    this.wanted = false;
    this._onVisible = this._onVisible.bind(this);
    document.addEventListener('visibilitychange', this._onVisible);
  }

  get supported() {
    return 'wakeLock' in navigator;
  }

  async acquire() {
    this.wanted = true;
    if (!this.supported || this.sentinel) return;
    try {
      this.sentinel = await navigator.wakeLock.request('screen');
      this.sentinel.addEventListener('release', () => { this.sentinel = null; });
    } catch {
      // Suele fallar si la pestaña no está visible o el sistema lo deniega.
      this.sentinel = null;
    }
  }

  async release() {
    this.wanted = false;
    try { await this.sentinel?.release(); } catch { /* ya liberado */ }
    this.sentinel = null;
  }

  /** El sistema suelta el bloqueo al ocultar la pestaña: hay que recuperarlo. */
  _onVisible() {
    if (document.visibilityState === 'visible' && this.wanted && !this.sentinel) {
      this.acquire();
    }
  }

  destroy() {
    document.removeEventListener('visibilitychange', this._onVisible);
    this.release();
  }
}

/**
 * Captura el evento de instalación para poder ofrecer un botón propio.
 * Devuelve un objeto con `available` y `prompt()`.
 */
export function installPrompt({ onAvailable } = {}) {
  let deferred = null;

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();           // sin esto, el navegador muestra su propio aviso
    deferred = e;
    onAvailable?.(true);
  });

  window.addEventListener('appinstalled', () => {
    deferred = null;
    onAvailable?.(false);
  });

  return {
    get available() { return deferred !== null; },
    async prompt() {
      if (!deferred) return 'unavailable';
      deferred.prompt();
      const { outcome } = await deferred.userChoice;
      deferred = null;
      onAvailable?.(false);
      return outcome;             // 'accepted' | 'dismissed'
    },
  };
}

/** ¿Se está ejecutando como aplicación instalada y no en pestaña? */
export function isStandalone() {
  return window.matchMedia?.('(display-mode: standalone)').matches
      || window.matchMedia?.('(display-mode: fullscreen)').matches
      || window.navigator.standalone === true;   // iOS
}

/** Modo de juego pedido desde un acceso directo del manifiesto (?modo=royale). */
export function requestedMode() {
  try {
    const m = new URLSearchParams(location.search).get('modo');
    return m && /^[a-z]+$/.test(m) ? m : null;
  } catch {
    return null;
  }
}
