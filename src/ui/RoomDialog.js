/*
 * Sierpe — diálogo para crear o unirse a una partida en red.
 * Copyright (C) 2026 dev-perazarich · GNU AGPL v3.0
 */

/**
 * RoomDialog.js — Montar una sala o entrar en la de otro.
 *
 * Reutiliza la forma de ModeDialog (superposición, cabecera, cuerpo que se
 * desplaza y pie fijo) porque quien llega aquí viene de allí: cambiar de
 * lenguaje visual a mitad del recorrido obliga a reaprender la pantalla.
 *
 * La diferencia real con una partida de un jugador no es técnica, es de
 * expectativas. Una partida en red depende de dos casas, dos routers y dos
 * operadores, así que el aviso que de verdad puede hacer cambiar de idea —qué
 * redes suelen impedir la conexión— abre el cuerpo, por encima de las pestañas.
 * Contarlo después, como error, deja al jugador con la sensación de que el juego
 * está roto.
 *
 * Y tiene que ir ahí arriba, no al final: el botón de acción está en el pie
 * FIJO, luego se puede pulsar sin haber desplazado ni un pixel. Lo que quede al
 * final de un cuerpo con desplazamiento no lo lee nadie. Lo que sí puede quedar
 * abajo es el contexto —quién lleva la partida y qué pasa si esa persona se va—,
 * porque no cambia la decisión de intentarlo, solo explica lo que vendrá luego.
 *
 * Contrato con quien lo integre:
 *   @crear  { modo, maxJugadores, visibilidad }  visibilidad: 'local' | 'codigo'
 *   @unirse { metodo, codigo, invitacion }       metodo: 'codigo' | 'manual'
 *   @cerrar sin datos
 */

import { MODE_LIST } from '../modes/index.js';

const { ref, computed, onMounted, onBeforeUnmount, nextTick } = Vue;

/** Plazas ofrecidas. Seis es el techo medido: por encima, la subida del
 *  anfitrión doméstico se queda corta y empieza a tironear para todos. */
const PLAZAS = [2, 3, 4, 5, 6];

/* Colores de reserva para los puntos de plaza. Son tokens, no valores
   inventados: si el tema no trae paleta, la interfaz sigue siendo la suya. */
const PALETA_RESERVA = [
  'var(--accent)', 'var(--accent-2)', 'var(--ok)',
  'var(--warn)', 'var(--text-2)', 'var(--text-3)',
];

export const RoomDialog = {
  props: {
    conexionDisponible: { type: Boolean, default: true },
    tema: { type: Object, default: () => ({}) },
  },
  emits: ['crear', 'unirse', 'cerrar'],

  setup(props, { emit }) {
    const pestana = ref('crear');
    const modo = ref(MODE_LIST[0].id);
    const maxJugadores = ref(4);
    const visibilidad = ref('local');
    const codigo = ref('');
    const invitacion = ref('');
    const aviso = ref('');

    const caja = ref(null);
    const campoCodigo = ref(null);
    const botonCrear = ref(null);
    const botonUnirse = ref(null);

    const puedePegar = computed(() =>
      typeof navigator !== 'undefined' && !!navigator.clipboard?.readText);

    /* Los dos primeros colores de un tema son fondos: sobre el diálogo oscuro
       no se verían, así que solo se usan los vivos. */
    const coloresPlaza = computed(() => {
      const vivos = Array.isArray(props.tema?.swatches)
        ? props.tema.swatches.slice(2)
        : [];
      const base = vivos.length ? vivos : PALETA_RESERVA;
      return Array.from({ length: maxJugadores.value }, (_, i) => base[i % base.length]);
    });

    /* `enfocar` solo se pide desde el teclado. Con el ratón, o con el dedo, el
       foco debe quedarse donde el usuario lo puso; llevarlo al campo de texto
       levantaría el teclado del móvil sin que nadie lo haya pedido. */
    function irA(id, enfocar = false) {
      pestana.value = id;
      aviso.value = '';
      if (!enfocar) return;
      nextTick(() => (id === 'crear' ? botonCrear : botonUnirse).value?.focus());
    }

    /** Flechas entre pestañas: es lo que espera quien navega con teclado. */
    function moverPestana(e) {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      irA(pestana.value === 'crear' ? 'unirse' : 'crear', true);
    }

    /* Misma limpieza que hace la capa de red antes de validar: mayúsculas, sin
       espacios y sin guiones. Así lo que se emite ya entra tal cual, y quien
       teclea en minúsculas o copia el código con un guion no se queda fuera
       por un detalle que la interfaz podía arreglar sola. */
    const limpiarCodigo = (t) => String(t ?? '').toUpperCase().replace(/[\s-]+/g, '');

    async function pegar(destino) {
      try {
        const texto = await navigator.clipboard.readText();
        if (!texto) return;
        if (destino === 'codigo') codigo.value = limpiarCodigo(texto).slice(0, 48);
        else invitacion.value = texto.trim();
        aviso.value = '';
      } catch {
        // El navegador puede negar el portapapeles sin previo aviso. No es un
        // fallo del juego: basta con decir que se pegue a mano.
        aviso.value = 'No se ha podido leer el portapapeles. Pega el texto a mano en el campo.';
      }
    }

    function crear() {
      if (!props.conexionDisponible) return;
      emit('crear', {
        modo: modo.value,
        maxJugadores: maxJugadores.value,
        visibilidad: visibilidad.value,
      });
    }

    function unirse() {
      if (!props.conexionDisponible) return;
      const cod = limpiarCodigo(codigo.value);
      const inv = invitacion.value.trim();
      if (!cod && !inv) {
        aviso.value = 'Escribe el código de la sala o pega la invitación que te han enviado.';
        return;
      }
      aviso.value = '';
      emit('unirse', {
        metodo: cod ? 'codigo' : 'manual',
        codigo: cod,
        invitacion: inv,
      });
    }

    function onKey(e) {
      if (e.code === 'Escape') emit('cerrar');
    }

    onMounted(() => {
      window.addEventListener('keydown', onKey);
      caja.value?.focus();
    });
    onBeforeUnmount(() => window.removeEventListener('keydown', onKey));

    return {
      modos: MODE_LIST, plazas: PLAZAS,
      pestana, modo, maxJugadores, visibilidad, codigo, invitacion, aviso,
      caja, campoCodigo, botonCrear, botonUnirse,
      puedePegar, coloresPlaza,
      irA, moverPestana, pegar, crear, unirse, limpiar: limpiarCodigo,
    };
  },

  template: `
    <div class="overlay" @click.self="$emit('cerrar')">
      <div
        class="dialog" ref="caja" tabindex="-1"
        role="dialog" aria-modal="true" aria-labelledby="sala-titulo"
      >

        <header class="dialog__head">
          <h2 class="dialog__title" id="sala-titulo">Jugar con amigos</h2>
          <button
            class="btn btn--icon" type="button"
            @click="$emit('cerrar')" aria-label="Cerrar"
          >✕</button>
        </header>

        <div class="dialog__body">

          <!-- Los avisos que condicionan la decisión van ANTES de todo lo demás.
               El botón de acción vive en el pie fijo y es pulsable desde el primer
               instante: cualquier cosa que quede al final de este cuerpo con
               desplazamiento se puede crear o unirse sin haberla visto nunca. -->
          <div class="room-lead">
            <div class="notice notice--danger" v-if="!conexionDisponible" role="alert">
              <b class="notice__title">Desde aquí no se puede jugar en red</b>
              <span>
                Este navegador no admite la conexión directa entre dispositivos, o el juego
                se ha abierto como archivo suelto en vez de servirse. Prueba con otro
                navegador. El juego de un jugador sigue funcionando igual.
              </span>
            </div>

            <div class="notice notice--warn">
              <b class="notice__title">Antes de intentarlo, ten esto en cuenta</b>
              <span>
                Con datos móviles la conexión falla a menudo: muchas operadoras esconden
                los teléfonos detrás de su propia red y los dispositivos no llegan a
                encontrarse. Si podéis, conectaos los dos por WiFi. Aun así, una de cada
                cinco veces no se consigue enlazar; volver a intentarlo o cambiar de red
                suele bastar.
              </span>
            </div>
          </div>

          <div class="tabs" role="tablist" aria-label="Crear o unirse">
            <button
              type="button" role="tab" ref="botonCrear"
              id="sala-tab-crear" aria-controls="sala-panel-crear"
              :aria-selected="pestana === 'crear'"
              :tabindex="pestana === 'crear' ? 0 : -1"
              :class="{ 'is-active': pestana === 'crear' }"
              @click="irA('crear')" @keydown="moverPestana"
            >Crear sala</button>
            <button
              type="button" role="tab" ref="botonUnirse"
              id="sala-tab-unirse" aria-controls="sala-panel-unirse"
              :aria-selected="pestana === 'unirse'"
              :tabindex="pestana === 'unirse' ? 0 : -1"
              :class="{ 'is-active': pestana === 'unirse' }"
              @click="irA('unirse')" @keydown="moverPestana"
            >Unirme a una</button>
          </div>

          <!-- ══ CREAR ══ -->
          <section
            id="sala-panel-crear" role="tabpanel" aria-labelledby="sala-tab-crear"
            class="room-panel" v-show="pestana === 'crear'"
          >
            <div class="field">
              <span class="field__label">A qué vais a jugar</span>
              <div class="modes">
                <button
                  v-for="m in modos" :key="m.id" type="button"
                  class="mode-card" :class="{ 'is-active': modo === m.id }"
                  :aria-pressed="modo === m.id"
                  @click="modo = m.id"
                >
                  <span class="mode-card__icon" aria-hidden="true">{{ m.icon }}</span>
                  <span class="mode-card__body">
                    <span class="mode-card__name">{{ m.name }}</span>
                    <span class="mode-card__desc">{{ m.short }}</span>
                  </span>
                  <span class="mode-card__time">{{ m.duracion }}</span>
                </button>
              </div>
            </div>

            <div class="field">
              <span class="field__label">Cuántos podéis ser</span>
              <div class="chips">
                <button
                  v-for="n in plazas" :key="n" type="button"
                  class="chip" :class="{ 'is-active': maxJugadores === n }"
                  :aria-pressed="maxJugadores === n"
                  @click="maxJugadores = n"
                >{{ n }}</button>
              </div>
              <span class="plazas" aria-hidden="true">
                <span
                  v-for="(c, i) in coloresPlaza" :key="i"
                  class="plazas__dot" :style="{ background: c }"
                ></span>
              </span>
              <span class="field__hint">
                Cuantos más seáis, más trabajo lleva la conexión de quien monta la sala.
                Con seis conviene que esa persona tenga fibra o buen WiFi.
              </span>
            </div>

            <div class="field">
              <span class="field__label">Quién puede entrar</span>
              <div class="modes">
                <button
                  type="button" class="mode-card"
                  :class="{ 'is-active': visibilidad === 'local' }"
                  :aria-pressed="visibilidad === 'local'"
                  @click="visibilidad = 'local'"
                >
                  <span class="mode-card__icon" aria-hidden="true">⌂</span>
                  <span class="mode-card__body">
                    <span class="mode-card__name">Solo mi red</span>
                    <span class="mode-card__desc">
                      Únicamente quien esté en el mismo WiFi que tú. Sigue haciendo falta
                      pasarles el código, pero así casi nunca falla la conexión.
                    </span>
                  </span>
                </button>
                <button
                  type="button" class="mode-card"
                  :class="{ 'is-active': visibilidad === 'codigo' }"
                  :aria-pressed="visibilidad === 'codigo'"
                  @click="visibilidad = 'codigo'"
                >
                  <span class="mode-card__icon" aria-hidden="true">◇</span>
                  <span class="mode-card__body">
                    <span class="mode-card__name">Abierta con código</span>
                    <span class="mode-card__desc">
                      Cualquiera con el código puede entrar desde donde esté. Depende de
                      que las dos conexiones se dejen ver.
                    </span>
                  </span>
                </button>
              </div>
            </div>
          </section>

          <!-- ══ UNIRSE ══ -->
          <section
            id="sala-panel-unirse" role="tabpanel" aria-labelledby="sala-tab-unirse"
            class="room-panel" v-show="pestana === 'unirse'"
          >
            <!-- El botón de pegar queda fuera de la etiqueta: un botón dentro
                 de un <label> reenvía la pulsación al campo asociado. -->
            <div class="field">
              <label class="field__label" for="sala-codigo">Código de la sala</label>
              <div class="codigo__row">
                <input
                  id="sala-codigo" ref="campoCodigo" type="text"
                  class="input input--codigo"
                  maxlength="12" autocomplete="off" spellcheck="false"
                  autocapitalize="characters" autocorrect="off"
                  placeholder="Pega o escribe el código"
                  :value="codigo"
                  @input="codigo = limpiar($event.target.value)"
                  @keyup.enter="unirse"
                />
                <button
                  v-if="puedePegar" class="btn" type="button"
                  @click="pegar('codigo')"
                >Pegar</button>
              </div>
              <span class="field__hint">
                Te lo pasa quien ha montado la partida, por mensaje o en voz alta.
                Son seis caracteres y no lleva ni oes ni ceros, ni íes ni eles:
                si crees ver una, es otra cosa.
              </span>
            </div>

            <div class="field">
              <label class="field__label" for="sala-invitacion">
                O pega la invitación completa
              </label>
              <textarea
                id="sala-invitacion" class="input blob" rows="4" spellcheck="false"
                placeholder="Solo si te han enviado un bloque largo de texto"
                :value="invitacion"
                @input="invitacion = $event.target.value"
              ></textarea>
              <span class="field__hint">
                Este campo es el plan B cuando el código no llega a funcionar.
              </span>
            </div>

            <button
              v-if="puedePegar" class="btn" type="button"
              @click="pegar('invitacion')"
            >Pegar la invitación</button>
          </section>

          <!-- Contexto, no condición: esto explica cómo va a ir la partida, y se
               lee igual de bien mientras se decide. El aviso que puede hacer
               cambiar de idea está arriba del todo, no aquí. -->
          <div class="notice notice--info">
            <b class="notice__title">Cómo funciona una partida entre amigos</b>
            <ul role="list">
              <li>
                Uno de vosotros monta la sala y su dispositivo es el que lleva la partida:
                todos los demás juegan contra lo que ese aparato calcula.
              </li>
              <li>
                Si esa persona cierra el juego o pierde la conexión, la partida termina
                para todos. No se puede continuar sin ella.
              </li>
              <li>
                Quien monta la sala nota cero retraso; el resto notaréis el de vuestra
                propia conexión.
              </li>
            </ul>
          </div>

          <p class="notice notice--danger" v-if="aviso" role="alert">{{ aviso }}</p>

        </div>

        <footer class="dialog__foot">
          <button
            v-if="pestana === 'crear'"
            class="btn btn--primary btn--big" type="button"
            :disabled="!conexionDisponible" @click="crear"
          >Crear sala</button>
          <button
            v-else
            class="btn btn--primary btn--big" type="button"
            :disabled="!conexionDisponible" @click="unirse"
          >Unirme</button>
        </footer>

      </div>
    </div>
  `,
};
