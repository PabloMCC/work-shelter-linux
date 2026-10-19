// Caracterización de Sesiones con una query() falsa: cómo se traducen los mensajes del Agent SDK (fixtures sintéticos en
// test/fixtures/sdk) a estado y cuaderno, el viaje de los permisos al jugador y las opciones con que se lanza Claude Code.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { query, Options, Query, PermissionResult } from '@anthropic-ai/claude-agent-sdk';
import { Sesiones } from './sesiones.ts';

const FIXTURES = path.join(import.meta.dirname, '..', 'test', 'fixtures', 'sdk');
const fixture = (nombre: string, cwd: string): any[] => JSON.parse(readFileSync(path.join(FIXTURES, nombre), 'utf8').replaceAll('__CWD__', cwd));

// una query() que solo suelta los mensajes que la prueba le mete, y apunta con qué opciones se la llamó
class QueryFalsa {
  private cola: any[] = []; private esperas: ((r: IteratorResult<any>) => void)[] = []; private fin = false;
  modos: string[] = []; fallaModo = false;
  constructor(public options: Options) {}
  meter(m: any) { const w = this.esperas.shift(); if (w) w({ value: m, done: false }); else this.cola.push(m); }
  terminar() { this.fin = true; for (const w of this.esperas.splice(0)) w({ value: undefined, done: true }); }
  [Symbol.asyncIterator]() { return { next: () => this.cola.length ? Promise.resolve({ value: this.cola.shift(), done: false }) : this.fin ? Promise.resolve({ value: undefined, done: true }) : new Promise<IteratorResult<any>>(r => this.esperas.push(r)) }; }
  async supportedCommands() { return []; }
  async setPermissionMode(m: string) { this.modos.push(m); if (this.fallaModo) throw new Error('modo no admitido'); }
  async interrupt() { return {}; }
  close() { this.terminar(); }
}

let dir = '', config = '', llamadas: QueryFalsa[] = [];
const consulta = ((p: { options?: Options }) => { const q = new QueryFalsa(p.options ?? {}); llamadas.push(q); return q as unknown as Query; }) as typeof query;
const nuevas = (confiadas: string[] = []) => new Sesiones({ salaDeRuta: () => undefined, carpetasConfiadas: () => confiadas }, undefined, consulta);
const tic = () => new Promise(r => setTimeout(r, 5));
const opcionesPermiso = (extra: Record<string, unknown> = {}) => ({ signal: new AbortController().signal, toolUseID: 'uso-1', ...extra }) as any;

beforeEach(() => {
  llamadas = [];
  dir = mkdtempSync(path.join(tmpdir(), 'refugio-sesiones-'));
  config = mkdtempSync(path.join(tmpdir(), 'refugio-config-'));
  // ni el ~/.claude.json ni los ajustes de quien ejecuta las pruebas; y un «claude» que no lanza nada (node)
  vi.stubEnv('CLAUDE_CONFIG_DIR', config); vi.stubEnv('CLAUDE_BIN', process.execPath);
});
afterEach(() => { vi.unstubAllEnvs(); rmSync(dir, { recursive: true, force: true }); rmSync(config, { recursive: true, force: true }); });

describe('mensajes del SDK → estado y cuaderno', () => {
  it('un turno con texto, herramientas, un ayudante, aviso de límite y resultado', async () => {
    const s = nuevas(); const limites: any[] = [], turnos: any[] = []; let herramientas = 0;
    s.on('limite', i => limites.push(i)); s.on('turno', t => turnos.push(t)); s.on('herramienta', () => herramientas++);
    const r = await s.empezar('hab-1', 'sala-1', dir, 'Revisa las notas', {});
    expect(llamadas).toHaveLength(1);
    for (const m of fixture('turno-con-ayudante.json', dir)) llamadas[0].meter(m);
    await vi.waitFor(() => expect(turnos).toHaveLength(1));
    const x = s.get(r.id)!.r;
    expect(x).toMatchObject({ claudeId: '0a1b2c3d-0000-4000-8000-00000000c0de', modelo: 'modelo-de-prueba', modoPermisos: 'default', estado: 'terminada', turnos: 1, herramientas: 3, coste: 0.0123, sinLeer: true, ultimoTexto: 'Listo: las pruebas están en orden.' });
    expect(x.actividad).toBeUndefined();
    expect(s.cuaderno(r.id).map(e => [e.tipo, e.herramienta, e.ayudante, e.esError])).toEqual([
      ['usuario', undefined, undefined, undefined],
      ['asistente', undefined, undefined, undefined],
      ['herramienta', 'Read', undefined, undefined],
      ['herramienta', 'Read', undefined, true],          // el tool_result con is_error
      ['herramienta', 'Agent', undefined, undefined],
      ['herramienta', 'Grep', 'agente-1', undefined],    // lo del ayudante va con su id; su texto no entra en el cuaderno
      ['asistente', undefined, undefined, undefined],
      ['resultado', undefined, undefined, undefined],
    ]);
    expect(s.cuaderno(r.id).at(-1)?.texto).toBe('Hecho en 4 s');
    expect(x.ayudantes).toEqual([expect.objectContaining({ id: 'agente-1', descripcion: 'Revisar las pruebas', tipo: 'explorador', estado: 'hecho', herramientas: 1, salaId: 'sala-1' })]);
    expect(limites).toEqual([{ status: 'allowed_warning', rateLimitType: 'five_hour', utilization: 0.9 }]);
    expect(herramientas).toBe(3);
    expect(turnos[0]).toMatchObject({ estado: 'terminada', herramientasTurno: 3 });
    s.cerrarTodas();
  });
  it('un init con clave de API para la sesión y lo apunta como error', async () => {
    const s = nuevas(); const r = await s.empezar('hab-1', 'sala-1', dir, 'Hola', {});
    llamadas[0].meter({ type: 'system', subtype: 'init', session_id: 'x', cwd: dir, model: 'm', permissionMode: 'default', apiKeySource: 'ANTHROPIC_API_KEY' });
    await vi.waitFor(() => expect(s.get(r.id)!.r.estado).toBe('cerrada'));
    expect(s.cuaderno(r.id).at(-1)).toMatchObject({ tipo: 'error' });
    expect(s.get(r.id)!.r.claudeId).toBeUndefined();
  });
});

describe('permisos → jugador', () => {
  it('canUseTool espera al jugador; «siempre» devuelve las sugerencias y «no» niega con su motivo', async () => {
    const s = nuevas(); const r = await s.empezar('hab-1', 'sala-1', dir, 'Hola', {});
    const puede = llamadas[0].options.canUseTool!;
    const sugerencias = [{ type: 'addRules', rules: [{ toolName: 'Bash', ruleContent: 'ls' }], behavior: 'allow', destination: 'localSettings' }];
    let decidido: PermissionResult | null | undefined;
    puede('Bash', { command: 'ls' }, opcionesPermiso({ suggestions: sugerencias, decisionReason: 'Comando nuevo' })).then(d => { decidido = d; });
    const x = s.get(r.id)!.r;
    expect(x.estado).toBe('esperando');
    expect(x.pendiente).toMatchObject({ tipo: 'permiso', herramienta: 'Bash', titulo: '¿Puedo ejecutar este comando?', motivo: 'Comando nuevo', puedeSiempre: true });
    s.responder(r.id, x.pendiente!.id, 'siempre');
    await tic();
    expect(decidido).toEqual({ behavior: 'allow', updatedInput: { command: 'ls' }, updatedPermissions: sugerencias });
    expect(s.get(r.id)!.r.estado).toBe('trabajando');
    expect(s.cuaderno(r.id).at(-1)).toMatchObject({ tipo: 'usuario', texto: '✅ Sí, y no vuelvas a preguntar' });

    puede('Write', { file_path: path.join(dir, 'a.txt'), content: 'x' }, opcionesPermiso()).then(d => { decidido = d; });
    expect(s.get(r.id)!.r.pendiente?.puedeSiempre).toBe(false);   // sin sugerencias no se ofrece «siempre»
    s.responder(r.id, s.get(r.id)!.r.pendiente!.id, 'no', 'Mejor en otro archivo');
    await tic();
    expect(decidido).toEqual({ behavior: 'deny', message: 'Mejor en otro archivo' });
    s.cerrarTodas();
  });
  it('las herramientas del juego (mcp__refugio__*) pasan sin preguntar', async () => {
    const s = nuevas(); const r = await s.empezar('hab-1', 'sala-1', dir, 'Hola', {});
    const d = await llamadas[0].options.canUseTool!('mcp__refugio__aplicar', { escena: 'taller' }, opcionesPermiso());
    expect(d).toEqual({ behavior: 'allow', updatedInput: { escena: 'taller' } });
    expect(s.get(r.id)!.r.pendientes).toBe(0);
    s.cerrarTodas();
  });
  it('aprobar un plan con «siempre» cambia el modo a acceptEdits', async () => {
    const s = nuevas(); const r = await s.empezar('hab-1', 'sala-1', dir, 'Hola', { permisos: 'plan' });
    const p = llamadas[0].options.canUseTool!('ExitPlanMode', { plan: '1. Hacer' }, opcionesPermiso());
    expect(s.get(r.id)!.r.pendiente).toMatchObject({ tipo: 'plan', detalle: '1. Hacer' });
    s.responder(r.id, s.get(r.id)!.r.pendiente!.id, 'siempre');
    expect(await p).toEqual({ behavior: 'allow', updatedInput: { plan: '1. Hacer' } });
    expect(llamadas[0].modos).toEqual(['acceptEdits']);
    expect(s.get(r.id)!.r.modoPermisos).toBe('acceptEdits');
    s.cerrarTodas();
  });
});

describe('opciones de query()', () => {
  it('permissionMode va siempre explícito: default si no se pide otro; bypass añade allowDangerouslySkipPermissions', async () => {
    const s = nuevas();
    await s.empezar('hab-1', 'sala-1', dir, '', {});
    await s.empezar('hab-1', 'sala-1', dir, '', { permisos: 'acceptEdits' });
    await s.empezar('hab-1', 'sala-1', dir, '', { permisos: 'bypassPermissions' });
    expect(llamadas.map(q => [q.options.permissionMode, q.options.allowDangerouslySkipPermissions])).toEqual([['default', undefined], ['acceptEdits', undefined], ['bypassPermissions', true]]);
    s.cerrarTodas();
  });
  it('settingSources según la confianza de la carpeta', async () => {
    const fuentes = () => llamadas.at(-1)!.options.settingSources;
    await nuevas().empezar('hab-1', 'sala-1', dir, '', {});
    expect(fuentes()).toEqual(['user', 'project', 'local']);   // sin configuración de proyecto
    writeFileSync(path.join(dir, 'CLAUDE.md'), '# Instrucciones de ejemplo\n');
    const s = nuevas(); const r = await s.empezar('hab-1', 'sala-1', dir, '', {});
    expect(llamadas).toHaveLength(1);   // sin confianza: no se lanza hasta que el jugador conteste
    expect(s.get(r.id)!.r.pendiente).toMatchObject({ tipo: 'confianza' });
    s.responder(r.id, s.get(r.id)!.r.pendiente!.id, 'no');
    expect(fuentes()).toEqual(['user']);
    const s2 = nuevas(); const r2 = await s2.empezar('hab-1', 'sala-1', dir, '', {});
    s2.responder(r2.id, s2.get(r2.id)!.r.pendiente!.id, 'si');
    expect(fuentes()).toEqual(['user', 'project', 'local']);
    await nuevas([dir]).empezar('hab-1', 'sala-1', dir, '', {});   // confiada en el juego: se lanza sin preguntar
    expect(llamadas).toHaveLength(4); expect(fuentes()).toEqual(['user', 'project', 'local']);
  });
  it('si el SDK no acepta volver al modo pedido, la sesión se para y lo dice', async () => {
    const s = nuevas(); const r = await s.empezar('hab-1', 'sala-1', dir, 'Hola', { permisos: 'default' });
    llamadas[0].fallaModo = true;
    llamadas[0].meter(fixture('init-modo-auto.json', dir)[0]);
    await vi.waitFor(() => expect(s.get(r.id)!.r.estado).toBe('cerrada'));
    expect(llamadas[0].modos).toEqual(['default']);
    expect(s.cuaderno(r.id).some(e => e.tipo === 'sistema')).toBe(false);
    expect(s.cuaderno(r.id).find(e => e.tipo === 'error')?.texto).toMatch(/auto.*default/s);
    s.cerrarTodas();
  });

  it('si el init informa otro modo (auto), se mantiene el pedido: se le devuelve al SDK, se avisa y se reanuda con él', async () => {
    const s = nuevas(); const r = await s.empezar('hab-1', 'sala-1', dir, 'Hola', { permisos: 'default' });
    expect(llamadas[0].options.permissionMode).toBe('default');
    for (const m of fixture('init-modo-auto.json', dir)) llamadas[0].meter(m);
    await vi.waitFor(() => expect(s.get(r.id)!.r.estado).toBe('terminada'));
    expect(s.get(r.id)!.r.modoPermisos).toBe('default');
    expect(llamadas[0].modos).toEqual(['default']);
    expect(s.cuaderno(r.id).find(e => e.tipo === 'sistema')?.texto).toMatch(/auto.*default/s);
    llamadas[0].terminar();
    await vi.waitFor(() => expect(s.get(r.id)!.viva).toBe(false));
    s.enviar(r.id, 'Sigue');   // la sesión ya no está viva: se relanza retomando la conversación
    expect(llamadas).toHaveLength(2);
    expect(llamadas[1].options).toMatchObject({ resume: '0a1b2c3d-0000-4000-8000-0000000a0700', permissionMode: 'default' });
    s.cerrarTodas();
  });
});
