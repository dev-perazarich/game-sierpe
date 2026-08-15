/*
 * Sierpe — sesión del cliente en una partida en red.
 * Copyright (C) 2026 dev-perazarich · GNU AGPL v3.0
 */

/**
 * client.js — La mitad invitada de una partida: se une a la sala de otro y
 * dibuja el mundo que ese otro simula.
 *
 * ── Lo que este módulo NO hace ──
 *
 * No hay World, ni bots, ni colisiones, ni lógica de modo. Un cliente que
 * simulara por su cuenta tendría que coincidir bit a bit con el anfitrión, y ya
 * está medido en ghost.js que eso es imposible entre navegadores distintos:
 * Math.sin y Math.atan2 no están obligados a dar el mismo resultado. La verdad
 * llega por el cable y aquí solo se representa.
 *
 * ── Las dos velocidades del cliente ──
 *
 * Lo ajeno se dibuja INTERPOLADO y con retraso (InterpolationBuffer): así se ve
 * suave aunque el estado llegue a 20 Hz y algún paquete se pierda.
 * Lo propio se dibuja PREDICHO y sin retraso (Prediccion): mover el ratón y ver
 * responder la cabeza cien milisegundos después es lo único que un jugador no
 * perdona.
 *
 * ── Del cuerpo solo viaja la cabeza ──
 *
 * El anfitrión manda 10 bytes por serpiente. El cuerpo se reconstruye aquí con
 * setReplayPose(), que usa la MISMA cadena de remolque que la simulación real,
 * así que las serpientes ajenas arrastran igual que en la pantalla del
 * anfitrión sin haber transmitido ni un nodo.
 *
 * ── Contrato de `sala` (transporte inyectado) ──
 *
 * La sala es una dependencia, no una importación: este módulo se prueba entero
 * con un objeto de mentira y sin WebRTC por medio.
 *
 *   conectar()            → Promise. Abre o reabre el canal. Opcional.
 *   enviar(datos)         → manda ArrayBuffer o string al anfitrión.
 *   alMensaje(fn)         → registra el receptor. Si no existe el método, se
 *                           asigna la propiedad `onMensaje`.
 *   alCerrar(fn)          → aviso de canal caído. Alternativa: `onCierre`.
 *   cerrar()              → cierre definitivo. Opcional.
 *   abierta               → booleano. Si es false no se intenta enviar.
 *
 * ── Vocabulario JSON con el anfitrión ──
 *
 * Lo binario está cerrado en protocol.js; lo que va en JSON se define aquí.
 *
 *   JOIN  cliente → anfitrión  { v, nombre, apariencia, tema }
 *   HELLO anfitrión → cliente  { v, tuId, tick, mundo:{w,h}, modo, semilla,
 *                                tu: identidad }
 *   EVENT ambos sentidos       { ev, ...datos }
 *         ev: 'censo'                  anfitrión → cliente, campo `filas` con
 *                                      una identidad por serpiente recién vista
 *         ev: 'baja'                   anfitrión → cliente, campo `id`
 *         ev: 'muerte'                 anfitrión → cliente, campo `id`
 *         ev: 'aparicion'              anfitrión → cliente, campos `id`, `x`, `y`
 *         ev: 'ping' / 'pong'          sonda de reserva, campo `ts`
 *         ev: 'pideApariencias'        cliente → anfitrión, campo `ids`
 *         los nombres de EVENTOS_REEMITIDOS llegan además a `sesion.eventos`,
 *         de modo que FX, audio y HUD se enganchan igual que al bus del mundo
 *         local. Lo que no está en esa lista se cuenta y se tira.
 *   BYE   ambos sentidos       { razon }
 *
 * ── Por qué 'muerte' y 'aparicion' no son decorativos ──
 *
 * Una serpiente muerta deja de viajar en el paquete de estado, así que ese aviso
 * por canal fiable es la ÚNICA noticia de la muerte. Sin atenderlo el cadáver se
 * retira cuando vence el temporizador de muestra rancia —medido: 0,70 s de más
 * moviéndose y contando como obstáculo—, y en la serpiente propia una muerte
 * seguida de su reaparición cabe entre dos instantáneas (50 ms a 20 Hz) sin que
 * el bit DEAD llegue a verse nunca.
 *
 * 'aparicion' cierra el otro lado: el mismo netId vuelve al estado desde un
 * punto cualquiera del mapa. Sus muestras anteriores describen otro trayecto, y
 * el buffer, que no sabe nada de muertes, uniría el sitio donde murió con el
 * sitio donde nació por una recta.
 *
 * `identidad` es { id, nombre, equipo, bot, piel }. La piel llega ENTERA, ya
 * construida por el anfitrión: usarla tal cual es lo que garantiza que todos
 * vean el mismo aspecto. buildSkin solo entra como respaldo cuando lo que llega
 * son los colores base sin construir.
 *
 * Dos condiciones que el anfitrión DEBE cumplir y que no se pueden comprobar
 * desde aquí:
 *   · Ningún campo de un JSON puede llamarse `t`. encodeJson construye
 *     { t: tipo, ...payload }, así que un `t` propio pisa el tipo del mensaje y
 *     el receptor lo descarta como basura.
 *   · `tick` en el SNAPSHOT es el contador de PASOS de simulación (60 Hz), no
 *     el número de paquete. La interpolación sitúa cada muestra en tick * STEP;
 *     si el contador avanzara de uno en uno a 20 Hz, el mundo ajeno se
 *     reproduciría a un tercio de velocidad.
 *
 * ── Limitaciones asumidas ──
 *
 * El anfitrión es autoritativo y por tanto puede hacer trampas; entre amigos se
 * acepta. Sin servidor TURN, entre un 10 % y un 20 % de las conexiones no
 * llegan a abrirse (peor en datos móviles por CGNAT): de ahí que la reconexión
 * se rinda en lugar de insistir para siempre. Y si el anfitrión se va, la sala
 * muere: aquí eso se ve como silencio y acaba en 'cerrado'.
 */

import { STEP, CFG } from '../config.js';
import { TAU } from '../engine/math.js';
import { EventBus } from '../engine/events.js';
import { Snake } from '../entities/Snake.js';
import { ORB_KIND } from '../entities/Orb.js';
import { getTheme, buildSkin, botSkin } from '../themes/index.js';
import {
  MSG, PROTOCOL_VERSION, encodeInput, encodeJson, decodeMessage,
} from './protocol.js';
import { InterpolationBuffer, NetStats } from './interpolation.js';
import { Prediccion } from './prediction.js';

/** Estados que la interfaz puede mostrar sin conocer nada de red. */
export const ESTADO = {
  CONECTANDO: 'conectando',
  JUGANDO:    'jugando',
  PERDIDO:    'perdido',
  CERRADO:    'cerrado',
};

const MAX_REINTENTOS   = 4;     // ver limitaciones: insistir más no arregla un NAT
const ESPERA_BASE      = 0.6;   // s hasta el primer reintento, se duplica
const ESPERA_MAX       = 6;     // s de tope entre reintentos
const SILENCIO_MAX     = 5;     // s sin un solo paquete → canal dado por muerto
const PING_CADA        = 1;     // s entre sondas de ida y vuelta
const PETICION_CADA    = 2;     // s entre tandas de peticiones de apariencia
const PETICIONES_MAX   = 3;     // por id: si no contesta, se juega con la de bot
const RESERVA_MAX      = 24;    // serpientes recicladas que se guardan
const CONGELADA_MAX    = 0.6;   // s sin muestra fresca antes de retirar a una ajena

/**
 * Salto máximo que el dibujo puede dar en un fotograma sin que se note.
 *
 * Dos pasos a velocidad de turbo. Por encima de esto la serpiente no se está
 * moviendo: se está teletransportando, y es preferible resembrarla en su sitio
 * a arrastrarla por una recta que nadie recorrió.
 */
const SALTO_DIBUJABLE  = CFG.snake.boostSpeed * STEP * 2;
const DELTAS_MUESTRA   = 32;    // ventana para deducir el ritmo de envío
const PULSO_ORBE       = 2.4;   // rad/s del titileo de la comida

/**
 * Hueco entre dos muestras a partir del cual la recta que las une deja de ser
 * una suposición razonable.
 *
 * Los paquetes salen cada 50 ms; seis seguidos perdidos son ya un corte del
 * flujo, no un tropiezo. Por encima de este hueco la interpolación ha dejado de
 * dar dato fresco hace rato —congela pasados 0,25 s— y la serpiente se ve
 * parada, así que unir por una recta lo de antes con lo de después no suaviza
 * nada: inventa un trayecto.
 */
const HUECO_MAX = 0.3;

/**
 * Velocidad que ninguna serpiente puede alcanzar, en u/s.
 *
 * El techo legítimo es el turbo (306 u/s) por el mayor potenciador del juego
 * (1,22 en Pickup.js): 373 u/s. Un 50 % sobre el turbo deja margen para eso y
 * para la cuantización, y sigue muy por debajo del salto más lento medido al
 * cruzar un agujero del flujo (585 u/s).
 */
const VELOCIDAD_IMPOSIBLE = CFG.snake.boostSpeed * 1.5;

/**
 * Nombres de EVENTO que se reemiten en el bus de la sesión.
 *
 * El nombre lo elige el anfitrión, y el bus es el mismo donde esta sesión
 * publica 'estado', 'hola' y 'aparecer'. Sin lista blanca, un anfitrión
 * manipulado manda {"ev":"aparecer"} y el manejador de la serpiente propia
 * recibe un mensaje sin `snake`. Se enumeran los nombres del vocabulario en
 * lugar de vetar los tres internos: así un nombre interno nuevo queda protegido
 * el día que se añada, sin que nadie tenga que acordarse.
 */
const EVENTOS_REEMITIDOS = new Set([
  'entra', 'sale', 'baja', 'censo', 'apariencias', 'muerte', 'aparicion',
  'inactivo', 'activo', 'marcador', 'fin',
]);

const relojPorDefecto = () => (
  typeof performance !== 'undefined' ? performance.now() : Date.now()
) / 1000;

const tamano = (datos) => datos?.byteLength ?? datos?.length ?? 0;
const textoError = (e) => (e && e.message) ? e.message : String(e ?? 'desconocido');
const HEX = /^#[0-9a-f]{6}$/i;

export class SesionCliente {
  /**
   * @param {object}   opciones.sala        transporte (ver contrato arriba)
   * @param {object}   opciones.apariencia  { primary, secondary, pattern, eyes, trail }
   * @param {string}   opciones.nombre      nombre visible
   * @param {string|object} opciones.tema   id de tema o el tema ya resuelto
   * @param {Function} opciones.reloj       inyectable para las pruebas
   */
  constructor({ sala, apariencia, nombre, tema, reloj, prediccion } = {}) {
    this.sala = sala ?? null;
    this.apariencia = apariencia ?? null;
    this.nombre = String(nombre ?? 'Sierpe').slice(0, 18);
    this.tema = typeof tema === 'string' ? getTheme(tema) : (tema ?? getTheme('panal'));
    this._reloj = reloj ?? relojPorDefecto;

    this.estado = ESTADO.CONECTANDO;
    this.motivo = '';
    this.eventos = new EventBus();

    // ── Identidad y mundo, tal como los declara el anfitrión ──
    this.miId = -1;
    this.mundo = { w: CFG.world.w, h: CFG.world.h };
    this.modo = 'classic';
    this.tickAnfitrion = 0;

    this.buffer = new InterpolationBuffer(STEP);
    this.red = new NetStats();
    this.prediccion = prediccion ?? new Prediccion({ paso: STEP });

    /** Serpiente propia, predicha. No pasa por el buffer de interpolación. */
    this.yo = null;
    /** @type {Map<number, Snake>} netId → serpiente ajena reconstruida */
    this.serpientes = new Map();
    /** @type {Map<number, object>} netId → piel ya construida */
    this.pieles = new Map();
    this.nombres = new Map();
    this.orbes = [];
    this.marcador = [];

    this.tickEntrada = 0;
    this._ultimaEntrada = { angulo: 0, turbo: false };
    this._autoritativo = null;     // estado propio pendiente de reconciliar

    this._tiempo = 0;
    this._silencio = 0;
    this._desdePing = PING_CADA;   // la primera sonda sale enseguida
    this._pingEnviado = 0;
    this._reintentos = 0;
    this._esperaReintento = 0;
    this._cerrando = false;
    this._enganchada = false;
    this._descartados = 0;
    this._saltosCortados = 0;      // muestras que describían un trayecto imposible
    this._eventosDescartados = 0;  // nombres fuera del vocabulario o manejador que lanzó

    this._peticiones = new Map();  // netId → veces que se ha pedido su apariencia
    this._proximaPeticion = 0;

    // Estructuras reutilizadas: con 20 serpientes a 60 Hz, crearlas por
    // fotograma serían miles de objetos al segundo solo para alimentar al
    // recolector de basura.
    this._reserva = [];
    this._vistos = new Set();
    this._presentes = new Set();
    this._retirados = [];
    this._listaVisible = [];
    this._congeladas = new Map();   // netId → segundos sin muestra fresca
    this._deltas = [];              // saltos de tick entre paquetes consecutivos
    this._tickPrevio = null;
    this._paquete = 0;
    this._perdida = 0;              // fracción de paquetes perdidos, suavizada

    this._recibir = (datos) => this.alRecibirMensaje(datos);
    this._alCaer = (motivo) => this._perderCanal(textoError(motivo) || 'canal cerrado');

    this._engancharSala();
  }

  /* ═══════════════ Ciclo de vida ═══════════════ */

  /**
   * Abre el canal (si la sala sabe hacerlo) y se presenta.
   * Es idempotente: la reconexión pasa por aquí mismo.
   */
  async conectar() {
    if (this.estado === ESTADO.CERRADO) return false;
    this._fijarEstado(ESTADO.CONECTANDO, '');

    try {
      if (typeof this.sala?.conectar === 'function') await this.sala.conectar();
    } catch (e) {
      this._fijarEstado(ESTADO.PERDIDO, `no se pudo abrir el canal: ${textoError(e)}`);
      this._programarReintento();
      return false;
    }

    this._engancharSala();
    this._silencio = 0;
    this._enviarJoin();
    return true;
  }

  /** Salida voluntaria. Tras esto la sesión no revive: hay que crear otra. */
  cerrar(motivo = 'salida voluntaria') {
    if (this.estado === ESTADO.CERRADO) return;
    this._cerrando = true;
    this._enviar(encodeJson(MSG.BYE, { razon: motivo }));
    try { this.sala?.cerrar?.(); } catch { /* el canal ya podía estar roto */ }

    this.buffer.clear();
    this._retirados.length = 0;
    for (const id of this.serpientes.keys()) this._retirados.push(id);
    for (const id of this._retirados) this._retirar(id);
    this.orbes.length = 0;
    this._autoritativo = null;
    this._fijarEstado(ESTADO.CERRADO, motivo);
  }

  /* ═══════════════ Entrada de mensajes ═══════════════ */

  /**
   * Punto único de entrada desde la sala. Acepta ArrayBuffer, vistas tipadas y
   * texto, que es lo que puede entregar un canal de datos.
   */
  alRecibirMensaje(datos) {
    if (this.estado === ESTADO.CERRADO || datos == null) return;

    // decodeMessage confía en que el paquete está completo: un SNAPSHOT truncado
    // que dice traer 40 serpientes revienta al leer más allá del buffer. Aquí se
    // atrapa, porque quien llama es el bucle de mensajes de la sala y una
    // excepción suelta se llevaría por delante toda la recepción.
    let msg = null;
    try {
      msg = decodeMessage(datos);
    } catch {
      this._descartados++;
      return;
    }
    if (!msg) {
      // Basura o un tipo que este cliente no conoce. Se cuenta y se ignora: un
      // anfitrión más nuevo no debe poder tumbar al invitado con un mensaje.
      this._descartados++;
      return;
    }

    const bytes = tamano(datos);
    this._silencio = 0;

    switch (msg.type) {
      case MSG.SNAPSHOT: this._instantanea(msg, bytes); break;
      case MSG.ORBS:     this.red.bytesIn += bytes; this._recibirOrbes(msg.orbs); break;
      case MSG.HELLO:    this.red.bytesIn += bytes; this._hola(msg); break;
      case MSG.EVENT:    this.red.bytesIn += bytes; this._evento(msg); break;
      case MSG.BYE:
        this.red.bytesIn += bytes;
        this.cerrar(msg.razon ?? msg.motivo ?? 'el anfitrión cerró la sala');
        break;
      default:           this._descartados++;
    }
  }

  _hola(msg) {
    if (msg.v !== PROTOCOL_VERSION) {
      // Sin negociación de versiones: dos protocolos distintos interpretan los
      // mismos bytes de forma distinta y el resultado sería un mundo corrupto.
      this.cerrar(`protocolo incompatible: sala ${msg.v}, cliente ${PROTOCOL_VERSION}`);
      return;
    }

    // El tema lo decide el anfitrión: las pieles se ajustan para contrastar con
    // el fondo, y el fondo que se va a dibujar es el suyo. Si cambia, la piel
    // propia se rehace: la de antes se aclaró contra otro fondo.
    if (msg.tema) {
      const tema = getTheme(msg.tema);
      if (tema !== this.tema) { this.tema = tema; this.miPiel = null; }
    }
    if (msg.mundo) {
      this.mundo.w = Number(msg.mundo.w) || this.mundo.w;
      this.mundo.h = Number(msg.mundo.h) || this.mundo.h;
    }
    if (msg.modo) this.modo = msg.modo;
    if (Number.isFinite(msg.tick)) this.tickAnfitrion = msg.tick;

    // Al reconectar el anfitrión reparte un identificador nuevo: la serpiente
    // anterior ya no es la nuestra y hay que dejar que la reconstruya el estado.
    const mio = msg.tuId ?? msg.yourId;
    if (Number.isFinite(mio) && this.miId !== mio) {
      this.yo = null;
      this.miPiel = null;
      this.miId = mio;
    }

    // El anfitrión manda la identidad propia suelta y las ajenas por censo.
    if (msg.tu) this._registrarJugadores([msg.tu]);
    this._registrarJugadores(msg.jugadores ?? msg.filas);
    this._reintentos = 0;
    this._fijarEstado(ESTADO.JUGANDO, '');
    this.eventos.emit('hola', msg);
  }

  _instantanea(msg, bytes) {
    const ahora = this._reloj();
    this.red.onPacket(ahora, bytes, this._secuencia(msg.tick));
    this.tickAnfitrion = msg.tick;

    // Si el HELLO se perdió, el propio estado trae el identificador. Sin esto,
    // una sesión podría quedarse dibujando a los demás y sin serpiente propia.
    if (this.miId < 0 && Number.isFinite(msg.yourId)) this.miId = msg.yourId;
    if (this.estado === ESTADO.CONECTANDO) this._fijarEstado(ESTADO.JUGANDO, '');

    this._cortarSaltos(msg);
    this.buffer.push(msg, ahora);

    for (const s of msg.snakes) {
      if (s.id !== this.miId) continue;
      // La propia NO se lee del buffer: interpolarla la retrasaría 100 ms, que
      // es justo lo que la predicción existe para evitar.
      this._autoritativo = { ...s, ack: msg.ackInput, tick: msg.tick };
      break;
    }
  }

  /**
   * Rompe la continuidad de una entidad cuando el par de muestras que rodearía
   * al cabezal describe un trayecto imposible.
   *
   * El buffer une dos muestras cualesquiera con una recta: no puede saber que
   * entre ellas hubo una muerte, una reaparición o un rato fuera del radio de
   * interés. Cuando la serpiente vuelve al estado tras segundos de ausencia esa
   * recta cruza medio mapa en los pocos fotogramas que dura el hueco. Medido:
   * huecos de 2,0-2,4 s uniendo saltos de 1.200-1.400 u, hasta 4.472 u/s —
   * catorce veces el máximo del juego— sostenidos entre cuatro y nueve
   * fotogramas.
   *
   * Se corta ANTES de insertar, que es el único punto donde se sabe cuánto ha
   * pasado desde la muestra anterior. Sin la vieja no hay recta que dibujar y la
   * entidad reaparece directamente en su sitio. La serpiente local se retira
   * también: su cadena de remolque recuerda un camino que no ocurrió, y
   * arrastrarla por el salto metería el mismo latigazo en el cuerpo.
   *
   * El criterio es la velocidad implícita y no solo el hueco: una serpiente que
   * estuvo fuera de vista dos segundos y apenas se movió sí se puede unir por
   * una recta sin mentir, y cortar ahí sería un parpadeo gratis.
   *
   * En las pruebas este contador se queda en cero: 'muerte' y 'aparicion' llegan
   * antes y ya han vaciado la entidad. Es a propósito una RED DE SEGURIDAD, no
   * la vía principal. Cubre lo que el aviso fiable no puede: que una instantánea
   * aún en vuelo por el canal no ordenado adelante al aviso, que el cliente se
   * reconecte y se pierda el evento, o que un anfitrión no mande 'aparicion'.
   */
  _cortarSaltos(msg) {
    const tiempoAnfitrion = msg.tick * STEP;
    for (const s of msg.snakes) {
      const e = this.buffer.entities.get(s.id);
      const previa = e && e.samples[e.samples.length - 1];
      if (!previa) continue;

      const hueco = tiempoAnfitrion - previa.t;
      if (hueco <= HUECO_MAX) continue;
      const salto = Math.hypot(s.x - previa.x, s.y - previa.y);
      if (salto <= VELOCIDAD_IMPOSIBLE * hueco) continue;

      this.buffer.entities.delete(s.id);
      this._retirar(s.id);          // la propia no está aquí: para ella no hace nada
      this._congeladas.delete(s.id);
      this._saltosCortados++;
    }
  }

  /**
   * Traduce el tick del anfitrión a un número de paquete consecutivo y estima
   * de paso cuántos se han perdido.
   *
   * NetStats cuenta huecos dando por hecho que el contador sube de uno en uno.
   * El tick sube de tres en tres —es de pasos, a 60 Hz, y los paquetes salen a
   * 20 Hz—, así que cada paquete parecería traer dos perdidos detrás y la
   * pérdida se clavaría en el 100 %. El salto normal no se cablea: se deduce
   * como el menor observado en una ventana reciente, y así un anfitrión que
   * cambie de ritmo se sigue midiendo bien.
   */
  _secuencia(tick) {
    if (this._tickPrevio === null) { this._tickPrevio = tick; return this._paquete; }

    const salto = tick - this._tickPrevio;
    this._tickPrevio = tick;
    if (salto <= 0) return this._paquete;      // duplicado o llegada desordenada

    this._deltas.push(salto);
    if (this._deltas.length > DELTAS_MUESTRA) this._deltas.shift();
    let paso = 0;
    for (const d of this._deltas) if (!paso || d < paso) paso = d;

    const esperados = Math.max(1, Math.round(salto / paso));
    this._paquete += esperados;

    // Pérdida propia, aparte de la de NetStats: aquella solo sube —su media
    // ponderada vive dentro del if del hueco—, así que un tropiezo suelto
    // dejaría el indicador clavado toda la partida. Esta decae en un segundo
    // largo cuando la red se recupera, que es lo que el jugador espera ver.
    const fraccion = (esperados - 1) / esperados;
    this._perdida += (fraccion - this._perdida) * 0.05;
    return this._paquete;
  }

  _evento(msg) {
    switch (msg.ev) {
      case 'pong':
        if (Number.isFinite(msg.ts)) this.red.onRtt((this._reloj() - msg.ts) * 1000);
        return;
      case 'ping':
        // Que el anfitrión mida su latencia contra nosotros sale gratis.
        this._enviar(encodeJson(MSG.EVENT, { ev: 'pong', ts: msg.ts }));
        return;
      case 'censo':
      case 'apariencias':
        this._registrarJugadores(msg.filas ?? msg.jugadores);
        break;
      case 'muerte':
        this._muerte(Number(msg.id));
        break;
      case 'aparicion':
        this._aparicion(Number(msg.id));
        break;
      case 'baja':
        // El netId deja de existir y puede reciclarse para otro jugador: si se
        // guardara su nombre y su piel, el siguiente en heredarlo aparecería
        // con la identidad del anterior.
        this._retirar(msg.id);
        this.pieles.delete(msg.id);
        this.nombres.delete(msg.id);
        this._peticiones.delete(msg.id);
        break;
      case 'marcador':
        this.marcador = Array.isArray(msg.lista) ? msg.lista : [];
        break;
      default:
        break;
    }
    this._reemitir(msg);
  }

  /**
   * Retira una serpiente en cuanto el anfitrión confirma su muerte.
   *
   * Es la única vía: las muertas dejan de viajar en el paquete de estado, así
   * que esperar al temporizador de muestra rancia deja el cadáver deslizándose
   * 0,70 s después de que el aviso fiable ya hubiera llegado.
   */
  _muerte(id) {
    if (!Number.isFinite(id)) return;

    if (id === this.miId) {
      // Morir no se predice; aquí solo se apunta el hecho para que la predicción
      // deje de adelantar un cadáver. Dónde queda el cuerpo lo dice el estado.
      // Sin esto, una muerte y su reaparición que caigan entre dos instantáneas
      // no se ven, y la reconciliación las lee como un error de miles de
      // unidades: medido, saltos duros de 2.960 y 3.197 u con `yo.alive` a true.
      if (this.yo) this.yo.alive = false;
      return;
    }

    this._retirar(id);
    this._congeladas.delete(id);
    // Sus muestras describen a alguien que ya no está: sin borrarlas el paso
    // siguiente la daría de alta otra vez con la última posición conocida.
    this.buffer.entities.delete(id);
  }

  /**
   * Un netId vuelve al paquete de estado, y puede volver desde cualquier punto
   * del mapa.
   *
   * Reaparecer no es moverse: entre la última muestra y la primera nueva no hay
   * trayecto que interpolar. El anfitrión manda este aviso por canal fiable y
   * con la posición precisamente porque él sí sabe que hubo discontinuidad.
   */
  _aparicion(id) {
    if (!Number.isFinite(id) || id === this.miId) return;
    this._retirar(id);
    this._congeladas.delete(id);
    this.buffer.entities.delete(id);
  }

  /**
   * Reemite en el bus de la sesión, y solo los nombres del vocabulario.
   *
   * La lista blanca impide que el anfitrión publique con el nombre de un evento
   * INTERNO: 'aparecer' llega a su manejador sin `snake` y lo revienta.
   *
   * El aislamiento se hace oyente a oyente, no envolviendo la llamada entera.
   * EventBus.emit recorre sus manejadores sin guarda, así que envolver el emit
   * completo no salvaba a los demás: si el segundo de cinco lanzaba, el tercero,
   * el cuarto y el quinto seguían sin ejecutarse igual que antes. Lo único que
   * cambiaba era que el fallo dejaba de verse.
   *
   * Y el error se saca por consola además de contarlo: un contador que solo
   * asoma en el panel de depuración convierte un fallo real en invisible, que es
   * peor que el fallo ruidoso que se quería evitar.
   */
  _reemitir(msg) {
    if (!EVENTOS_REEMITIDOS.has(msg.ev)) {
      if (msg.ev) this._eventosDescartados++;
      return;
    }

    const oyentes = this.eventos.handlers?.get(msg.ev);
    if (!oyentes) return;

    for (const fn of oyentes) {
      try {
        fn(msg);
      } catch (err) {
        this._eventosDescartados++;
        this.ultimoError = err;
        console.warn(`[red] manejador de '${msg.ev}' lanzó:`, err);
      }
    }
  }

  /* ═══════════════ Paso del cliente ═══════════════ */

  /**
   * @param {number} dt      paso fijo, el mismo que usa el bucle (STEP)
   * @param {object} entrada { angulo, turbo }. Si es null se repite la última:
   *   soltar el ratón no debe frenar a la serpiente.
   */
  tick(dt, entrada = null) {
    if (this.estado === ESTADO.CERRADO) return;
    this._tiempo += dt;

    if (this.estado === ESTADO.PERDIDO) {
      // La cuenta atrás del reintento vive aquí, no en un temporizador: así la
      // sesión es determinista en las pruebas y no deja timers sueltos al cerrar.
      this._esperaReintento -= dt;
      if (this._esperaReintento <= 0) this.conectar().catch(() => {});
      return;
    }

    this._silencio += dt;
    if (this._silencio > SILENCIO_MAX) {
      this._perderCanal('silencio del anfitrión');
      return;
    }

    this._sondear(dt);
    this._reconciliar();
    this._predecir(dt, entrada);

    this.buffer.advance(dt);
    this._sincronizarRemotas(dt);
    this._animarOrbes(dt);
    this._pedirAparienciasPendientes();
  }

  /** Envía la entrada y adelanta la serpiente propia sin esperar respuesta. */
  _predecir(dt, entrada) {
    const previa = this._ultimaEntrada;
    const angulo = Number.isFinite(entrada?.angulo) ? entrada.angulo : previa.angulo;
    const turbo = entrada ? !!entrada.turbo : previa.turbo;
    previa.angulo = angulo;
    previa.turbo = turbo;

    // Hasta que el anfitrión no ha mandado nuestra serpiente no hay nada que
    // predecir, y por tanto tampoco pose que anotar. Enviar entradas ahora hace
    // que el acuse del primer paquete de estado señale un tick del que la
    // predicción no guarda referencia; el error se mediría entonces contra la
    // cabeza actual y no contra la de ese tick. Se calla y el contador espera:
    // así todo tick que el anfitrión acuse tiene su pose.
    if (!this.yo) return;

    this.tickEntrada++;
    // Se manda aunque no haya cambiado nada: el anfitrión devuelve este número
    // como acuse, y sin flujo continuo no puede saber hasta dónde reconciliar
    // ni distinguir a un jugador quieto de uno desconectado. También mientras se
    // está muerto, que es cuando más se nota que te den por desconectado.
    this._enviar(encodeInput(this.tickEntrada, angulo, turbo));

    if (!this.yo.alive) return;
    const paso = { tick: this.tickEntrada, angulo, turbo };
    this.prediccion.registrarEntrada(this.tickEntrada, angulo, turbo);

    // registrarEntrada ya adelanta la serpiente por su cuenta si la instancia la
    // tiene fijada con establecerSerpiente(). Aquí se lleva el paso a mano —la
    // vía que la propia Prediccion contempla—, así que solo se da si no la
    // tiene: hacerlo dos veces la movería al doble de velocidad.
    if (this.prediccion.snake !== this.yo) this.prediccion.aplicarPaso(this.yo, paso, dt);
  }

  /** Encaja el último estado autoritativo propio con lo que se había predicho. */
  _reconciliar() {
    const e = this._autoritativo;
    if (!e) return;
    this._autoritativo = null;

    if (!this.yo) { this._crearPropia(e); return; }

    if (!e.alive) {
      this.yo.alive = false;      // morir no se predice: lo decide el anfitrión
      return;
    }
    if (!this.yo.alive) {
      // Reaparición: no hay predicción que reconciliar con un salto de mapa, se
      // planta donde diga el anfitrión y se empieza de cero.
      this.yo.respawn(e.x, e.y, e.angle, 0);
      this.yo.setReplayPose(e.x, e.y, e.mass);
      // Un salto de mapa invalida todo el historial y cualquier deuda visual
      // pendiente: reiniciar es más barato y más correcto que reconciliar.
      this.prediccion.reiniciar?.();
      this.prediccion.limpiarHistorial(e.ack);
      return;
    }

    // La masa nunca se predice: el cliente no sabe qué ha comido ni a quién ha
    // matado. Llega hecha y el grosor la persigue con su propia transición.
    //
    // Se adopta SIEMPRE, sin umbral. Medido: suprimir esta línea por completo
    // deja los mismos números hasta el último decimal en las tres redes y en
    // 3.507 reconciliaciones, porque Prediccion.reconciliar() vuelve a escribir
    // la masa del anfitrión por setReplayPose() en todo camino que no sea la
    // zona muerta, y dentro de la zona muerta la masa ya coincide. Un umbral
    // solo añadiría una divergencia permanente con la autoridad —de la masa
    // salen la puntuación, el grosor y el ritmo de giro— sin ganar nada.
    this.yo.mass = e.mass;
    this.yo.shield = e.shield ? 1 : 0;
    this.yo.spikeTimer = e.spikes ? 1 : 0;

    this.prediccion.reconciliar(this.yo, e, e.ack);
    this.prediccion.limpiarHistorial(e.ack);
  }

  _crearPropia(e) {
    this.yo = new Snake({
      x: e.x, y: e.y, angle: e.angle, mass: e.mass,
      skin: this._pielPropia(), name: this.nombre, isPlayer: true,
    });
    this.yo.netId = this.miId;
    this.yo.invuln = 0;         // el brillo de gracia lo marca el anfitrión
    this.eventos.emit('aparecer', { snake: this.yo });
  }

  /**
   * Coloca a las serpientes ajenas en el instante de representación.
   *
   * Solo se les da la cabeza: setReplayPose reconstruye el cuerpo con la cadena
   * de remolque, de modo que lo que se ve aquí es la misma forma que en la
   * pantalla del anfitrión aunque no haya viajado ni un nodo.
   */
  _sincronizarRemotas(dt) {
    const vistos = this._vistos;
    const presentes = this._presentes;
    vistos.clear();
    presentes.clear();

    for (const id of this.buffer.ids()) {
      presentes.add(id);
      if (id === this.miId) continue;
      const m = this.buffer.sample(id);
      if (!m) continue;
      if (!m.alive) { this._retirar(id); this._congeladas.delete(id); continue; }

      // El buffer guarda las muestras tres segundos antes de podarlas, y
      // mientras tanto devuelve la última marcada como rancia. Quedarse con ella
      // dejaría una serpiente congelada en pantalla tres segundos cada vez que
      // alguien sale del radio de interés. Se le da margen para un tropiezo de
      // red y, si no vuelve, se retira.
      if (m.stale) {
        const parada = (this._congeladas.get(id) ?? 0) + dt;
        this._congeladas.set(id, parada);
        if (parada > CONGELADA_MAX) { this._retirar(id); continue; }
      } else if (this._congeladas.size) {
        const parada = this._congeladas.get(id);
        this._congeladas.delete(id);

        // Volver de congelada es el único punto donde la cabeza puede saltar.
        //
        // Mientras no llega dato, el búfer clava la entidad en su última
        // posición conocida; al llegar el paquete siguiente, setReplayPose la
        // planta de golpe donde esté ahora, y el cuerpo se arrastra tras ella
        // por una recta que nadie recorrió. Medido: hasta 86,7 u en un solo
        // fotograma, unas 5.200 u/s, diecisiete veces el máximo del juego.
        //
        // El guardián de _cortarSaltos no lo ve porque compara muestras
        // consecutivas del búfer, y aquí el salto está entre lo DIBUJADO y la
        // muestra nueva. Si el trayecto es imposible se resiembra la serpiente
        // en su sitio en vez de deslizarla.
        const s = this.serpientes.get(id);
        if (s && parada > 0) {
          // El listón NO es "cuánto pudo moverse la serpiente" —pudo moverse
          // mucho, estaba viva— sino "cuánto puede saltar el DIBUJO sin que se
          // note". Mientras estuvo congelada se pintó quieta, así que cualquier
          // recuperación por encima de un par de fotogramas de movimiento se ve
          // como un tirón. Medir contra la distancia recorrible dejaba pasar
          // saltos de 86 u en un fotograma: legítimos en el mundo, imposibles
          // en pantalla.
          const salto = Math.hypot(m.x - s.head.x, m.y - s.head.y);
          if (salto > SALTO_DIBUJABLE) {
            this._retirar(id);
            this._saltosCortados++;
          }
        }
      }

      vistos.add(id);
      const s = this.serpientes.get(id) ?? this._nacer(id, m);
      s.boosting = m.boosting;
      s.shield = m.shield ? 1 : 0;
      // Estas serpientes no ejecutan step(), así que ningún temporizador
      // decrece solo: los estados se refrescan desde las banderas del paquete.
      s.spikeTimer = m.spikes ? 1 : 0;
      s.setReplayPose(m.x, m.y, m.mass);
    }

    this._retirados.length = 0;
    for (const id of this.serpientes.keys()) {
      if (!vistos.has(id)) this._retirados.push(id);
    }
    for (const id of this._retirados) this._retirar(id);

    // Fuera de la vista de interés (1400 unidades) el anfitrión deja de mandar
    // una serpiente: sin poda, sus muestras quedarían para siempre.
    this.buffer.prune(this._reloj());
    for (const id of this._congeladas.keys()) {
      if (!presentes.has(id)) this._congeladas.delete(id);
    }
  }

  _nacer(id, m) {
    const piel = this._pielDe(id);
    const nombre = this.nombres.get(id) ?? '';

    // Reciclar en lugar de construir: cada Snake nueva siembra su cadena entera
    // y con jugadores entrando y saliendo de la vista eso se paga constantemente.
    let s = this._reserva.pop();
    if (s) {
      s.respawn(m.x, m.y, m.angle, 0);
      s.skin = piel;
      s.name = nombre;
    } else {
      s = new Snake({ x: m.x, y: m.y, angle: m.angle, skin: piel, name: nombre });
    }
    s.netId = id;
    s.isPlayer = false;
    s.brain = null;
    s.invuln = 0;
    this.serpientes.set(id, s);
    return s;
  }

  _retirar(id) {
    const s = this.serpientes.get(id);
    if (!s) return;
    this.serpientes.delete(id);
    s.alive = false;
    if (this._reserva.length < RESERVA_MAX) this._reserva.push(s);
  }

  /* ═══════════════ Pieles ═══════════════ */

  _pielPropia() {
    if (!this.miPiel) this.miPiel = this._construirPiel(this.apariencia, this.miId);
    return this.miPiel;
  }

  _pielDe(id) {
    const piel = this.pieles.get(id);
    if (piel) return piel;

    // Sin apariencia conocida se pinta ya con una de bot y se pide la buena:
    // esperar la respuesta dejaría una serpiente invisible varios paquetes, que
    // en este juego es la diferencia entre esquivar y morir.
    const provisional = botSkin(id, this.tema);
    this.pieles.set(id, provisional);
    this._pedirApariencia(id);
    return provisional;
  }

  /**
   * @param {object} fuente  identidad del anfitrión: puede traer la piel ya
   *   construida (`piel`) o solo los colores base (`apariencia`).
   */
  _construirPiel(fuente, id) {
    // La piel entera manda: viene del anfitrión y es la que él está dibujando.
    // Reconstruirla desde los colores base podría dar otro resultado si el tema
    // no coincide, y entonces cada jugador vería a los demás de otro color.
    if (fuente?.piel?.head) return fuente.piel;

    const apariencia = fuente?.apariencia ?? fuente;
    if (!apariencia || !HEX.test(apariencia.primary ?? '')) return botSkin(id, this.tema);
    return buildSkin({
      primary: apariencia.primary,
      secondary: HEX.test(apariencia.secondary ?? '') ? apariencia.secondary : '#101418',
      pattern: apariencia.pattern,
      eyes: apariencia.eyes,
      trail: apariencia.trail,
    }, this.tema);
  }

  _registrarJugadores(lista) {
    if (!Array.isArray(lista)) return;
    for (const j of lista) {
      const id = Number(j?.id);
      if (!Number.isFinite(id)) continue;

      const nombre = String(j.nombre ?? '').slice(0, 18);
      this.nombres.set(id, nombre);
      this._peticiones.delete(id);

      if (id === this.miId) {
        this.nombre = nombre || this.nombre;
        this.miPiel = this._construirPiel(j, id);
        if (this.yo) this.yo.skin = this.miPiel;
        continue;
      }
      const piel = this._construirPiel(j, id);
      this.pieles.set(id, piel);

      // Puede que ya estuviera dibujándose con la piel provisional.
      const s = this.serpientes.get(id);
      if (s) { s.skin = piel; s.name = nombre; }
    }
  }

  _pedirApariencia(id) {
    if (this._peticiones.has(id)) return;
    this._peticiones.set(id, 0);
  }

  /**
   * Las peticiones van en tanda y con tope. Un anfitrión que no conteste no
   * debe convertirse en un goteo de mensajes durante toda la partida: pasadas
   * PETICIONES_MAX se juega con la piel provisional y se deja de insistir.
   */
  _pedirAparienciasPendientes() {
    if (this._peticiones.size === 0 || this._tiempo < this._proximaPeticion) return;
    this._proximaPeticion = this._tiempo + PETICION_CADA;

    const ids = [];
    for (const [id, veces] of this._peticiones) {
      if (veces >= PETICIONES_MAX) { this._peticiones.delete(id); continue; }
      this._peticiones.set(id, veces + 1);
      ids.push(id);
    }
    if (ids.length) this._enviar(encodeJson(MSG.EVENT, { ev: 'pideApariencias', ids }));
  }

  /* ═══════════════ Orbes ═══════════════ */

  /**
   * Los orbes llegan como una foto completa cada 200 ms. Se vuelcan sobre los
   * mismos objetos en lugar de crear una tanda nueva: son unos setenta por
   * paquete y a 5 Hz eso serían 21.000 objetos por minuto para nada.
   */
  _recibirOrbes(lista) {
    const pool = this.orbes;
    for (let i = 0; i < lista.length; i++) {
      const o = lista[i];
      let d = pool[i];
      if (!d) {
        d = {
          x: 0, y: 0, r: 3, hue: 0, kind: ORB_KIND.NORMAL,
          pulse: 0, pulseSpeed: PULSO_ORBE, attractTo: null, attractT: 0, active: true,
        };
        pool.push(d);
      }
      d.x = o.x;
      d.y = o.y;
      d.r = o.r;
      d.hue = o.hue;
      // La fase del titileo sale de la POSICIÓN, no del hueco del array. Si
      // dependiera del índice, cada foto reordenaría los orbes y el campo
      // entero parpadearía al unísono cinco veces por segundo.
      d.pulse = ((o.x * 0.021 + o.y * 0.017) % TAU) + this._tiempo * PULSO_ORBE;
    }
    pool.length = lista.length;
  }

  _animarOrbes(dt) {
    for (const o of this.orbes) o.pulse += o.pulseSpeed * dt;
  }

  /** Comida visible, ya con la forma que espera el renderizador. */
  orbesVisibles() {
    return this.orbes;
  }

  /**
   * Desvanece la corrección pendiente de la predicción.
   *
   * Va por FOTOGRAMA y con el dt real, no por paso de simulación: es lo único
   * de esta sesión que pertenece al bucle de dibujo. Si nadie la llama, la
   * predicción se desvanece igualmente al ritmo de la simulación, solo que sin
   * aprovechar los fotogramas intermedios.
   */
  actualizarVista(dtReal) {
    this.prediccion?.actualizar?.(dtReal);
  }

  /**
   * Dónde DIBUJAR la serpiente propia, que no es dónde está lógicamente: la
   * corrección suave vive como desplazamiento visual para no deformar el cuerpo.
   * La cámara debe seguir esto y no `yo.head`, o se moverá a tirones.
   */
  posicionVisual() {
    if (!this.yo) return null;
    return this.prediccion?.posicionVisual?.(this.yo) ?? this.yo.head;
  }

  /** Todo lo dibujable: la propia primero, para que quede por encima. */
  serpientesVisibles() {
    const lista = this._listaVisible;
    lista.length = 0;
    for (const s of this.serpientes.values()) lista.push(s);
    if (this.yo) lista.push(this.yo);
    return lista;
  }

  /* ═══════════════ Estado del canal ═══════════════ */

  _engancharSala() {
    if (!this.sala || this._enganchada) return;
    this._suscribir('alMensaje', 'onMensaje', this._recibir);
    this._suscribir('alCerrar', 'onCierre', this._alCaer);
    this._enganchada = true;
  }

  /** Admite sala con método suscriptor o con propiedad asignable. */
  _suscribir(metodo, propiedad, fn) {
    if (typeof this.sala[metodo] === 'function') this.sala[metodo](fn);
    else this.sala[propiedad] = fn;
  }

  _enviarJoin() {
    this._enviar(encodeJson(MSG.JOIN, {
      v: PROTOCOL_VERSION,
      nombre: this.nombre,
      apariencia: this.apariencia,
      tema: this.tema?.id ?? 'panal',
    }));
  }

  _enviar(datos) {
    const sala = this.sala;
    if (!sala || sala.abierta === false) return false;
    try {
      sala.enviar(datos);
    } catch (e) {
      this._perderCanal(`fallo al enviar: ${textoError(e)}`);
      return false;
    }
    this.red.bytesOut += tamano(datos);
    return true;
  }

  _perderCanal(motivo) {
    if (this._cerrando || this.estado === ESTADO.CERRADO) return;
    if (this.estado === ESTADO.PERDIDO) return;

    // Lo guardado en el buffer es pasado que ya no encaja con el reloj del
    // anfitrión cuando vuelva: reproducirlo daría un tirón hacia atrás.
    this.buffer.clear();
    this._autoritativo = null;
    this._enganchada = false;   // el canal nuevo traerá sus propios enganches

    // El anfitrión seguirá contando ticks mientras estamos fuera: sin olvidar
    // el último, el primer paquete de vuelta parecería un agujero enorme.
    this._tickPrevio = null;
    this._deltas.length = 0;

    this._fijarEstado(ESTADO.PERDIDO, motivo);
    this._programarReintento();
  }

  /**
   * Espera creciente y acotada. Reintentar en bucle no levanta una red caída y
   * sí quema batería; y sin TURN hay conexiones que no van a abrirse nunca, así
   * que a los MAX_REINTENTOS se admite la derrota y se avisa a la interfaz.
   */
  _programarReintento() {
    if (this._reintentos >= MAX_REINTENTOS) {
      this.cerrar(`sin conexión tras ${MAX_REINTENTOS} intentos`);
      return;
    }
    this._esperaReintento = Math.min(ESPERA_MAX, ESPERA_BASE * 2 ** this._reintentos);
    this._reintentos++;
  }

  _fijarEstado(estado, motivo = '') {
    if (this.estado === estado && this.motivo === motivo) return;
    this.estado = estado;
    this.motivo = motivo;
    this.eventos.emit('estado', { estado, motivo });
  }

  _sondear(dt) {
    this._desdePing += dt;
    if (this._desdePing < PING_CADA) return;
    this._desdePing = 0;

    // Si el transporte ya mide la ida y vuelta —transport.js lo hace con pings
    // propios que ni siquiera llegan hasta aquí—, se lee de ahí. Mandar una
    // sonda sería tráfico duplicado para medir exactamente lo mismo, y además
    // el anfitrión no está obligado a contestarla.
    const delTransporte = this.sala?.rtt;
    if (Number.isFinite(delTransporte)) {
      if (delTransporte > 0) this.red.onRtt(delTransporte);
      return;
    }

    this._pingEnviado = this._reloj();
    // El campo NO puede llamarse `t`: encodeJson usa esa clave para el tipo.
    this._enviar(encodeJson(MSG.EVENT, { ev: 'ping', ts: this._pingEnviado }));
  }

  /* ═══════════════ Lectura para la interfaz ═══════════════ */

  get conectado() {
    return this.estado === ESTADO.JUGANDO;
  }

  /** Milisegundos salvo `perdida` (porcentaje) y los contadores de bytes. */
  get estadisticas() {
    return {
      estado: this.estado,
      motivo: this.motivo,
      rtt: Math.round(this.red.rtt),
      jitter: Math.round(this.red.jitter * 1000),
      perdida: Math.round(this._perdida * 100),
      retraso: Math.round(this.buffer.lag * 1000),
      entidades: this.serpientes.size,
      orbes: this.orbes.length,
      bytesEntrada: this.red.bytesIn,
      bytesSalida: this.red.bytesOut,
      reintentos: this._reintentos,
      descartados: this._descartados,
      saltosCortados: this._saltosCortados,
      eventosDescartados: this._eventosDescartados,
      prediccion: this._statsPrediccion(),
    };
  }

  /** En Prediccion las estadísticas son un método, no una propiedad. */
  _statsPrediccion() {
    const p = this.prediccion;
    if (!p) return null;
    return typeof p.estadisticas === 'function' ? p.estadisticas() : (p.estadisticas ?? null);
  }
}

/**
 * Envuelve la `Sala` de transport.js en el contrato que espera SesionCliente.
 *
 * Se hace por duck typing y sin importar transport.js a propósito: en cuanto
 * este módulo dependiera de él arrastraría la detección de WebRTC al grafo de
 * importaciones y dejaría de poder probarse con una sala de mentira.
 *
 * La sala del cliente tiene un único par —el anfitrión—, así que el id se toma
 * del primero disponible en lugar de pedirlo.
 */
export function salaDeTransporte(sala) {
  let receptor = null;
  let avisoCierre = null;

  // Los manejadores previos se encadenan: quien construyó la sala pudo poner
  // los suyos para la interfaz y no deben perderse por envolverla.
  const datosPrevio = sala.onDatos;
  const cortePrevio = sala.onParDesconectado;

  sala.onDatos = (id, datos, canal) => {
    datosPrevio?.(id, datos, canal);
    receptor?.(datos);
  };
  sala.onParDesconectado = (id, motivo) => {
    cortePrevio?.(id, motivo);
    avisoCierre?.(motivo ?? 'el anfitrión se desconectó');
  };

  return {
    get abierta() { return sala.abiertos > 0; },
    /** La ida y vuelta ya la mide el transporte: no hace falta sondear encima. */
    get rtt() { return sala.pares[0]?.rtt ?? NaN; },
    enviar(datos) {
      const par = sala.pares[0];
      // enviar() devuelve false en lugar de lanzar cuando el canal está caído;
      // aquí interesa lo contrario, para que la sesión lo note en el acto en vez
      // de esperar los cinco segundos del detector de silencio.
      if (!par || !sala.enviar(par.id, datos)) throw new Error('canal no disponible');
    },
    alMensaje(fn) { receptor = fn; },
    alCerrar(fn) { avisoCierre = fn; },
    cerrar() { sala.cerrar('salida del cliente'); },
  };
}
