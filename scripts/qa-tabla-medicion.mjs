// La tabla de rendimiento, generada desde el registro JSON Lines que dejan qa-coste-electron.mjs y qa-bucle-electron.mjs
// con --json=archivo: así nunca se copia a mano. Aplica el protocolo de medición:
// - un candidato por build (huella sha256 de la entrada, build.entradaSha256), con su commit corto y su huella corta;
//   las mediciones con cambios sin commit se muestran, pero avisando (el commit no basta para saber qué se midió);
// - las del bucle con un cambio de primer plano durante la medición no valen: se quitan y se dice cuántas;
// - por métrica: mediana de las medianas de cada medición, mediana de sus p95 y rango (mín-máx) de las medianas;
//   n = mediciones. Los recuentos (llamadas, triángulos, programas, memoria, pases) se dan como valores observados;
// - el p95 del tiempo de GPU es una cota superior (cuenta los huecos en que la GPU espera a la CPU);
// - con dos candidatos o más, cada uno se compara con el primero: si los rangos de las medianas se solapan, no hay
//   cambio medible; si no, mejora o empeora (en ms, menos es mejor; en fps, más).
// Uso: node scripts/qa-tabla-medicion.mjs <archivo.jsonl> [--build=<prefijo de la huella>]...
// Sin --build, todos los builds en el orden del archivo; con --build, en el orden pedido (el primero es la referencia).
// Lo puro se prueba en test/qa-tabla-medicion.test.ts.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

// un error de quien llama (archivo, línea, prefijo): la línea de órdenes sale con 2 y solo el mensaje
export class ErrorDeEntrada extends Error {}

const dos = x => x === null ? null : +x.toFixed(2);
const hay = x => x !== null && x !== undefined;
const corta = hash => hash ? hash.slice(0, 8) : 'sin huella';

// la mediana de un conjunto pequeño (las mediciones de un candidato): con número par, la media de las dos centrales.
// No es el índice o[n/2] de percentil() en qa-medicion.mjs, que resume cientos de fotogramas de una medición
export function mediana(valores) {
  const o = [...valores].sort((a, b) => a - b), k = o.length >> 1;
  if (!o.length) return null;
  return o.length % 2 ? o[k] : (o[k - 1] + o[k]) / 2;
}

export function leerRegistros(texto) {
  const registros = [];
  texto.split('\n').forEach((linea, i) => {
    if (!linea.trim()) return;
    let r;
    try { r = JSON.parse(linea); } catch (e) { throw new ErrorDeEntrada(`línea ${i + 1}: no es JSON válido (${e.message}).`); }
    if (!r || typeof r !== 'object' || Array.isArray(r) || typeof r.guion !== 'string') throw new ErrorDeEntrada(`línea ${i + 1}: no es un registro de medición (falta "guion").`);
    registros.push(r);
  });
  return registros;
}

// en el orden en que aparece cada build por primera vez
export function agruparPorBuild(registros) {
  const grupos = new Map();
  for (const r of registros) {
    const hash = r.build?.entradaSha256 ?? null;
    if (!grupos.has(hash)) grupos.set(hash, { hash, registros: [] });
    grupos.get(hash).registros.push(r);
  }
  return [...grupos.values()];
}

export function elegirCandidatos(grupos, prefijos) {
  if (!prefijos.length) return grupos;
  return prefijos.map(p => {
    const encontrados = grupos.filter(g => g.hash?.startsWith(p));
    if (!encontrados.length) throw new ErrorDeEntrada(`--build=${p}: ningún build del registro tiene una huella que empiece así (hay: ${grupos.map(g => corta(g.hash)).join(', ') || 'ninguno'}).`);
    if (encontrados.length > 1) throw new ErrorDeEntrada(`--build=${p}: es ambiguo, vale para ${encontrados.map(g => corta(g.hash)).join(', ')}; alárgalo.`);
    return encontrados[0];
  });
}

// conjunto de valores observados: los seguidos, como rango (788-789); los sueltos, separados; los que faltan, contados
export function valoresObservados(valores) {
  const faltan = valores.filter(v => !hay(v)).length;
  const o = [...new Set(valores.filter(hay))].sort((a, b) => a - b);
  const tramos = [];
  for (const v of o) {
    const ultimo = tramos.at(-1);
    if (ultimo && Number.isInteger(v) && v === ultimo[1] + 1) ultimo[1] = v;
    else tramos.push([v, v]);
  }
  const texto = tramos.map(([a, b]) => a === b ? `${a}` : `${a}-${b}`).join(', ');
  if (!texto) return faltan ? `no medible en ${faltan}` : 'sin datos';
  return faltan ? `${texto}; no medible en ${faltan}` : texto;
}

// por medición: { mediana, p95 }; las que no tienen mediana (no medible) no cuentan
function resumirTiempos(porMedicion) {
  const validas = porMedicion.filter(x => hay(x?.mediana));
  const medianas = validas.map(x => x.mediana), p95s = validas.map(x => x.p95).filter(hay);
  return {
    n: validas.length, mediana: dos(mediana(medianas)), p95: dos(mediana(p95s)),
    min: medianas.length ? Math.min(...medianas) : null, max: medianas.length ? Math.max(...medianas) : null,
  };
}

// catálogo de métricas: de dónde sale cada una en el registro y cómo se lee y se compara
const ms = o => o ? { mediana: o.medianaMs, p95: o.p95Ms } : null;
const solo = v => ({ mediana: v, p95: null });
const llamadasPase = (r, cumple) => r.desglose?.porPase ? r.desglose.porPase.filter(p => cumple(p.nombre)).reduce((s, p) => s + p.llamadas, 0) : null;
const TIEMPOS_COSTE = [
  { id: 'fotograma', etiqueta: 'Fotograma, CPU con espera a la GPU (ms)', leer: r => ms(r) },
  { id: 'conSombra', etiqueta: '… con mapa de sombras (ms)', leer: r => ms(r.conSombra) },
  { id: 'sinSombra', etiqueta: '… sin mapa de sombras (ms)', leer: r => ms(r.sinSombra) },
  { id: 'gpu', etiqueta: 'Tiempo de GPU (ms)', leer: r => ms(r.tiempoGpu), cotaSuperior: true },
  { id: 'gpuConSombra', etiqueta: '… GPU con mapa de sombras (ms)', leer: r => ms(r.tiempoGpu?.conSombra), cotaSuperior: true },
  { id: 'gpuSinSombra', etiqueta: '… GPU sin mapa de sombras (ms)', leer: r => ms(r.tiempoGpu?.sinSombra), cotaSuperior: true },
];
const RECUENTOS_COSTE = [
  { id: 'llamadas', etiqueta: 'Llamadas de dibujo (máx. por fotograma)', leer: r => r.llamadasMax },
  { id: 'triangulos', etiqueta: 'Triángulos (máx. por fotograma)', leer: r => r.triangulosMax },
  { id: 'programasTrasReady', etiqueta: 'Programas de shader tras __ready', leer: r => r.programasPorFase?.trasReady },
  { id: 'programasTrasCalentar', etiqueta: '… tras calentar', leer: r => r.programasPorFase?.trasCalentar },
  { id: 'programasTrasMedir', etiqueta: '… tras medir', leer: r => r.programasPorFase?.trasMedir },
  { id: 'programasTrasDesglose', etiqueta: '… tras el desglose', leer: r => r.programasPorFase?.trasDesglose },
  { id: 'programasNuevos', etiqueta: '… nuevos durante la medición', leer: r => r.programasPorFase?.nuevosDuranteMedicion },
  { id: 'memoriaGeometrias', etiqueta: 'Memoria de GPU: geometrías', leer: r => r.memoria?.geometries },
  { id: 'memoriaTexturas', etiqueta: 'Memoria de GPU: texturas', leer: r => r.memoria?.textures },
  { id: 'pasesEscena', etiqueta: 'Desglose: llamadas del pase escena', leer: r => llamadasPase(r, n => n === 'escena') },
  { id: 'pasesSombras', etiqueta: 'Desglose: llamadas del pase sombras', leer: r => llamadasPase(r, n => n === 'sombras') },
  { id: 'pasesPost', etiqueta: 'Desglose: llamadas del postproceso', leer: r => llamadasPase(r, n => n.startsWith('post')) },
];
// los Hz de la pantalla no son nuestros: se muestran, pero no se comparan
const TIEMPOS_BUCLE = [
  { id: 'hz', etiqueta: 'Pantalla (Hz, de la mediana del rAF)', leer: r => solo(r.pantalla?.hz), mayorEsMejor: true, sinComparar: true },
  { id: 'fps', etiqueta: 'Fotogramas pintados por segundo', leer: r => solo(r.pintadosPorSegundo), mayorEsMejor: true },
  { id: 'intervalo', etiqueta: 'Intervalo entre pintados (ms)', leer: r => ms(r.intervaloPintados) },
  { id: 'cpuPaso', etiqueta: 'CPU dentro de paso() (ms)', leer: r => ms(r.cpuPaso) },
];

const cambioDePrimerPlano = r => Array.isArray(r.cambiosPrimerPlano) && r.cambiosPrimerPlano.length > 0;
const distintos = valores => [...new Set(valores.filter(hay).map(String))];

export function resumirCandidato({ hash, registros }) {
  const costes = registros.filter(r => r.guion === 'qa-coste-electron');
  const buclesTodos = registros.filter(r => r.guion === 'qa-bucle-electron');
  const bucles = buclesTodos.filter(r => !cambioDePrimerPlano(r));
  const medidos = [...costes, ...buclesTodos];
  const commits = distintos(medidos.map(r => r.commit));
  // ISO 8601: el orden del texto es el del tiempo
  const fechas = medidos.map(r => r.fecha).filter(hay).sort((a, b) => a.localeCompare(b));
  const nuevos = bucles.map(r => r.programas?.nuevos);
  return {
    hash, etiqueta: `${commits.join('+') || 'sin commit'} · ${corta(hash)}`, commits,
    entradas: distintos(medidos.map(r => r.build?.entrada)),
    sinCommit: medidos.filter(r => r.cambiosSinCommit).length, total: medidos.length,
    otros: registros.length - medidos.length,
    fechas: { desde: fechas[0] ?? null, hasta: fechas.at(-1) ?? null },
    condiciones: {
      ventana: distintos(medidos.map(r => r.ventana)), angle: distintos(medidos.map(r => r.angle)),
      pixeles: distintos(medidos.map(r => r.pixeles)), dpr: distintos(medidos.map(r => r.dpr)), gpu: distintos(medidos.map(r => r.gpu)),
    },
    coste: {
      n: costes.length,
      tiempos: Object.fromEntries(TIEMPOS_COSTE.map(m => [m.id, resumirTiempos(costes.map(m.leer))])),
      recuentos: Object.fromEntries(RECUENTOS_COSTE.map(m => [m.id, valoresObservados(costes.map(m.leer))])),
    },
    bucle: {
      n: bucles.length, excluidas: buclesTodos.length - bucles.length,
      tiempos: Object.fromEntries(TIEMPOS_BUCLE.map(m => [m.id, resumirTiempos(bucles.map(m.leer))])),
      programasNuevos: {
        conNuevos: nuevos.filter(v => hay(v) && v > 0).length,
        max: nuevos.some(hay) ? Math.max(...nuevos.filter(hay)) : null,
        noMedible: nuevos.filter(v => !hay(v)).length,
      },
    },
  };
}

// solo con los rangos de las medianas por medición: si se solapan (tocarse incluido), el ruido entre mediciones tapa
// la diferencia
export function veredicto(referencia, candidato, mayorEsMejor) {
  if (!referencia.n || !candidato.n) return 'sin datos';
  if (candidato.max >= referencia.min && referencia.max >= candidato.min) return 'sin cambio medible';
  const baja = candidato.max < referencia.min;
  return baja !== mayorEsMejor ? 'mejora' : 'empeora';
}

// ---- Markdown ----
const num = x => hay(x) ? `${dos(x)}` : '—';
const rango = f => f.n ? (f.min === f.max ? num(f.min) : `${num(f.min)}-${num(f.max)}`) : '—';
const lista = valores => valores.length ? valores.join(', ') : '—';

function tablaTiempos(catalogo, tiempos) {
  const filas = catalogo.map(m => {
    const f = tiempos[m.id];
    const p95 = hay(f.p95) && m.cotaSuperior ? `${num(f.p95)} (cota superior)` : num(f.p95);
    return `| ${m.etiqueta} | ${f.n} | ${num(f.mediana)} | ${p95} | ${rango(f)} |`;
  });
  return ['| Métrica | n | Mediana de las medianas | Mediana de los p95 | Rango de las medianas |', '|---|---|---|---|---|', ...filas].join('\n');
}

function seccionCandidato(c) {
  const l = [`### Candidato ${c.etiqueta}`, ''];
  l.push(`- Build: huella \`${c.hash ?? 'sin huella'}\`, entrada ${lista(c.entradas.map(e => `\`${e}\``))}`);
  l.push(`- Commits: ${lista(c.commits)}; mediciones del ${c.fechas.desde ?? '—'} al ${c.fechas.hasta ?? '—'}`);
  if (c.sinCommit) l.push(`- **AVISO:** ${c.sinCommit} de ${c.total} mediciones con cambios sin commit: el commit no basta para saber qué se midió.`);
  const k = c.condiciones;
  l.push(`- Condiciones: ventana ${lista(k.ventana)}, píxeles ${lista(k.pixeles)}, dpr ${lista(k.dpr)}, angle ${lista(k.angle)}; GPU ${lista(k.gpu)}`);
  if (Object.values(k).some(v => v.length > 1)) l.push('- **AVISO:** las condiciones no son las mismas en todas las mediciones de este candidato.');
  if (c.otros) l.push(`- Otros guiones en el registro, no incluidos: ${c.otros}`);
  l.push('', `#### Coste por fotograma (qa-coste-electron, ${c.coste.n} mediciones)`, '');
  if (c.coste.n) {
    l.push(tablaTiempos(TIEMPOS_COSTE, c.coste.tiempos), '');
    l.push('| Recuento | Valores observados |', '|---|---|', ...RECUENTOS_COSTE.map(m => `| ${m.etiqueta} | ${c.coste.recuentos[m.id]} |`));
  } else l.push('Sin mediciones.');
  const p = c.bucle.programasNuevos;
  l.push('', `#### Bucle real (qa-bucle-electron, ${c.bucle.n} mediciones; excluidas por cambio de primer plano: ${c.bucle.excluidas})`, '');
  if (c.bucle.n) {
    l.push(tablaTiempos(TIEMPOS_BUCLE, c.bucle.tiempos), '');
    l.push(`Programas de shader nuevos durante la medición: en ${p.conNuevos} de ${c.bucle.n} mediciones (máximo ${num(p.max)})${p.noMedible ? `; no medible en ${p.noMedible}` : ''}.`);
  } else l.push('Sin mediciones válidas.');
  return l.join('\n');
}

function seccionComparacion(referencia, candidato) {
  const filas = [
    ...TIEMPOS_COSTE.map(m => [m, referencia.coste.tiempos[m.id], candidato.coste.tiempos[m.id]]),
    ...TIEMPOS_BUCLE.filter(m => !m.sinComparar).map(m => [m, referencia.bucle.tiempos[m.id], candidato.bucle.tiempos[m.id]]),
  ].map(([m, a, b]) => `| ${m.etiqueta} | ${rango(a)} | ${rango(b)} | ${veredicto(a, b, !!m.mayorEsMejor)} |`);
  return [
    `#### ${candidato.etiqueta} frente a ${referencia.etiqueta}`, '',
    '| Métrica | Rango de medianas (referencia) | Rango de medianas (candidato) | Veredicto |', '|---|---|---|---|', ...filas,
  ].join('\n');
}

export function tablaMarkdown(candidatos, { origen }) {
  const partes = [
    `## Tabla de rendimiento (generada desde \`${origen}\`)`, '',
    'Generada con `node scripts/qa-tabla-medicion.mjs`: no se edita a mano. Por métrica, mediana de las medianas de cada medición, mediana de sus p95 y rango de las medianas; n = mediciones.',
    ...candidatos.map(c => `\n${seccionCandidato(c)}`),
  ];
  if (candidatos.length > 1) {
    const [referencia, ...resto] = candidatos;
    partes.push('', `### Comparación con ${referencia.etiqueta}`, '',
      'Por los rangos de las medianas por medición: si se solapan, sin cambio medible. En ms, menos es mejor; en fps, más. Los Hz de la pantalla no se comparan.',
      ...resto.map(c => `\n${seccionComparacion(referencia, c)}`));
  }
  return partes.join('\n') + '\n';
}

// argv sin node ni el guion: <archivo.jsonl> [--build=prefijo]...
export function generar(argv) {
  const prefijos = [], sueltos = [];
  for (const a of argv) {
    if (a.startsWith('--build=')) {
      const p = a.slice('--build='.length);
      if (!/^[0-9a-f]+$/.test(p)) throw new ErrorDeEntrada(`--build=${p} no vale: tiene que ser el principio de una huella sha256 (cifras hexadecimales en minúscula).`);
      prefijos.push(p);
    } else if (a.startsWith('--')) throw new ErrorDeEntrada(`opción desconocida: ${a}. Uso: node scripts/qa-tabla-medicion.mjs <archivo.jsonl> [--build=<prefijo>]...`);
    else sueltos.push(a);
  }
  if (sueltos.length !== 1) throw new ErrorDeEntrada('Uso: node scripts/qa-tabla-medicion.mjs <archivo.jsonl> [--build=<prefijo de la huella>]...');
  const [ruta] = sueltos;
  let texto;
  try { texto = readFileSync(ruta, 'utf8'); }
  catch (e) { throw new ErrorDeEntrada(e.code === 'ENOENT' ? `${ruta}: el archivo no existe.` : `${ruta}: no se puede leer (${e.code ?? e.message}).`); }
  const registros = leerRegistros(texto);
  if (!registros.length) throw new ErrorDeEntrada(`${ruta}: no tiene ninguna medición.`);
  const candidatos = elegirCandidatos(agruparPorBuild(registros), prefijos).map(resumirCandidato);
  return tablaMarkdown(candidatos, { origen: ruta });
}

// solo como guion: importarlo (en las pruebas) no lo ejecuta
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.stdout.write(generar(process.argv.slice(2))); }
  catch (e) {
    if (!(e instanceof ErrorDeEntrada)) throw e;
    console.error(e.message);
    process.exit(2);
  }
}
