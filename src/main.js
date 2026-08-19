/*
 * Sierpe — arcade de serpientes para navegador.
 * Copyright (C) 2026 dev-perazarich
 *
 * Este programa es software libre: puedes redistribuirlo y/o modificarlo bajo
 * los términos de la Licencia Pública General Affero de GNU, versión 3, tal
 * como la publica la Free Software Foundation.
 *
 * Se distribuye con la esperanza de que resulte útil, pero SIN NINGUNA GARANTÍA;
 * ni siquiera la garantía implícita de COMERCIABILIDAD o IDONEIDAD PARA UN FIN
 * DETERMINADO. Consulta la Licencia Pública General Affero de GNU para más
 * detalles: <https://www.gnu.org/licenses/>.
 */

/**
 * main.js — Punto de entrada. Une Vue (pantallas y HUD) con el motor (canvas).
 *
 * Responsabilidades:
 *   - ciclo de vida de una partida: crear, destruir, y sobre todo LIMPIAR
 *   - un único Loop, un único juego de listeners, cancelables siempre
 *   - degradación automática de calidad si el rendimiento cae
 *
 * La regla que evita la clase de fallo más común del código anterior: cada
 * `attach`, `bind` o `addEventListener` guarda su función de limpieza, y
 * `teardown()` las llama todas antes de empezar nada nuevo.
 */

import { BOT_NAMES } from './config.js';
import { Loop } from './engine/loop.js';
import { World } from './engine/world.js';
import { Camera } from './engine/camera.js';
import { Input } from './engine/input.js';
import { Renderer } from './render/renderer.js';
import { FX } from './render/fx.js';
import { Sfx } from './audio/sfx.js';
import { getTheme, buildSkin } from './themes/index.js';
import { instantiateMode, getMode, MODES } from './modes/index.js';
import { Profile } from './meta/profile.js';
import { sanitizeAppearance } from './meta/cosmetics.js';
import { evaluate } from './meta/achievements.js';
import { seedFromDate, dateKey } from './engine/rng.js';
import { GhostRecorder, GhostPlayer, validateGhost } from './meta/ghost.js';
import { Snake } from './entities/Snake.js';
import { registerServiceWorker, WakeLock, installPrompt, requestedMode } from './pwa.js';

import { MenuScreen } from './ui/MenuScreen.js';
import { HudOverlay } from './ui/HudOverlay.js';
import { PauseOverlay } from './ui/PauseOverlay.js';
import { GameOverScreen } from './ui/GameOverScreen.js';

const { createApp, ref, reactive, computed, onMounted, nextTick } = Vue;

const app = createApp({
  components: { MenuScreen, HudOverlay, PauseOverlay, GameOverScreen },

  // La plantilla raíz vive aquí y no en index.html a propósito: dentro del
  // documento la parsea el navegador antes que Vue, y eso rompe tanto los
  // nombres en PascalCase como el autocierre de componentes.
  template: `
    <MenuScreen
      v-if="screen === 'menu'"
      :profile="profile"
      :theme="theme"
      :fps="fps"
      :offline-ready="offlineReady"
      :can-install="canInstall"
      :update-ready="updateReady"
      @play="startGame"
      @setting="onSetting"
      @appearance="onAppearance"
      @name="onName"
      @mode="currentModeId = $event"
      @install="doInstall"
    />

    <div v-show="screen === 'game'" class="screen screen--game">
      <div class="game-canvas-wrap" :style="{ transform: 'rotate(' + gameRotation + 'deg)' }">
        <canvas ref="canvasEl" class="game-canvas" aria-label="Área de juego"></canvas>
      </div>

      <HudOverlay
        v-if="screen === 'game'"
        :snap="snap"
        :mode-id="currentModeId"
        :settings="profile.settings"
        :fps="fps"
        :compact="compactHud"
        :gyro-available="gyroAvailable"
        @pause="togglePause"
        @card="chooseCard"
        @manual-rotate="toggleManualRotation"
      />

      <PauseOverlay
        v-if="paused"
        :settings="profile.settings"
        :mode-name="modeName"
        :fps="fps"
        @resume="resume"
        @menu="goToMenu"
        @restart="restart"
        @setting="onSetting"
      />
    </div>

    <GameOverScreen
      v-if="screen === 'over' && results"
      :results="results"
      :records="records"
      :unlocks="unlocks"
      :mode-name="modeName"
      @retry="restart"
      @menu="goToMenu"
    />
  `,

  setup() {
    // ── Estado reactivo (solo lo que la interfaz necesita) ──
    const screen = ref('menu');
    const paused = ref(false);
    const fps = ref(60);
    const canvasEl = ref(null);
    const profile = reactive(new Profile());
    const snap = ref(emptySnapshot());
    const results = ref(null);
    const records = ref([]);
    const unlocks = ref({ achievements: [], cosmetics: [] });
    const currentModeId = ref(profile.lastMode);
    const compactHud = ref(window.innerWidth < 720);
    const updateReady = ref(null);      // función para aplicar la actualización
    const canInstall = ref(false);
    const offlineReady = ref(false);    // el service worker ya controla la página
    const gameRotation = ref(0);        // rotación del juego en grados (0 | 180)
    const gyroAvailable = ref(false);   // si el dispositivo reportó orientación

    const theme = computed(() => getTheme(profile.settings.theme));
    const modeName = computed(() => getMode(currentModeId.value).name);

    // ── Estado imperativo (fuera de Vue: cambia 60 veces por segundo) ──
    let renderer = null;
    let camera = null;
    let input = null;
    let fx = null;
    let sfx = null;
    let world = null;
    let loop = null;
    let cleanups = [];
    let qualityWatch = { low: 0, high: 0 };
    let audioUnlocked = false;
    let wakeLock = null;
    let promptInstall = () => {};
    let recorder = null;      // graba tu partida del desafío diario
    let ghost = null;         // reproduce la partida contra la que compites

    // ── Preparación inicial ────────────────────────────────
    sanitizeAppearance(profile.appearance, profile);
    if (!profile.appearance.name) {
      profile.appearance.name = suggestName();
      profile.saveAppearance();
    }
    // Respeta la preferencia del sistema la primera vez.
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      profile.settings.reducedMotion = true;
    }

    onMounted(() => {
      applyChrome();
      applyQuality();

      // ── Aplicación instalable ──
      registerServiceWorker({
        onUpdateReady: (apply) => {
          // Si estamos en el menú, aplicamos automáticamente para que la PWA
          // instalada no se quede con la versión antigua en caché. En partida
          // se pospone y se muestra el aviso en el HUD.
          if (screen.value === 'menu') {
            apply();
          } else {
            updateReady.value = apply;
          }
        },
      });

      // Cuando volvemos al menú y hay una actualización pendiente, la aplicamos
      // automáticamente (por ejemplo, al terminar una partida sin minimizar).
      Vue.watch(screen, (s) => {
        if (s === 'menu' && updateReady.value) {
          updateReady.value();
          updateReady.value = null;
        }
      });
      const install = installPrompt({ onAvailable: (v) => { canInstall.value = v; } });
      promptInstall = () => install.prompt();
      wakeLock = new WakeLock();

      // "Sin conexión listo" significa que un service worker ya controla esta
      // página, no que se haya registrado: hasta que toma el control, una
      // recarga sin red seguiría fallando.
      if (navigator.serviceWorker?.controller) offlineReady.value = true;
      navigator.serviceWorker?.ready.then(() => { offlineReady.value = true; }).catch(() => {});

      // Acceso directo del manifiesto: ?modo=royale entra directo a ese modo.
      const shortcut = requestedMode();
      if (shortcut && MODES[shortcut]) currentModeId.value = shortcut;

      /**
       * Pausa automática al salir de la aplicación.
       *
       * En móvil es imprescindible: al llegar una notificación o cambiar de app,
       * el juego seguía corriendo y volvías muerto. El acumulador del bucle ya
       * limita el salto de tiempo, pero eso evita el bloqueo, no la injusticia.
       */
      const onVisibility = () => {
        if (document.visibilityState === 'hidden' && screen.value === 'game' && !paused.value) {
          togglePause();
        }
      };
      document.addEventListener('visibilitychange', onVisibility);
      window.addEventListener('pagehide', onVisibility);

      const onResize = () => {
        compactHud.value = window.innerWidth < 720;
        renderer?.resize();
        camera?.setViewport(renderer.cssW, renderer.cssH);
      };
      window.addEventListener('resize', onResize);
      window.addEventListener('orientationchange', onResize);

      sfx = new Sfx(profile.settings);
      // El contexto de audio solo se puede crear tras un gesto del usuario.
      const unlockAudio = () => {
        if (audioUnlocked) return;
        audioUnlocked = sfx.init();
        if (audioUnlocked) {
          sfx.applyVolumes();
          sfx.setTheme(theme.value);
        }
      };
      window.addEventListener('pointerdown', unlockAudio, { once: false });
      window.addEventListener('keydown', unlockAudio, { once: false });
    });

    // ── Ciclo de vida de la partida ────────────────────────

    function teardown() {
      loop?.stop();
      for (const fn of cleanups) fn();
      cleanups = [];
      input?.detach();
      fx?.unbind();
      fx?.clear();
      sfx?.unbind();
      world?.destroy();
      world = null;
      loop = null;
      recorder = null;
      ghost = null;
    }

    async function startGame(modeId) {
      teardown();
      currentModeId.value = modeId;
      profile.setLastMode(modeId);
      screen.value = 'game';
      paused.value = false;
      results.value = null;

      await nextTick();

      const settings = profile.settings;
      settings.themeObj = theme.value;

      // ── Sistemas ──
      renderer = new Renderer(canvasEl.value, settings);
      renderer.resize();
      camera = new Camera();
      camera.setViewport(renderer.cssW, renderer.cssH);

      input = new Input(canvasEl.value);
      input.deadzone = settings.deadzone;
      input.toggleBoost = settings.toggleBoost;
      input.touchMode = settings.touchMode;
      input.setGyroEnabled(settings.gyroEnabled);
      input.setManualRotation(settings.manualRotation);
      input.onPause(() => togglePause());
      cleanups.push(input.attach());

      fx = new FX(settings);

      // ── Mundo ──
      const mode = instantiateMode(modeId);
      const seed = modeId === 'daily'
        ? seedFromDate()
        : (Math.random() * 0xffffffff) >>> 0;

      world = new World({
        mode,
        seed,
        settings,
        playerConfig: {
          name: profile.appearance.name?.trim() || 'Jugador',
          skin: buildSkin(profile.appearance, theme.value),
          raw: profile.appearance,
        },
      });
      world.fxRef = fx;

      cleanups.push(fx.bind(world, theme.value));
      if (audioUnlocked) {
        cleanups.push(sfx.bind(world, theme.value));
        sfx.setTheme(theme.value);
      }

      // Los bots deben enterarse de las muertes cercanas para carroñear.
      cleanups.push(world.events.on('death', ({ snake }) => {
        for (const b of world.bots) b.brain?.notifyDeathNear(snake.head.x, snake.head.y);
      }));

      // Clic derecho: marca de apoyo en Dominio.
      const onContext = (e) => {
        e.preventDefault();
        if (!world?.mode.markPing) return;
        const r = canvasEl.value.getBoundingClientRect();
        const p = camera.screenToWorld(e.clientX - r.left, e.clientY - r.top);
        world.mode.markPing(world, p.x, p.y);
        if (audioUnlocked) sfx.ui('click');
      };
      canvasEl.value.addEventListener('contextmenu', onContext);
      cleanups.push(() => canvasEl.value?.removeEventListener('contextmenu', onContext));

      // ── Fantasmas: solo en el desafío diario, que es el único modo con un
      // mundo idéntico para todos y por tanto el único donde comparar tiene
      // sentido. En los demás, competir contra una trayectoria de otro mapa no
      // significaría nada.
      recorder = null;
      ghost = null;
      if (modeId === 'daily') {
        const hoy = dateKey();
        recorder = new GhostRecorder({
          seed, dateKey: hoy, mode: modeId,
          name: world.playerConfig.name,
          skin: { ...profile.appearance },
        });

        const rival = profile.bestGhost(hoy);
        if (rival) {
          const check = validateGhost(rival);
          if (check.ok) {
            // El fantasma es una serpiente aparte que NO entra en world.snakes:
            // no colisiona, no come y los bots no lo ven. Si participara, el
            // mundo dejaría de ser el mismo para todos y el desafío diario
            // perdería su sentido.
            const fantasma = new Snake({
              x: 0, y: 0, angle: 0,
              skin: buildSkin(rival.skin, theme.value),
              name: rival.name || 'Tu récord',
              mass: 14,
            });
            ghost = new GhostPlayer(rival, fantasma);
          } else {
            console.warn('[fantasma] registro descartado:', check.razon);
          }
        }
      }

      if (world.player) camera.snapTo(world.player.head.x, world.player.head.y);

      // ── Bucle ──
      loop = new Loop({
        update: tick,
        render: draw,
        onStats: ({ fps: f, frameMs }) => {
          fps.value = f;
          autoQuality(frameMs);
        },
      });
      loop.start();
    }

    function tick(dt) {
      if (!world) return;
      // Hitstop: congela la simulación unas decenas de ms al matar. Es lo que
      // convierte una eliminación en un impacto en lugar de una desaparición.
      if (fx.hitstop > 0) { fx.update(dt); return; }

      // El mundo se congela mientras eliges carta en Nido.
      if (world.mode.awaitingChoice) { fx.update(dt); return; }

      const p = world.player;
      if (p?.alive) {
        // Capturamos la intención cruda del jugador (sin suavizar).
        input.aim(p, camera);
        // Suavizamos esa intención antes de aplicarla a la serpiente.
        input.update(dt);
        const aim = input.getTargetAngle();
        if (aim !== null) p.targetAngle = aim;
        p.boosting = input.wantsBoost() && p.canBoost();
      }

      world.tick(dt);
      fx.update(dt);
      sfx?.update(dt, world);

      recorder?.tick(dt, world.player);
      ghost?.update(dt);

      snap.value = world.snapshot();
      if (ghost) {
        snap.value.ghost = {
          name: ghost.record.name,
          score: ghost.score,
          finished: ghost.finished,
        };
      }
      if (world.over) finish();
    }

    function draw(alpha, rawDt) {
      if (!world || !renderer) return;
      gameRotation.value = input?.gameRotation || 0;
      gyroAvailable.value = input?.gyroAvailable || false;
      const target = world.mode.cameraTarget
        ? world.mode.cameraTarget(world)
        : world.player;

      // El zoom extra de la carta "Visión amplia" de Nido.
      const bonus = world.mode.cameraZoomBonus?.() ?? 0;
      camera.update(rawDt, target, world.bounds, fx.shake);
      if (bonus) camera.zoom = Math.max(0.4, camera.zoom - bonus);

      renderer.draw(world, camera, theme.value, fx, alpha, rawDt, input, ghost);
    }

    function finish() {
      if (screen.value !== 'game') return;
      loop.setPaused(true);
      results.value = world.results;

      // Guardar tu partida como fantasma, si mejora la anterior de hoy.
      if (recorder) {
        recorder.stop();
        const registro = recorder.build(world.results.score ?? 0);
        const check = registro ? validateGhost(registro) : { ok: false, razon: 'muy corta' };
        if (check.ok) {
          const mejorado = profile.saveGhost(registro.date, registro);
          results.value = { ...results.value, ghostSaved: mejorado, ghostRecord: registro };
        }
      }
      records.value = profile.recordGame({
        modeId: currentModeId.value,
        results: world.results,
        world,
      });
      unlocks.value = evaluate(profile);
      if (unlocks.value.achievements.length && audioUnlocked) sfx.ui('unlock');

      // Un momento para que el efecto de muerte se vea antes de la pantalla.
      setTimeout(() => {
        if (screen.value === 'game') screen.value = 'over';
      }, 900);
    }

    /**
     * Degradación automática. Mejor un juego fluido y algo menos bonito que uno
     * bonito a tirones. Sube de nuevo si el margen se mantiene amplio un rato.
     */
    function autoQuality(frameMs) {
      if (profile.settings.quality !== 'auto') return;
      const effective = profile.settings.effectiveQuality ?? 'high';

      if (frameMs > 21) {
        qualityWatch.low += 0.5;
        qualityWatch.high = 0;
      } else if (frameMs < 13) {
        qualityWatch.high += 0.5;
        qualityWatch.low = 0;
      } else {
        qualityWatch.low = Math.max(0, qualityWatch.low - 0.25);
        qualityWatch.high = Math.max(0, qualityWatch.high - 0.25);
      }

      const order = ['low', 'medium', 'high'];
      let idx = order.indexOf(effective);

      if (qualityWatch.low >= 2 && idx > 0) {
        idx--; qualityWatch.low = 0;
      } else if (qualityWatch.high >= 12 && idx < 2) {
        idx++; qualityWatch.high = 0;
      } else {
        return;
      }

      profile.settings.effectiveQuality = order[idx];
      applyQuality();
    }

    /**
     * Escribe la calidad efectiva en el propio objeto de ajustes, que es el que
     * comparten renderizador y FX. Sustituirles el objeto por una copia (lo
     * primero que probé) los desconectaba del resto de ajustes: dejaban de ver
     * los cambios de `reducedMotion`, `showNames` y demás.
     */
    function applyQuality() {
      const s = profile.settings;
      s.resolvedQuality = s.quality === 'auto' ? (s.effectiveQuality ?? 'high') : s.quality;
      if (renderer) {
        renderer.resize();
        camera?.setViewport(renderer.cssW, renderer.cssH);
      }
    }

    /** Los tokens CSS de la interfaz siguen al tema y al modo de contraste. */
    function applyChrome() {
      const root = document.documentElement;
      root.dataset.theme = profile.settings.theme;
      if (profile.settings.highContrast) root.dataset.contrast = 'high';
      else delete root.dataset.contrast;
      document.querySelector('meta[name="theme-color"]')
        ?.setAttribute('content', theme.value.background.base);
    }

    // ── Controles de pantalla ──────────────────────────────

    function togglePause() {
      if (screen.value !== 'game') return;
      paused.value = !paused.value;
      loop?.setPaused(paused.value);
      if (audioUnlocked) sfx.ui(paused.value ? 'back' : 'confirm');
    }

    function toggleManualRotation() {
      if (!input || screen.value !== 'game') return;
      input.toggleManualRotation();
      profile.settings.manualRotation = input.gameRotation;
      profile.saveSettings();
    }

    function resume() { paused.value = false; loop?.setPaused(false); }

    function restart() {
      paused.value = false;
      startGame(currentModeId.value);
    }

    function goToMenu() {
      teardown();
      paused.value = false;
      screen.value = 'menu';
      snap.value = emptySnapshot();
      if (audioUnlocked) sfx.ui('back');
    }

    function chooseCard(cardId) {
      world?.mode.chooseCard?.(world, cardId);
      if (audioUnlocked) sfx.ui('confirm');
    }

    // ── Ajustes ────────────────────────────────────────────

    function onSetting(key, value) {
      profile.settings[key] = value;
      profile.saveSettings();

      switch (key) {
        case 'theme':
          profile.settings.themeObj = theme.value;
          applyChrome();
          if (audioUnlocked) sfx.setTheme(theme.value);
          // El fondo cacheado se regenera solo al detectar el cambio de id de
          // tema; las pieles ya creadas conservan su color, que es lo correcto.
          break;
        case 'highContrast':
          applyChrome();
          break;
        case 'quality':
          if (value !== 'auto') profile.settings.effectiveQuality = value;
          applyQuality();
          break;
        case 'deadzone':      if (input) input.deadzone = value; break;
        case 'toggleBoost':   if (input) input.toggleBoost = value; break;
        case 'touchMode':     if (input) input.touchMode = value; break;
        case 'gyroEnabled':   if (input) input.setGyroEnabled(value); break;
        case 'manualRotation': if (input) input.setManualRotation(value); break;
        case 'masterVolume':
        case 'sfxVolume':
        case 'ambientVolume':
        case 'muted':
          sfx?.applyVolumes();
          if (key === 'muted') value ? sfx?.stopAmbient() : sfx?.setTheme(theme.value);
          break;
        case 'reducedMotion':
          if (value) fx?.clear();
          break;
      }
    }

    function onAppearance(next) {
      Object.assign(profile.appearance, next);
      profile.saveAppearance();
    }

    function onName(name) {
      profile.appearance.name = name;
      profile.saveAppearance();
    }

    // ── Exportado a la plantilla ───────────────────────────
    return {
      screen, paused, fps, canvasEl, profile, snap, results, records, unlocks,
      currentModeId, modeName, theme, compactHud,
      offlineReady, canInstall, updateReady,
      gameRotation, gyroAvailable,
      startGame, togglePause, resume, restart, goToMenu, chooseCard, toggleManualRotation,
      onSetting, onAppearance, onName,
      doInstall: () => promptInstall(),
    };
  },
});

/**
 * Sin paso de build no hay nada que avise en tiempo de compilación, así que un
 * error en cualquier punto del arranque dejaba la pantalla en negro sin más.
 * Aquí cualquier fallo acaba en la consola y, además, a la vista.
 */
app.config.errorHandler = (err, instance, info) => {
  console.error(`[Sierpe] Error en ${info}:`, err);
  showFatal(err);
};

try {
  app.mount('#app');
} catch (err) {
  console.error('[Sierpe] No se pudo montar la aplicación:', err);
  showFatal(err);
}

function showFatal(err) {
  const host = document.getElementById('app');
  if (!host || host.dataset.fatal) return;
  host.dataset.fatal = '1';
  host.innerHTML = `
    <div style="max-width:640px;margin:12vh auto;padding:24px;font-family:system-ui,sans-serif;
                border:1px solid #7a2432;border-radius:12px;background:#150a0e;color:#f3dede">
      <h1 style="margin:0 0 8px;font-size:20px">El juego no arrancó</h1>
      <p style="margin:0 0 12px;color:#c79ea3;font-size:14px">
        Abre la consola del navegador para ver la traza completa.
      </p>
      <pre style="margin:0;padding:12px;overflow-x:auto;border-radius:8px;background:#0c0507;
                  color:#ffb4a2;font-size:12px;white-space:pre-wrap">${String(err && err.stack || err)}</pre>
    </div>`;
}

// ── Utilidades ────────────────────────────────────────────

function emptySnapshot() {
  return {
    time: 0, alive: false, length: 0, kills: 0, mass: 0,
    boosting: false, canBoost: true, rank: 1, total: 0,
    leaderboard: [], killFeed: [], powers: [], mode: null, over: false,
  };
}

/** Nombre sugerido y editable, para que jugar no exija rellenar un formulario. */
function suggestName() {
  const base = BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)];
  return `${base}${Math.floor(Math.random() * 90) + 10}`;
}
