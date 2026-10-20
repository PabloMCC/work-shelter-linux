// Lo que solo funciona en macOS (salir a la superficie, el dictado y Spotify), apagado con aviso en el resto. El
// servidor de verdad con SHELTER_COMO_LINUX, que apaga esas funciones en cualquier sistema (también en el runner de
// macOS): no para nada de lo abierto (tampoco si el juego se cae), no prepara el dictado y avisa. Y el CLI de
// ./shelter superficie, igual.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { AVISOS_CAPACIDAD, capacidadesDe } from '../shared/protocolo.ts';

const PUERTO = 3900 + Math.floor(Math.random() * 30);   // otro rango que los demás tests del servidor: corren a la vez
const DATOS = mkdtempSync(path.join(tmpdir(), 'refugio-capac-'));
const CONFIG = mkdtempSync(path.join(tmpdir(), 'refugio-capac-config-'));
const SALA = mkdtempSync(path.join(tmpdir(), 'refugio-capac-sala-'));
const ESCRITORIO = path.join(DATOS, 'escritorio.jsonl');   // lo que se abriría en el escritorio (no debe haber nada)
const COMO_LINUX = { SHELTER_COMO_LINUX: '1', SHELTER_DATOS: DATOS, SHELTER_DEV: '', CLAUDE_CONFIG_DIR: CONFIG, CLAUDE_BIN: process.execPath };
let srv: ChildProcess; let token = '';
type Servidor = { srv: ChildProcess; puerto: number; token: string; salida: string[]; fin: Promise<number | null> };
const espera = (ms: number) => new Promise(r => setTimeout(r, ms));
const hasta = async <T>(f: () => T | undefined, ms = 8000): Promise<T> => { for (const fin = Date.now() + ms; Date.now() < fin; await espera(25)) { const v = f(); if (v !== undefined) return v; } throw new Error('No ha llegado a tiempo'); };

// arranca el servidor de verdad y espera a que conteste en /salud; si no llega a contestar, falla diciéndolo (y no
// con un «no existe el token» que despista)
async function arrancar(datos: string, puerto: number, env: Record<string, string>): Promise<Servidor> {
  const srv = spawn(process.execPath, ['--import', 'tsx', 'server/main.ts'], { env: { ...process.env, ...COMO_LINUX, SHELTER_DATOS: datos, SHELTER_PUERTO: String(puerto), ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  const salida: string[] = []; srv.stdout!.on('data', d => salida.push(String(d))); srv.stderr!.on('data', d => salida.push(String(d)));
  const fin = new Promise<number | null>(ok => srv.on('exit', c => ok(c)));
  let listo = false;
  for (let i = 0; i < 80 && !listo && srv.exitCode === null; i++) { try { listo = (await fetch(`http://127.0.0.1:${puerto}/salud`)).ok; } catch {} if (!listo) await espera(150); }
  if (!listo) { srv.kill('SIGKILL'); throw new Error(`El servidor de prueba no contesta en /salud (puerto ${puerto}). Su salida:\n${salida.join('').slice(-2000)}`); }
  return { srv, puerto, token: readFileSync(path.join(datos, 'token'), 'utf8').trim(), salida, fin };
}

async function conectar(s: { puerto: number; token: string } = { puerto: PUERTO, token }) {
  const ws = await new Promise<WebSocket>((ok, ko) => { const w = new WebSocket(`ws://127.0.0.1:${s.puerto}/ws?t=${s.token}`, { headers: { Origin: `http://127.0.0.1:${s.puerto}` } }); w.on('open', () => ok(w)); w.on('error', ko); });
  const recibidos: any[] = []; ws.on('message', d => recibidos.push(JSON.parse(String(d))));
  const enviar = (m: object) => ws.send(JSON.stringify(m));
  const respuesta = (peticion: string) => hasta(() => recibidos.find(m => m.t === 'respuesta' && m.peticion === peticion));
  const pedir = (nombre: string, datos: unknown, peticion: string) => { enviar({ t: 'accion', nombre, datos, peticion }); return respuesta(peticion); };
  return { ws, recibidos, enviar, respuesta, pedir };
}

beforeAll(async () => {
  ({ srv, token } = await arrancar(DATOS, PUERTO, { SHELTER_ESCRITORIO_PRUEBA: ESCRITORIO }));
}, 30_000);
afterAll(() => { srv?.kill('SIGKILL'); for (const c of [DATOS, CONFIG, SALA]) rmSync(c, { recursive: true, force: true }); });

describe('capacidades en la bienvenida', () => {
  it('un servidor anterior no las manda: todo disponible, como siempre en macOS', () => {
    expect(capacidadesDe(undefined)).toEqual({ superficie: true, dictado: true, spotify: true });
    expect(capacidadesDe({ dictado: false })).toEqual({ superficie: true, dictado: false, spotify: true });
    expect(capacidadesDe({ superficie: 'no', spotify: false })).toEqual({ superficie: true, dictado: true, spotify: false });
  });
  it('el servidor dice cuáles hay', async () => {
    const c = await conectar();
    c.enviar({ t: 'hola', version: '0.1' });
    expect((await hasta(() => c.recibidos.find(m => m.t === 'bienvenida'))).capacidades).toEqual({ superficie: false, dictado: false, spotify: false });
    c.ws.close();
  });
});

describe('sin salir a la superficie', () => {
  it('superficie.sacar no para ninguna conversación y avisa', async () => {
    const c = await conectar();
    // con CLAUDE.md y sin confianza, la sesión espera la pregunta de confianza: cuenta como viva y no lanza Claude Code
    writeFileSync(path.join(SALA, 'CLAUDE.md'), '# Instrucciones de ejemplo\n');
    const salaId = (await c.pedir('reclutar', { ruta: SALA }, 'rec')).datos.id;
    c.enviar({ t: 'hola', version: '0.1' });
    const habitanteId = (await hasta(() => c.recibidos.find(m => m.t === 'bienvenida'))).estado.habitantes.find((h: any) => h.salaId === salaId).id;
    c.enviar({ t: 'empezar', salaId, habitanteId, prompt: '', opciones: { reanudar: 'conv-ejemplo-1' }, peticion: 'e1' });
    const id = (await c.respuesta('e1')).datos;
    await hasta(() => c.recibidos.find(m => m.t === 'sesion' && m.sesion.id === id && m.sesion.estado === 'esperando'));
    expect((await c.pedir('superficie.sacar', { todo: true, ventanaNueva: true }, 's1')).datos).toEqual({ sesiones: 0, terminales: 0, avisos: [AVISOS_CAPACIDAD.superficie], app: '' });
    expect(await hasta(() => c.recibidos.find(m => m.t === 'aviso' && m.texto === AVISOS_CAPACIDAD.superficie))).toMatchObject({ nivel: 'aviso' });
    await espera(400);
    expect(c.recibidos.filter(m => m.t === 'sesion' && m.sesion.id === id).pop().sesion.estado).toBe('esperando');
    expect(c.recibidos.some(m => m.t === 'sesionFuera')).toBe(false);
    expect(existsSync(ESCRITORIO)).toBe(false);
    c.enviar({ t: 'cerrarSesion', sesionId: id });
    c.ws.close();
  }, 15_000);
});

describe('el juego se cae (sin clientes) sin salir a la superficie', () => {
  it('pasado el margen para lo de siempre, sin sacar nada a tu escritorio', async () => {
    const datos = mkdtempSync(path.join(tmpdir(), 'refugio-capac-caida-')); const sala = mkdtempSync(path.join(tmpdir(), 'refugio-capac-caida-sala-'));
    const escritorio = path.join(datos, 'escritorio.jsonl');
    // con todo lo demás que pide sacarlo a tu escritorio: la ventana del juego (SALIR_SIN_CLIENTES), el escritorio de
    // prueba con los datos aislados y una conversación viva. Solo falta la capacidad
    const s = await arrancar(datos, PUERTO + 30, { SHELTER_ESCRITORIO_PRUEBA: escritorio, SHELTER_SALIR_SIN_CLIENTES: '1', SHELTER_GRACIA_MS: '300' });
    try {
      const c = await conectar(s);
      writeFileSync(path.join(sala, 'CLAUDE.md'), '# Instrucciones de ejemplo\n');
      const salaId = (await c.pedir('reclutar', { ruta: sala }, 'rec')).datos.id;
      c.enviar({ t: 'hola', version: '0.1' });
      const habitanteId = (await hasta(() => c.recibidos.find(m => m.t === 'bienvenida'))).estado.habitantes.find((h: any) => h.salaId === salaId).id;
      c.enviar({ t: 'empezar', salaId, habitanteId, prompt: '', opciones: { reanudar: 'conv-ejemplo-1' }, peticion: 'e1' });
      const id = (await c.respuesta('e1')).datos;
      await hasta(() => c.recibidos.find(m => m.t === 'sesion' && m.sesion.id === id && m.sesion.estado === 'esperando'));
      c.ws.close();
      const codigo = await Promise.race([s.fin, espera(10_000).then(() => 'sigue')]);
      const salida = s.salida.join('');
      expect(codigo, salida).toBe(0);
      // la conversación esperando la confianza cuenta como abierta (lista) aunque no haya proceso (no sale en «paradas»)
      expect(salida).not.toContain('saco a tu escritorio'); expect(salida).not.toContain('No pude salir');
      expect(salida).toContain('Apagando el refugio (Sin clientes)');
      expect(existsSync(escritorio)).toBe(false);
    } finally { s.srv.kill('SIGKILL'); for (const c of [datos, sala]) rmSync(c, { recursive: true, force: true }); }
  }, 25_000);
});

describe('sin dictado', () => {
  it('vozEmpezar contesta al momento con el aviso, sin preparar el transcriptor', async () => {
    const c = await conectar();
    c.enviar({ t: 'vozEmpezar', id: 'v1', idioma: 'es-ES' });
    expect(await hasta(() => c.recibidos.find(m => m.t === 'voz' && m.id === 'v1'))).toEqual({ t: 'voz', id: 'v1', estado: 'error', texto: AVISOS_CAPACIDAD.dictado });
    // preparar el transcriptor no deja otra huella que su carpeta: server/voz.ts:23-26 crea DATOS/bin antes de compilar
    // con swiftc. Fuera de macOS ni llega ahí (voz.ts:21 lanza antes), así que esto solo muerde en el runner de macOS,
    // que es donde SHELTER_COMO_LINUX tiene que apagarlo
    expect(existsSync(path.join(DATOS, 'bin'))).toBe(false);
    c.ws.close();
  });
});

describe('./shelter superficie sin salir a la superficie', () => {
  it('enseña el aviso y sale con error, sin abrir nada', () => {
    const datos = mkdtempSync(path.join(tmpdir(), 'refugio-capac-cli-'));
    try {
      const r = spawnSync(process.execPath, ['--import', 'tsx', 'server/superficie.ts', 'superficie'], { env: { ...process.env, ...COMO_LINUX, SHELTER_DATOS: datos, SHELTER_PUERTO: '1', SHELTER_ESCRITORIO_PRUEBA: path.join(datos, 'e.jsonl') }, encoding: 'utf8', timeout: 20_000 });
      expect(r.status).toBe(1);
      expect(r.stderr).toContain(AVISOS_CAPACIDAD.superficie);
      expect(existsSync(path.join(datos, 'e.jsonl'))).toBe(false);
    } finally { rmSync(datos, { recursive: true, force: true }); }
  }, 25_000);
});
