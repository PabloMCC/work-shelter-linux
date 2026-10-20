// Lo que comparten los guiones de medición dentro de la app (qa-coste-electron.mjs, qa-bucle-electron.mjs): el
// servidor propio de cada medición, las opciones, los resúmenes (mediana, p95), las muestras de tiempo de GPU, el
// desglose de llamadas de dibujo y el registro JSON que ata cada medición a un commit y a un build. Lo puro se prueba
// en test/qa-medicion.test.ts; lo que pasa dentro de la página se queda en cada guion.
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PUERTO = process.env.SHELTER_PUERTO || '3791';
const espera = ms => new Promise(r => setTimeout(r, ms));

export async function servidor() {
  const datos = mkdtempSync(join(tmpdir(), 'shelter-medicion-'));
  const p = spawn(process.execPath, ['server/supervisor.mjs'], { stdio: 'ignore', env: { ...process.env, SHELTER_DATOS: datos, SHELTER_PUERTO: PUERTO, SHELTER_SIN_EJEMPLOS: '1' } });
  for (let i = 0; i < 80; i++) {
    try { if ((await fetch(`http://127.0.0.1:${PUERTO}/salud`)).ok) { const token = readFileSync(join(datos, 'token'), 'utf8').trim(); return { p, datos, url: `http://127.0.0.1:${PUERTO}/#t=${token}` }; } } catch {}
    await espera(250);
  }
  p.kill('SIGINT'); rmSync(datos, { recursive: true, force: true });
  throw new Error(`El servidor no ha arrancado en el puerto ${PUERTO}.`);
}

// Cierra la app medida sin el aviso de «¿Salir del refugio?» (electron/main.cjs, evento 'close'): ese diálogo bloquea
// el proceso principal y dejaba la ventana abierta hasta que alguien la cerraba a mano. destroy() no emite 'close'; la
// medición no tiene sesiones que parar (datos temporales) y el servidor lo apaga quien llama. Si destruir y cerrar no
// terminan en `ms` (un proceso principal bloqueado no contesta ni a evaluate()), se mata el proceso: una medición nunca
// deja una ventana viva.
export async function cerrarApp(app, ms = 10_000) {
  if (!app) return;
  const proceso = app.process();
  let reloj;
  const cerrada = await Promise.race([
    (async () => {
      await app.evaluate(({ BrowserWindow }) => { for (const v of BrowserWindow.getAllWindows()) v.destroy(); }).catch(() => {});
      await app.close().catch(() => {});
      return true;
    })(),
    new Promise(r => { reloj = setTimeout(() => r(false), ms); }),
  ]);
  clearTimeout(reloj);
  if (!cerrada && proceso.exitCode === null) proceso.kill('SIGKILL');
}

// [ancho x alto] [--angle=gl|vulkan|metal] [--veces=N] [--espera=ms] [--json=archivo] [--segundos=N]
// Una opción numérica mal escrita falla aquí, antes de arrancar nada: una medición con opciones raras no llega a correr
// ni, por tanto, al registro JSON
export function leerOpciones(argv) {
  const valor = nombre => argv.find(o => o.startsWith(`--${nombre}=`))?.slice(nombre.length + 3);
  // solo cifras (y decimales con punto): ni signo, ni exponentes, ni Infinity
  const numero = (nombre, porDefecto, { entero = false, cero = true }, explicacion) => {
    const v = valor(nombre);
    if (v === undefined) return porDefecto;
    const n = /^\d+(\.\d+)?$/.test(v) ? Number(v) : NaN;
    if (!Number.isFinite(n) || (entero && !Number.isInteger(n)) || (!cero && n === 0)) throw new Error(`--${nombre}=${v} no vale: ${explicacion}.`);
    return n;
  };
  const [w, h] = (argv.find(o => /^\d+x\d+$/.test(o)) || '1440x900').split('x').map(Number);
  const angle = valor('angle');
  // las opciones de Chromium van delante del guion de la app; Vulkan, además, hay que activarlo
  const chromium = angle ? [`--use-angle=${angle}`, ...(angle === 'vulkan' ? ['--enable-features=Vulkan'] : [])] : [];
  return {
    w, h, angle, chromium,
    veces: numero('veces', 1, { entero: true, cero: false }, 'tiene que ser un número entero de mediciones, 1 o más'),
    esperaMs: numero('espera', 0, {}, 'tiene que ser un número de milisegundos, 0 o más'),
    json: valor('json') || undefined,
    segundos: numero('segundos', 10, { cero: false }, 'tiene que ser un número de segundos mayor que 0'),
  };
}

// programas nuevos entre dos recuentos; si falta uno (renderer.info.programs no existe), no se sabe: null, no 0
export function nuevos(antes, despues) {
  return antes === null || antes === undefined || despues === null || despues === undefined ? null : despues - antes;
}

// para el texto: lo que no se ha podido medir se dice, en vez de escribir «null» o un 0
export function cifra(x, sufijo = '') {
  return x === null || x === undefined ? 'no medible' : `${x}${sufijo}`;
}

// mismo índice que ha usado siempre qa-coste-electron (mediana = o[n/2], p95 = o[0,95·n]): los números nuevos se
// comparan con los de antes
export function percentil(ordenados, p) {
  if (!ordenados.length) return null;
  return ordenados[Math.min(ordenados.length - 1, Math.floor(ordenados.length * p))];
}
const dos = x => x === null ? null : +x.toFixed(2);
export function resumen(ts) {
  const o = [...ts].sort((a, b) => a - b);
  return { n: o.length, medianaMs: dos(percentil(o, 0.5)), p95Ms: dos(percentil(o, 0.95)) };
}

// de marcas de tiempo (ms) a intervalos entre ellas, con el peor: el tirón que se nota aunque la mediana vaya bien
export function intervalos(marcas) {
  const d = marcas.slice(1).map((t, i) => t - marcas[i]);
  return { ...resumen(d), maxMs: d.length ? dos(Math.max(...d)) : null };
}

// muestras de EXT_disjoint_timer_query_webgl2: { ns, disjunta }. Una consulta que estaba en vuelo cuando la GPU avisó
// de algo disjunto (cambio de frecuencia, otro proceso…) no vale; una que no llegó a tener resultado, tampoco
export function filtrarGpu(muestras) {
  const ms = [];
  let disjuntas = 0, sinResultado = 0;
  for (const m of muestras) {
    if (m.disjunta) disjuntas++;
    else if (m.ns === null || m.ns === undefined) sinResultado++;
    else ms.push(m.ns / 1e6);
  }
  return { ms, disjuntas, sinResultado };
}

// llamadas: [{ pase, grupo, triangulos }], una por llamada de dibujo. Suma por pase y, en los pases que dibujan objetos
// de la escena (grupo no nulo), por grupo; de más a menos llamadas y, a igualdad, triángulos. Más allá del tope, el
// resto en una línea
const ordenar = cubos => [...cubos.values()].sort((a, b) => b.llamadas - a.llamadas || b.triangulos - a.triangulos || a.nombre.localeCompare(b.nombre));
function sumar(cubos, nombre, triangulos) {
  const c = cubos.get(nombre) ?? { nombre, llamadas: 0, triangulos: 0 };
  c.llamadas++; c.triangulos += triangulos; cubos.set(nombre, c);
}
export function agregarDesglose(llamadas, tope = 15) {
  const pases = new Map(), grupos = new Map();
  let triangulos = 0;
  for (const l of llamadas) {
    triangulos += l.triangulos;
    sumar(pases, l.pase, l.triangulos);
    if (l.grupo === null || l.grupo === undefined) continue;
    if (!grupos.has(l.pase)) grupos.set(l.pase, new Map());
    sumar(grupos.get(l.pase), l.grupo, l.triangulos);
  }
  const porGrupo = {};
  for (const [pase, cubos] of grupos) {
    const lista = ordenar(cubos);
    const resto = lista.slice(tope);
    porGrupo[pase] = resto.length
      ? [...lista.slice(0, tope), { nombre: 'resto', llamadas: resto.reduce((s, c) => s + c.llamadas, 0), triangulos: resto.reduce((s, c) => s + c.triangulos, 0), grupos: resto.length }]
      : lista;
  }
  return { total: { llamadas: llamadas.length, triangulos }, porPase: ordenar(pases), porGrupo };
}

// el JS de entrada que pone Vite en el index (<script type="module" … src="/assets/main-….js">)
export function entradaDeIndex(html) {
  const m = /<script\b[^>]*\btype="module"[^>]*\bsrc="\/?([^"]+)"/.exec(html);
  return m ? m[1] : null;
}

const sha256 = datos => createHash('sha256').update(datos).digest('hex');
// huella del build que se mide: el index cambia con cada build (lleva el hash de la entrada) y la entrada es el código
export function huellaBuild(dir = 'dist/web') {
  let html;
  try { html = readFileSync(join(dir, 'index.html')); } catch { return { indexHtml: null, entrada: null, entradaSha256: null }; }
  const entrada = entradaDeIndex(html.toString('utf8'));
  let entradaSha256 = null;
  try { if (entrada) entradaSha256 = sha256(readFileSync(join(dir, entrada))); } catch {}
  return { indexHtml: sha256(html), entrada, entradaSha256 };
}

// commit corto y si hay cambios sin commit (entonces el hash no basta para saber qué se midió)
export function commitActual() {
  const git = (...a) => execFileSync('git', a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  try { return { hash: git('rev-parse', '--short', 'HEAD'), sucio: git('status', '--porcelain', '--untracked-files=no') !== '' }; }
  catch { return { hash: null, sucio: false }; }
}

export function crearRegistro({ guion, fecha, commit, build, opciones, resultado }) {
  return { guion, fecha: fecha.toISOString(), commit: commit.hash, cambiosSinCommit: commit.sucio, build, opciones, ...resultado };
}

// JSON Lines: un objeto por medición, añadido al final
export function anadirJson(ruta, registro) {
  appendFileSync(ruta, JSON.stringify(registro) + '\n');
}
