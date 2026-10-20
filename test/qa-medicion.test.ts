// La parte pura de los guiones de medición (scripts/qa-medicion.mjs): resúmenes, muestras de GPU, desglose de llamadas,
// huella del build y el registro JSON. Sin Electron ni WebGL: lo que pasa dentro de la página se mide a mano.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

type AppFalsa = {
  process(): { exitCode: number | null; kill(senal: string): void };
  evaluate(f: (e: { BrowserWindow: { getAllWindows(): { destroy(): void }[] } }) => void): Promise<void>;
  close(): Promise<void>;
};
type Resumen ={ n: number; medianaMs: number | null; p95Ms: number | null };
type Cubo = { nombre: string; llamadas: number; triangulos: number; grupos?: number };
type Medicion = {
  percentil(ordenados: number[], p: number): number | null;
  resumen(ts: number[]): Resumen;
  intervalos(marcas: number[]): Resumen & { maxMs: number | null };
  filtrarGpu(muestras: { ns: number | null; disjunta: boolean }[]): { ms: number[]; disjuntas: number; sinResultado: number };
  agregarDesglose(llamadas: { pase: string; grupo: string | null; triangulos: number }[], tope?: number): {
    total: { llamadas: number; triangulos: number }; porPase: Cubo[]; porGrupo: Record<string, Cubo[]>;
  };
  leerOpciones(argv: string[]): { w: number; h: number; angle?: string; chromium: string[]; veces: number; esperaMs: number; json?: string; segundos: number };
  entradaDeIndex(html: string): string | null;
  huellaBuild(dir: string): { indexHtml: string | null; entrada: string | null; entradaSha256: string | null };
  crearRegistro(d: { guion: string; fecha: Date; commit: { hash: string | null; sucio: boolean }; build: object; opciones: object; resultado: object }): Record<string, unknown>;
  anadirJson(ruta: string, registro: object): void;
  cerrarApp(app: AppFalsa | undefined, ms?: number): Promise<void>;
  nuevos(antes: number | null, despues: number | null): number | null;
  cifra(x: number | null | undefined, sufijo?: string): string;
};

// ruta calculada: el módulo es JavaScript sin tipos y TypeScript no lo resuelve; los tipos van arriba
let m: Medicion;
beforeAll(async () => { m = (await import(new URL('../scripts/qa-medicion.mjs', import.meta.url).href)) as Medicion; });

describe('resúmenes', () => {
  it('mediana y p95 con el mismo índice que el guion de siempre (comparables con lo medido antes)', () => {
    const ts = Array.from({ length: 120 }, (_, i) => 120 - i);   // 120..1, desordenados
    expect(m.resumen(ts)).toEqual({ n: 120, medianaMs: 61, p95Ms: 115 });
    expect(m.resumen([3.14159, 1, 2])).toEqual({ n: 3, medianaMs: 2, p95Ms: 3.14 });
  });
  it('sin muestras no inventa números', () => {
    expect(m.resumen([])).toEqual({ n: 0, medianaMs: null, p95Ms: null });
    expect(m.percentil([], 0.5)).toBeNull();
  });
  it('no cambia el orden de las muestras que recibe', () => {
    const ts = [3, 1, 2]; m.resumen(ts); expect(ts).toEqual([3, 1, 2]);
  });
  it('intervalos entre marcas de tiempo: mediana, p95 y el peor', () => {
    expect(m.intervalos([0, 16, 33, 50, 100])).toEqual({ n: 4, medianaMs: 17, p95Ms: 50, maxMs: 50 });
    expect(m.intervalos([5])).toEqual({ n: 0, medianaMs: null, p95Ms: null, maxMs: null });
  });
});

describe('muestras de tiempo de GPU', () => {
  it('descarta las disjuntas y las que no llegaron, y pasa de ns a ms', () => {
    const r = m.filtrarGpu([{ ns: 2_500_000, disjunta: false }, { ns: 9e9, disjunta: true }, { ns: null, disjunta: false }, { ns: 1_000_000, disjunta: false }]);
    expect(r).toEqual({ ms: [2.5, 1], disjuntas: 1, sinResultado: 1 });
  });
});

describe('desglose de llamadas de dibujo', () => {
  const llamadas = [
    { pase: 'escena', grupo: 'sala:taller', triangulos: 100 },
    { pase: 'escena', grupo: 'sala:taller', triangulos: 50 },
    { pase: 'escena', grupo: 'personaje:supervisor', triangulos: 900 },
    { pase: 'sombras', grupo: 'sala:taller', triangulos: 100 },
    { pase: 'post: EffectPass', grupo: null, triangulos: 1 },
  ];
  it('suma llamadas y triángulos por pase y por grupo de cada pase, de más a menos llamadas (y a igualdad, triángulos)', () => {
    const d = m.agregarDesglose(llamadas);
    expect(d.total).toEqual({ llamadas: 5, triangulos: 1151 });
    expect(d.porPase).toEqual([
      { nombre: 'escena', llamadas: 3, triangulos: 1050 },
      { nombre: 'sombras', llamadas: 1, triangulos: 100 },
      { nombre: 'post: EffectPass', llamadas: 1, triangulos: 1 },
    ]);
    expect(d.porGrupo.escena).toEqual([{ nombre: 'sala:taller', llamadas: 2, triangulos: 150 }, { nombre: 'personaje:supervisor', llamadas: 1, triangulos: 900 }]);
    expect(d.porGrupo.sombras).toEqual([{ nombre: 'sala:taller', llamadas: 1, triangulos: 100 }]);
    expect(d.porGrupo['post: EffectPass']).toBeUndefined();
  });
  it('a partir del tope, el resto va junto en una línea que dice cuántos grupos lleva', () => {
    const muchas = Array.from({ length: 20 }, (_, i) => Array.from({ length: 20 - i }, () => ({ pase: 'escena', grupo: `g${i}`, triangulos: 1 }))).flat();
    const g = m.agregarDesglose(muchas, 15).porGrupo.escena;
    expect(g).toHaveLength(16);
    expect(g[0]).toEqual({ nombre: 'g0', llamadas: 20, triangulos: 20 });
    expect(g[15]).toEqual({ nombre: 'resto', llamadas: 5 + 4 + 3 + 2 + 1, triangulos: 15, grupos: 5 });
  });
});

describe('opciones de la línea de órdenes', () => {
  it('valores por defecto y los de siempre', () => {
    expect(m.leerOpciones([])).toEqual({ w: 1440, h: 900, angle: undefined, chromium: [], veces: 1, esperaMs: 0, json: undefined, segundos: 10 });
    const o = m.leerOpciones(['1920x1080', '--angle=vulkan', '--veces=3', '--espera=500', '--json=/tmp/x.jsonl', '--segundos=5']);
    expect(o).toEqual({ w: 1920, h: 1080, angle: 'vulkan', chromium: ['--use-angle=vulkan', '--enable-features=Vulkan'], veces: 3, esperaMs: 500, json: '/tmp/x.jsonl', segundos: 5 });
    expect(m.leerOpciones(['--segundos=2.5', '--espera=0']).segundos).toBe(2.5);
  });
  // una opción mal escrita para la medición antes de arrancar nada: nunca llega al registro JSON
  it.each([
    ['--veces=abc', /--veces=abc/], ['--veces=0', /--veces=0/], ['--veces=-1', /--veces=-1/], ['--veces=1.5', /--veces=1\.5/], ['--veces=', /--veces=/],
    ['--segundos=abc', /--segundos=abc/], ['--segundos=0', /--segundos=0/], ['--segundos=-3', /--segundos=-3/], ['--segundos=Infinity', /--segundos=Infinity/],
    ['--espera=abc', /--espera=abc/], ['--espera=-10', /--espera=-10/], ['--espera=1e999', /--espera=1e999/],
  ])('rechaza %s con un error que lo nombra', (opcion, error) => {
    expect(() => m.leerOpciones([opcion])).toThrow(error);
  });
});

describe('contadores que pueden faltar', () => {
  it('los programas nuevos son la diferencia, o null si falta un lado (no un 0 inventado)', () => {
    expect(m.nuevos(41, 43)).toBe(2);
    expect(m.nuevos(41, 41)).toBe(0);
    expect(m.nuevos(null, 41)).toBeNull();
    expect(m.nuevos(41, null)).toBeNull();
    expect(m.nuevos(null, null)).toBeNull();
  });
  it('en el texto, lo que falta se dice «no medible»', () => {
    expect(m.cifra(2.5, ' ms')).toBe('2.5 ms');
    expect(m.cifra(0)).toBe('0');
    expect(m.cifra(null, ' ms')).toBe('no medible');
    expect(m.cifra(undefined)).toBe('no medible');
  });
});

describe('huella del build y registro JSON', () => {
  let dir: string;
  beforeAll(() => { dir = mkdtempSync(join(tmpdir(), 'qa-medicion-')); });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const sha = (t: string) => createHash('sha256').update(t).digest('hex');

  it('encuentra el JS de entrada en el index de Vite', () => {
    expect(m.entradaDeIndex('<script type="module" crossorigin src="/assets/main-Di5DTjgQ.js"></script>')).toBe('assets/main-Di5DTjgQ.js');
    expect(m.entradaDeIndex('<p>sin script</p>')).toBeNull();
  });
  it('huella del index y de la entrada, para atar una medición a un build', () => {
    const html = '<script type="module" src="/assets/main-x.js"></script>';
    mkdirSync(join(dir, 'web', 'assets'), { recursive: true });
    writeFileSync(join(dir, 'web', 'index.html'), html); writeFileSync(join(dir, 'web', 'assets', 'main-x.js'), 'codigo');
    expect(m.huellaBuild(join(dir, 'web'))).toEqual({ indexHtml: sha(html), entrada: 'assets/main-x.js', entradaSha256: sha('codigo') });
    expect(m.huellaBuild(join(dir, 'no-existe'))).toEqual({ indexHtml: null, entrada: null, entradaSha256: null });
  });
  it('el registro lleva fecha, commit, build, opciones y resultado, y se añade como una línea por medición', () => {
    const r = m.crearRegistro({ guion: 'qa-coste-electron', fecha: new Date('2026-10-20T20:00:00Z'), commit: { hash: 'abc1234', sucio: false }, build: { indexHtml: 'h' }, opciones: { veces: 1 }, resultado: { medianaMs: 10 } });
    expect(r).toEqual({ guion: 'qa-coste-electron', fecha: '2026-10-20T20:00:00.000Z', commit: 'abc1234', cambiosSinCommit: false, build: { indexHtml: 'h' }, opciones: { veces: 1 }, medianaMs: 10 });
    const ruta = join(dir, 'm.jsonl');
    m.anadirJson(ruta, r); m.anadirJson(ruta, { otra: 1 });
    expect(readFileSync(ruta, 'utf8').trim().split('\n').map(l => JSON.parse(l) as unknown)).toEqual([r, { otra: 1 }]);
  });
});

describe('cerrar la app medida', () => {
  // una app de Playwright de mentira: apunta lo que se le pide y deja elegir si close() termina o se queda colgado,
  // cómo responde evaluate() (el proceso principal bloqueado no contesta nunca) y si el proceso ya había salido
  function falsa({ cuelga, evaluar = 'bien', salido = false }: { cuelga: boolean; evaluar?: 'bien' | 'falla' | 'cuelga'; salido?: boolean }) {
    const log: string[] = [];
    const proceso = { exitCode: salido ? 0 : null as number | null, kill: (s: string) => { log.push(`kill ${s}`); } };
    const app: AppFalsa = {
      process: () => proceso,
      evaluate: f => {
        if (evaluar === 'cuelga') return new Promise<void>(() => {});
        if (evaluar === 'falla') return Promise.reject(new Error('sin contexto'));
        f({ BrowserWindow: { getAllWindows: () => [{ destroy: () => { log.push('destroy'); } }] } });
        return Promise.resolve();
      },
      close: () => { log.push('close'); return cuelga ? new Promise<void>(() => {}) : Promise.resolve(); },
    };
    return { app, log };
  }
  it('si el proceso principal no contesta ni a evaluate(), también mata el proceso', async () => {
    const { app, log } = falsa({ cuelga: true, evaluar: 'cuelga' });
    await m.cerrarApp(app, 20);
    expect(log).toEqual(['kill SIGKILL']);
  });
  it('si evaluate() falla, cierra igualmente', async () => {
    const { app, log } = falsa({ cuelga: false, evaluar: 'falla' });
    await m.cerrarApp(app, 1000);
    expect(log).toEqual(['close']);
  });
  it('no mata un proceso que ya ha salido', async () => {
    const { app, log } = falsa({ cuelga: true, salido: true });
    await m.cerrarApp(app, 20);
    expect(log).toEqual(['destroy', 'close']);
  });
  it('destruye las ventanas antes de cerrar: así no sale el aviso de «¿Salir del refugio?»', async () => {
    const { app, log } = falsa({ cuelga: false });
    await m.cerrarApp(app, 1000);
    expect(log).toEqual(['destroy', 'close']);
  });
  it('si close() se queda colgado, mata el proceso en vez de dejar la ventana abierta', async () => {
    const { app, log } = falsa({ cuelga: true });
    await m.cerrarApp(app, 20);
    expect(log).toEqual(['destroy', 'close', 'kill SIGKILL']);
  });
  it('sin app (Electron no llegó a arrancar) no hace nada', async () => {
    await expect(m.cerrarApp(undefined)).resolves.toBeUndefined();
  });
});
