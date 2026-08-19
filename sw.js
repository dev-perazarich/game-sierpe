/*
 * Sierpe — service worker.
 * Copyright (C) 2026 dev-perazarich · GNU AGPL v3.0
 *
 * Estrategia: precarga del conjunto completo en la instalación, y luego
 * caché primero para todo lo del propio origen. El juego no pide datos a
 * ningún servidor —el audio está sintetizado, las fuentes son del sistema y
 * el progreso vive en localStorage—, así que una vez instalado funciona
 * entero sin conexión.
 *
 * Al añadir o quitar un módulo hay que actualizar PRECACHE y subir CACHE_VERSION.
 * Es el precio de no tener paso de compilación; a cambio, la red de seguridad de
 * más abajo cachea igualmente cualquier archivo que falte en la lista.
 *
 * IMPORTANTE: este archivo debe servirse con `Cache-Control: no-cache` o
 * `no-store` para que el navegador detecte los cambios entre versiones.
 * Si se cachea, la PWA no se actualiza aunque aquí se modifique.
 */

const CACHE_VERSION = 'v1.0.0';
const CACHE_NAME = `sierpe-${CACHE_VERSION}`;

const PRECACHE = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/screens.css',
  'css/tokens.css',
  'css/ui.css',
  'vendor/vue.global.prod.js',
  'icons/apple-touch-icon.png',
  'icons/icon-192.png',
  'icons/icon-512-maskable.png',
  'icons/icon-512.png',
  'src/ai/behaviors.js',
  'src/ai/BotBrain.js',
  'src/ai/director.js',
  'src/ai/perception.js',
  'src/ai/personalities.js',
  'src/ai/steering.js',
  'src/audio/sfx.js',
  'src/audio/synth.js',
  'src/config.js',
  'src/engine/camera.js',
  'src/engine/collision.js',
  'src/engine/events.js',
  'src/engine/input.js',
  'src/engine/loop.js',
  'src/engine/math.js',
  'src/engine/rng.js',
  'src/engine/spatial.js',
  'src/engine/world.js',
  'src/entities/Orb.js',
  'src/entities/Pickup.js',
  'src/entities/Snake.js',
  'src/main.js',
  'src/pwa.js',
  'src/meta/achievements.js',
  'src/meta/cosmetics.js',
  'src/meta/ghost.js',
  'src/meta/profile.js',
  'src/meta/storage.js',
  'src/modes/classic.js',
  'src/modes/daily.js',
  'src/modes/domination.js',
  'src/modes/frenzy.js',
  'src/modes/index.js',
  'src/modes/Mode.js',
  'src/modes/nest.js',
  'src/modes/royale.js',
  'src/render/background.js',
  'src/render/fx.js',
  'src/render/minimap.js',
  'src/render/renderer.js',
  'src/render/snakeRenderer.js',
  'src/render/sprites.js',
  'src/render/touchControls.js',
  'src/themes/abyss.js',
  'src/themes/cartoon.js',
  'src/themes/index.js',
  'src/themes/neon.js',
  'src/themes/panal.js',
  'src/ui/GameOverScreen.js',
  'src/ui/HudOverlay.js',
  'src/ui/Leaderboard.js',
  'src/ui/MenuScreen.js',
  'src/ui/ModeDialog.js',
  'src/ui/PauseOverlay.js',
  'src/ui/SettingsPanel.js',
  'src/ui/SnakeEditor.js',
  'src/ui/TouchControlPicker.js',
];

// ── Instalación ────────────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    // Uno a uno en vez de cache.addAll(): así un archivo que falle no tumba la
    // instalación entera y deja al usuario sin service worker.
    const results = await Promise.allSettled(
      PRECACHE.map((url) => cache.add(new Request(url, { cache: 'reload' }))),
    );
    const failed = results
      .map((r, i) => (r.status === 'rejected' ? PRECACHE[i] : null))
      .filter(Boolean);
    if (failed.length) {
      console.warn('[sw] no se pudieron precargar:', failed);
    }
  })());
});

// ── Activación ─────────────────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // Fuera las cachés de versiones anteriores.
    const names = await caches.keys();
    await Promise.all(
      names
        .filter((n) => n.startsWith('sierpe-') && n !== CACHE_NAME)
        .map((n) => caches.delete(n)),
    );

    // Navegación precargada: acelera el primer arranque cuando sí hay red.
    if (self.registration.navigationPreload) {
      await self.registration.navigationPreload.enable();
    }

    await self.clients.claim();
  })());
});

// ── Peticiones ─────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const req = event.request;

  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;   // nada externo que servir

  // Navegación: se sirve el index cacheado. Es una aplicación de una sola
  // página, así que cualquier ruta debe resolver al mismo documento.
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const preloaded = await event.preloadResponse;
        if (preloaded) {
          putInCache(req, preloaded.clone());
          return preloaded;
        }
        const fresh = await fetch(req);
        putInCache(req, fresh.clone());
        return fresh;
      } catch {
        const cache = await caches.open(CACHE_NAME);
        return (await cache.match(req))
            ?? (await cache.match('index.html'))
            ?? (await cache.match('./'))
            ?? new Response('Sin conexión y sin copia en caché.', {
                 status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' },
               });
      }
    })());
    return;
  }

  // Todo lo demás: caché primero. El contenido es estático y versionado por
  // CACHE_VERSION, así que servir de caché es correcto y además instantáneo.
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const hit = await cache.match(req);
    if (hit) return hit;

    try {
      const fresh = await fetch(req);
      // Red de seguridad: cachea lo que no estuviera en PRECACHE (por ejemplo un
      // módulo nuevo que se olvidó añadir a la lista).
      if (fresh.ok && fresh.type === 'basic') cache.put(req, fresh.clone());
      return fresh;
    } catch {
      return new Response('', { status: 504, statusText: 'Sin conexión' });
    }
  })());
});

function putInCache(req, res) {
  if (!res.ok) return;
  caches.open(CACHE_NAME).then((c) => c.put(req, res)).catch(() => {});
}

// ── Actualización bajo demanda ─────────────────────────────
// La página avisa cuando el jugador acepta actualizar. No se hace skipWaiting
// automático: cambiar el código en mitad de una partida la rompería.
self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting();
});
