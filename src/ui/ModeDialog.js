/*
 * Sierpe — diálogo de selección de partida.
 * Copyright (C) 2026 dev-perazarich · GNU AGPL v3.0
 */

/**
 * ModeDialog.js — Elegir modo y dificultad justo antes de jugar.
 *
 * Vive aquí y no en la pantalla de inicio a propósito: el arranque solo debe
 * pedir lo imprescindible (un nombre y un botón). Todo lo que hay que decidir
 * *sobre la partida* se decide cuando ya has dicho que quieres jugar.
 */

import { MODE_LIST } from '../modes/index.js';
import { todaysObjectives } from '../modes/daily.js';
import { DIFFICULTY_LIST } from '../ai/personalities.js';

const { ref, onMounted, onBeforeUnmount } = Vue;

export const ModeDialog = {
  props: {
    modeId: { type: String, required: true },
    difficulty: { type: String, required: true },
  },
  emits: ['close', 'start', 'update:modeId', 'update:difficulty'],

  setup(props, { emit }) {
    const seleccion = ref(props.modeId);
    const dificultad = ref(props.difficulty);
    const caja = ref(null);

    function empezar() {
      emit('update:modeId', seleccion.value);
      emit('update:difficulty', dificultad.value);
      emit('start', seleccion.value);
    }

    function onKey(e) {
      if (e.code === 'Escape') emit('close');
      if (e.code === 'Enter') empezar();
    }

    onMounted(() => {
      window.addEventListener('keydown', onKey);
      caja.value?.focus();
    });
    onBeforeUnmount(() => window.removeEventListener('keydown', onKey));

    return {
      modos: MODE_LIST,
      dificultades: DIFFICULTY_LIST,
      objetivosHoy: todaysObjectives(),
      seleccion, dificultad, caja, empezar,
    };
  },

  template: `
    <div class="overlay" @click.self="$emit('close')">
      <div class="dialog" ref="caja" tabindex="-1" role="dialog" aria-label="Elegir partida">

        <header class="dialog__head">
          <h2 class="dialog__title">Elegir partida</h2>
          <button class="btn btn--icon" type="button" @click="$emit('close')" aria-label="Cerrar">✕</button>
        </header>

        <div class="dialog__body">
          <div class="modes">
            <button
              v-for="m in modos" :key="m.id" type="button"
              class="mode-card" :class="{ 'is-active': seleccion === m.id }"
              @click="seleccion = m.id"
              @dblclick="empezar"
            >
              <span class="mode-card__icon" aria-hidden="true">{{ m.icon }}</span>
              <span class="mode-card__body">
                <span class="mode-card__name">{{ m.name }}</span>
                <span class="mode-card__desc">{{ m.short }}</span>
              </span>
              <span class="mode-card__time">{{ m.duracion }}</span>
            </button>

            <button
              class="mode-card mode-card--daily"
              :class="{ 'is-active': seleccion === 'daily' }"
              type="button"
              @click="seleccion = 'daily'"
              @dblclick="empezar"
            >
              <span class="mode-card__icon" aria-hidden="true">★</span>
              <span class="mode-card__body">
                <span class="mode-card__name">Desafío diario</span>
                <span class="mode-card__desc">El mismo mundo para todos hoy. Tres objetivos.</span>
                <ul class="mode-card__objectives" v-if="seleccion === 'daily'">
                  <li v-for="o in objetivosHoy" :key="o.id">{{ o.label }}</li>
                </ul>
              </span>
              <span class="mode-card__time">3 min</span>
            </button>
          </div>

          <div class="field">
            <span class="field__label">Dificultad de los rivales</span>
            <div class="chips">
              <button
                v-for="d in dificultades" :key="d.id" type="button"
                class="chip" :class="{ 'is-active': dificultad === d.id }"
                @click="dificultad = d.id"
              >{{ d.label }}</button>
            </div>
            <span class="field__hint">
              Sube su habilidad: reaccionan antes y apuntan mejor. Nunca corren más que tú.
            </span>
          </div>
        </div>

        <footer class="dialog__foot">
          <button class="btn btn--primary btn--big" type="button" @click="empezar">
            Empezar
          </button>
        </footer>

      </div>
    </div>
  `,
};
