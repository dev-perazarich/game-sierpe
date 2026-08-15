/**
 * MenuScreen.js — Pantalla principal.
 *
 * Frente al menú anterior: el nombre ya no es obligatorio (se genera uno
 * editable), el botón de jugar nunca está deshabilitado, y lo primero que ves es
 * a qué puedes jugar en lugar de un bloque de instrucciones.
 */

import { ModePicker } from './ModePicker.js';
import { SnakeEditor } from './SnakeEditor.js';
import { SettingsPanel } from './SettingsPanel.js';
import { progressList } from '../meta/achievements.js';

const { ref, computed } = Vue;

export const MenuScreen = {
  components: { ModePicker, SnakeEditor, SettingsPanel },
  props: {
    profile: { type: Object, required: true },
    theme: { type: Object, required: true },
    fps: { type: Number, default: 0 },
  },
  emits: ['play', 'setting', 'appearance', 'name', 'mode'],

  setup(props, { emit }) {
    const tab = ref('jugar');
    const mode = ref(props.profile.lastMode);

    const achievements = computed(() => progressList(props.profile));
    const done = computed(() => achievements.value.filter((a) => a.done).length);
    const stats = computed(() => props.profile.summary());

    function play() {
      emit('mode', mode.value);
      emit('play', mode.value);
    }

    function onName(e) {
      emit('name', e.target.value);
    }

    return { tab, mode, achievements, done, stats, play, onName };
  },

  template: `
    <div class="screen screen--menu">
      <div class="menu">

        <header class="menu__head">
          <h1 class="logo">
            <span class="logo__mark" aria-hidden="true">
              <svg viewBox="0 0 48 48" width="44" height="44">
                <path d="M6 34c0-8 8-10 14-10s12-2 12-8-5-8-9-6"
                      fill="none" stroke="currentColor" stroke-width="6"
                      stroke-linecap="round" stroke-linejoin="round" />
                <circle cx="35" cy="9" r="2.6" fill="currentColor" />
              </svg>
            </span>
            <span class="logo__text">
              <span class="logo__name">Sierpe</span>
              <span class="logo__sub">arcade de serpientes</span>
            </span>
          </h1>

          <nav class="tabs" role="tablist">
            <button type="button" role="tab" :aria-selected="tab === 'jugar'"
                    :class="{ 'is-active': tab === 'jugar' }" @click="tab = 'jugar'">Jugar</button>
            <button type="button" role="tab" :aria-selected="tab === 'serpiente'"
                    :class="{ 'is-active': tab === 'serpiente' }" @click="tab = 'serpiente'">Serpiente</button>
            <button type="button" role="tab" :aria-selected="tab === 'ajustes'"
                    :class="{ 'is-active': tab === 'ajustes' }" @click="tab = 'ajustes'">Ajustes</button>
            <button type="button" role="tab" :aria-selected="tab === 'perfil'"
                    :class="{ 'is-active': tab === 'perfil' }" @click="tab = 'perfil'">Perfil</button>
          </nav>
        </header>

        <div class="menu__body">

          <!-- JUGAR -->
          <div v-show="tab === 'jugar'" class="panel">
            <label class="field field--name">
              <span class="field__label">Tu nombre</span>
              <input
                type="text" maxlength="18" class="input"
                :value="profile.appearance.name"
                placeholder="Escribe un nombre"
                @input="onName"
                @keyup.enter="play"
              />
            </label>

            <ModePicker v-model="mode" @play="play" />

            <button class="btn btn--primary btn--big" type="button" @click="play">
              Jugar
            </button>

            <p class="hint">
              Mueve con el ratón o <kbd>WASD</kbd> · acelera con <kbd>clic</kbd> o <kbd>espacio</kbd>
              · pausa con <kbd>Esc</kbd>
            </p>
          </div>

          <!-- SERPIENTE -->
          <div v-show="tab === 'serpiente'" class="panel">
            <SnakeEditor
              :appearance="profile.appearance"
              :theme="theme"
              :profile="profile"
              @change="$emit('appearance', $event)"
            />
          </div>

          <!-- AJUSTES -->
          <div v-show="tab === 'ajustes'" class="panel">
            <SettingsPanel
              :settings="profile.settings"
              :fps="fps"
              @change="(k, v) => $emit('setting', k, v)"
            />
          </div>

          <!-- PERFIL -->
          <div v-show="tab === 'perfil'" class="panel">
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
          </div>

        </div>
      </div>
    </div>
  `,
};
