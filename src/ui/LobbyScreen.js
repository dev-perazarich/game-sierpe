/*
 * Sierpe — sala de espera de las partidas en red.
 * Copyright (C) 2026 dev-perazarich · GNU AGPL v3.0
 */

/**
 * LobbyScreen.js — Lo que se ve entre montar la sala y empezar a jugar.
 *
 * Es una pantalla completa, no un diálogo, porque aquí se espera: puede durar
 * un minuto mientras llegan los demás, y una superposición sobre el menú
 * insinúa que vas a volver enseguida.
 *
 * Todo el trabajo de esta pantalla es traducir. La capa de red habla de fases,
 * causas y estados de conexión; aquí solo se ve qué está pasando y qué puede
 * hacer el jugador. Ningún texto que escriba esta pantalla nombra una
 * tecnología. Lo único crudo que puede llegar a verse es el mensaje del propio
 * navegador, y va plegado bajo «Detalle técnico»: quien no lo abra no lo lee.
 *
 * Contrato con quien lo integre:
 *   props.estado            'esperando' | 'conectando' | 'listo' | 'empezando' |
 *                           'error' | 'cerrada', o un objeto
 *                           { fase, causa, mensaje } con esos mismos valores.
 *                           `causa` acepta los códigos de ErrorTransporte que
 *                           produce transport.js ('sin-webrtc', 'stun', 'canal',
 *                           'blob', 'llena', 'ranura', 'senalizacion'…) y también
 *                           la frase suelta con la que hablan client.js y host.js
 *                           (el `motivo` de la sesión, la `razon` de un BYE).
 *                           `mensaje` es el texto técnico y NUNCA se usa de
 *                           titular: se pliega y se vuelca en la consola.
 *   props.jugadores         [{ id, nombre, estado, ping, anfitrion, color }]
 *                           `estado` es una clave de ESTADOS y `ping` va en ms.
 *                           La lista `pares` del transporte encaja tal cual:
 *                           sus `estado` ya están contemplados y su `rtt` se
 *                           acepta como sinónimo de `ping`. Basta con marcar
 *                           `anfitrion: true` en quien lleva la partida.
 *   props.invitacionManual  cadena con el bloque a compartir, u objeto
 *                           { blob, pendientes: [{ id, nombre }], instrucciones }.
 *                           Vacío = la señalización no es manual y no se muestra.
 *   @empezar   sin datos, solo lo emite el anfitrión
 *   @salir     sin datos
 *   @copiar    { que: 'codigo' | 'invitacion', texto }
 *   @respuesta { id, texto }  añadido a los tres pedidos: sin él, el área de
 *              pegar la respuesta de cada invitado no tendría a dónde enviarla.
 */

const { ref, reactive, computed, watch, onMounted, onBeforeUnmount } = Vue;

const FASES = {
  esperando:  { texto: 'Sala abierta. Aún falta gente por entrar.', tono: 'espera' },
  conectando: { texto: 'Enlazando con los demás. Esto tarda unos segundos.', tono: 'espera' },
  listo:      { texto: 'Ya estáis todos dentro.', tono: 'ok' },
  jugando:    { texto: 'Estás dentro de la partida.', tono: 'ok' },
  empezando:  { texto: 'Empezando la partida.', tono: 'ok' },
  perdido:    { texto: 'Se ha cortado la conexión. Intentando volver.', tono: 'error' },
  error:      { texto: 'La conexión no ha salido bien.', tono: 'error' },
  cerrada:    { texto: 'Esta sala ya no está en pie.', tono: 'error' },
  cerrado:    { texto: 'Esta sala ya no está en pie.', tono: 'error' },
};

/* Cada fallo se cuenta por lo que le pasa al jugador y por lo que puede hacer.
   «Fallo de negociación» no es información: es la excusa del programa.

   Los textos viven aparte de las claves porque varias causas distintas se
   resuelven con el mismo consejo: al jugador le da igual si el enlace murió por
   la ruta ICE o por el canal de datos, solo si puede hacer algo. */
const TEXTOS = {
  bloqueada: {
    titulo: 'Vuestros dispositivos no han conseguido verse',
    ayuda: 'Suele pasar con los datos móviles. Probad los dos por WiFi, o que monte '
         + 'la sala quien esté en una red de casa.',
  },
  enlaceCaido: {
    titulo: 'Se ha cortado la conexión con la partida',
    ayuda: 'Mira si sigues teniendo WiFi o datos y vuelve a entrar con el mismo '
         + 'código. Si la sala aguanta en pie, te dejará pasar otra vez.',
  },
  silencio: {
    titulo: 'Quien lleva la partida ha dejado de responder',
    ayuda: 'O se le ha ido la conexión, o ha cerrado el juego. Esperad un momento y, '
         + 'si no vuelve, montad otra sala entre los que quedéis.',
  },
  anfitrionFuera: {
    titulo: 'Quien llevaba la partida se ha ido',
    ayuda: 'La sala se cierra con esa persona. Podéis montar otra y empezar de nuevo.',
  },
  llena: {
    titulo: 'La sala está completa',
    ayuda: 'Pide a quien la ha montado que suba el número de plazas y vuelve a entrar.',
  },
  codigoMalo: {
    titulo: 'Ese código no corresponde a ninguna sala',
    ayuda: 'Son seis caracteres y no lleva ni oes ni ceros, ni íes ni eles. Vuelve a '
         + 'escribirlo mirando el que te pasaron.',
  },
  invitacionMala: {
    titulo: 'Ese texto no es una invitación',
    ayuda: 'Cópialo otra vez de principio a fin. Si te llegó partido en dos mensajes, '
         + 'pega los dos trozos seguidos y sin nada en medio.',
  },
  invitacionCaducada: {
    titulo: 'Esa invitación ya no vale',
    ayuda: 'Las invitaciones se quedan esperando menos de un minuto. Pide otra a quien '
         + 'te invitó y pégala nada más recibirla.',
  },
  invitacionLarga: {
    titulo: 'La invitación se ha quedado demasiado larga',
    ayuda: 'No cabe en el envío automático. Cread la sala con invitación a mano: ese '
         + 'camino no tiene límite de tamaño.',
  },
  version: {
    titulo: 'No jugáis con la misma versión del juego',
    ayuda: 'Cerrad el juego y volved a abrirlo para que se actualice. Si sigue igual, '
         + 'recargad la página.',
  },
  servicio: {
    titulo: 'El servicio que reparte los códigos no responde',
    ayuda: 'No es cosa del juego y suele volver solo. Mientras tanto podéis jugar con '
         + 'la invitación a mano, que no depende de nadie.',
  },
  navegador: {
    titulo: 'Este navegador no puede jugar en red',
    ayuda: 'Prueba con otro navegador, o con una versión más nueva de este. El juego '
         + 'de un jugador sigue funcionando igual.',
  },
  sinInternet: {
    titulo: 'Este dispositivo se ha quedado sin internet',
    ayuda: 'Comprueba el WiFi o los datos y vuelve a intentarlo.',
  },
  salida: {
    titulo: 'Has salido de la sala',
    ayuda: 'Vuelve al menú para montar otra partida o para entrar en una con su código.',
  },
  generico: {
    titulo: 'La partida no ha podido seguir',
    ayuda: 'Vuelve al menú e inténtalo de nuevo. Si se repite, probad los dos por WiFi '
         + 'en lugar de con datos móviles.',
  },
};

/* Claves de `causa`. Son EXACTAMENTE los códigos que construye ErrorTransporte
   en transport.js, no una lista inventada: la tabla anterior no acertaba ni uno
   y por eso todo fallo acababa en el respaldo enseñando la jerga cruda. */
const CAUSAS = {
  'sin-webrtc': TEXTOS.navegador,
  stun: TEXTOS.bloqueada,
  canal: TEXTOS.enlaceCaido,
  envio: TEXTOS.enlaceCaido,
  blob: TEXTOS.invitacionMala,
  codigo: TEXTOS.codigoMalo,
  llena: TEXTOS.llena,
  ranura: TEXTOS.invitacionCaducada,
  tamano: TEXTOS.invitacionLarga,
  publicar: TEXTOS.servicio,
  senalizacion: TEXTOS.servicio,
  // 'rol' e 'interfaz' son fallos de programación, no del jugador: no hay nada
  // que pueda hacer, así que se le cuenta lo mismo que en cualquier imprevisto.
  rol: TEXTOS.generico,
  interfaz: TEXTOS.generico,

  // Las que documentaba el contrato anterior. No las produce nadie —ese era
  // justo el defecto—, pero se siguen aceptando: quitarlas solo podría romper a
  // quien las hubiera creído, y mantenerlas no cuesta nada.
  'red-bloqueada': TEXTOS.bloqueada,
  'codigo-invalido': TEXTOS.codigoMalo,
  'sala-llena': TEXTOS.llena,
  'anfitrion-fuera': TEXTOS.anfitrionFuera,
  'version-distinta': TEXTOS.version,
  'tiempo-agotado': TEXTOS.silencio,
  'sin-conexion': TEXTOS.sinInternet,
};

/* Ni client.js ni host.js ponen código a lo que cuentan: mandan una frase suelta
   en `motivo` o en la `razon` de un BYE. Se reconocen por lo que dicen.

   El orden importa, porque varias comparten palabras: 'no se pudo abrir el
   canal' tiene que resolverse antes que 'canal cerrado', y 'sin conexión tras N
   intentos' antes que 'sin conexión' a secas. Donde va una vocal acentuada se
   pone un comodín: así la frase se reconoce igual venga acentuada o no. */
const FRASES = [
  [/protocolo incompatible/i, TEXTOS.version],
  [/sala llena|no quedan huecos/i, TEXTOS.llena],
  // Un fallo de STUN es que no se han encontrado, no que falte el navegador:
  // se separa de 'webrtc' porque cuentan cosas distintas al jugador.
  [/no se pudo abrir el canal|ruta imposible|^stun \d/i, TEXTOS.bloqueada],
  [/webrtc|canales de datos/i, TEXTOS.navegador],
  [/servicio de c.digos|el servicio respondi/i, TEXTOS.servicio],
  [/silencio del anfitri|sin se.al/i, TEXTOS.silencio],
  [
    /anfitri.n (ha cerrado|cerr|se desconect|se ha ido)|sala cerrada|otro extremo/i,
    TEXTOS.anfitrionFuera,
  ],
  [/invitaci.n caducada|esperando respuesta/i, TEXTOS.invitacionCaducada],
  [/no cabe en un mensaje/i, TEXTOS.invitacionLarga],
  [/no es una invitaci|no es una respuesta/i, TEXTOS.invitacionMala],
  [/c.digo de sala/i, TEXTOS.codigoMalo],
  [/salida voluntaria|salida del cliente|adi.s del cliente/i, TEXTOS.salida],
  [
    /sin conexi.n tras|fallo al enviar|canal cerrado|canal no disponible/i,
    TEXTOS.enlaceCaido,
  ],
  [/ruta no se recuper|ruta inestable|fallo en (estado|control)/i, TEXTOS.enlaceCaido],
  // Va la última de las de enlace: 'el anfitrión se desconectó' ya se ha
  // resuelto antes y aquí solo queda la desconexión a secas de host.js.
  [/desconexi.n/i, TEXTOS.enlaceCaido],
  [/sin conexi.n|sin internet/i, TEXTOS.sinInternet],
];

/**
 * Traduce lo primero que reconozca. Acepta tanto el código como la frase, y en
 * cualquiera de los dos campos, porque quien integra puede pasar el código de
 * ErrorTransporte en `causa` o volcar directamente el `motivo` de la sesión.
 * @returns {object|null} texto para el jugador, o null si nada encaja
 */
function traducirFallo(...piezas) {
  for (const pieza of piezas) {
    const texto = String(pieza ?? '').trim();
    if (!texto) continue;
    if (CAUSAS[texto]) return CAUSAS[texto];
    for (const [patron, salida] of FRASES) if (patron.test(texto)) return salida;
  }
  return null;
}

/* Incluye tal cual los estados que ya manejan el transporte ('nueva',
   'conectando', 'abierta', 'cerrada', 'fallida') y la sesión del cliente
   ('jugando', 'perdido', 'cerrado'), para que la lista se pueda alimentar
   directamente con lo que devuelve la red sin traducirla por el camino. */
const ESTADOS = {
  anfitrion:    { etiqueta: 'Lleva la partida',   punto: 'is-ok' },
  conectado:    { etiqueta: 'Dentro',             punto: 'is-ok' },
  abierta:      { etiqueta: 'Dentro',             punto: 'is-ok' },
  jugando:      { etiqueta: 'Dentro',             punto: 'is-ok' },
  listo:        { etiqueta: 'Listo',              punto: 'is-ok' },
  nueva:        { etiqueta: 'Entrando…',          punto: 'is-wait' },
  conectando:   { etiqueta: 'Entrando…',          punto: 'is-wait' },
  invitado:     { etiqueta: 'Invitado, aún sin responder', punto: 'is-wait' },
  reconectando: { etiqueta: 'Intentando volver…', punto: 'is-wait' },
  perdido:      { etiqueta: 'Se ha quedado sin conexión', punto: 'is-bad' },
  desconectado: { etiqueta: 'Se ha quedado sin conexión', punto: 'is-bad' },
  fallida:      { etiqueta: 'No se ha podido conectar',   punto: 'is-bad' },
  cerrada:      { etiqueta: 'Ha salido',          punto: 'is-bad' },
  cerrado:      { etiqueta: 'Ha salido',          punto: 'is-bad' },
  fuera:        { etiqueta: 'Ha salido',          punto: 'is-bad' },
};

export const LobbyScreen = {
  props: {
    esAnfitrion: { type: Boolean, default: false },
    codigo: { type: String, default: '' },
    jugadores: { type: Array, default: () => [] },
    estado: { type: [String, Object], default: 'esperando' },
    invitacionManual: { type: [String, Object], default: '' },
  },
  emits: ['empezar', 'salir', 'copiar', 'respuesta'],

  setup(props, { emit }) {
    const copiado = ref('');
    const avisoCopia = ref('');
    const avisoRespuesta = ref('');
    const respuestas = reactive({});
    let temporizador = 0;

    const est = computed(() =>
      (typeof props.estado === 'string' ? { fase: props.estado } : (props.estado ?? {})));
    const fase = computed(() => est.value.fase ?? 'esperando');
    const faseInfo = computed(() => FASES[fase.value] ?? FASES.esperando);
    const hayError = computed(() =>
      fase.value === 'error' || fase.value === 'cerrada' || fase.value === 'cerrado');

    /* Empezar con la conexión caída solo sirve para que la partida arranque
       rota; se espera a que vuelva o a que alguien salga. */
    const puedeEmpezar = computed(() =>
      !hayError.value && fase.value !== 'empezando' && fase.value !== 'perdido');

    /* El titular NUNCA sale del mensaje técnico. «no se pudo abrir el canal:
       Failed to execute 'setRemoteDescription'…» no le dice nada a quien está
       intentando jugar, pero sí es lo único aprovechable cuando hay que
       contárselo a alguien que pueda arreglarlo: se guarda plegado. */
    const fallo = computed(() => {
      if (!hayError.value) return null;
      const detalle = String(est.value.mensaje ?? '').trim();
      const texto = traducirFallo(est.value.causa, detalle) ?? TEXTOS.generico;
      return { titulo: texto.titulo, ayuda: texto.ayuda, detalle };
    });

    /* A la consola va tal cual, sin traducir: es el sitio donde el detalle sirve
       de algo y donde nadie tropieza con él. Se observa el texto y no el objeto
       porque `fallo` se reconstruye en cada cálculo y repetiría el volcado. */
    watch(() => fallo.value?.detalle ?? '', (detalle) => {
      if (detalle) console.warn('[sala] fallo de red:', est.value.causa ?? '—', detalle);
    });

    const lista = computed(() => props.jugadores.map((j, i) => {
      const clave = j.anfitrion ? 'anfitrion' : (j.estado ?? 'conectando');
      const info = ESTADOS[clave] ?? { etiqueta: 'Sin datos', punto: '' };
      return {
        id: j.id ?? i,
        nombre: j.nombre || 'Jugador',
        etiqueta: info.etiqueta,
        punto: info.punto,
        color: j.color || '',
        anfitrion: !!j.anfitrion,
        ping: textoPing(j),
        calidad: calidadPing(j),
      };
    }));

    const conectados = computed(() => lista.value.filter((j) => j.punto === 'is-ok').length);
    const solo = computed(() => lista.value.length <= 1);

    /* `rtt` es como lo llama el transporte y `ping` como lo llama todo el
       mundo: se aceptan los dos para no obligar a traducir la lista de pares.
       Sin medida todavía llega null, y Number(null) es cero: mostrarlo como
       «0 ms» sería anunciar una conexión perfecta justo cuando no se sabe nada
       de ella. */
    function msDe(j) {
      const v = j.ping ?? j.rtt;
      if (v === null || v === undefined || v === '') return NaN;
      const ms = Number(v);
      // Cero no es una medida: es el valor con el que nace el contador antes
      // de la primera sonda, y también lo que deja el redondeo de un enlace
      // por debajo del milisegundo. En los dos casos, mejor una raya.
      return Number.isFinite(ms) && ms > 0 ? ms : NaN;
    }

    // El anfitrión tiene la partida en su propia máquina: no hay ida y vuelta
    // que medir, así que cualquier cifra sería falsamente precisa.
    function textoPing(j) {
      if (j.anfitrion) return 'sin retraso';
      const ms = msDe(j);
      return Number.isNaN(ms) ? '—' : Math.round(ms) + ' ms';
    }

    function calidadPing(j) {
      const ms = msDe(j);
      if (j.anfitrion || Number.isNaN(ms) || ms <= 90) return '';
      return ms <= 180 ? 'is-mid' : 'is-bad';
    }

    const manual = computed(() => {
      const v = props.invitacionManual;
      const base = typeof v === 'string' ? { blob: v } : (v ?? {});
      const pendientes = Array.isArray(base.pendientes) ? base.pendientes : [];
      return { blob: base.blob ?? '', instrucciones: base.instrucciones ?? '', pendientes };
    });
    const hayManual = computed(() => !!manual.value.blob || manual.value.pendientes.length > 0);

    const instruccionesManual = computed(() => {
      if (manual.value.instrucciones) return manual.value.instrucciones;
      if (props.esAnfitrion) {
        return 'Copia este texto y envíaselo a quien quieras invitar, por donde ya '
             + 'habléis. Te devolverá otro texto parecido: pégalo aquí abajo.';
      }
      return 'Copia este texto y devuélveselo a quien te ha invitado. En cuanto lo '
           + 'pegue en su pantalla, entrarás en la sala.';
    });

    /* Si la capa de red no dice a quién espera, se ofrece una casilla suelta:
       el anfitrión siempre tiene que poder pegar la respuesta que le acaba de
       llegar por mensaje, aunque nadie figure todavía en la lista. */
    const huecos = computed(() => (manual.value.pendientes.length
      ? manual.value.pendientes
      : [{ id: null, nombre: 'Respuesta de un invitado' }]));

    const claveDe = (p) => String(p.id ?? 'nuevo');

    async function copiar(que, texto) {
      if (!texto) return;
      emit('copiar', { que, texto });
      avisoCopia.value = '';
      try {
        await navigator.clipboard.writeText(texto);
        copiado.value = que;
        clearTimeout(temporizador);
        temporizador = setTimeout(() => { copiado.value = ''; }, 2400);
      } catch {
        // Sin permiso de portapapeles el texto sigue estando a la vista y
        // seleccionable; lo único que falta es decirlo.
        copiado.value = '';
        avisoCopia.value = 'Este navegador no deja copiar solo. Selecciona el texto y cópialo.';
      }
    }

    function enviarRespuesta(p) {
      const clave = claveDe(p);
      const texto = String(respuestas[clave] ?? '').trim();
      if (!texto) {
        avisoRespuesta.value = 'Pega antes el texto que te ha devuelto esa persona.';
        return;
      }
      avisoRespuesta.value = '';
      emit('respuesta', { id: p.id ?? null, texto });
      respuestas[clave] = '';
    }

    function onKey(e) {
      if (e.code === 'Escape') emit('salir');
    }

    onMounted(() => window.addEventListener('keydown', onKey));
    onBeforeUnmount(() => {
      window.removeEventListener('keydown', onKey);
      clearTimeout(temporizador);
    });

    return {
      copiado, avisoCopia, avisoRespuesta, respuestas,
      fase, faseInfo, hayError, puedeEmpezar, fallo, lista, conectados, solo,
      manual, hayManual, instruccionesManual, huecos, claveDe,
      copiar, enviarRespuesta,
    };
  },

  template: `
    <div class="screen screen--lobby">
      <div class="lobby">

        <header class="panel__head">
          <button
            class="btn btn--icon" type="button"
            @click="$emit('salir')" aria-label="Salir de la sala"
          >←</button>
          <h2 class="panel__title">Sala de espera</h2>
        </header>

        <p class="lobby__state" :class="'is-' + faseInfo.tono" aria-live="polite">
          {{ faseInfo.texto }}
        </p>

        <div class="notice notice--danger" v-if="fallo" role="alert">
          <b class="notice__title">{{ fallo.titulo }}</b>
          <span>{{ fallo.ayuda }}</span>
        </div>

        <!-- Fuera de la región role="alert" a propósito: ahí dentro un lector de
             pantalla leería en voz alta el mensaje del navegador entero, que es
             justo lo que no queremos que oiga nadie que no lo haya pedido. -->
        <details class="detalle" v-if="fallo && fallo.detalle">
          <summary>Detalle técnico</summary>
          <p class="detalle__texto">{{ fallo.detalle }}</p>
        </details>

        <section class="lobby__section" v-if="codigo">
          <div class="codigo">
            <span class="field__label">Código de la sala</span>
            <div class="codigo__row">
              <p class="codigo__valor">{{ codigo }}</p>
              <button class="btn" type="button" @click="copiar('codigo', codigo)">
                Copiar
              </button>
            </div>
            <span class="codigo__ok" role="status">
              {{ copiado === 'codigo' ? 'Copiado' : '' }}
            </span>
            <span class="field__hint">
              Pásaselo a quien quieras que juegue contigo. Sin él no pueden entrar.
            </span>
          </div>
        </section>

        <section class="lobby__section">
          <h3 class="settings__title">
            Quién hay
            <span class="field__hint">{{ conectados }} de {{ lista.length }} dentro</span>
          </h3>

          <ul class="players" role="list">
            <li v-for="j in lista" :key="j.id">
              <span
                class="player__dot" :class="j.punto" aria-hidden="true"
                :style="j.color ? { background: j.color } : null"
              ></span>
              <span class="player__body">
                <span class="player__name">
                  {{ j.nombre }}
                  <span class="badge" v-if="j.anfitrion">Anfitrión</span>
                </span>
                <span class="player__tag">{{ j.etiqueta }}</span>
              </span>
              <span class="player__ping" :class="j.calidad">{{ j.ping }}</span>
            </li>
          </ul>

          <p class="field__hint" v-if="solo">
            Todavía estás solo. En cuanto alguien entre con el código aparecerá aquí.
          </p>
        </section>

        <!-- Señalización manual: solo cuando no hay forma automática de que se
             encuentren y el texto tiene que viajar por donde pueda. -->
        <section class="lobby__section manual" v-if="hayManual">
          <h3 class="settings__title">Invitación a mano</h3>

          <p class="field__hint">{{ instruccionesManual }}</p>

          <div class="field" v-if="manual.blob">
            <span class="field__label">
              {{ esAnfitrion ? 'Tu invitación' : 'Tu respuesta' }}
            </span>
            <textarea
              class="input blob" rows="4" readonly spellcheck="false"
              :value="manual.blob"
              aria-label="Texto de invitación para compartir"
              @focus="$event.target.select()"
            ></textarea>
            <div class="manual__row">
              <button class="btn" type="button" @click="copiar('invitacion', manual.blob)">
                Copiar el texto
              </button>
            </div>
            <span class="codigo__ok" role="status">
              {{ copiado === 'invitacion' ? 'Copiado' : '' }}
            </span>
          </div>

          <template v-if="esAnfitrion">
            <div class="manual__guest" v-for="p in huecos" :key="claveDe(p)">
              <span class="field__label">{{ p.nombre || 'Invitado' }}</span>
              <textarea
                class="input blob" rows="3" spellcheck="false"
                placeholder="Pega aquí el texto que te ha devuelto"
                :value="respuestas[claveDe(p)] || ''"
                :aria-label="'Respuesta de ' + (p.nombre || 'un invitado')"
                @input="respuestas[claveDe(p)] = $event.target.value"
              ></textarea>
              <div class="manual__row">
                <button class="btn" type="button" @click="enviarRespuesta(p)">
                  Añadir a la sala
                </button>
              </div>
            </div>
          </template>

          <p class="notice notice--danger" v-if="avisoRespuesta" role="alert">
            {{ avisoRespuesta }}
          </p>
        </section>

        <p class="notice notice--warn" v-if="avisoCopia" role="alert">{{ avisoCopia }}</p>

        <footer class="lobby__actions">
          <button
            v-if="esAnfitrion"
            class="btn btn--primary btn--big" type="button"
            :disabled="!puedeEmpezar"
            @click="$emit('empezar')"
          >Empezar</button>

          <p class="lobby__waiting" v-else>
            Esperando a que empiece quien lleva la partida.
          </p>

          <button class="btn btn--ghost" type="button" @click="$emit('salir')">
            Salir de la sala
          </button>

          <p class="hint">
            Si quien lleva la partida se va, la sala se cierra para todos.
          </p>
        </footer>

      </div>
    </div>
  `,
};
