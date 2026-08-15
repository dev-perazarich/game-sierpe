/*
 * Sierpe — transporte WebRTC entre pares.
 * Copyright (C) 2026 dev-perazarich · GNU AGPL v3.0
 */

/**
 * transport.js — Lleva los bytes que fabrica protocol.js de una máquina a otra.
 *
 * ── Topología ──
 *
 * Estrella con el anfitrión en el centro. El anfitrión simula el mundo y abre
 * una conexión por invitado; los invitados solo hablan con él. Una malla
 * completa exigiría N·(N-1)/2 conexiones y ponerse de acuerdo sobre quién tiene
 * razón, que es el problema difícil de verdad. Con estrella hay un único estado
 * autoritativo —el del anfitrión— y eso ya está resuelto en world.js.
 *
 * ── Dos canales, no uno ──
 *
 * El canal 'estado' es NO fiable y NO ordenado. Un paquete de estado perdido no
 * se reenvía: para cuando llegara ya habría otro más nuevo, y el reenvío solo
 * habría añadido retraso a todo lo que venía detrás (bloqueo de cabecera de
 * línea). Perder un paquete a 20 Hz cuesta 50 ms de interpolación, que
 * interpolation.js absorbe sin que se vea.
 *
 * El canal 'control' es fiable y ordenado. Por ahí van los mensajes que NO
 * pueden perderse ni llegar cambiados de orden: entrar, la presentación del
 * mundo, las muertes y los avisos. Son pocos y esporádicos, así que la latencia
 * extra del reenvío no molesta.
 *
 * El reparto es automático según el tipo del dato: cadena de texto → control,
 * binario → estado. No es casualidad, es exactamente cómo divide protocol.js
 * sus mensajes (encodeJson devuelve cadena; encodeSnapshot/encodeInput,
 * ArrayBuffer). Se puede forzar el canal con el tercer argumento.
 *
 * ── Byte 0 reservado ──
 *
 * Los tramos binarios cuyo primer byte vale 0 pertenecen al transporte (ping y
 * pong) y NUNCA llegan a onDatos. MSG de protocol.js empieza en 1, así que no
 * hay colisión posible.
 *
 * ── Limitaciones aceptadas ──
 *
 * - Sin TURN: entre un 10 % y un 20 % de las conexiones no llegarán a
 *   establecerse. Con NAT simétrica en ambos extremos —típico de datos móviles
 *   con CGNAT— la perforación falla y sin repetidor no hay alternativa. Un TURN
 *   de pago lo arreglaría; no lo hay a propósito.
 * - El anfitrión tiene 0 ms de latencia y los demás cargan con su ping entero.
 *   Repartirlo exigiría un servidor neutral.
 * - Si el anfitrión se va, la sala muere. No hay migración: el sustituto no
 *   tendría el estado autoritativo ni las conexiones de los demás.
 * - El anfitrión es autoritativo, luego puede hacer trampas. Entre amigos vale.
 * - No se reinicia ICE si la ruta se cae: reiniciarla exige renegociar, y el
 *   canal de señalización es de un solo uso (un blob copiado y pegado no está
 *   ahí para pedirle otro).
 */

/* ═══════════════ Soporte del navegador ═══════════════ */

/**
 * Se comprueba SIN tocar nada que pueda lanzar. Cargar este módulo en un
 * navegador sin WebRTC no debe romper la partida de un jugador: el juego
 * consulta SOPORTE y esconde el botón de multijugador.
 */
function detectarSoporte() {
  const hayRtc = typeof RTCPeerConnection === 'function';
  const hayCanal = hayRtc && typeof RTCPeerConnection.prototype.createDataChannel === 'function';
  const hayRed = typeof fetch === 'function' && typeof WebSocket === 'function';
  let razon = '';
  if (!hayRtc) razon = 'este navegador no tiene WebRTC';
  else if (!hayCanal) razon = 'este navegador no tiene canales de datos';
  return {
    webrtc: hayRtc && hayCanal,
    compresion: typeof CompressionStream === 'function'
      && typeof DecompressionStream === 'function',
    senalizacionRemota: hayRed,
    razon,
  };
}

export const SOPORTE = detectarSoporte();

export function hayWebRTC() {
  return SOPORTE.webrtc;
}

/** Error propio para que quien llame distinga un fallo del transporte de un fallo del juego. */
export class ErrorTransporte extends Error {
  constructor(codigo, mensaje) {
    super(mensaje);
    this.name = 'ErrorTransporte';
    this.codigo = codigo;
  }
}

/**
 * STUN público y gratuito, varios por redundancia. Solo sirven para descubrir
 * la dirección pública propia; no ven ni un byte del juego.
 *
 * Cuatro y no diez a propósito: cada servidor añade una consulta más a la
 * recolección de candidatos y por tanto retrasa el momento en que el blob está
 * listo. El de Nextcloud escucha en el 443 y por eso atraviesa cortafuegos que
 * bloquean el 3478, que es la razón de tenerlo en la lista.
 */
export const SERVIDORES_STUN = Object.freeze([
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
  { urls: 'stun:stun.cloudflare.com:3478' },
  { urls: 'stun:stun.nextcloud.com:443' },
]);

/* ═══════════════ Constantes de tiempo ═══════════════ */

const MS_SILENCIO_ICE = 1200;    // sin candidatos nuevos durante esto: se da por hecho
const MS_TOPE_ICE = 8000;        // tope duro; un STUN muerto no puede bloquear la sala
const MS_PING = 2000;
const MS_SIN_SENAL = 9000;       // sin recibir nada: el par se da por perdido
const MS_GRACIA_CAIDA = 4000;    // 'disconnected' puede recuperarse; esto es lo que se espera
const MS_INVITACION = 45000;     // una invitación sin respuesta libera la ranura
const BYTES_DESCARTE = 64 * 1024; // cola del canal de estado por encima de esto: se tira

/* ═══════════════ Códigos de sala ═══════════════ */

/**
 * Sin 0/O ni 1/I/L: son los pares que se confunden al leer un código en voz
 * alta o al copiarlo de una captura. Quedan 31 símbolos, y 31^6 son 887
 * millones de combinaciones, de sobra para que nadie caiga en una sala ajena
 * por accidente.
 */
export const ALFABETO_CODIGO = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const LARGO_CODIGO = 6;

export function generarCodigo(largo = LARGO_CODIGO) {
  const n = ALFABETO_CODIGO.length;
  const bytes = new Uint8Array(largo * 2);
  let salida = '';
  llenarAzar(bytes);
  let i = 0;
  while (salida.length < largo) {
    if (i >= bytes.length) { llenarAzar(bytes); i = 0; }
    const b = bytes[i++];
    // Muestreo por rechazo: 256 no es múltiplo de 31, así que tomar el resto sin
    // más haría que las primeras letras del alfabeto salieran más a menudo.
    if (b >= 256 - (256 % n)) continue;
    salida += ALFABETO_CODIGO[b % n];
  }
  return salida;
}

function llenarAzar(bytes) {
  const c = globalThis.crypto;
  if (c && typeof c.getRandomValues === 'function') { c.getRandomValues(bytes); return; }
  // El código de sala no es una barrera de seguridad, solo evita colisiones.
  for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
}

/** Limpia lo que ha escrito el usuario: espacios, guiones y minúsculas. */
export function normalizarCodigo(texto) {
  const limpio = String(texto ?? '').toUpperCase().replace(/[\s-]+/g, '');
  for (const ch of limpio) if (!ALFABETO_CODIGO.includes(ch)) return null;
  return limpio.length === LARGO_CODIGO ? limpio : null;
}

export function esCodigo(texto) {
  return normalizarCodigo(texto) !== null;
}

/* ═══════════════ Compresión de la descripción de sesión ═══════════════ */

const PREFIJO_BLOB = 'SRP1';
const VERSION_SOBRE = 1;

/**
 * Un SDP recién salido del navegador ocupa entre 1.200 y 2.500 caracteres, y en
 * base64 crece un tercio más. Eso no cabe cómodamente en un mensaje de chat, y
 * el usuario acaba pegándolo cortado.
 *
 * Se reduce en dos pasos:
 *
 * 1. Reescritura estructural. Casi todo el SDP es una plantilla fija: la versión,
 *    el origen, el grupo BUNDLE, la línea m=, el puerto SCTP... Como los dos
 *    extremos son Sierpe y ambos negocian exactamente lo mismo —un par de
 *    canales de datos y nada de audio ni vídeo—, basta con transmitir lo que de
 *    verdad cambia (ufrag, contraseña, huella, papel DTLS y candidatos) y
 *    reconstruir el resto. Pasa de ~2.000 a ~500 caracteres.
 *
 * 2. Deflate nativo con CompressionStream, que ya trae el navegador. El SDP es
 *    texto muy repetitivo y se queda en un tercio.
 *
 * Resultado típico: 350-500 caracteres. Cabe en cualquier chat de una pieza.
 *
 * Si el SDP no encaja en la plantilla —otra versión del navegador, algo
 * inesperado— se guarda entero y solo se aplica el paso 2. Vale más un blob
 * largo que una conexión que no se establece.
 */
function analizarSdp(sdp) {
  const lineas = String(sdp).split(/\r\n|\r|\n/);
  const r = { c: [], mid: '0', sp: 5000 };
  let secciones = 0;
  let esDatos = false;

  for (const linea of lineas) {
    if (linea.startsWith('m=')) {
      secciones++;
      esDatos = linea.startsWith('m=application') && linea.includes('webrtc-datachannel');
      continue;
    }
    if (linea.startsWith('a=ice-ufrag:')) r.u = linea.slice(12).trim();
    else if (linea.startsWith('a=ice-pwd:')) r.p = linea.slice(10).trim();
    else if (linea.startsWith('a=setup:')) r.s = linea.slice(8).trim();
    else if (linea.startsWith('a=mid:')) r.mid = linea.slice(6).trim();
    else if (linea.startsWith('a=sctp-port:')) r.sp = parseInt(linea.slice(12), 10) || 5000;
    else if (linea.startsWith('a=max-message-size:')) r.mm = parseInt(linea.slice(19), 10) || 0;
    else if (linea.startsWith('a=fingerprint:')) {
      const [algo, valor] = linea.slice(14).trim().split(/\s+/);
      if (algo && valor) {
        r.f = valor.replace(/:/g, '').toUpperCase();
        if (algo.toLowerCase() !== 'sha-256') r.h = algo;
      }
    } else if (linea.startsWith('a=candidate:')) {
      const c = recortarCandidato(linea.slice(12));
      if (c) r.c.push(c);
    }
  }

  // Una sola sección y que sea de datos: es la única forma que sabe reconstruir
  // la plantilla. Cualquier otra cosa se manda literal.
  if (secciones !== 1 || !esDatos) return null;
  if (!r.u || !r.p || !r.f || !r.s) return null;
  return r;
}

/**
 * Deja el candidato en lo imprescindible. Se descarta:
 * - TCP: solo sirve dentro de la misma red local, donde los candidatos UDP ya
 *   funcionan, y duplica el tamaño de la lista.
 * - Componente 2 (RTCP): con solo canales de datos no existe.
 * - Las coletillas 'generation', 'ufrag' y 'network-cost', que son extensiones
 *   opcionales que el otro extremo puede deducir o ignorar.
 *
 * Los candidatos mDNS (xxxx.local) SÍ se conservan: son los que permiten jugar
 * en la misma red local sin pasar por internet, y el navegador del otro extremo
 * sabe resolverlos.
 */
function recortarCandidato(valor) {
  const p = valor.trim().split(/\s+/);
  if (p.length < 8 || p[6] !== 'typ') return null;
  if (p[1] !== '1') return null;
  if (p[2].toLowerCase() !== 'udp') return null;

  const base = p.slice(0, 8);
  const iRaddr = p.indexOf('raddr');
  // Los reflexivos deben declarar la dirección base según la RFC 5245, y hay
  // analizadores que rechazan el candidato si falta.
  if (iRaddr > 7 && p[iRaddr + 2] === 'rport') {
    return base.concat(p.slice(iRaddr, iRaddr + 4)).join(' ');
  }
  return base.join(' ');
}

function reconstruirSdp(r) {
  const l = [
    'v=0',
    'o=- 1 1 IN IP4 127.0.0.1',
    's=-',
    't=0 0',
    `a=group:BUNDLE ${r.mid}`,
    'a=msid-semantic: WMS',
    'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
    'c=IN IP4 0.0.0.0',
  ];
  for (const c of r.c) l.push(`a=candidate:${c}`);
  // La recolección terminó antes de generar el blob, así que se declara. Sin
  // esto el otro extremo espera candidatos que no van a llegar nunca.
  l.push('a=end-of-candidates');
  l.push(`a=ice-ufrag:${r.u}`);
  l.push(`a=ice-pwd:${r.p}`);
  l.push('a=ice-options:trickle');
  l.push(`a=fingerprint:${r.h || 'sha-256'} ${puntear(r.f)}`);
  l.push(`a=setup:${r.s}`);
  l.push(`a=mid:${r.mid}`);
  l.push(`a=sctp-port:${r.sp}`);
  l.push(`a=max-message-size:${r.mm || 65536}`);
  return l.join('\r\n') + '\r\n';
}

const puntear = (hex) => (hex.match(/../g) || []).join(':');

/**
 * Comprueba que la plantilla devuelve lo mismo que entró antes de fiarse de
 * ella. Si un navegador futuro cambia algo y el análisis pierde un campo, el
 * fallo aparecería como una conexión que no se establece y sin pista alguna;
 * así se degrada solo a mandar el SDP entero.
 */
function plantillaFiable(original, r) {
  // Caso que sí ocurre: detrás de ciertos proxys el navegador solo consigue
  // candidatos TCP, y el filtro los tira todos. Quedarse sin ninguno hace la
  // conexión imposible, así que ahí vale más mandar el SDP entero.
  const totales = (original.match(/^a=candidate:/gm) || []).length;
  if (totales > 0 && r.c.length === 0) return false;

  const rehecho = analizarSdp(reconstruirSdp(r));
  if (!rehecho) return false;
  return rehecho.u === r.u && rehecho.p === r.p && rehecho.f === r.f
    && rehecho.s === r.s && rehecho.mid === r.mid
    && rehecho.c.length === r.c.length;
}

/* ── Sobre: lo que viaja de verdad entre los dos extremos ── */

/**
 * @param {object} sobre  { tipo, de, para, ranura, nombre, sdp }
 * @returns {Promise<string>} blob de texto listo para pegar
 */
export async function empaquetar(sobre) {
  const contenido = { v: VERSION_SOBRE, t: sobre.tipo, de: sobre.de };
  if (sobre.para) contenido.a = sobre.para;
  if (sobre.ranura != null) contenido.r = sobre.ranura;
  if (sobre.nombre) contenido.n = String(sobre.nombre).slice(0, 18);

  if (sobre.sdp) {
    const r = analizarSdp(sobre.sdp);
    if (r && plantillaFiable(sobre.sdp, r)) {
      contenido.k = 'c';
      contenido.d = r;
    } else {
      contenido.k = 'v';
      contenido.d = sobre.sdp;
    }
  }

  const crudo = nuevoTextoABytes(JSON.stringify(contenido));
  if (SOPORTE.compresion) {
    try {
      return PREFIJO_BLOB + 'Z' + bytesABase64Url(await desinflar(crudo));
    } catch { /* sin compresión también vale, solo ocupa más */ }
  }
  return PREFIJO_BLOB + 'P' + bytesABase64Url(crudo);
}

/**
 * @param {string} blob
 * @returns {Promise<object|null>} sobre, o null si el texto no es un blob válido
 */
export async function desempaquetar(blob) {
  const texto = String(blob ?? '').trim().replace(/\s+/g, '');
  if (!texto.startsWith(PREFIJO_BLOB)) return null;

  const modo = texto[PREFIJO_BLOB.length];
  const cuerpo = texto.slice(PREFIJO_BLOB.length + 1);
  let bytes;
  try {
    bytes = base64UrlABytes(cuerpo);
    if (modo === 'Z') bytes = await inflar(bytes);
    else if (modo !== 'P') return null;
  } catch {
    return null;
  }

  let contenido;
  try { contenido = JSON.parse(nuevoBytesATexto(bytes)); } catch { return null; }
  if (!contenido || contenido.v !== VERSION_SOBRE) return null;

  const sobre = {
    tipo: contenido.t,
    de: contenido.de,
    para: contenido.a ?? null,
    ranura: contenido.r ?? null,
    nombre: contenido.n ?? '',
    sdp: null,
  };
  if (contenido.d) {
    try {
      sobre.sdp = contenido.k === 'c' ? reconstruirSdp(contenido.d) : String(contenido.d);
    } catch { return null; }
  }
  return sobre;
}

/** Tamaño del blob en caracteres, para que la interfaz pueda avisar si se pasa. */
export function tamanoBlob(blob) {
  return String(blob ?? '').length;
}

/* ── Utilidades de codificación ── */

async function desinflar(bytes) {
  const cs = new CompressionStream('deflate-raw');
  const w = cs.writable.getWriter();
  w.write(bytes);
  w.close();
  return new Uint8Array(await new Response(cs.readable).arrayBuffer());
}

async function inflar(bytes) {
  const ds = new DecompressionStream('deflate-raw');
  const w = ds.writable.getWriter();
  w.write(bytes);
  w.close();
  return new Uint8Array(await new Response(ds.readable).arrayBuffer());
}

const nuevoTextoABytes = (s) => new TextEncoder().encode(s);
const nuevoBytesATexto = (b) => new TextDecoder().decode(b);

/**
 * base64 con el alfabeto de URL y sin relleno: el '+' y el '=' se rompen al
 * pasar por una barra de direcciones o por un chat que autoenlaza.
 */
function bytesABase64Url(bytes) {
  let s = '';
  const TROZO = 0x8000;   // pasar 60.000 argumentos de golpe desborda la pila
  for (let i = 0; i < bytes.length; i += TROZO) {
    s += String.fromCharCode(...bytes.subarray(i, i + TROZO));
  }
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlABytes(texto) {
  let s = texto.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/* ═══════════════ Conexión con un par ═══════════════ */

export const ESTADO = Object.freeze({
  NUEVA: 'nueva',
  CONECTANDO: 'conectando',
  ABIERTA: 'abierta',
  CERRADA: 'cerrada',
  FALLIDA: 'fallida',
});

const CANAL_ESTADO = 0;
const CANAL_CONTROL = 1;
const TRAMO_TRANSPORTE = 0;   // primer byte reservado; MSG de protocol.js empieza en 1
const SUB_PING = 1;
const SUB_PONG = 2;

/**
 * Envuelve un RTCPeerConnection y sus dos canales. No sabe nada del juego: solo
 * abre, mide, entrega bytes y avisa cuando se rompe.
 */
export class Conexion {
  /**
   * @param {object} op
   * @param {boolean} op.iniciador  true si este extremo genera la oferta
   * @param {*}       op.id         identificador del par para quien llame
   * @param {Array}   op.stun       servidores ICE alternativos
   */
  constructor(op = {}) {
    if (!SOPORTE.webrtc) {
      throw new ErrorTransporte('sin-webrtc', SOPORTE.razon || 'WebRTC no disponible');
    }
    this.id = op.id ?? 0;
    this.iniciador = !!op.iniciador;
    this.nombre = op.nombre ?? '';
    this.estado = ESTADO.NUEVA;
    this.rtt = 0;
    this.error = null;
    this.remoto = null;    // identidad del otro extremo en la señalización
    this.ranura = null;

    this.onEstado = op.onEstado ?? null;
    this.onDatos = op.onDatos ?? null;
    this.onError = op.onError ?? null;

    this.stats = {
      bytesEnviados: 0, bytesRecibidos: 0, descartados: 0, pings: 0, erroresConsumidor: 0,
    };

    // El anfitrión es el descortés y el invitado el cortés. Con un solo oferente
    // y sin renegociación no puede haber colisión de ofertas, pero la máquina de
    // negociación perfecta se deja montada: si algún día se añade renegociar,
    // el fallo aparecería como una conexión muerta y sin traza.
    this._educado = !this.iniciador;
    this._haciendoOferta = false;
    this._esperandoRespuesta = false;
    this._candidatosEnCola = [];

    this.pc = new RTCPeerConnection({
      iceServers: op.stun ?? SERVIDORES_STUN,
      // La agrupación es obligatoria en la práctica y ahorra una negociación.
      bundlePolicy: 'max-bundle',
      iceCandidatePoolSize: 0,
    });

    // Los canales se crean AQUÍ, antes de cualquier oferta. Si se crearan
    // después, la oferta saldría sin la sección m=application y no habría por
    // dónde mandar nada.
    //
    // 'negotiated: true' con identificadores fijos: los dos extremos declaran
    // los mismos canales por su cuenta en lugar de esperar a ondatachannel. Se
    // ahorra un viaje y desaparece la asimetría de quién crea qué.
    this.canalEstado = this.pc.createDataChannel('estado', {
      ordered: false, maxRetransmits: 0, negotiated: true, id: CANAL_ESTADO,
    });
    this.canalControl = this.pc.createDataChannel('control', {
      ordered: true, negotiated: true, id: CANAL_CONTROL,
    });

    // Sin esto Firefox entrega Blob y habría que leerlo de forma asíncrona en
    // mitad del bucle de juego.
    this.canalEstado.binaryType = 'arraybuffer';
    this.canalControl.binaryType = 'arraybuffer';

    this._ultimaSenal = ahora();
    this._temporizadorPing = 0;
    this._temporizadorVigilia = 0;
    this._temporizadorCaida = 0;

    this._engancharCanal(this.canalEstado, 'estado');
    this._engancharCanal(this.canalControl, 'control');
    this._engancharPar();
  }

  /* ── Ciclo de negociación ── */

  /**
   * Genera la oferta y espera a que ICE termine de recolectar.
   *
   * Se espera a propósito: el trickle ICE no sirve cuando el canal de
   * señalización es copiar y pegar, porque no hay forma de mandar candidatos
   * sueltos después. Todo tiene que ir dentro del mismo blob.
   *
   * @returns {Promise<string>} SDP completo
   */
  async oferta() {
    this._cambiarEstado(ESTADO.CONECTANDO);
    this._haciendoOferta = true;
    try {
      await this.pc.setLocalDescription(await this.pc.createOffer());
    } finally {
      this._haciendoOferta = false;
    }
    await this._esperarRecoleccion();
    return this.pc.localDescription.sdp;
  }

  /**
   * Aplica la oferta del otro extremo y devuelve la respuesta, también con la
   * recolección terminada.
   * @returns {Promise<string>} SDP completo
   */
  async responder(sdpOferta) {
    this._cambiarEstado(ESTADO.CONECTANDO);
    await this._aplicarDescripcion({ type: 'offer', sdp: sdpOferta });
    await this.pc.setLocalDescription(await this.pc.createAnswer());
    await this._esperarRecoleccion();
    return this.pc.localDescription.sdp;
  }

  /** Cierra el círculo en el extremo que ofreció. */
  async aceptarRespuesta(sdpRespuesta) {
    await this._aplicarDescripcion({ type: 'answer', sdp: sdpRespuesta });
  }

  /**
   * Negociación perfecta. El orden importa y es fácil equivocarse: una
   * descripción remota solo puede aplicarse si el estado de señalización lo
   * permite, y los candidatos sueltos solo pueden añadirse DESPUÉS de que haya
   * descripción remota. Los que lleguen antes se guardan y se aplican aquí.
   */
  async _aplicarDescripcion(desc) {
    const pc = this.pc;
    const esOferta = desc.type === 'offer';
    const listo = pc.signalingState === 'stable'
      || (this._esperandoRespuesta && !esOferta);
    const choque = esOferta && (this._haciendoOferta || !listo);

    if (choque) {
      // El descortés se planta y sigue con su propia oferta; el cortés cede y
      // vuelve a estable antes de aceptar la ajena. Si los dos cedieran o
      // ninguno lo hiciera, la negociación se quedaría colgada para siempre.
      if (!this._educado) return;
      await pc.setLocalDescription({ type: 'rollback' });
    }

    if (!esOferta) this._esperandoRespuesta = true;
    try {
      await pc.setRemoteDescription(desc);
    } finally {
      this._esperandoRespuesta = false;
    }

    for (const c of this._candidatosEnCola.splice(0)) {
      try { await pc.addIceCandidate(c); } catch { /* candidato caducado */ }
    }
  }

  /**
   * Candidato suelto, por si algún día la señalización sí puede llevarlos.
   * Antes de la descripción remota se encola: addIceCandidate lanzaría.
   */
  async agregarCandidato(candidato) {
    if (!candidato) return;
    if (!this.pc.remoteDescription) { this._candidatosEnCola.push(candidato); return; }
    try { await this.pc.addIceCandidate(candidato); } catch { /* caducado */ }
  }

  /**
   * Termina cuando ICE dice que ha acabado, cuando lleva MS_SILENCIO_ICE sin
   * candidatos nuevos y ya tiene alguno, o cuando se agota el tope duro.
   *
   * El tope importa: si uno de los STUN no contesta, hay navegadores que tardan
   * más de diez segundos en declarar 'complete'. Con los candidatos locales y
   * uno reflexivo ya se puede conectar en la mayoría de los casos; esperar al
   * resto solo hace que el usuario crea que se ha colgado.
   */
  _esperarRecoleccion() {
    const pc = this.pc;
    if (pc.iceGatheringState === 'complete') return Promise.resolve();

    return new Promise((resolver) => {
      let hechos = 0;
      let silencio = 0;
      let cerrado = false;

      const terminar = () => {
        if (cerrado) return;
        cerrado = true;
        clearTimeout(silencio);
        clearTimeout(tope);
        pc.removeEventListener('icegatheringstatechange', alEstado);
        pc.removeEventListener('icecandidate', alCandidato);
        resolver();
      };

      const rearmar = () => {
        clearTimeout(silencio);
        silencio = setTimeout(() => { if (hechos > 0) terminar(); }, MS_SILENCIO_ICE);
      };

      const alCandidato = (ev) => {
        if (!ev.candidate) { terminar(); return; }   // null = fin de la recolección
        hechos++;
        rearmar();
      };
      const alEstado = () => { if (pc.iceGatheringState === 'complete') terminar(); };

      const tope = setTimeout(terminar, MS_TOPE_ICE);
      pc.addEventListener('icecandidate', alCandidato);
      pc.addEventListener('icegatheringstatechange', alEstado);
      rearmar();
    });
  }

  /* ── Envío ── */

  /**
   * @param {ArrayBuffer|ArrayBufferView|string} datos
   * @param {'estado'|'control'} [canal]  por defecto se deduce del tipo
   * @returns {boolean} false si no se pudo enviar
   */
  enviar(datos, canal) {
    const cual = canal || (typeof datos === 'string' ? 'control' : 'estado');
    const dc = cual === 'control' ? this.canalControl : this.canalEstado;
    if (!dc || dc.readyState !== 'open') return false;

    // Contrapresión: si la cola del canal de estado crece es que la red no da
    // más. Encolar otro paquete solo empeora el retraso de todos los que vienen
    // detrás, y para cuando saliera ya estaría obsoleto. Se tira y se cuenta.
    if (cual === 'estado' && dc.bufferedAmount > BYTES_DESCARTE) {
      this.stats.descartados++;
      return false;
    }

    try {
      dc.send(datos);
      this.stats.bytesEnviados += tamanoDe(datos);
      return true;
    } catch (e) {
      this._avisarError(new ErrorTransporte('envio', e.message));
      return false;
    }
  }

  cerrar(motivo = 'cierre') {
    if (this.estado === ESTADO.CERRADA) return;
    this._pararRelojes();
    try { this.canalEstado.close(); } catch { /* ya cerrado */ }
    try { this.canalControl.close(); } catch { /* ya cerrado */ }
    try { this.pc.close(); } catch { /* ya cerrado */ }
    this._cambiarEstado(this.estado === ESTADO.FALLIDA ? ESTADO.FALLIDA : ESTADO.CERRADA, motivo);
  }

  get abierta() {
    return this.estado === ESTADO.ABIERTA;
  }

  /** Instantánea para el panel de red. */
  get estadisticas() {
    return {
      id: this.id,
      estado: this.estado,
      rtt: Math.round(this.rtt),
      colaEstado: this.canalEstado ? this.canalEstado.bufferedAmount : 0,
      ...this.stats,
    };
  }

  /* ── Enganches internos ── */

  _engancharPar() {
    const pc = this.pc;

    pc.addEventListener('connectionstatechange', () => this._revisarSalud());
    // Safari antiguo no tiene connectionState; iceConnectionState siempre está.
    pc.addEventListener('iceconnectionstatechange', () => this._revisarSalud());
    pc.addEventListener('icecandidateerror', (ev) => {
      // Que un STUN falle no es fatal: quedan los demás y los candidatos locales.
      if (ev.errorCode >= 700) return;
      this._avisarError(new ErrorTransporte('stun', `STUN ${ev.errorCode}: ${ev.errorText}`));
    });
    // A propósito NO se escucha 'negotiationneeded'. Salta una vez al crear los
    // canales en el constructor, y atenderlo llevaría a renegociar: la
    // señalización es de un solo uso y no habría por dónde mandar la segunda
    // oferta, así que se quedaría a medias en un estado del que no se sale.
  }

  _engancharCanal(dc, nombre) {
    dc.addEventListener('open', () => {
      if (this.canalEstado.readyState === 'open' && this.canalControl.readyState === 'open') {
        this._cambiarEstado(ESTADO.ABIERTA);
        this._arrancarRelojes();
      }
    });
    dc.addEventListener('close', () => {
      if (this.estado === ESTADO.ABIERTA) this._caer('canal cerrado');
    });
    dc.addEventListener('error', (ev) => {
      const e = ev.error || {};
      // 'User-Initiated Abort' es el cierre normal visto desde el otro lado.
      if (e.sctpCauseCode === 12) return;
      this._avisarError(new ErrorTransporte('canal', e.message || `fallo en ${nombre}`));
    });
    dc.addEventListener('message', (ev) => this._alMensaje(ev.data, nombre));
  }

  _alMensaje(datos, canal) {
    this._ultimaSenal = ahora();
    this.stats.bytesRecibidos += tamanoDe(datos);

    if (datos instanceof ArrayBuffer && datos.byteLength >= 2) {
      const v = new DataView(datos);
      if (v.getUint8(0) === TRAMO_TRANSPORTE) { this._alTramoInterno(v); return; }
    }
    if (!this.onDatos) return;
    // Esto corre dentro del listener 'message' del canal, donde no hay nadie
    // esperando: una excepción del consumidor moriría como error no capturado y
    // el transporte seguiría creyendo que la entrega fue bien. Se contabiliza y
    // se avisa para que un fallo del juego no pueda dejar el canal mudo sin que
    // se note.
    try {
      this.onDatos(datos, canal, this.id);
    } catch (e) {
      this.stats.erroresConsumidor++;
      // Si el propio manejador de errores también lanza no queda a quien avisar,
      // y dejar salir la excepción aquí sería repetir el defecto que se arregla.
      try {
        this._avisarError(new ErrorTransporte('consumidor', (e && e.message) || String(e)));
      } catch { /* consumidor roto del todo; el fallo ya está contado */ }
    }
  }

  _alTramoInterno(v) {
    const sub = v.getUint8(1);
    if (sub === SUB_PING && v.byteLength >= 10) {
      const eco = new ArrayBuffer(10);
      const w = new DataView(eco);
      w.setUint8(0, TRAMO_TRANSPORTE);
      w.setUint8(1, SUB_PONG);
      // Se devuelve la marca de tiempo del otro tal cual: así no hace falta que
      // los dos relojes estén sincronizados para medir la ida y vuelta.
      w.setFloat64(2, v.getFloat64(2));
      this.enviar(eco, 'control');
    } else if (sub === SUB_PONG && v.byteLength >= 10) {
      const ms = ahora() - v.getFloat64(2);
      if (ms >= 0 && ms < 10000) {
        // Media exponencial: un pico suelto no debe mover la cifra que se enseña.
        this.rtt = this.rtt ? this.rtt * 0.8 + ms * 0.2 : ms;
      }
    }
  }

  _arrancarRelojes() {
    this._pararRelojes();
    this._ultimaSenal = ahora();
    this._temporizadorPing = setInterval(() => this._enviarPing(), MS_PING);
    this._temporizadorVigilia = setInterval(() => {
      if (ahora() - this._ultimaSenal > MS_SIN_SENAL) this._caer('sin señal');
    }, 1000);
  }

  _pararRelojes() {
    clearInterval(this._temporizadorPing);
    clearInterval(this._temporizadorVigilia);
    clearTimeout(this._temporizadorCaida);
    this._temporizadorPing = 0;
    this._temporizadorVigilia = 0;
    this._temporizadorCaida = 0;
  }

  _enviarPing() {
    const buf = new ArrayBuffer(10);
    const v = new DataView(buf);
    v.setUint8(0, TRAMO_TRANSPORTE);
    v.setUint8(1, SUB_PING);
    v.setFloat64(2, ahora());
    if (this.enviar(buf, 'control')) this.stats.pings++;
  }

  _revisarSalud() {
    const s = this.pc.connectionState || this.pc.iceConnectionState;
    if (s === 'failed') { this._caer('ruta imposible'); return; }
    if (s === 'closed') { this.cerrar('cerrada por el otro extremo'); return; }

    if (s === 'disconnected') {
      // Puede recuperarse solo —un cambio de red, un pico de pérdida—, así que se
      // le da un margen antes de darla por muerta.
      this._cambiarEstado(ESTADO.CONECTANDO, 'ruta inestable');
      clearTimeout(this._temporizadorCaida);
      this._temporizadorCaida = setTimeout(() => {
        const ahoraS = this.pc.connectionState || this.pc.iceConnectionState;
        if (ahoraS === 'disconnected') this._caer('la ruta no se recuperó');
      }, MS_GRACIA_CAIDA);
      return;
    }

    if (s === 'connected' || s === 'completed') {
      clearTimeout(this._temporizadorCaida);
      if (this.canalEstado.readyState === 'open' && this.canalControl.readyState === 'open') {
        this._cambiarEstado(ESTADO.ABIERTA);
      }
    }
  }

  _caer(motivo) {
    if (this.estado === ESTADO.CERRADA || this.estado === ESTADO.FALLIDA) return;
    this._pararRelojes();
    this._cambiarEstado(ESTADO.FALLIDA, motivo);
    try { this.pc.close(); } catch { /* ya cerrada */ }
  }

  _cambiarEstado(nuevo, motivo = '') {
    if (this.estado === nuevo) return;
    this.estado = nuevo;
    if (this.onEstado) this.onEstado(nuevo, motivo, this.id);
  }

  _avisarError(err) {
    this.error = err;
    if (this.onError) this.onError(err, this.id);
  }
}

const ahora = () => (globalThis.performance ? performance.now() : Date.now());

function tamanoDe(datos) {
  if (typeof datos === 'string') return datos.length;
  if (datos instanceof ArrayBuffer) return datos.byteLength;
  return datos && datos.byteLength ? datos.byteLength : 0;
}

/* ═══════════════ Señalización ═══════════════ */

/**
 * Los dos adaptadores comparten interfaz para que Sala no sepa cuál está usando:
 *
 *   automatica          ¿puede intercambiar sobres sin ayuda del usuario?
 *   async disponible()  ¿se puede usar ahora mismo?
 *   async abrir(op)     engancha el canal ({ codigo, yo })
 *   async publicar(s)   saca un sobre
 *   cerrar()
 *   onSobre(sobre)      entra un sobre
 *
 * La diferencia es solo por dónde salen y entran los sobres: por un cuadro de
 * texto que el usuario copia, o por un servicio público.
 */
export class Senalizacion {
  constructor() {
    this.automatica = false;
    this.onSobre = null;
    this.onError = null;
    this.codigo = null;
    this.yo = null;
  }

  async disponible() { return SOPORTE.webrtc; }
  async abrir(op = {}) { this.codigo = op.codigo ?? null; this.yo = op.yo ?? null; }
  async publicar() { throw new ErrorTransporte('interfaz', 'sin implementar'); }
  cerrar() {}

  _entra(sobre) {
    if (sobre && this.onSobre) this.onSobre(sobre);
  }
}

/**
 * SenalizacionManual — el canal es el usuario.
 *
 * Genera un blob de texto que se copia y se pega en cualquier chat, y acepta el
 * blob de vuelta. No hay servidor, no hay cuentas y no hay nada que pueda caerse:
 * es la única forma de señalización que funciona siempre.
 *
 * A cambio, cada par cuesta dos pegados. Con seis jugadores son diez, y por eso
 * existe el adaptador público.
 */
export class SenalizacionManual extends Senalizacion {
  constructor(op = {}) {
    super();
    this.automatica = false;
    /** @type {(blob: string, sobre: object) => void} */
    this.onBlob = op.onBlob ?? null;
    this.ultimoBlob = '';
  }

  async publicar(sobre) {
    const blob = await empaquetar(sobre);
    this.ultimoBlob = blob;
    if (this.onBlob) this.onBlob(blob, sobre);
    return blob;
  }

  /**
   * Lo que el usuario ha pegado.
   * @returns {Promise<object|null>} el sobre leído, o null si el texto no vale
   */
  async inyectar(texto) {
    const sobre = await desempaquetar(texto);
    if (!sobre) {
      if (this.onError) {
        this.onError(new ErrorTransporte('blob', 'el texto pegado no es una invitación'));
      }
      return null;
    }
    this._entra(sobre);
    return sobre;
  }
}

/**
 * SenalizacionPublica — intercambia los blobs por un servicio público gratuito
 * y sin registro, para que el anfitrión solo tenga que decir un código de seis
 * letras en lugar de pegar blobs uno por uno.
 *
 * ── Qué se usa y por qué ──
 *
 * ntfy.sh: publicar/suscribirse a un tema arbitrario por HTTP y WebSocket, sin
 * cuenta, sin clave de API y sin dar de alta el tema. El tema se crea al
 * escribir en él. Es software libre (Apache-2.0) y quien no se fíe de la
 * instancia pública puede levantar la suya y pasarla en `servidor`.
 *
 * Se descartaron: los servicios de señalización gestionados (Metered y
 * similares) piden una clave publicable, y eso es una cuenta; los relés
 * públicos sobre Cloudflare Workers dependen de la cuota de un particular; y
 * Nostr, que sí sería accountless, exige firmar cada evento con secp256k1 y eso
 * son miles de líneas de criptografía que este proyecto no puede traer.
 *
 * ── Lo que hay que saber antes de usarlo ──
 *
 * - EL TEMA ES PÚBLICO. Cualquiera que adivine el código lee los sobres, y un
 *   sobre contiene la dirección IP pública de quien lo mandó. 31^6 combinaciones
 *   lo hacen improbable, pero no es un secreto: si eso importa, señalización
 *   manual por un canal privado.
 * - Es un servicio de notificaciones. Usarlo de tablón para WebRTC funciona pero
 *   no es para lo que está: si un día lo capa o desaparece, `disponible()`
 *   devolverá false y quedará la señalización manual, que no depende de nadie.
 * - Límites de la instancia pública: 4.096 bytes por mensaje (el blob comprimido
 *   ronda los 500, así que sobra), 60 peticiones seguidas por visitante y los
 *   mensajes se guardan 12 horas.
 * - Los mensajes viejos se ven al suscribirse. Por eso la ventana de repesca es
 *   corta y cada sobre lleva remitente y destinatario: los de otra partida no
 *   encajan con nadie y se ignoran.
 */
export class SenalizacionPublica extends Senalizacion {
  constructor(op = {}) {
    super();
    this.automatica = true;
    this.servidor = (op.servidor ?? 'https://ntfy.sh').replace(/\/+$/, '');
    this.ventana = op.ventana ?? '20s';
    this.ws = null;
    this.cerrada = false;
    this.vistos = new Set();
    this._reintentos = 0;
    this._reconexion = 0;
  }

  get tema() {
    // Prefijo con versión: si el formato del sobre cambia, una sala vieja y una
    // nueva no se pisan aunque coincida el código.
    return `sierpe1-${String(this.codigo ?? '').toLowerCase()}`;
  }

  /**
   * Se comprueba de verdad, con una petición corta, en vez de dar por hecho que
   * el servicio está en pie. Sin conexión —que es el caso normal de este juego—
   * devuelve false sin ruido y la interfaz ofrece solo la señalización manual.
   */
  async disponible() {
    if (!SOPORTE.webrtc || !SOPORTE.senalizacionRemota) return false;
    if (globalThis.navigator && navigator.onLine === false) return false;
    try {
      const corte = AbortSignal.timeout ? AbortSignal.timeout(3500) : undefined;
      const r = await fetch(`${this.servidor}/sierpe1-sonda/json?poll=1`, { signal: corte });
      // Sin consumir el cuerpo la conexión se queda abierta hasta que la recoja
      // el basurero, y esto se llama justo antes de abrir la sala.
      if (r.body) await r.body.cancel();
      return r.ok;
    } catch {
      return false;
    }
  }

  async abrir(op = {}) {
    await super.abrir(op);
    if (!this.codigo) throw new ErrorTransporte('codigo', 'falta el código de sala');
    this.cerrada = false;
    this._conectar();
  }

  async publicar(sobre) {
    const blob = await empaquetar(sobre);
    if (blob.length > 3900) {
      throw new ErrorTransporte('tamano', 'la invitación no cabe en un mensaje del servicio');
    }
    const r = await fetch(`${this.servidor}/${this.tema}`, {
      method: 'POST',
      body: blob,
      // Sin encabezados que provoquen una comprobación previa: ntfy responde a
      // las peticiones simples y así se evita el viaje extra del OPTIONS.
      headers: { 'Content-Type': 'text/plain' },
    });
    if (!r.ok) {
      throw new ErrorTransporte('publicar', `el servicio respondió ${r.status}`);
    }
    return blob;
  }

  cerrar() {
    this.cerrada = true;
    clearTimeout(this._reconexion);
    if (this.ws) {
      try { this.ws.close(); } catch { /* ya cerrado */ }
      this.ws = null;
    }
  }

  _conectar() {
    if (this.cerrada) return;
    const base = this.servidor.replace(/^http/, 'ws');
    const url = `${base}/${this.tema}/ws?since=${encodeURIComponent(this.ventana)}`;
    let ws;
    try { ws = new WebSocket(url); } catch (e) {
      this._fallo(new ErrorTransporte('senalizacion', e.message));
      return;
    }
    this.ws = ws;

    ws.addEventListener('open', () => { this._reintentos = 0; });
    ws.addEventListener('message', (ev) => this._alMensaje(ev.data));
    ws.addEventListener('error', () => { /* el cierre que viene detrás lo gestiona */ });
    ws.addEventListener('close', () => {
      if (this.cerrada) return;
      // Reintento con espera creciente: si el servicio está caído, insistir cada
      // segundo solo consume la cuota de peticiones y adelanta el bloqueo.
      const espera = Math.min(15000, 1000 * 2 ** this._reintentos++);
      this._reconexion = setTimeout(() => this._conectar(), espera);
    });
  }

  async _alMensaje(crudo) {
    let evento;
    try { evento = JSON.parse(crudo); } catch { return; }
    if (evento.event !== 'message' || !evento.message) return;

    // El servicio reenvía lo cacheado al suscribirse y puede repetir un mensaje
    // tras una reconexión: sin esta criba se procesaría dos veces la misma oferta.
    if (this.vistos.has(evento.id)) return;
    this.vistos.add(evento.id);
    if (this.vistos.size > 200) this.vistos.delete(this.vistos.values().next().value);

    const sobre = await desempaquetar(evento.message);
    if (!sobre) return;
    if (sobre.de === this.yo) return;                       // eco de lo propio
    if (sobre.para && sobre.para !== this.yo) return;       // dirigido a otro
    this._entra(sobre);
  }

  _fallo(err) {
    if (this.onError) this.onError(err);
  }
}

/* ═══════════════ Sala ═══════════════ */

const TIPO = Object.freeze({
  HOLA: 'h',        // invitado → sala: quiero entrar
  OFERTA: 'o',      // anfitrión → invitado
  RESPUESTA: 'r',   // invitado → anfitrión
  ADIOS: 'x',
});

const MAX_PARES = 6;

/**
 * Sala — N conexiones vistas desde el anfitrión, o una sola desde el invitado.
 *
 * ── Quién ofrece ──
 *
 * Siempre el anfitrión, en los dos modos de señalización. Es lo que permite que
 * `unirseComoCliente` acepte indistintamente un código o un blob: en los dos
 * casos el invitado recibe una oferta y devuelve una respuesta.
 *
 * Con código, el saludo del invitado es lo que dispara la oferta, así que el
 * anfitrión no tiene que adivinar cuántos van a entrar. Con blob, el anfitrión
 * acuña una invitación por hueco con `nuevaInvitacion()`: cada oferta vale para
 * un solo par, porque cada par es una conexión distinta.
 */
export class Sala {
  constructor(op = {}) {
    if (!SOPORTE.webrtc) {
      throw new ErrorTransporte('sin-webrtc', SOPORTE.razon || 'WebRTC no disponible');
    }
    this.esAnfitrion = !!op.esAnfitrion;
    this.maxPares = Math.max(1, op.maxPares ?? MAX_PARES);
    this.codigo = op.codigo ?? null;
    this.nombre = op.nombre ?? '';
    this.stun = op.stun ?? SERVIDORES_STUN;
    this.senalizacion = op.senalizacion ?? null;
    this.cerrada = false;

    // Identidad de esta sesión en la señalización. No es el id del par: sirve
    // solo para que los sobres sepan a quién van y para descartar el propio eco.
    this.yo = generarCodigo(10);

    this.onParConectado = op.onParConectado ?? null;
    this.onParDesconectado = op.onParDesconectado ?? null;
    this.onDatos = op.onDatos ?? null;
    this.onEstado = op.onEstado ?? null;
    this.onError = op.onError ?? null;

    /** @type {Map<number, Conexion>} */
    this._pares = new Map();
    /** @type {Map<number, {conexion: Conexion, remoto: string, caduca: number}>} */
    this._pendientes = new Map();
    this._siguienteId = 1;
    this._blobRespuesta = '';
    this._limpieza = setInterval(() => this._caducarPendientes(), 5000);
  }

  /* ── Construcción ── */

  /**
   * @param {object} op  { senalizacion, maxPares, codigo, nombre, on* }
   * @returns {Promise<Sala>}
   */
  static async crearComoAnfitrion(op = {}) {
    exigirSoporte();
    const senal = op.senalizacion ?? new SenalizacionManual();
    const codigo = op.codigo ?? (senal.automatica ? generarCodigo() : null);
    const sala = new Sala({ ...op, esAnfitrion: true, senalizacion: senal, codigo });
    await sala._prepararSenalizacion();
    return sala;
  }

  /**
   * @param {string} codigoOBlob  código de seis caracteres o invitación pegada
   * @returns {Promise<Sala>}  con `blobRespuesta` puesto si la señalización es manual
   */
  static async unirseComoCliente(codigoOBlob, op = {}) {
    exigirSoporte();
    const texto = String(codigoOBlob ?? '').trim();
    const codigo = normalizarCodigo(texto);

    // Se deduce el modo del propio argumento: un código de seis caracteres pide
    // el adaptador público; cualquier otra cosa se trata como invitación pegada.
    const senal = op.senalizacion
      ?? (codigo ? new SenalizacionPublica() : new SenalizacionManual());

    const sala = new Sala({
      ...op, esAnfitrion: false, senalizacion: senal, codigo, maxPares: 1,
    });
    await sala._prepararSenalizacion();

    if (senal.automatica) {
      if (!codigo) throw new ErrorTransporte('codigo', 'el código de sala no es válido');
      await senal.publicar({ tipo: TIPO.HOLA, de: sala.yo, nombre: sala.nombre });
    } else {
      const sobre = await desempaquetar(texto);
      if (!sobre || sobre.tipo !== TIPO.OFERTA) {
        throw new ErrorTransporte('blob', 'el texto pegado no es una invitación válida');
      }
      await sala._responderOferta(sobre);
    }
    return sala;
  }

  /* ── Uso desde el anfitrión con señalización manual ── */

  /**
   * Acuña una invitación para el siguiente hueco libre.
   * @returns {Promise<string>} blob para pegar en el chat
   */
  async nuevaInvitacion() {
    if (!this.esAnfitrion) throw new ErrorTransporte('rol', 'solo el anfitrión invita');
    if (this._ocupacion >= this.maxPares) {
      throw new ErrorTransporte('llena', 'no quedan huecos en la sala');
    }
    const { conexion, ranura } = this._nuevaConexion(null);
    // Con `return promesa` sin esperar, un fallo al publicar saldría por fuera de
    // este try y la invitación se quedaría ocupando hueco 45 s con su par vivo.
    try {
      const sdp = await conexion.oferta();
      return await this.senalizacion.publicar({
        tipo: TIPO.OFERTA, de: this.yo, ranura, nombre: this.nombre, sdp,
      });
    } catch (e) {
      this._liberarRanura(ranura, conexion, 'invitación fallida');
      throw e;
    }
  }

  /**
   * Cierra el círculo con lo que el invitado ha devuelto.
   * @returns {Promise<number>} identificador del par
   */
  async aceptarRespuesta(texto) {
    const sobre = await desempaquetar(texto);
    if (!sobre || sobre.tipo !== TIPO.RESPUESTA) {
      throw new ErrorTransporte('blob', 'el texto pegado no es una respuesta válida');
    }
    return this._aplicarRespuesta(sobre);
  }

  /** Respuesta que el invitado debe devolver al anfitrión (señalización manual). */
  get blobRespuesta() {
    return this._blobRespuesta;
  }

  /* ── Envío ── */

  /**
   * @param {number} idPar
   * @param {ArrayBuffer|ArrayBufferView|string} datos
   * @param {'estado'|'control'} [canal]
   */
  enviar(idPar, datos, canal) {
    const c = this._pares.get(idPar);
    return c ? c.enviar(datos, canal) : false;
  }

  /**
   * @param {*} datos
   * @param {number|number[]} [excepto]  par o pares que no deben recibirlo
   * @returns {number} cuántos lo recibieron
   */
  difundir(datos, excepto, canal) {
    const fuera = excepto == null ? null
      : (Array.isArray(excepto) ? new Set(excepto) : new Set([excepto]));
    let n = 0;
    for (const [id, c] of this._pares) {
      if (fuera && fuera.has(id)) continue;
      if (c.enviar(datos, canal)) n++;
    }
    return n;
  }

  /** @returns {Array<{id, estado, rtt, nombre}>} */
  get pares() {
    const salida = [];
    for (const [id, c] of this._pares) {
      salida.push({ id, estado: c.estado, rtt: Math.round(c.rtt), nombre: c.nombre });
    }
    return salida;
  }

  get abiertos() {
    let n = 0;
    for (const c of this._pares.values()) if (c.abierta) n++;
    return n;
  }

  get llena() {
    return this._ocupacion >= this.maxPares;
  }

  get _ocupacion() {
    return this._pares.size + this._pendientes.size;
  }

  get estadisticas() {
    return [...this._pares.values()].map((c) => c.estadisticas);
  }

  cerrar(motivo = 'sala cerrada') {
    if (this.cerrada) return;
    this.cerrada = true;
    clearInterval(this._limpieza);
    for (const p of this._pendientes.values()) p.conexion.cerrar(motivo);
    this._pendientes.clear();
    for (const c of this._pares.values()) c.cerrar(motivo);
    this._pares.clear();
    if (this.senalizacion) this.senalizacion.cerrar();
  }

  /* ── Interior ── */

  async _prepararSenalizacion() {
    const s = this.senalizacion;
    if (!s) return;
    s.onSobre = (sobre) => this._alSobre(sobre);
    s.onError = (err) => this._avisarError(err);
    if (s.automatica) {
      const ok = await s.disponible();
      if (!ok) {
        throw new ErrorTransporte(
          'senalizacion',
          'el servicio de códigos de sala no responde; usa la invitación manual',
        );
      }
    }
    await s.abrir({ codigo: this.codigo, yo: this.yo });
  }

  async _alSobre(sobre) {
    try {
      if (this.cerrada) return;
      if (this.esAnfitrion && sobre.tipo === TIPO.HOLA) await this._atenderSaludo(sobre);
      else if (this.esAnfitrion && sobre.tipo === TIPO.RESPUESTA) {
        await this._aplicarRespuesta(sobre);
      } else if (!this.esAnfitrion && sobre.tipo === TIPO.OFERTA) {
        await this._responderOferta(sobre);
      }
    } catch (e) {
      this._avisarError(e instanceof ErrorTransporte ? e
        : new ErrorTransporte('senalizacion', e.message));
    }
  }

  async _atenderSaludo(sobre) {
    if (this.llena) return;
    // Un saludo repetido —reenvío del servicio, o el invitado insistiendo— no
    // debe gastar un hueco por cada copia.
    for (const p of this._pendientes.values()) if (p.remoto === sobre.de) return;
    for (const c of this._pares.values()) if (c.remoto === sobre.de) return;

    const { conexion, ranura } = this._nuevaConexion(sobre.de);
    conexion.nombre = sobre.nombre || '';
    // El hueco se reserva antes de negociar para que un saludo repetido no acuñe
    // dos ofertas; si crear la oferta o publicarla falla hay que devolverlo, o el
    // servicio caído durante seis saludos deja la sala llena de conexiones muertas.
    try {
      const sdp = await conexion.oferta();
      await this.senalizacion.publicar({
        tipo: TIPO.OFERTA, de: this.yo, para: sobre.de, ranura, nombre: this.nombre, sdp,
      });
    } catch (e) {
      this._liberarRanura(ranura, conexion, 'oferta fallida');
      throw e;
    }
  }

  async _responderOferta(sobre) {
    if (this._pares.size > 0 || this._pendientes.size > 0) return;   // ya hay anfitrión
    const conexion = new Conexion({
      id: 0, iniciador: false, stun: this.stun, nombre: sobre.nombre || '',
      onEstado: (e, m, id) => this._alEstadoPar(id, e, m),
      onDatos: (d, canal, id) => this.onDatos && this.onDatos(id, d, canal),
      onError: (err, id) => this._avisarError(err, id),
    });
    conexion.remoto = sobre.de;
    conexion.ranura = sobre.ranura;
    this._pares.set(0, conexion);

    // Aquí es donde más duele no soltar la ranura: la guarda de arriba mira si
    // hay alguien en los mapas, así que una sola oferta con el SDP roto dejaría
    // la sala sorda para siempre y ninguna oferta legítima posterior entraría.
    try {
      const sdp = await conexion.responder(sobre.sdp);
      this._blobRespuesta = await this.senalizacion.publicar({
        tipo: TIPO.RESPUESTA, de: this.yo, para: sobre.de,
        ranura: sobre.ranura, nombre: this.nombre, sdp,
      });
    } catch (e) {
      this._liberarRanura(0, conexion, 'oferta inválida');
      throw e;
    }
  }

  async _aplicarRespuesta(sobre) {
    const pendiente = this._pendientes.get(sobre.ranura);
    if (!pendiente) {
      throw new ErrorTransporte('ranura', 'esa invitación ya no está esperando respuesta');
    }
    this._pendientes.delete(sobre.ranura);
    pendiente.conexion.remoto = sobre.de;
    if (sobre.nombre) pendiente.conexion.nombre = sobre.nombre;
    this._pares.set(sobre.ranura, pendiente.conexion);
    // Un SDP que no vale llega solo: el tema del servicio público es público y
    // cualquiera que sepa el código puede publicar ahí, y un blob manipulado hace
    // lo mismo. Sin esto la ranura se quedaría ocupada por una conexión muerta.
    try {
      await pendiente.conexion.aceptarRespuesta(sobre.sdp);
    } catch (e) {
      this._liberarRanura(sobre.ranura, pendiente.conexion, 'respuesta inválida');
      throw e;
    }
    return sobre.ranura;
  }

  _nuevaConexion(remoto) {
    const ranura = this._siguienteId++;
    const conexion = new Conexion({
      id: ranura, iniciador: true, stun: this.stun,
      onEstado: (e, m, id) => this._alEstadoPar(id, e, m),
      onDatos: (d, canal, id) => this.onDatos && this.onDatos(id, d, canal),
      onError: (err, id) => this._avisarError(err, id),
    });
    conexion.remoto = remoto;
    conexion.ranura = ranura;
    this._pendientes.set(ranura, { conexion, remoto, caduca: ahora() + MS_INVITACION });
    return { conexion, ranura };
  }

  /**
   * Devuelve una ranura que se tomó antes de tiempo.
   *
   * La ranura se ocupa ANTES de negociar a propósito: si se esperara a que el
   * SDP estuviera aplicado, dos sobres seguidos —el servicio público reenvía lo
   * que tiene en caché— pasarían las dos guardas y montarían dos conexiones para
   * el mismo hueco. El precio es que, si la negociación falla, hay que devolver
   * la ranura a mano: una conexión con solo descripción local nunca arranca ICE,
   * así que no habrá 'failed' ni 'closed' que despierte a _alEstadoPar, y fuera
   * de _pendientes tampoco la recicla _caducarPendientes.
   *
   * Se saca de los mapas ANTES de cerrar para que _alEstadoPar no anuncie como
   * desconectado a un par que nunca llegó a conectarse.
   */
  _liberarRanura(ranura, conexion, motivo) {
    if (this._pares.get(ranura) === conexion) this._pares.delete(ranura);
    const p = this._pendientes.get(ranura);
    if (p && p.conexion === conexion) this._pendientes.delete(ranura);
    conexion.cerrar(motivo);
  }

  _alEstadoPar(id, estado, motivo) {
    if (this.onEstado) this.onEstado(id, estado, motivo);
    if (estado === ESTADO.ABIERTA) {
      const c = this._pares.get(id);
      if (c && this.onParConectado) this.onParConectado(id, { nombre: c.nombre, rtt: c.rtt });
      return;
    }
    if (estado === ESTADO.CERRADA || estado === ESTADO.FALLIDA) {
      // Una conexión puede morir mientras todavía es una invitación sin
      // contestar. Si no se saca también de ahí, el hueco sigue ocupado hasta
      // que caduque y la sala parece llena sin estarlo.
      this._pendientes.delete(id);
      if (this._pares.delete(id) && this.onParDesconectado) {
        this.onParDesconectado(id, motivo || estado);
      }
    }
  }

  /**
   * Una invitación sin respuesta bloquea un hueco para siempre. Pasa cuando
   * alguien pide entrar y cierra la pestaña, y con el adaptador público también
   * cuando llega un saludo cacheado de una partida anterior.
   */
  _caducarPendientes() {
    const t = ahora();
    for (const [ranura, p] of this._pendientes) {
      if (t < p.caduca) continue;
      this._pendientes.delete(ranura);
      p.conexion.cerrar('invitación caducada');
    }
  }

  _avisarError(err, id) {
    if (this.onError) this.onError(err, id);
  }
}

function exigirSoporte() {
  if (!SOPORTE.webrtc) {
    throw new ErrorTransporte('sin-webrtc', SOPORTE.razon || 'WebRTC no disponible');
  }
}
