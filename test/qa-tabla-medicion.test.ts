// La tabla de rendimiento sale del registro JSON Lines de las mediciones (scripts/qa-tabla-medicion.mjs), nunca de
// copiarla a mano. Registros sintéticos y pequeños: lo que se prueba son las reglas del protocolo de medición.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

type Registro = Record<string, unknown>;
type Fila = { n: number; mediana: number | null; p95: number | null; min: number | null; max: number | null };
type Candidato = {
  hash: string | null; etiqueta: string; commits: string[]; sinCommit: number; total: number;
  coste: { n: number; tiempos: Record<string, Fila>; recuentos: Record<string, string> };
  bucle: { n: number; excluidas: number; tiempos: Record<string, Fila>; programasNuevos: { conNuevos: number; max: number | null; noMedible: number } };
};
type Tabla = {
  ErrorDeEntrada: new (mensaje: string) => Error;
  mediana(valores: number[]): number | null;
  leerRegistros(texto: string): Registro[];
  agruparPorBuild(registros: Registro[]): { hash: string | null; registros: Registro[] }[];
  elegirCandidatos(grupos: { hash: string | null; registros: Registro[] }[], prefijos: string[]): { hash: string | null; registros: Registro[] }[];
  valoresObservados(valores: (number | null | undefined)[]): string;
  resumirCandidato(grupo: { hash: string | null; registros: Registro[] }): Candidato;
  veredicto(referencia: Fila, candidato: Fila, mayorEsMejor: boolean): string;
  generar(argv: string[]): string;
};

// ruta calculada: el módulo es JavaScript sin tipos y TypeScript no lo resuelve; los tipos van arriba
let t: Tabla;
beforeAll(async () => { t = (await import(new URL('../scripts/qa-tabla-medicion.mjs', import.meta.url).href)) as Tabla; });

const A = 'aaaa1111'.padEnd(64, '0'), B = 'bbbb2222'.padEnd(64, '0');
const base = (hash: string, commit = 'c0ffee1', sucio = false) => ({
  fecha: '2026-10-20T20:00:00.000Z', commit, cambiosSinCommit: sucio, build: { indexHtml: 'i', entrada: 'assets/main-x.js', entradaSha256: hash },
});
const res = (medianaMs: number, p95Ms: number) => ({ n: 40, medianaMs, p95Ms });
function coste(hash: string, medianaMs: number, p95Ms: number, extra: Registro = {}): Registro {
  return {
    guion: 'qa-coste-electron', ...base(hash), opciones: { ventana: '1440x900', angle: 'por defecto' },
    n: 120, medianaMs, p95Ms, conSombra: res(medianaMs + 1, p95Ms), sinSombra: res(medianaMs - 1, p95Ms - 1),
    llamadasMax: 788, triangulosMax: 968385, programas: 41, memoria: { geometries: 539, textures: 132 },
    ventana: '1440x900', angle: 'por defecto', pixeles: '1944x1215', dpr: 1.35, gpu: 'GPU de prueba',
    tiempoGpu: { n: 120, medianaMs: 2.5, p95Ms: 13.8, conSombra: res(2.7, 13.9), sinSombra: res(2.4, 13.5), disjuntas: 0, sinResultado: 0 },
    programasPorFase: { trasReady: 6, trasCalentar: 41, trasMedir: 41, trasDesglose: 42, nuevosDuranteMedicion: 0 },
    desglose: { total: { llamadas: 794, triangulos: 969901 }, porPase: [
      { nombre: 'escena', llamadas: 478, triangulos: 1 }, { nombre: 'sombras', llamadas: 296, triangulos: 1 },
      { nombre: 'post 1: EffectPass(Bloom)', llamadas: 17, triangulos: 17 }, { nombre: 'post 2: EffectPass(SMAA)', llamadas: 3, triangulos: 3 },
    ] },
    ...extra,
  };
}
function bucle(hash: string, cpuMediana: number, fps: number, extra: Registro = {}): Registro {
  return {
    guion: 'qa-bucle-electron', ...base(hash), opciones: { ventana: '1440x900', segundos: 20 },
    ventana: '1440x900', pixeles: '1944x1215', dpr: 1.35, gpu: 'GPU de prueba', angle: 'por defecto', segundos: 20, arranque: 'ya corría',
    pantalla: { n: 3000, medianaMs: 6.1, p95Ms: 6.6, maxMs: 18, hz: 163.9 },
    pintadosPorSegundo: fps, pintados: fps * 20, intervaloPintados: { n: 1000, medianaMs: +(1000 / fps).toFixed(1), p95Ms: 18.6, maxMs: 21 },
    cpuPaso: { n: 1000, medianaMs: cpuMediana, p95Ms: cpuMediana + 3 }, programas: { inicio: 43, fin: 43, nuevos: 0 },
    cambiosPrimerPlano: [],
    ...extra,
  };
}
const jsonl = (registros: Registro[]) => registros.map(r => JSON.stringify(r)).join('\n') + '\n';

describe('mediana entre mediciones', () => {
  it('la de siempre de un conjunto: con número par, la media de las dos centrales', () => {
    expect(t.mediana([3, 1, 2])).toBe(2);
    expect(t.mediana([4, 1, 3, 2])).toBe(2.5);
    expect(t.mediana([])).toBeNull();
  });
});

describe('leer el registro', () => {
  it('una línea por medición; las vacías no cuentan', () => {
    expect(t.leerRegistros(`${JSON.stringify({ guion: 'x' })}\n\n${JSON.stringify({ guion: 'y' })}\n`)).toEqual([{ guion: 'x' }, { guion: 'y' }]);
  });
  it('una línea que no es JSON para con un error que dice cuál', () => {
    expect(() => t.leerRegistros('{"guion":"x"}\n{roto\n')).toThrow(/línea 2/);
    expect(() => t.leerRegistros('{"guion":"x"}\n{roto\n')).toThrow(t.ErrorDeEntrada);
  });
  it('una línea JSON que no es un registro (sin guion) también', () => {
    expect(() => t.leerRegistros('[1,2]\n')).toThrow(/línea 1/);
  });
});

describe('candidatos: uno por build', () => {
  it('agrupa por la huella de la entrada, en el orden en que aparecen en el archivo', () => {
    const g = t.agruparPorBuild([coste(B, 10, 20), coste(A, 11, 21), bucle(B, 9, 55)]);
    expect(g.map(x => x.hash)).toEqual([B, A]);
    expect(g[0].registros).toHaveLength(2);
  });
  it('se eligen por prefijo de la huella, en el orden pedido; uno desconocido o ambiguo falla', () => {
    const g = t.agruparPorBuild([coste(A, 10, 20), coste(B, 11, 21), coste('aaaa9999'.padEnd(64, '0'), 1, 2)]);
    expect(t.elegirCandidatos(g, ['bbbb', 'aaaa1']).map(x => x.hash)).toEqual([B, A]);
    expect(t.elegirCandidatos(g, []).map(x => x.hash)).toHaveLength(3);
    expect(() => t.elegirCandidatos(g, ['cccc'])).toThrow(/cccc/);
    expect(() => t.elegirCandidatos(g, ['cccc'])).toThrow(t.ErrorDeEntrada);
    expect(() => t.elegirCandidatos(g, ['aaaa'])).toThrow(/aaaa/);
  });
  it('la etiqueta es commit corto y huella corta; los cambios sin commit se cuentan', () => {
    const c = t.resumirCandidato({ hash: A, registros: [coste(A, 10, 20), { ...coste(A, 10, 20), cambiosSinCommit: true }] });
    expect(c.etiqueta).toBe('c0ffee1 · aaaa1111');
    expect(c.sinCommit).toBe(1);
  });
});

describe('agregado por candidato', () => {
  it('mediana de las medianas, mediana de los p95 y rango de las medianas; n = mediciones', () => {
    const c = t.resumirCandidato({ hash: A, registros: [coste(A, 10, 20), coste(A, 12, 30), coste(A, 11, 22)] });
    expect(c.coste.n).toBe(3);
    expect(c.coste.tiempos.fotograma).toEqual({ n: 3, mediana: 11, p95: 22, min: 10, max: 12 });
    expect(c.coste.tiempos.conSombra).toEqual({ n: 3, mediana: 12, p95: 22, min: 11, max: 13 });
  });
  it('un tiempo de GPU no medible no cuenta en su fila (n menor), en vez de valer 0', () => {
    const c = t.resumirCandidato({ hash: A, registros: [coste(A, 10, 20), coste(A, 10, 20, { tiempoGpu: null })] });
    expect(c.coste.tiempos.gpu.n).toBe(1);
    expect(c.coste.tiempos.gpu.mediana).toBe(2.5);
  });
  it('excluye las mediciones del bucle con cambio de primer plano y dice cuántas', () => {
    const cambio = { cambiosPrimerPlano: [{ ms: 1200, activo: false }] };
    const c = t.resumirCandidato({ hash: A, registros: [bucle(A, 9, 55), bucle(A, 30, 10, cambio), bucle(A, 11, 57)] });
    expect(c.bucle.n).toBe(2);
    expect(c.bucle.excluidas).toBe(1);
    expect(c.bucle.tiempos.cpuPaso).toEqual({ n: 2, mediana: 10, p95: 13, min: 9, max: 11 });
    expect(c.bucle.tiempos.fps).toEqual({ n: 2, mediana: 56, p95: null, min: 55, max: 57 });
  });
  it('programas nuevos del bucle: en cuántas mediciones aparecieron y el máximo', () => {
    const c = t.resumirCandidato({ hash: A, registros: [
      bucle(A, 9, 55), bucle(A, 9, 55, { programas: { inicio: 43, fin: 45, nuevos: 2 } }), bucle(A, 9, 55, { programas: { inicio: null, fin: null, nuevos: null } }),
    ] });
    expect(c.bucle.programasNuevos).toEqual({ conNuevos: 1, max: 2, noMedible: 1 });
  });
  it('los recuentos se dan como el conjunto de valores observados', () => {
    const c = t.resumirCandidato({ hash: A, registros: [coste(A, 10, 20), coste(A, 10, 20, { llamadasMax: 789 }), coste(A, 10, 20)] });
    expect(c.coste.recuentos.llamadas).toBe('788-789');
    expect(c.coste.recuentos.memoriaTexturas).toBe('132');
    expect(c.coste.recuentos.pasesPost).toBe('20');
    expect(c.coste.recuentos.pasesSombras).toBe('296');
  });
  it('valores observados: seguidos como rango, sueltos separados, y lo que falta se dice', () => {
    expect(t.valoresObservados([788, 789, 788])).toBe('788-789');
    expect(t.valoresObservados([5])).toBe('5');
    expect(t.valoresObservados([7, 5, 9, 8])).toBe('5, 7-9');
    expect(t.valoresObservados([5, null])).toBe('5; no medible en 1');
    expect(t.valoresObservados([])).toBe('sin datos');
  });
});

describe('veredicto entre dos candidatos', () => {
  const fila = (min: number, max: number): Fila => ({ n: 3, mediana: (min + max) / 2, p95: null, min, max });
  it('si los rangos de las medianas se solapan, no hay cambio medible', () => {
    expect(t.veredicto(fila(10, 12), fila(11.5, 13), false)).toBe('sin cambio medible');
    expect(t.veredicto(fila(10, 12), fila(12, 13), false)).toBe('sin cambio medible');   // tocarse es solaparse
  });
  it('en ms, todo por debajo es mejora y todo por encima, empeora', () => {
    expect(t.veredicto(fila(10, 12), fila(7, 9), false)).toBe('mejora');
    expect(t.veredicto(fila(10, 12), fila(13, 14), false)).toBe('empeora');
  });
  it('en fps, al revés: más es mejor', () => {
    expect(t.veredicto(fila(50, 52), fila(55, 57), true)).toBe('mejora');
    expect(t.veredicto(fila(50, 52), fila(40, 45), true)).toBe('empeora');
  });
  it('sin datos en un lado no hay veredicto', () => {
    expect(t.veredicto({ n: 0, mediana: null, p95: null, min: null, max: null }, fila(1, 2), false)).toBe('sin datos');
  });
});

describe('la tabla en Markdown', () => {
  let dir: string, ruta: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'qa-tabla-'));
    ruta = join(dir, 'm.jsonl');
    writeFileSync(ruta, jsonl([
      coste(A, 10, 20), coste(A, 11, 21), coste(A, 12, 22), bucle(A, 9, 55), bucle(A, 10, 56),
      bucle(A, 40, 5, { cambiosPrimerPlano: [{ ms: 10, activo: false }] }),
      { ...coste(B, 6, 15), cambiosSinCommit: true, commit: 'beef002' }, coste(B, 7, 16), coste(B, 8, 17), bucle(B, 9.5, 55.5), bucle(B, 10, 56),
    ]));
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('un candidato por build, con sus tablas de coste y de bucle, y sin comparación si solo hay uno', () => {
    const md = t.generar([ruta, '--build=aaaa']);
    expect(md).toContain('### Candidato c0ffee1 · aaaa1111');
    expect(md).toContain('| Fotograma, CPU con espera a la GPU (ms) | 3 | 11 | 21 | 10-12 |');
    expect(md).toMatch(/excluidas por cambio de primer plano: 1/);
    expect(md).toMatch(/cota superior/);
    expect(md).not.toContain('bbbb2222');
    expect(md).not.toMatch(/Comparación/);
  });
  it('con dos candidatos, compara cada uno con el primero por solape de rangos', () => {
    const md = t.generar([ruta]);
    expect(md).toContain('beef002+c0ffee1 · bbbb2222');
    expect(md).toMatch(/1 de 5 mediciones con cambios sin commit/);
    expect(md).toMatch(/Comparación/);
    expect(md).toContain('| Fotograma, CPU con espera a la GPU (ms) | 10-12 | 6-8 | mejora |');
    expect(md).toContain('| CPU dentro de paso() (ms) | 9-10 | 9.5-10 | sin cambio medible |');
  });
  it('los errores de entrada son de entrada (salida 2 en la línea de órdenes) y en castellano', () => {
    expect(() => t.generar([])).toThrow(t.ErrorDeEntrada);
    expect(() => t.generar([join(dir, 'no-existe.jsonl')])).toThrow(/no existe|no se puede leer/);
    expect(() => t.generar([ruta, '--build=cccc'])).toThrow(/cccc/);
  });
  it('la línea de órdenes sale con 2 y un mensaje claro; importarla no la ejecuta', () => {
    const guion = fileURLToPath(new URL('../scripts/qa-tabla-medicion.mjs', import.meta.url));
    const r = spawnSync(process.execPath, [guion, join(dir, 'no-existe.jsonl')], { encoding: 'utf8' });
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/no-existe\.jsonl/);
    expect(r.stdout).toBe('');
    const ok = spawnSync(process.execPath, [guion, ruta, '--build=bbbb'], { encoding: 'utf8' });
    expect(ok.status).toBe(0);
    expect(ok.stdout).toContain('### Candidato');
  });
});
