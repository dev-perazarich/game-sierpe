/*
 * Sierpe — sesión del anfitrión en las partidas entre amigos.
 * Copyright (C) 2026 dev-perazarich · GNU AGPL v3.0
 */

/**
 * host.js — El anfitrión observa su propio mundo y lo reparte.
 *
 * ── Qué NO hace este archivo ──
 *
 * No simula. El anfitrión ya tiene un World corriendo con su bucle de paso fijo,
 * y esta clase se limita a mirar el resultado y decidir qué trozo le toca a cada
 * cliente. Meter aquí lógica de juego duplicaría la verdad y dejaría dos
 * versiones del mundo que pueden discrepar, que es justo lo que world.js evita.
 *
 * ── Por qué el ancho de banda no se dispara ──
 *
 * El coste de una sala no crece con el número de jugadores, crece con el
 * CUADRADO: cada jugador nuevo es un destinatario más y a la vez una entidad más
 * dentro de cada paquete. Con 12 jugadores amontonados y sin filtro, el
 * anfitrión enviaría 12 × 12 × 10 bytes × 20 Hz = 29 KB/s solo de cabezas, y eso
 * dando por hecho que no hay bots.
 *
 * La gestión de interés rompe ese cuadrado por los dos lados: un radio de vista
 * de 1.400 unidades deja fuera lo que el cliente no puede ver, y un tope duro de
 * serpientes por paquete garantiza que ni la peor aglomeración imaginable haga
 * crecer el paquete. El tope es lo que convierte «normalmente barato» en
 * «acotado», y sin él la sala se cae justo en el momento más divertido.
 *
 * ── La cuenta, con los valores por defecto ──
 *
 *   estado:  12 + 40 × 10 = 412 bytes como MÁXIMO absoluto, a 20 Hz → 66 kbps
 *   orbes:    4 + 140 × 6 = 844 bytes como máximo, a  5 Hz → 34 kbps
 *
 * Con 6 jugadores el anfitrión tiene 5 destinatarios (él mismo es local), y la
 * ocupación real ronda las 20 serpientes visibles: unos 340 kbps de subida, que
 * es lo medido (406 kbps con el tráfico fiable incluido). Una conexión doméstica
 * española sube 300-600 kbps sin despeinarse; una de fibra, mucho más.
 *
 * ── Contrato de `sala` ──
 *
 * La sala es una dependencia INYECTADA, nunca WebRTC directamente. Es lo que
 * permite probar toda esta lógica —interés, topes, censo, expiración— sin abrir
 * un solo canal de datos, con el objeto que devuelve `crearSalaFalsa()`. La
 * firma es la misma que expone la Sala real de transport.js:
 *
 *   sala.enviar(idPar, datos, canal)          → un destinatario
 *   sala.difundir(datos, excepto, canal)      → todos (opcional; si falta, se itera)
 *
 * `datos` es un ArrayBuffer (binario) o una cadena (JSON). `canal` es 'estado'
 * o 'control': 'control' es fiable y ordenado y lleva lo que no se puede perder
 * —censo, muertes, entradas y salidas—; 'estado' no es fiable y lleva las
 * cabezas y los orbes, donde reenviar un paquete viejo es peor que perderlo.
 *
 * Que `enviar` devuelva false significa que el paquete se descartó por
 * contrapresión. No se reintenta: el siguiente estado ya viene de camino y
 * llegará antes de que este sirviera para algo.
 *
 * ── Limitaciones asumidas ──
 *
 * El anfitrión es autoritativo, luego puede hacer trampas: entre amigos es un
 * precio razonable a cambio de no pagar un servidor. Su latencia es 0 y la del
 * resto es la suya propia; no hay compensación de retardo. Y si se va, la sala
 * muere: no hay migración de anfitrión.
 */

import { STEP } from '../config.js';
import { Snake } from '../entities/Snake.js';
import { scatterFromSnake } from '../entities/Orb.js';
import { EV } from '../engine/events.js';
import {
  buildSkin, botSkin, getTheme, PATTERNS, EYE_STYLES, TRAILS,
} from '../themes/index.js';
import {
  MSG, PROTOCOL_VERSION, encodeSnapshot, encodeOrbs, encodeJson,
  decodeMessage, decodeInput, snapshotBytes, orbsBytes,
} from './protocol.js';

/* ═══════════════ Ajustes ═══════════════ */

export const RADIO_INTERES = 1400;     // unidades de mundo desde la cabeza
export const TOPE_SERPIENTES = 40;     // por paquete de estado, incluida la propia
export const TOPE_ORBES = 140;         // por paquete de orbes
export const HZ_ESTADO = 20;
export const HZ_ORBES = 5;
export const TIMEOUT_ENTRADA = 5;      // segundos de silencio antes de marcar inactivo
export const MAX_JUGADORES = 8;

/**
 * Techo de mensajes por segundo y por par.
 *
 * La cadencia legítima son 60 entradas por segundo más algún JSON suelto, así
 * que 120 deja el doble de margen y sigue cortando en seco al cliente que
 * alterna JOIN y BYE miles de veces por segundo: cada ciclo creaba y destruía
 * una serpiente, quemaba un netId y metía tres mensajes en el canal fiable, que
 * NO tiene contrapresión.
 */
export const MAX_MSG_POR_SEGUNDO = 120;

/**
 * Segundos que un par debe esperar tras despedirse para volver a entrar.
 *
 * Sin esta espera, decir adiós justo antes de morir es la forma barata de
 * negarle la presa al perseguidor y volver al instante con serpiente nueva,
 * saltándose reaparecer(). Tres segundos es lo que tarda en reaparecer un bot.
 */
export const REENTRADA_MIN = 3;

/** Canales de transport.js: 'estado' es no fiable, 'control' es fiable. */
export const CANAL_ESTADO = 'estado';
export const CANAL_CONTROL = 'control';

const ID_MAX = 65535;                  // el protocolo guarda netId en uint16
const MAX_LIBERADOS = 4096;
const CUARENTENA_ID = 30;              // segundos antes de reciclar un netId
const CAUSA_SALIDA = 'salida';
const MAX_NOMBRE = 18;

const VENTANA_TRAFICO = 1;             // segundos de la ventana del limitador
const MAX_VIGILADOS = 64;              // idPar distintos con contador a la vez

/**
 * JOIN y BYE llevan cupo propio, aparte del flujo de entradas.
 *
 * Compartir cupo con las 60 entradas por segundo tenía una consecuencia que
 * anulaba el arreglo de la reconexión: cuando el anfitrión pasa a segundo plano,
 * requestAnimationFrame baja a ~1 Hz y el mundo simula unos 5 pasos por segundo
 * real, pero el cliente sigue enviando entradas a 60 Hz. El contador se agotaba
 * con las entradas y los JOIN de reintento —que son justo la vía de
 * recuperación— se descartaban sin llegar a decodificarse. Medido: 1 de 4 JOIN
 * atendidos con el limitador frente a 4 de 4 sin él.
 */
const MAX_CONTROL_POR_VENTANA = 8;
const VENTANA_CONTROL = 10;            // segundos

/**
 * Tope de tamaño antes de decodificar. JSON.parse sobre una cadena enorme cuesta
 * tiempo real, así que un cliente no debe poder imponerlo enviando basura.
 */
const MAX_BYTES_MENSAJE = 4096;

/**
 * Ticks que una entrada espera en la cola a que llegue la que le falta.
 *
 * Con 60 entradas por segundo basta un temblor comparable al paso de 16,7 ms
 * para que lleguen desordenadas. Medido con ±40 ms de temblor, esperar 2 pasos
 * deja fuera el 14,9 % de las entradas, 3 pasos el 3,2 %, 4 pasos el 1,2 % y
 * 6 pasos el 0,5 %. Se eligen 4: pasar de ahí solo recupera medio punto y a
 * cambio mete dos pasos más de retraso en la mano del jugador cuando hay
 * pérdida, que es justo lo que la predicción existe para evitar.
 */
const VENTANA_ENTRADAS = 4;
const TOPE_ENTRADAS = 24;              // cola por cliente; tope duro
const MAX_IDS_PETICION = 32;           // ids por petición de apariencias
const MAX_FILAS_CENSO = 48;            // identidades por mensaje de censo

/** Avisos que viajan por el canal fiable dentro de un MSG.EVENT. */
export const EVENTO = {
  ENTRA:     'entra',      // un jugador se ha unido
  SALE:      'sale',       // un jugador se ha ido
  BAJA:      'baja',       // un netId deja de existir: bórralo del censo
  CENSO:     'censo',      // nombres y pieles de serpientes recién visibles
  MUERTE:    'muerte',
  APARICION: 'aparicion',  // nace o reaparece: vuelve a viajar en el estado
  INACTIVO:  'inactivo',
  ACTIVO:    'activo',
  FIN:       'fin',
};

/* ═══════════════ Sesión ═══════════════ */

export class SesionAnfitrion {
  /**
   * @param {object}  opciones
   * @param {World}   opciones.world          mundo ya en marcha del anfitrión
   * @param {object}  opciones.sala           transporte inyectado (ver cabecera)
   * @param {number} [opciones.maxJugadores]  clientes admitidos, sin contar al anfitrión
   * @param {number} [opciones.semilla]       semilla del mundo, para el HELLO
   */
  constructor({
    world,
    sala,
    maxJugadores = MAX_JUGADORES,
    semilla = null,
    hzEstado = HZ_ESTADO,
    hzOrbes = HZ_ORBES,
    radioInteres = RADIO_INTERES,
    radioOrbes = null,
    topeSerpientes = TOPE_SERPIENTES,
    topeOrbes = TOPE_ORBES,
    timeoutEntrada = TIMEOUT_ENTRADA,
    maxMensajesPorSegundo = MAX_MSG_POR_SEGUNDO,
    reentradaMinima = REENTRADA_MIN,
    // Inyectable para que los bancos controlen el tiempo sin depender del reloj
    // de la máquina. Ver _ahora().
    ahora = null,
  }) {
    this.world = world;
    this.sala = sala;
    this.maxJugadores = maxJugadores;
    this.semilla = semilla;

    this.hzEstado = hzEstado;
    this.hzOrbes = hzOrbes;
    this.radioInteres = radioInteres;
    this.radioOrbes = radioOrbes ?? radioInteres;
    this.topeSerpientes = Math.max(1, topeSerpientes);
    this.topeOrbes = Math.max(0, topeOrbes);
    this.timeoutEntrada = timeoutEntrada;
    this.maxMensajesPorSegundo = Math.max(1, maxMensajesPorSegundo);
    this.reentradaMinima = Math.max(0, reentradaMinima);
    this.ahora = ahora ?? (typeof performance !== 'undefined' && performance.now
      ? () => performance.now() / 1000
      : () => Date.now() / 1000);

    /** @type {Map<string, object>} idPar → registro del cliente */
    this.pares = new Map();

    /** @type {Map<string, object>} idPar → {desde, cuenta} del limitador */
    this._trafico = new Map();
    /** @type {Map<string, object>} idPar → {t, avisado} de la última despedida */
    this._salidas = new Map();

    // Apariciones que ha pedido ESTA sesión. Las demás vienen de la cola de
    // reaparición del modo, que trata a la serpiente de un cliente como un bot
    // suyo; ver el manejador de EV.SPAWN.
    this._aparicionesPedidas = new WeakSet();
    this._finAvisado = false;

    // Reloj propio. El tick que viaja en el paquete es el que el cliente
    // convierte en tiempo del anfitrión (tick × STEP) para interpolar, así que
    // tiene que contar PASOS DE SIMULACIÓN, no fotogramas ni envíos.
    this.tickActual = 0;
    this.tiempo = 0;

    /** @type {Map<number, Snake>} netId → serpiente */
    this._porId = new Map();
    this._siguienteId = 1;
    this._liberados = [];              // {id, t} en cuarentena
    this._vistas = new Set();
    this._pielesAsignadas = 0;

    this._intervaloEstado = 1 / hzEstado;
    this._intervaloOrbes = 1 / hzOrbes;
    this._accEstado = 0;
    this._accOrbes = 0;

    // Estadísticas: ventana deslizante de un segundo. Un contador acumulado no
    // sirve para decidir nada; lo que importa es el caudal instantáneo.
    this.bytesTotales = 0;
    this.bytesPorSegundo = 0;
    this.paquetesEstado = 0;
    this.paquetesOrbes = 0;
    this.descartados = 0;              // paquetes que el transporte no admitió
    this.errores = 0;
    this.ultimoError = null;
    // Lo que llega mal contado aparte: si crece, alguien está inundando o
    // hablando otro protocolo, y sin verlo no hay forma de decidir si expulsar.
    this.deformes = 0;                 // mensajes que no se pudieron decodificar
    this.limitados = 0;                // mensajes cortados por el limitador
    this.entradasTardias = 0;          // entradas llegadas después de su turno
    this.recicladosEnCaliente = 0;     // netId reutilizados sin cumplir cuarentena
    this._bytesVentana = 0;
    this._ventanaDesde = 0;

    // Estructuras reutilizadas entre envíos: con 5 clientes a 20 Hz, reservar
    // arrays nuevos serían 100 asignaciones por segundo que solo alimentan al
    // recolector de basura en mitad de la simulación.
    this._envio = [];
    this._envioOrbes = [];
    this._orden = [];
    this._ordenOrbes = [];
    this._pool = [];
    this._poolOrbes = [];
    this._scratchOrbes = [];
    this._poolEntradas = [];           // ranuras de cola de entrada reutilizadas

    /** Callback opcional: la capa de sala decide si expulsa o espera. */
    this.alParInactivo = null;

    this._sueltas = [];
    this._engancharEventos();
    this._sincronizarIds();
  }

  /* ─────────────── Altas y bajas ─────────────── */

  /**
   * Da entrada a un cliente y le crea serpiente en el mundo del anfitrión.
   *
   * @param {string} idPar
   * @param {object} [datos]  {nombre, apariencia} tal y como llegaron en el JOIN
   * @returns {object|null} registro del cliente, o null si no se admite
   */
  alConectarPar(idPar, datos = {}) {
    const existente = this.pares.get(idPar);
    if (existente) {
      // El cliente solo pone su contador de reintentos a cero cuando recibe un
      // HELLO. Si el JOIN se repite —lo hace tras cada silencio, y el anfitrión
      // se queda mudo cada vez que cambia de pestaña, porque su bucle vive en
      // requestAnimationFrame— y aquí no se contesta nada, el cliente se cierra
      // solo con el canal WebRTC intacto. Contestar cuesta dos mensajes.
      this._enviarHola(existente);
      this._enviarCenso(existente, [...existente.conocidas]);
      return existente;
    }

    const salida = this._salidas.get(idPar);
    if (salida && this._ahora() - salida.t < this.reentradaMinima) {
      // Solo se avisa una vez por espera: contestar a cada intento convertiría
      // el propio rechazo en el tráfico que se quiere evitar.
      if (!salida.avisado) {
        salida.avisado = true;
        this._enviar(idPar, encodeJson(MSG.BYE, { razon: 'espera antes de volver' }),
          CANAL_CONTROL);
      }
      return null;
    }

    if (this.pares.size >= this.maxJugadores) {
      this._enviar(idPar, encodeJson(MSG.BYE, { razon: 'sala llena' }), CANAL_CONTROL);
      return null;
    }

    const nombre = limpiarNombre(datos.nombre);
    const serpiente = this._crearSerpiente(nombre, datos.apariencia);
    const netId = this._asignarId(serpiente);

    const reg = {
      idPar,
      nombre,
      serpiente,
      netId,
      // La piel ya construida se guarda aparte: si un modo retira la serpiente
      // del mundo hay que reponerla con el mismo aspecto, y la apariencia cruda
      // que mandó el cliente ya no está.
      piel: serpiente.skin,
      activo: true,
      ultimoTickEntrada: 0,
      ultimaEntradaEn: this.tiempo,
      entradasRecibidas: 0,
      cola: [],                      // entradas pendientes, ordenadas por tick
      tickConsumo: -1,               // tick del anfitrión en que se consumió una
      conocidas: new Set(),          // netIds cuyo nombre y piel ya conoce
      serpientesUltimoPaquete: 0,
      orbesUltimoPaquete: 0,
      bytesTotales: 0,
      bytesVentana: 0,
      bytesPorSegundo: 0,
      entroEn: this.tiempo,
    };
    this.pares.set(idPar, reg);

    this._enviarHola(reg);
    this._difundirEvento(EVENTO.ENTRA, { id: netId, nombre });
    return reg;
  }

  /**
   * Presentación del mundo para un cliente.
   *
   * El censo de nombres y pieles NO va aquí: mandarlo entero serían 9 KB de
   * golpe por un canal fiable, y la mayoría describiría serpientes que este
   * cliente no verá en toda la partida. Llega por goteo con el interés.
   */
  _enviarHola(reg) {
    return this._enviar(reg.idPar, encodeJson(MSG.HELLO, {
      v: PROTOCOL_VERSION,
      tuId: reg.netId,
      tick: this.tickActual,
      paso: STEP,
      hzEstado: this.hzEstado,
      hzOrbes: this.hzOrbes,
      radioInteres: this.radioInteres,
      mundo: { w: this.world.bounds.w, h: this.world.bounds.h },
      modo: this.world.mode?.id ?? null,
      semilla: this.semilla,
      maxJugadores: this.maxJugadores,
      tu: reg.serpiente ? identidad(reg.serpiente) : null,
    }), CANAL_CONTROL);
  }

  /**
   * Manda las identidades de una lista de netIds, troceada.
   *
   * Se trocea porque un censo completo de una sala llena pasa de los 9 KB y el
   * canal fiable los entregaría en una sola ráfaga, justo por delante del
   * siguiente paquete de estado.
   */
  _enviarCenso(reg, ids) {
    let filas = null;
    for (let i = 0; i < ids.length; i++) {
      const s = this._porId.get(ids[i]);
      if (!s) continue;
      (filas ??= []).push(identidad(s));
      if (filas.length < MAX_FILAS_CENSO) continue;
      this._enviar(reg.idPar, encodeJson(MSG.EVENT, { ev: EVENTO.CENSO, filas }), CANAL_CONTROL);
      filas = null;
    }
    if (filas) {
      this._enviar(reg.idPar, encodeJson(MSG.EVENT, { ev: EVENTO.CENSO, filas }), CANAL_CONTROL);
    }
  }

  /** Saca a un cliente: retira su serpiente y libera su netId. */
  alDesconectarPar(idPar, razon = 'desconexión') {
    const reg = this.pares.get(idPar);
    if (!reg) return false;
    this.pares.delete(idPar);

    const s = reg.serpiente;
    if (s) {
      // Se reparte su masa como orbes antes de retirarla. Si se evaporara sin
      // más, desconectar sería la forma barata de negarle la recompensa a quien
      // te estaba acorralando, y eso se aprende en dos partidas.
      //
      // No se pasa por world.kill: eso llamaría a mode.onKill, y para el modo
      // esta serpiente es un bot suyo —la única marca que mira es isPlayer—, así
      // que classic la encola y tres segundos después la revive ya retirada del
      // mundo: una aparición que ningún paquete de estado menciona jamás.
      if (s.alive) {
        s.alive = false;
        s.deathCause = CAUSA_SALIDA;
        s.boosting = false;
        scatterFromSnake(this.world.orbs, s, s.skin?.hue ?? null);
      }
      this.world.removeSnake(s);
    }
    this._liberarId(reg.netId);
    this._difundirEvento(EVENTO.SALE, { id: reg.netId, nombre: reg.nombre, razon });
    return true;
  }

  /** Devuelve a la vida la serpiente de un cliente. Lo pide la capa de sala. */
  reaparecer(idPar) {
    const reg = this.pares.get(idPar);
    if (!reg || !reg.serpiente || reg.serpiente.alive) return false;
    // Se marca ANTES de reaparecer: el manejador de EV.SPAWN cancela cualquier
    // resurrección de una serpiente remota que esta sesión no haya pedido.
    this._aparicionesPedidas.add(reg.serpiente);
    this.world.respawn(reg.serpiente);   // emite EV.SPAWN, que ya se retransmite
    return true;
  }

  serpienteDe(idPar) {
    return this.pares.get(idPar)?.serpiente ?? null;
  }

  /* ─────────────── Entrada del cliente ─────────────── */

  /**
   * Aplica la intención de un cliente a su serpiente.
   *
   * Solo se acepta INTENCIÓN —hacia dónde mira y si acelera—, jamás una
   * posición. El giro sigue pasando por turnRateForRadius dentro de Snake.step,
   * así que un cliente manipulado no puede teletransportarse ni girar más
   * cerrado de lo que su tamaño permite. Es el único antitrampas que este
   * diseño puede ofrecer, y cubre lo que de verdad rompería la partida.
   *
   * @param {string} idPar
   * @param {ArrayBuffer|object} mensaje  paquete crudo o ya decodificado
   */
  alRecibirEntrada(idPar, mensaje) {
    const reg = this.pares.get(idPar);
    if (!reg) return false;

    // decodeInput lee ocho bytes a ciegas: un datagrama truncado lanza aquí, y
    // la excepción escaparía por la sala hasta morir dentro del oyente del canal
    // sin que el anfitrión llegue a enterarse.
    let ent = null;
    try {
      ent = normalizarEntrada(mensaje);
    } catch (err) {
      this.deformes++;
      this.ultimoError = err;
      return false;
    }
    if (!ent) return false;

    // Solo se rechaza lo que ya se aplicó: reaplicarlo devolvería la serpiente a
    // un rumbo superado. Lo que llega desordenado pero aún a tiempo se guarda en
    // la cola y se aplica en su turno; descartarlo era lo que hacía que el
    // anfitrión y el cliente ejecutaran secuencias distintas y que la
    // reconciliación mintiera con solo unos milisegundos de temblor.
    if (ent.tick < reg.ultimoTickEntrada) {
      this.entradasTardias++;
      return false;
    }

    this._encolarEntrada(reg, ent);

    reg.ultimaEntradaEn = this.tiempo;
    reg.entradasRecibidas++;

    if (!reg.activo) {
      reg.activo = true;
      this._difundirEvento(EVENTO.ACTIVO, { id: reg.netId, nombre: reg.nombre });
    }

    // Si el paso de simulación aún no ha gastado su entrada, esta se aplica ya:
    // en un enlace sin temblor llega justo una por paso y la cola ni se usa.
    this._consumirEntrada(reg);
    return true;
  }

  /** Inserta ordenado por tick. El caso normal es una inserción al final. */
  _encolarEntrada(reg, ent) {
    const cola = reg.cola;
    if (cola.length >= TOPE_ENTRADAS) {
      // Tope duro: un cliente que manda más rápido de lo que el mundo simula no
      // puede hacer crecer la cola sin fin. Se suelta la más vieja, que es la
      // que menos falta hace.
      this._soltarEntrada(cola.shift());
      this.entradasTardias++;
    }
    let i = cola.length;
    while (i > 0 && cola[i - 1].tick > ent.tick) i--;
    if (i > 0 && cola[i - 1].tick === ent.tick) {
      // Duplicado (el canal puede repetir): manda la copia más reciente.
      cola[i - 1].angle = ent.angle;
      cola[i - 1].boosting = ent.boosting;
      return;
    }
    const e = this._poolEntradas.pop() ?? { tick: 0, angle: 0, boosting: false, llegada: 0 };
    e.tick = ent.tick;
    e.angle = ent.angle;
    e.boosting = ent.boosting;
    e.llegada = this.tickActual;
    cola.splice(i, 0, e);
  }

  _soltarEntrada(e) {
    if (e && this._poolEntradas.length < TOPE_ENTRADAS * 2) this._poolEntradas.push(e);
  }

  /**
   * Aplica COMO MUCHO una entrada por paso de simulación y en orden de tick.
   *
   * Es la mitad que hace honesta a la reconciliación. El cliente reaplica
   * exactamente una entrada por tick desde el que se le confirma; si el
   * anfitrión aplicara dos entre dos pasos del mundo, la primera no llegaría a
   * mover nada y el acuse afirmaría lo contrario. Y si se salta una, el cliente
   * corregirá contra un estado que sus propias entradas no producen nunca.
   */
  _consumirEntrada(reg) {
    if (reg.tickConsumo === this.tickActual) return false;
    const cab = reg.cola[0];
    if (!cab) return false;

    const hueco = cab.tick - reg.ultimoTickEntrada - 1;
    const lista = reg.ultimoTickEntrada === 0     // aún no hay referencia
      || hueco <= 0                               // la que toca, sin huecos
      || hueco > VENTANA_ENTRADAS                 // salto grande: no es desorden
      || this.tickActual - cab.llegada >= VENTANA_ENTRADAS   // la que falta no llega
      || reg.cola.length > VENTANA_ENTRADAS;
    if (!lista) return false;

    reg.cola.shift();
    reg.tickConsumo = this.tickActual;
    reg.ultimoTickEntrada = cab.tick;

    const s = reg.serpiente;
    if (s && s.alive) {
      s.targetAngle = cab.angle;
      s.boosting = cab.boosting && s.canBoost();
    }
    this._soltarEntrada(cab);
    return true;
  }

  _consumirEntradas() {
    for (const reg of this.pares.values()) this._consumirEntrada(reg);
  }

  /** Puerta única para el transporte: decodifica y reparte. */
  alRecibirMensaje(idPar, datos) {
    // Tope de tamaño ANTES de decodificar: es lo único que puede hacerse sin
    // mirar el contenido, y evita que una cadena enorme imponga el coste de un
    // JSON.parse por cada mensaje de una inundación.
    const bytes = typeof datos === 'string'
      ? datos.length
      : (datos?.byteLength ?? datos?.buffer?.byteLength ?? 0);
    if (bytes > MAX_BYTES_MENSAJE) {
      this.deformes++;
      return false;
    }

    // decodeMessage confía en que el paquete está completo: un SNAPSHOT de dos
    // bytes que dice traer cuarenta serpientes lanza al leer más allá del búfer.
    // El envío ya estaba envuelto; faltaba la recepción, y una excepción aquí no
    // la recoge nadie: ni Sala.onDatos ni Conexion._alMensaje protegen.
    let msg = null;
    try {
      msg = decodeMessage(datos);
    } catch (err) {
      this.deformes++;
      this.ultimoError = err;
      return false;
    }
    if (!msg) {
      this.deformes++;
      return false;
    }

    // El cupo se aplica DESPUÉS de saber el tipo. Contar antes obligaba a JOIN y
    // BYE a competir con las 60 entradas por segundo, y eran justo los mensajes
    // que no debían perderse nunca.
    const esControl = msg.type === MSG.JOIN || msg.type === MSG.BYE;
    if (!this._admiteTrafico(idPar, esControl)) return false;

    switch (msg.type) {
      case MSG.INPUT:
        return this.alRecibirEntrada(idPar, msg);
      case MSG.JOIN:
        return this.alConectarPar(idPar, {
          nombre: msg.nombre,
          apariencia: msg.apariencia,
        }) !== null;
      case MSG.EVENT:
        return this._eventoDeCliente(idPar, msg);
      case MSG.BYE:
        this._anotarSalida(idPar);
        return this.alDesconectarPar(idPar, 'adiós del cliente');
      default:
        return false;
    }
  }

  /**
   * Avisos que suben del cliente.
   *
   * `pideApariencias` es la ÚNICA vía que tiene un cliente para recuperar una
   * identidad que se le perdió; sin contestarla, esa serpiente se queda con piel
   * de bot y sin nombre el resto de la partida. El cliente insiste tres veces
   * por id y luego se rinde.
   */
  _eventoDeCliente(idPar, msg) {
    switch (msg.ev) {
      case 'ping':
        // Contestar sale gratis y es lo que le permite medir la ida y vuelta
        // cuando el transporte no la mide por su cuenta.
        return this._enviar(idPar, encodeJson(MSG.EVENT, { ev: 'pong', ts: msg.ts }),
          CANAL_CONTROL);
      case 'pong':
        return true;
      case 'pideApariencias': {
        const reg = this.pares.get(idPar);
        if (!reg || !Array.isArray(msg.ids)) return false;
        const pedidos = [];
        // El número de ids se acota: viene de fuera y construir identidades es
        // copiar una piel entera por cada una.
        for (let i = 0; i < msg.ids.length && pedidos.length < MAX_IDS_PETICION; i++) {
          const id = Number(msg.ids[i]);
          if (Number.isInteger(id) && this._porId.has(id)) pedidos.push(id);
        }
        if (!pedidos.length) return false;
        this._enviarCenso(reg, pedidos);
        for (const id of pedidos) reg.conocidas.add(id);
        return true;
      }
      default:
        return false;
    }
  }

  /**
   * Limitador por par: ventana de un segundo y techo de mensajes.
   *
   * El contador avanza con el reloj de la simulación, no con el de la máquina:
   * una ráfaga entera cabe dentro de un mismo paso y ahí es justo donde tiene
   * que cortarse.
   */
  /**
   * Reloj de PARED, no el simulado.
   *
   * `this.tiempo` solo avanza dentro de tick(), y el bucle descarta los pasos que
   * no llega a dar. Con el anfitrión en segundo plano el reloj simulado se queda
   * por detrás del real y un techo de "120 por segundo" pasa a ser 120 por varios
   * segundos, cortando tráfico legítimo. Es inyectable para que los bancos puedan
   * controlarlo sin depender del reloj de la máquina.
   */
  _ahora() {
    return this.ahora();
  }

  /**
   * @param {boolean} esControl  JOIN y BYE, que llevan cupo propio
   */
  _admiteTrafico(idPar, esControl = false) {
    const ahora = this._ahora();
    let t = this._trafico.get(idPar);
    if (!t) {
      if (this._trafico.size >= MAX_VIGILADOS) this._podarTrafico();
      t = { desde: ahora, cuenta: 0, desdeCtrl: ahora, cuentaCtrl: 0 };
      this._trafico.set(idPar, t);
    }

    if (esControl) {
      if (ahora - t.desdeCtrl >= VENTANA_CONTROL) {
        t.desdeCtrl = ahora;
        t.cuentaCtrl = 0;
      }
      t.cuentaCtrl++;
      if (t.cuentaCtrl > MAX_CONTROL_POR_VENTANA) {
        this.limitados++;
        return false;
      }
      return true;
    }

    if (ahora - t.desde >= VENTANA_TRAFICO) {
      t.desde = ahora;
      t.cuenta = 0;
    }
    t.cuenta++;
    if (t.cuenta > this.maxMensajesPorSegundo) {
      this.limitados++;
      return false;
    }
    return true;
  }

  _podarTrafico() {
    const ahora = this._ahora();
    for (const [idPar, t] of this._trafico) {
      if (ahora - t.desde > VENTANA_TRAFICO * 5) this._trafico.delete(idPar);
    }
    // Si aún así no cabe, se olvida todo: perder los contadores un segundo es
    // preferible a que el mapa crezca con cada idPar inventado.
    if (this._trafico.size >= MAX_VIGILADOS) this._trafico.clear();
  }

  _anotarSalida(idPar) {
    if (this.reentradaMinima <= 0) return;
    if (this._salidas.size >= MAX_VIGILADOS) this._podarSalidas();
    this._salidas.set(idPar, { t: this._ahora(), avisado: false });
  }

  _podarSalidas() {
    const ahora = this._ahora();
    for (const [idPar, s] of this._salidas) {
      if (ahora - s.t >= this.reentradaMinima) this._salidas.delete(idPar);
    }
    if (this._salidas.size >= MAX_VIGILADOS) this._salidas.clear();
  }

  /* ─────────────── Bucle ─────────────── */

  /**
   * Se llama una vez por PASO FIJO, justo después de world.tick(dt).
   *
   * El orden importa: el hash de orbes que consulta la gestión de interés lo
   * repuebla world.tick() en cada paso, y aquí se aprovecha en lugar de
   * construir otro índice.
   */
  tick(dt) {
    this.tiempo += dt;

    // world.tick() deja de simular en cuanto el modo se da por terminado, y en
    // classic eso pasa cada pocos minutos: basta con que muera el jugador del
    // anfitrión. Seguir emitiendo estado de un mundo congelado no dispara el
    // detector de silencio del cliente y le manda, cada 50 ms, una corrección
    // contra un punto fijo: la serpiente pegada al sitio y sin ningún aviso.
    if (this.world.over) {
      this._anunciarFin();
      this._cerrarVentana();
      return;
    }

    // El tick cuenta PASOS DE SIMULACIÓN, así que no avanza si el mundo no ha
    // avanzado: es lo que el cliente convierte en tiempo del anfitrión.
    this.tickActual++;

    this._vigilarInactivos();

    this._accEstado += dt;
    if (this._accEstado >= this._intervaloEstado) {
      // Se resta el intervalo en vez de poner a cero: así la cadencia media es
      // exactamente la pedida aunque el paso fijo no sea múltiplo de ella.
      this._accEstado -= this._intervaloEstado;
      // Pestaña en segundo plano o pausa larga: se descarta el retraso en lugar
      // de soltar una ráfaga de paquetes que solo serviría para saturar la cola.
      if (this._accEstado > this._intervaloEstado) this._accEstado = 0;
      this._enviarEstado();
    }

    this._accOrbes += dt;
    if (this._accOrbes >= this._intervaloOrbes) {
      this._accOrbes -= this._intervaloOrbes;
      if (this._accOrbes > this._intervaloOrbes) this._accOrbes = 0;
      this._enviarOrbes();
    }

    // Se consume DESPUÉS de enviar: lo que se aplique aquí lo integrará el
    // world.tick() siguiente, y el acuse solo puede confirmar lo que el mundo ya
    // ha simulado. Al revés, el paquete prometería un tick que aún no ha pasado.
    this._consumirEntradas();

    this._cerrarVentana();
  }

  /** El fin de partida se difunde una sola vez, venga del modo o de tick(). */
  _anunciarFin() {
    if (this._finAvisado) return;
    this._finAvisado = true;
    this._difundirEvento(EVENTO.FIN, { resultados: sanear(this.world.results, 0) });
  }

  /** Un cliente mudo sigue vivo en el mundo: hay que notarlo y decirlo. */
  _vigilarInactivos() {
    if (this.timeoutEntrada <= 0) return;
    for (const reg of this.pares.values()) {
      if (!reg.activo) continue;
      if (this.tiempo - reg.ultimaEntradaEn <= this.timeoutEntrada) continue;

      reg.activo = false;
      // No se le expulsa: un bache de red de seis segundos es habitual en datos
      // móviles y volver es preferible a perder la partida. Sí se le corta el
      // turbo, que si no se comería su propia masa sin que nadie lo pidiera.
      if (reg.serpiente) reg.serpiente.boosting = false;
      this._difundirEvento(EVENTO.INACTIVO, { id: reg.netId, nombre: reg.nombre });
      this.alParInactivo?.(reg.idPar, reg);
    }
  }

  /* ─────────────── Envío de estado ─────────────── */

  _enviarEstado() {
    this._sincronizarIds();
    if (this.pares.size === 0) return;

    for (const reg of this.pares.values()) {
      if (!this._revalidarSerpiente(reg)) continue;
      const lista = this._interesSerpientes(reg);
      this._censarNuevas(reg, lista);
      const buf = encodeSnapshot(this.tickActual, reg.ultimoTickEntrada, lista, reg.netId);
      this._enviar(reg.idPar, buf, CANAL_ESTADO);
      reg.serpientesUltimoPaquete = lista.length;
    }
    this.paquetesEstado++;
  }

  /**
   * Comprueba que el cliente sigue teniendo serpiente y netId antes de mandarle
   * un paquete que hable de ella.
   *
   * El ciclo de vida de una serpiente lo llevan los modos, y los modos solo
   * distinguen jugadores de bots por `isPlayer`: nest.onKill retira del mundo a
   * toda víctima que no lo sea, incluida la de un cliente. A partir de ahí el
   * anfitrión seguía mandando paquetes con un `yourId` que ya no existe y que
   * nunca contienen esa serpiente: el cliente jamás recibe FLAG.DEAD y dibuja un
   * fantasma indefinidamente. Reponerla y volver a presentarse cuesta un HELLO;
   * no hacerlo deja al jugador fuera de la partida sin decírselo.
   */
  _revalidarSerpiente(reg) {
    const s = reg.serpiente;
    if (s && s.removed !== true) {
      if (!s.netId) this._asignarId(s);
      if (s.netId) {
        reg.netId = s.netId;
        return true;
      }
    }

    if (reg.netId) this._liberarId(reg.netId);
    const nueva = this._crearSerpiente(reg.nombre, null, reg.piel);
    reg.serpiente = nueva;
    reg.netId = nueva.netId || this._asignarId(nueva);
    if (!reg.netId) {
      // Sin identificador no se puede hablar de ella con nadie. Expulsar es
      // preferible a dejar en el mundo una serpiente sólida que nadie ve.
      this.alDesconectarPar(reg.idPar, 'sin identificador de red');
      return false;
    }
    // El censo se rehace: los clientes acaban de recibir la BAJA del id viejo.
    reg.conocidas.clear();
    this._enviarHola(reg);
    return true;
  }

  /**
   * Serpientes que este cliente debe recibir, en orden de importancia.
   *
   * Tres reglas, y las tres importan:
   *  1. La suya SIEMPRE va, esté donde esté y aunque esté muerta: es como se
   *     entera de que ha muerto, porque las muertas dejan de transmitirse.
   *  2. Radio de interés: lo que no puede ver no le sirve de nada.
   *  3. Tope duro por cercanía: en una aglomeración, las que pueden matarte son
   *     las de al lado. Recortar por lejanía es exactamente el criterio que
   *     menos daño hace a la jugabilidad.
   */
  _interesSerpientes(reg) {
    const salida = this._envio;
    salida.length = 0;

    const propia = reg.serpiente;
    if (propia && propia.netId) salida.push(propia);

    const cx = propia ? propia.head.x : this.world.bounds.w * 0.5;
    const cy = propia ? propia.head.y : this.world.bounds.h * 0.5;
    const r2 = this.radioInteres * this.radioInteres;

    const orden = this._orden;
    orden.length = 0;

    for (const s of this.world.snakes) {
      if (s === propia || !s.netId || s.isGhost) continue;
      // Las muertas se dejan de mandar. Mantenerlas costaría 10 bytes por
      // paquete para siempre, y el aviso de muerte ya viajó por canal fiable.
      if (!s.alive) continue;
      const dx = s.head.x - cx;
      const dy = s.head.y - cy;
      const d2 = dx * dx + dy * dy;
      if (d2 > r2) continue;
      const e = entradaPool(this._pool, orden.length);
      e.ref = s;
      e.d2 = d2;
      orden.push(e);
    }

    const hueco = Math.max(0, this.topeSerpientes - salida.length);
    if (orden.length > hueco) {
      // Solo se ordena cuando el tope muerde, que es raro: el caso normal no
      // paga la ordenación.
      orden.sort(porDistancia);
      orden.length = hueco;
    }
    for (let i = 0; i < orden.length; i++) salida.push(orden[i].ref);
    return salida;
  }

  /**
   * Nombre y piel de las serpientes que este cliente ve por primera vez.
   *
   * El paquete de estado no tiene sitio para esto —son 10 bytes y ni uno más—,
   * así que la identidad viaja aparte, una sola vez por cliente y por serpiente,
   * y por canal fiable. Perderlo dejaría a una serpiente sin nombre el resto de
   * la partida, que es justo el tipo de fallo que nadie sabe reproducir.
   */
  _censarNuevas(reg, lista) {
    let filas = null;
    let ids = null;
    for (let i = 0; i < lista.length; i++) {
      const s = lista[i];
      if (reg.conocidas.has(s.netId)) continue;
      (filas ??= []).push(identidad(s));
      (ids ??= []).push(s.netId);
    }
    if (!filas) return;
    // Se apunta como conocida SOLO si el mensaje salió. Marcarla antes daba por
    // enviada una identidad que la contrapresión acababa de tirar, y esa
    // serpiente se quedaba sin nombre y con piel de bot el resto de la partida.
    if (!this._enviar(reg.idPar, encodeJson(MSG.EVENT, { ev: EVENTO.CENSO, filas }),
      CANAL_CONTROL)) return;
    for (let i = 0; i < ids.length; i++) reg.conocidas.add(ids[i]);
  }

  /* ─────────────── Envío de orbes ─────────────── */

  _enviarOrbes() {
    if (this.pares.size === 0) return;
    for (const reg of this.pares.values()) {
      const lista = this._interesOrbes(reg);
      this._enviar(reg.idPar, encodeOrbs(lista), CANAL_ESTADO);
      reg.orbesUltimoPaquete = lista.length;
    }
    this.paquetesOrbes++;
  }

  /**
   * Orbes visibles, recortados por cercanía.
   *
   * El tope es lo que fija el gasto: con 140 orbes el campo llega completo hasta
   * unas 1.080 unidades y más allá se ralea. Es un compromiso consciente —en el
   * borde de la pantalla se ve menos comida de la que hay— a cambio de que el
   * paquete nunca pase de 844 bytes en un mapa denso.
   */
  _interesOrbes(reg) {
    const salida = this._envioOrbes;
    salida.length = 0;

    const s = reg.serpiente;
    if (!s) return salida;

    const cx = s.head.x;
    const cy = s.head.y;
    const r = this.radioOrbes;
    const r2 = r * r;

    // El hash de orbes lo repuebla world.tick() en cada paso. Consultarlo evita
    // recorrer los miles de orbes de un mapa grande una vez por cliente.
    const encontrados = this.world.orbHash.query(cx, cy, r, this._scratchOrbes);

    const orden = this._ordenOrbes;
    orden.length = 0;
    for (let i = 0; i < encontrados.length; i++) {
      const o = encontrados[i];
      if (!o.active) continue;
      const dx = o.x - cx;
      const dy = o.y - cy;
      const d2 = dx * dx + dy * dy;
      if (d2 > r2) continue;
      const e = entradaPool(this._poolOrbes, orden.length);
      e.ref = o;
      e.d2 = d2;
      orden.push(e);
    }

    if (orden.length > this.topeOrbes) {
      orden.sort(porDistancia);
      orden.length = this.topeOrbes;
    }
    for (let i = 0; i < orden.length; i++) salida.push(orden[i].ref);
    return salida;
  }

  /* ─────────────── Identificadores de red ─────────────── */

  /**
   * Reparte netId a todo lo que haya nacido y recupera el de lo que se ha ido.
   *
   * Los bots también llevan netId: para un cliente son serpientes como
   * cualquier otra, y distinguirlas en el protocolo no aportaría nada salvo un
   * caso especial más.
   */
  _sincronizarIds() {
    const vistas = this._vistas;
    vistas.clear();
    for (const s of this.world.snakes) {
      if (s.isGhost) continue;
      if (!s.netId) this._asignarId(s);
      if (s.netId) vistas.add(s.netId);
    }
    for (const id of this._porId.keys()) {
      if (!vistas.has(id)) this._liberarId(id);
    }
  }

  _asignarId(serpiente) {
    if (serpiente.netId) {
      this._porId.set(serpiente.netId, serpiente);
      return serpiente.netId;
    }
    const id = this._tomarId();
    serpiente.netId = id;
    if (id) this._porId.set(id, serpiente);
    return id;
  }

  /**
   * Los identificadores NO se reciclan en caliente.
   *
   * Un cliente conserva cada entidad tres segundos después de dejar de verla
   * (InterpolationBuffer.prune) y guarda su nombre y su piel indefinidamente.
   * Si un id se reutilizara enseguida, la serpiente nueva heredaría el rastro
   * interpolado de la vieja y aparecería cruzando el mapa a velocidad
   * imposible, con el nombre equivocado. La cuarentena cuesta un contador y
   * elimina la clase entera de fallo.
   */
  _tomarId() {
    const nuevo = this._primerLibre();
    if (nuevo) return nuevo;

    // Agotados los 65.535 hay que reciclar sí o sí. Se prefiere la cabeza con la
    // cuarentena cumplida —y como la lista está ordenada por tiempo, si la
    // cabeza no la ha cumplido no la ha cumplido nadie—, pero si no la ha
    // cumplido se recicla igual y se anota. Un id reutilizado demasiado pronto
    // es un fallo visual pasajero: una serpiente que hereda el rastro de otra.
    // Devolver 0 era mucho peor: _interesSerpientes descarta a quien no tiene
    // id, así que NINGÚN cliente la ve mientras sigue siendo sólida y letal.
    const cabeza = this._liberados.shift();
    if (cabeza) {
      if (this.tiempo - cabeza.t <= CUARENTENA_ID) this.recicladosEnCaliente++;
      return cabeza.id;
    }

    // Sin nada en cuarentena: se rebobina el contador por si quedó algún hueco
    // suelto. Quedarse sin salida exigiría 65.535 serpientes vivas a la vez.
    this._siguienteId = 1;
    return this._primerLibre() || ID_MAX;
  }

  _primerLibre() {
    while (this._siguienteId <= ID_MAX) {
      const id = this._siguienteId++;
      if (!this._porId.has(id)) return id;
    }
    return 0;
  }

  _liberarId(id) {
    if (!id) return;
    const s = this._porId.get(id);
    if (s) s.netId = 0;
    this._porId.delete(id);

    this._liberados.push({ id, t: this.tiempo });
    if (this._liberados.length > MAX_LIBERADOS) this._liberados.shift();

    // Sin esto quedaría un nombre huérfano en el censo de cada cliente, y si el
    // id se reciclara más tarde lo heredaría la serpiente equivocada.
    for (const reg of this.pares.values()) reg.conocidas.delete(id);
    this._difundirEvento(EVENTO.BAJA, { id });
  }

  /* ─────────────── Eventos del mundo ─────────────── */

  _engancharEventos() {
    const w = this.world;

    this._sueltas.push(w.events.on(EV.DEATH, ({ snake, killer, cause }) => {
      if (!snake || !snake.netId) return;
      this._difundirEvento(EVENTO.MUERTE, {
        id: snake.netId,
        nombre: snake.name,
        por: killer?.netId ?? 0,
        asesino: killer?.name ?? null,
        causa: cause ?? null,
      });
    }));

    // Aparecer y reaparecer se avisan igual: como las muertas dejan de viajar
    // en el paquete de estado, el cliente necesita que alguien le diga que ese
    // id ha vuelto a estar vivo.
    this._sueltas.push(w.events.on(EV.SPAWN, ({ snake }) => {
      if (!snake || snake.isGhost) return;

      // Reaparición que esta sesión no ha pedido: viene de la cola del modo, que
      // trata la serpiente de un cliente como un bot suyo (classic.onKill la
      // encola y la revive a los tres segundos). Devolver al jugador a la
      // partida sin que él lo pida lo deja jugando mientras su interfaz sigue
      // enseñando la pantalla de muerte. Quien decide cuándo se vuelve es la
      // capa de sala, llamando a reaparecer().
      if (snake.esRemota === true && !this._aparicionesPedidas.delete(snake)) {
        snake.alive = false;
        snake.boosting = false;
        return;
      }

      this._asignarId(snake);
      if (!snake.netId) return;
      this._difundirEvento(EVENTO.APARICION, {
        id: snake.netId,
        x: Math.round(snake.head.x),
        y: Math.round(snake.head.y),
      });
    }));

    this._sueltas.push(w.events.on(EV.MODE_OVER, () => this._anunciarFin()));
  }

  /* ─────────────── Creación de serpientes remotas ─────────────── */

  /**
   * Crea la serpiente de un cliente dentro del mundo del anfitrión.
   *
   * Es spawnBot sin cerebro y spawnPlayer sin tocar world.player: no entra en
   * world.bots a propósito, porque el Director y varios modos recorren esa lista
   * dando por hecho que todos sus miembros tienen `.brain`.
   *
   * `esRemota` es la marca de que esta serpiente la manda alguien de fuera y su
   * ciclo de vida lo lleva esta sesión. Los modos NO la miran —solo entienden
   * `isPlayer`, que aquí no se puede poner sin que el anfitrión se coma el
   * temblor de pantalla, el sonido de muerte y el marcador de otro jugador—, así
   * que lo que hagan con ella se corrige desde aquí: ver el manejador de
   * EV.SPAWN y _revalidarSerpiente().
   */
  _crearSerpiente(nombre, apariencia, piel = null) {
    const w = this.world;
    // Mismo punto seguro que usan spawnPlayer y spawnBot: nacer dentro de otro
    // cuerpo es muerte instantánea y el cliente no tiene forma de evitarla.
    const pos = w._safeSpawn();
    const s = new Snake({ ...pos, skin: piel ?? this._piel(apariencia), name: nombre });
    s.esRemota = true;
    w.snakes.push(s);
    this._aparicionesPedidas.add(s);
    w.events.emit(EV.SPAWN, { snake: s });
    return s;
  }

  /**
   * La apariencia llega de un cliente, o sea de fuera: se valida entera contra
   * los catálogos y se descarta lo que no encaje. Un color inventado reventaría
   * el cálculo de contraste de buildSkin y con él el fotograma.
   */
  _piel(apariencia) {
    const tema = this.world.settings?.themeObj ?? getTheme(this.world.settings?.theme);
    if (!apariencia || typeof apariencia !== 'object') {
      return botSkin(this._pielesAsignadas++, tema);
    }
    return buildSkin({
      primary:   hexValido(apariencia.primary) ? apariencia.primary : '#4ade80',
      secondary: hexValido(apariencia.secondary) ? apariencia.secondary : '#0ea5e9',
      pattern:   opcionValida(PATTERNS, apariencia.pattern, 'liso'),
      eyes:      opcionValida(EYE_STYLES, apariencia.eyes, 'redondos'),
      trail:     opcionValida(TRAILS, apariencia.trail, 'chispas'),
    }, tema);
  }

  /* ─────────────── Transporte ─────────────── */

  _enviar(idPar, datos, canal = CANAL_ESTADO) {
    let entregado = true;
    try {
      entregado = this.sala.enviar(idPar, datos, canal) !== false;
    } catch (err) {
      // Un canal caído no puede tumbar la simulación del resto de la sala.
      this.errores++;
      this.ultimoError = err;
      entregado = false;
    }
    // Solo se contabiliza lo que salió de verdad. Sumar los descartes por
    // contrapresión inflaría el caudal justo cuando lo que se necesita es ver
    // que la red NO está tragando.
    if (!entregado) {
      this.descartados++;
      return false;
    }
    const n = tamano(datos);
    this.bytesTotales += n;
    this._bytesVentana += n;
    const reg = this.pares.get(idPar);
    if (reg) {
      reg.bytesTotales += n;
      reg.bytesVentana += n;
    }
    return true;
  }

  _difundir(datos, canal = CANAL_CONTROL) {
    if (typeof this.sala?.difundir !== 'function') {
      for (const idPar of this.pares.keys()) this._enviar(idPar, datos, canal);
      return;
    }
    let recibieron = this.pares.size;
    try {
      // El segundo argumento es la lista de excluidos de la Sala real: aquí
      // nunca se excluye a nadie, pero hay que respetar la posición.
      const n = this.sala.difundir(datos, null, canal);
      if (Number.isFinite(n)) recibieron = n;
    } catch (err) {
      this.errores++;
      this.ultimoError = err;
      return;
    }
    const bytes = tamano(datos) * recibieron;
    this.bytesTotales += bytes;
    this._bytesVentana += bytes;
  }

  _difundirEvento(ev, payload) {
    this._difundir(encodeJson(MSG.EVENT, { ev, ...payload }), CANAL_CONTROL);
  }

  /* ─────────────── Estadísticas ─────────────── */

  _cerrarVentana() {
    const lapso = this.tiempo - this._ventanaDesde;
    if (lapso < 1) return;
    this.bytesPorSegundo = this._bytesVentana / lapso;
    this._bytesVentana = 0;
    this._ventanaDesde = this.tiempo;
    for (const reg of this.pares.values()) {
      reg.bytesPorSegundo = reg.bytesVentana / lapso;
      reg.bytesVentana = 0;
    }
    // Los dos mapas de vigilancia se limpian aquí, una vez por segundo: son la
    // defensa contra quien inunda, y no pueden convertirse ellos mismos en la
    // fuga de memoria que evitan.
    this._podarTrafico();
    this._podarSalidas();
  }

  /**
   * Lo que hace falta para saber si la sala aguanta.
   *
   * `kbps` es lo que se está gastando de verdad en el último segundo;
   * `estimadoKbps` es la proyección con la ocupación actual y la configuración
   * actual, que es lo que permite ver si subir la frecuencia o el tope cabe en
   * la subida disponible ANTES de que la sala empiece a temblar.
   */
  estadisticas() {
    const pares = [];
    let activos = 0;
    let sumaSerpientes = 0;
    let sumaOrbes = 0;

    for (const reg of this.pares.values()) {
      if (reg.activo) activos++;
      sumaSerpientes += reg.serpientesUltimoPaquete;
      sumaOrbes += reg.orbesUltimoPaquete;
      pares.push({
        idPar: reg.idPar,
        netId: reg.netId,
        nombre: reg.nombre,
        activo: reg.activo,
        viva: reg.serpiente ? reg.serpiente.alive : false,
        ackEntrada: reg.ultimoTickEntrada,
        entradasEnCola: reg.cola.length,
        silencio: dec(this.tiempo - reg.ultimaEntradaEn),
        serpientesVistas: reg.serpientesUltimoPaquete,
        orbesVistos: reg.orbesUltimoPaquete,
        bytesTotales: reg.bytesTotales,
        bytesPorSegundo: Math.round(reg.bytesPorSegundo),
        kbps: dec(reg.bytesPorSegundo * 8 / 1000),
      });
    }

    const n = this.pares.size;
    const mediaSerpientes = n ? sumaSerpientes / n : 0;
    const mediaOrbes = n ? sumaOrbes / n : 0;
    const estimadoBps = n * (snapshotBytes(mediaSerpientes) * this.hzEstado
      + orbsBytes(mediaOrbes) * this.hzOrbes);

    return {
      jugadores: n,
      activos,
      maxJugadores: this.maxJugadores,
      tick: this.tickActual,
      tiempo: dec(this.tiempo),
      serpientesEnRed: this._porId.size,
      paquetesEstado: this.paquetesEstado,
      paquetesOrbes: this.paquetesOrbes,
      mediaSerpientes: dec(mediaSerpientes),
      mediaOrbes: dec(mediaOrbes),
      bytesTotales: this.bytesTotales,
      bytesPorSegundo: Math.round(this.bytesPorSegundo),
      kbps: dec(this.bytesPorSegundo * 8 / 1000),
      estimadoKbps: dec(estimadoBps * 8 / 1000),
      // Techo absoluto con los topes vigentes: si esto no cabe en la subida, la
      // sala se caerá en cuanto todo el mundo se junte, no antes.
      topeKbps: dec(n * (snapshotBytes(this.topeSerpientes) * this.hzEstado
        + orbsBytes(this.topeOrbes) * this.hzOrbes) * 8 / 1000),
      // Descartes crecientes = la subida está saturada. Es la señal para bajar
      // hzEstado o el tope antes de que la partida se vuelva injugable.
      descartados: this.descartados,
      errores: this.errores,
      // Lo que llega mal. Si `deformes` o `limitados` crecen, alguien está
      // inundando o hablando otro protocolo: es la señal para expulsarlo, y sin
      // contarlo aquí la inundación es invisible desde fuera.
      deformes: this.deformes,
      limitados: this.limitados,
      entradasTardias: this.entradasTardias,
      recicladosEnCaliente: this.recicladosEnCaliente,
      terminada: this.world.over === true,
      pares,
    };
  }

  /* ─────────────── Fin ─────────────── */

  destruir() {
    this._difundirEvento(EVENTO.FIN, { razon: 'el anfitrión ha cerrado la sala' });
    for (const idPar of [...this.pares.keys()]) this.alDesconectarPar(idPar, 'sala cerrada');
    for (const soltar of this._sueltas) soltar();
    this._sueltas.length = 0;
    this._porId.clear();
    this._liberados.length = 0;
    this.pares.clear();
    this._trafico.clear();
    this._salidas.clear();
    this._poolEntradas.length = 0;
  }
}

/* ═══════════════ Sala falsa, para probar sin WebRTC ═══════════════ */

/**
 * Transporte de mentira que guarda todo lo enviado.
 *
 * Que exista no es un detalle de comodidad: toda la lógica que de verdad puede
 * fallar —interés, topes, cuarentena de ids, censo, expiración— es lógica pura,
 * y poder ejercitarla sin negociar una conexión es la diferencia entre
 * depurarla en un banco de pruebas o hacerlo con dos navegadores y un amigo.
 */
export function crearSalaFalsa() {
  return {
    enviados: [],          // {idPar, datos, canal, bytes}
    difundidos: [],
    /** Poner a false para simular contrapresión y ver que el anfitrión aguanta. */
    admite: true,
    enviar(idPar, datos, canal = CANAL_ESTADO) {
      if (!this.admite) return false;
      this.enviados.push({ idPar, datos, canal, bytes: tamano(datos) });
      return true;
    },
    difundir(datos, excepto = null, canal = CANAL_CONTROL) {
      if (!this.admite) return 0;
      this.difundidos.push({ datos, excepto, canal, bytes: tamano(datos) });
      // Sin cuenta de destinatarios: el anfitrión usa entonces sus propios
      // pares, que es lo que hace la Sala real cuando todos reciben.
    },
    /** Paquetes recibidos por un cliente, en orden. */
    paraPar(idPar) {
      return this.enviados.filter((e) => e.idPar === idPar);
    },
    bytes() {
      let total = 0;
      for (const e of this.enviados) total += e.bytes;
      for (const e of this.difundidos) total += e.bytes;
      return total;
    },
    limpiar() {
      this.enviados.length = 0;
      this.difundidos.length = 0;
    },
  };
}

/* ═══════════════ Utilidades ═══════════════ */

const porDistancia = (a, b) => a.d2 - b.d2;

/** Entrada reutilizable del pool: el índice y el orden se llevan aparte. */
function entradaPool(pool, i) {
  let e = pool[i];
  if (e === undefined) {
    e = { ref: null, d2: 0 };
    pool[i] = e;
  }
  return e;
}

/** Ficha de identidad de una serpiente, para el censo y el HELLO. */
function identidad(s) {
  return {
    id: s.netId,
    nombre: (s.name ?? '').slice(0, MAX_NOMBRE),
    equipo: s.team ?? null,
    bot: s.brain != null,
    remota: s.esRemota === true,
    // La piel entera, no solo los dos colores base: así el cliente la usa tal
    // cual y no puede desviarse del aspecto que ve el anfitrión.
    piel: s.skin ? { ...s.skin } : null,
  };
}

function normalizarEntrada(mensaje) {
  let ent = mensaje;
  if (mensaje instanceof ArrayBuffer) {
    ent = decodeInput(mensaje);
  } else if (ArrayBuffer.isView(mensaje)) {
    // decodeInput lee desde el byte 0 del búfer, así que una vista con
    // desplazamiento hay que recortarla antes o se decodifica basura.
    const completa = mensaje.byteOffset === 0
      && mensaje.byteLength === mensaje.buffer.byteLength;
    ent = decodeInput(completa
      ? mensaje.buffer
      : mensaje.buffer.slice(mensaje.byteOffset, mensaje.byteOffset + mensaje.byteLength));
  }
  if (!ent || typeof ent !== 'object') return null;
  if (!Number.isFinite(ent.angle) || !Number.isFinite(ent.tick)) return null;
  return { angle: ent.angle, boosting: ent.boosting === true, tick: ent.tick >>> 0 };
}

function limpiarNombre(nombre) {
  const texto = typeof nombre === 'string' ? nombre.trim() : '';
  // Los controles se quitan porque el HUD los dibuja tal cual y un salto de
  // línea en el marcador descuadra la tabla entera.
  const limpio = texto.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, MAX_NOMBRE);
  return limpio || 'Invitado';
}

const hexValido = (v) => typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v);

function opcionValida(catalogo, valor, porDefecto) {
  return catalogo.some((c) => c.id === valor) ? valor : porDefecto;
}

/** Tamaño en bytes de lo que se manda, para las estadísticas. */
function tamano(datos) {
  if (typeof datos === 'string') {
    // Aproximación: el JSON del juego es ASCII salvo algún acento en los
    // nombres. Errar por un byte en un mensaje que va una vez por partida no
    // cambia ninguna decisión sobre el ancho de banda.
    return datos.length;
  }
  if (datos instanceof ArrayBuffer) return datos.byteLength;
  if (ArrayBuffer.isView(datos)) return datos.byteLength;
  return 0;
}

/**
 * Copia solo lo que sobrevive a JSON.stringify, con profundidad acotada.
 *
 * Los resultados los construye cada modo y no hay contrato que impida que
 * incluyan una referencia a una serpiente. Una referencia circular ahí lanzaría
 * dentro del bucle de simulación del anfitrión y se llevaría la partida por
 * delante, y todo por un mensaje decorativo de fin de ronda.
 */
function sanear(valor, prof) {
  if (valor === null || typeof valor !== 'object') {
    return typeof valor === 'function' ? null : valor;
  }
  if (prof >= 3) return null;
  if (Array.isArray(valor)) {
    return valor.slice(0, 32).map((v) => sanear(v, prof + 1));
  }
  const out = {};
  for (const clave of Object.keys(valor).slice(0, 24)) {
    const v = sanear(valor[clave], prof + 1);
    if (v !== null || valor[clave] === null) out[clave] = v;
  }
  return out;
}

const dec = (v) => Math.round(v * 100) / 100;
