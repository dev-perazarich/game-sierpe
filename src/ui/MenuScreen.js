/*
 * Sierpe — pantalla de inicio.
 * Copyright (C) 2026 dev-perazarich · GNU AGPL v3.0
 */

/**
 * MenuScreen.js — Lo primero que se ve.
 *
 * Principio de diseño: el arranque pide lo mínimo para empezar a jugar —un
 * nombre y un botón— y nada más. Todo lo demás (elegir modo, dificultad,
 * apariencia, ajustes, estadísticas) está a un toque de distancia pero no
 * ocupa la primera pantalla.
 *
 * La versión anterior mostraba de golpe las seis tarjetas de modo, cuatro
 * pestañas y el campo de nombre. En un móvil eso obligaba a desplazarse antes
 * de poder jugar.
 */

import { ModeDialog } from './ModeDialog.js';
import { SnakeEditor } from './SnakeEditor.js';
import { SettingsPanel } from './SettingsPanel.js';
import { progressList } from '../meta/achievements.js';
import { getMode } from '../modes/index.js';

const { ref, computed } = Vue;

export const MenuScreen = {
  components: { ModeDialog, SnakeEditor, SettingsPanel },
  props: {
    profile: { type: Object, required: true },
    theme: { type: Object, required: true },
    fps: { type: Number, default: 0 },
    offlineReady: { type: Boolean, default: false },
    canInstall: { type: Boolean, default: false },
    updateReady: { type: Function, default: null },
  },
  emits: ['play', 'setting', 'appearance', 'name', 'mode', 'install'],

  setup(props, { emit }) {
    // 'inicio' es la pantalla desnuda; el resto son paneles a los que se entra
    // y de los que se vuelve.
    const panel = ref('inicio');
    const dialogOpen = ref(false);
    const mode = ref(props.profile.lastMode);

    const achievements = computed(() => progressList(props.profile));
    const done = computed(() => achievements.value.filter((a) => a.done).length);
    const stats = computed(() => props.profile.summary());
    const modeName = computed(() => getMode(mode.value).name);

    function start(id) {
      dialogOpen.value = false;
      emit('mode', id);
      emit('play', id);
    }

    // Si hay una actualización pendiente al entrar al menú, la aplicamos
    // automáticamente tras un breve instante para que la PWA instalada no se
    // quede con la versión antigua en caché.
    Vue.onMounted(() => {
      if (props.updateReady) {
        setTimeout(() => {
          try { props.updateReady(); } catch {}
        }, 1500);
      }
    });

    return {
      panel, dialogOpen, mode, modeName,
      achievements, done, stats, start,
    };
  },

  template: `
    <div class="screen screen--menu">
      <div class="menu" :class="{ 'is-home': panel === 'inicio' }">

        <!-- ══ INICIO ══ -->
        <template v-if="panel === 'inicio'">
          <div v-if="updateReady" class="update-banner">
            <span>Hay una nueva versión disponible</span>
            <button class="btn btn--primary" type="button" @click="updateReady()">
              Actualizar ahora
            </button>
          </div>

          <h1 class="logo">
            <span class="logo__mark" aria-hidden="true">
              <svg viewBox="0 0 48 48" width="52" height="52">
                <path d="M9 37c0-9 9-11 15-11s11-2 11-8-5-8-9-6"
                      fill="none" stroke="currentColor" stroke-width="7"
                      stroke-linecap="round" stroke-linejoin="round" />
                <circle cx="36" cy="10" r="2.8" fill="currentColor" />
              </svg>
            </span>
            <span class="logo__text">
              <span class="logo__name">Sierpe</span>
              <span class="logo__sub">arcade de serpientes</span>
            </span>
          </h1>

          <div class="home">
            <label class="field">
              <span class="field__label">Tu nombre</span>
              <input
                type="text" maxlength="18" class="input input--big"
                :value="profile.appearance.name"
                placeholder="Escribe un nombre"
                @input="$emit('name', $event.target.value)"
                @keyup.enter="dialogOpen = true"
              />
            </label>

            <button class="btn btn--primary btn--play" type="button" @click="dialogOpen = true">
              Jugar
            </button>

            <p class="home__last">
              Último modo: <b>{{ modeName }}</b>
            </p>
          </div>

          <nav class="home__nav">
            <button type="button" @click="panel = 'serpiente'">
              <span aria-hidden="true">◕</span> Serpiente
            </button>
            <button type="button" @click="panel = 'ajustes'">
              <span aria-hidden="true">⚙</span> Ajustes
            </button>
            <button type="button" @click="panel = 'perfil'">
              <span aria-hidden="true">▤</span> Perfil
            </button>
          </nav>

          <footer class="home__foot">
            <p class="home__offline" :class="{ 'is-ready': offlineReady }">
              <span aria-hidden="true">{{ offlineReady ? '●' : '○' }}</span>
              {{ offlineReady
                 ? 'Listo para jugar sin conexión'
                 : 'Preparando el modo sin conexión…' }}
            </p>
            <button
              v-if="canInstall"
              class="btn btn--ghost btn--install" type="button"
              @click="$emit('install')"
            >Instalar aplicación</button>
          </footer>
        </template>

        <!-- ══ PANELES ══ -->
        <template v-else>
          <header class="panel__head">
            <button class="btn btn--icon" type="button" @click="panel = 'inicio'" aria-label="Volver">←</button>
            <h2 class="panel__title">
              {{ panel === 'serpiente' ? 'Tu serpiente'
               : panel === 'ajustes'   ? 'Ajustes' : 'Perfil' }}
            </h2>
          </header>

          <div class="panel">
            <SnakeEditor
              v-if="panel === 'serpiente'"
              :appearance="profile.appearance"
              :theme="theme"
              :profile="profile"
              @change="$emit('appearance', $event)"
            />

            <SettingsPanel
              v-else-if="panel === 'ajustes'"
              :settings="profile.settings"
              :fps="fps"
              @change="(k, v) => $emit('setting', k, v)"
            />

            <template v-else>
              <div class="stat-grid">
                <div v-for="s in stats" :key="s.label" class="stat">
                  <span class="stat__label">{{ s.label }}</span>
                  <span class="stat__value">{{ s.value }}</span>
                </div>
              </div>

              <h3 class="settings__title">
                Logros <span class="field__hint">{{ done }} de {{ achievements.length }}</span>
              </h3>
              <ul class="achievements">
                <li v-for="a in achievements" :key="a.id" :class="{ 'is-done': a.done }">
                  <span class="achievements__mark" aria-hidden="true">{{ a.done ? '✓' : '·' }}</span>
                  <span>
                    <b>{{ a.name }}</b>
                    <small>{{ a.desc }}</small>
                  </span>
                </li>
              </ul>
            </template>
          </div>
        </template>

      </div>

      <ModeDialog
        v-if="dialogOpen"
        v-model:mode-id="mode"
        :difficulty="profile.settings.difficulty"
        @update:difficulty="$emit('setting', 'difficulty', $event)"
        @start="start"
        @close="dialogOpen = false"
      />
    </div>
  `,
};
