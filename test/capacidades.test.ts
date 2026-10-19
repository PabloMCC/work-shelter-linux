// Lo que solo funciona en macOS (salir a la superficie, el dictado y Spotify), apagado con aviso en el resto. El
// servidor de verdad con SHELTER_COMO_LINUX, que apaga esas funciones en cualquier sistema (también en el runner de
// macOS): no para nada de lo abierto, no prepara el dictado y avisa. Y el CLI de ./shelter superficie, igual.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { AVISOS_CAPACIDAD, capacidadesDe } from '../shared/protocolo.ts';

const PUERTO = 3900 + Math.floor(Math.random() * 60);   // otro rango que los demás tests del servidor: corren a la vez
const DATOS = mkdtempSync(path.join(tmpdir(), 'refugio-capac-'));
const CONFIG = mkdtempSync(path.join(tmpdir(), 'refugio-capac-config-'));
const SALA = mkdtempSync(path.join(tmpdir(), 'refugio-capac-sala-'));
const ESCRITORIO = path.join(DATOS, 'escritorio.jsonl');   // lo que se abriría en el escritorio (no debe haber nada)
const BASE = `http://127.0.0.1:${PUERTO}`;
const COMO_LINUX = { SHELTER_COMO_LINUX: '1', SHELTER_DATOS: DATOS, SHELTER_DEV: '', CLAUDE_CONFIG_DIR: CONFIG, CLAUDE_BIN: process.execPath };
let srv: ChildProcess; let token = '';
const espera = (ms: number) => new Promise(r => setTimeout(r, ms));
const hasta = async <T>(f: () => T | undefined, ms = 8000): Promise<T> => { for (const fin = Date.now() + ms; Date.now() < fin; await espera(25)) { const v = f(); if (v !== undefined) return v; } throw new Error('No ha llegado a tiempo'); };

async function conectar() {
  const ws = await new Promise<WebSocket>((ok, ko) => { const w = new WebSocket(`ws://127.0.0.1:${PUERTO}/ws?t=${token}`, { headers: { Origin: BASE } }); w.on('open', () => ok(w)); w.on('error', ko); });
  const recibidos: any[] = []; ws.on('message', d => recibidos.push(JSON.parse(String(d))));
  const enviar = (m: object) => ws.send(JSON.stringify(m));
  const respuesta = (peticion: string) => hasta(() => recibidos.find(m => m.t === 'respuesta' && m.peticion === peticion));
  const pedir = (nombre: string, datos: unknown, peticion: string) => { enviar({ t: 'accion', nombre, datos, peticion }); return respuesta(peticion); };
  return { ws, recibidos, enviar, respuesta, pedir };
}

beforeAll(async () => {
  srv = spawn(process.execPath, ['--import', 'tsx', 'server/main.ts'], { env: { ...process.env, ...COMO_LINUX, SHELTER_PUERTO: String(PUERTO), SHELTER_ESCRITORIO_PRUEBA: ESCRITORIO }, stdio: 'ignore' });
  for (let i = 0; i < 80; i++) { try { if ((await fetch(BASE + '/salud')).ok) break; } catch {} await espera(150); }
  token = readFileSync(path.join(DATOS, 'token'), 'utf8').trim();
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

describe('sin dictado', () => {
  it('vozEmpezar contesta al momento con el aviso, sin preparar el transcriptor', async () => {
    const c = await conectar();
    c.enviar({ t: 'vozEmpezar', id: 'v1', idioma: 'es-ES' });
    expect(await hasta(() => c.recibidos.find(m => m.t === 'voz' && m.id === 'v1'))).toEqual({ t: 'voz', id: 'v1', estado: 'error', texto: AVISOS_CAPACIDAD.dictado });
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
