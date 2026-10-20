// Caracterización del servidor de verdad por el WebSocket autenticado: lo que contesta hoy a acciones desconocidas,
// trabajos imposibles, el límite de sesiones, guardar ajustes y aspectos, y los rechazos de abrirEn (sin abrir nada).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';

const PUERTO = 3800 + Math.floor(Math.random() * 60);   // otro rango que test/servidor.test.ts: corren a la vez
const DATOS = mkdtempSync(path.join(tmpdir(), 'refugio-caract-'));
const CONFIG = mkdtempSync(path.join(tmpdir(), 'refugio-caract-config-'));
const BASE = `http://127.0.0.1:${PUERTO}`;
let srv: ChildProcess; let token = '';
const carpetas: string[] = [];
const espera = (ms: number) => new Promise(r => setTimeout(r, ms));
const hasta = async <T>(f: () => T | undefined, ms = 8000): Promise<T> => { for (const fin = Date.now() + ms; Date.now() < fin; await espera(25)) { const v = f(); if (v !== undefined) return v; } throw new Error('No ha llegado a tiempo'); };
const carpeta = (prefijo: string) => { const c = mkdtempSync(path.join(tmpdir(), prefijo)); carpetas.push(c); return c; };

async function conectar() {
  const ws = await new Promise<WebSocket>((ok, ko) => { const w = new WebSocket(`ws://127.0.0.1:${PUERTO}/ws?t=${token}`, { headers: { Origin: BASE } }); w.on('open', () => ok(w)); w.on('error', ko); });
  const recibidos: any[] = []; ws.on('message', d => recibidos.push(JSON.parse(String(d))));
  const enviar = (m: object) => ws.send(JSON.stringify(m));
  const respuesta = (peticion: string) => hasta(() => recibidos.find(m => m.t === 'respuesta' && m.peticion === peticion));
  const pedir = (nombre: string, datos: unknown, peticion: string) => { enviar({ t: 'accion', nombre, datos, peticion }); return respuesta(peticion); };
  const estado = () => recibidos.filter(m => m.t === 'estado' || m.t === 'bienvenida').pop()?.estado;
  return { ws, recibidos, enviar, respuesta, pedir, estado };
}

beforeAll(async () => {
  // CLAUDE_CONFIG_DIR vacío: ni la confianza ni los ajustes de quien ejecuta las pruebas. CLAUDE_BIN=node: si algo
  // llegara a lanzar una sesión, no sería un Claude Code de verdad
  srv = spawn(process.execPath, ['--import', 'tsx', 'server/main.ts'], { env: { ...process.env, SHELTER_PUERTO: String(PUERTO), SHELTER_DATOS: DATOS, SHELTER_DEV: '', CLAUDE_CONFIG_DIR: CONFIG, CLAUDE_BIN: process.execPath }, stdio: 'ignore' });
  for (let i = 0; i < 80; i++) { try { if ((await fetch(BASE + '/salud')).ok) break; } catch {} await espera(150); }
  token = readFileSync(path.join(DATOS, 'token'), 'utf8').trim();
}, 30_000);
afterAll(() => { srv?.kill('SIGKILL'); for (const c of [DATOS, CONFIG, ...carpetas]) rmSync(c, { recursive: true, force: true }); });

describe('caracterización del servidor', () => {
  it('una acción desconocida contesta con error, también sin «peticion»', async () => {
    const c = await conectar();
    expect(await c.pedir('no.existe', {}, 'desc')).toEqual({ t: 'respuesta', peticion: 'desc', error: 'Acción desconocida: no.existe' });
    c.enviar({ t: 'accion', nombre: 'otra.cosa' });
    expect(await c.respuesta('')).toEqual({ t: 'respuesta', peticion: '', error: 'Acción desconocida: otra.cosa' });
    c.ws.close();
  });

  it('empezar en una sala o con un habitante que no existen: respuesta con error o, sin «peticion», un aviso', async () => {
    const c = await conectar();
    const empezar = (salaId: string, habitanteId: string, peticion?: string) => c.enviar({ t: 'empezar', salaId, habitanteId, prompt: 'Hola', opciones: {}, peticion });
    empezar('no-existe', 'lola', 'e-sala'); empezar('puerta', 'nadie', 'e-hab');
    expect((await c.respuesta('e-sala')).error).toBe('Esa sala no existe.');
    expect((await c.respuesta('e-hab')).error).toBe('Ese habitante no vive en esta sala.');
    empezar('no-existe', 'lola');
    expect(await hasta(() => c.recibidos.find(m => m.t === 'aviso' && m.nivel === 'error'))).toEqual({ t: 'aviso', nivel: 'error', texto: 'Esa sala no existe.' });
    c.ws.close();
  });

  it('guardar aplica solo la lista blanca de ajustes, acotada, y difunde el estado', async () => {
    const c = await conectar();
    expect((await c.pedir('guardar', { parche: { nombre: '  Refugio de Prueba  ', limiteSesiones: 99, raizRepos: '   ', bienvenidaHecha: 'sí', ajeno: 1 } }, 'g1')).datos).toBe(true);
    const e = c.estado();
    expect(e).toMatchObject({ nombre: 'Refugio de Prueba', limiteSesiones: 20 });
    expect(typeof e.bienvenidaHecha).toBe('boolean'); expect(e.raizRepos.trim()).not.toBe(''); expect(e.ajeno).toBeUndefined();
    await c.pedir('guardar', { parche: { nombre: '   ', limiteSesiones: 0 } }, 'g2');
    expect(c.estado()).toMatchObject({ nombre: 'work-shelter', limiteSesiones: 1 });
    await c.pedir('guardar', { parche: { limiteSesiones: 6 } }, 'g3');
    c.ws.close();
  });

  it('aspecto.guardar valida el aspecto y a quién se lo pone', async () => {
    const c = await conectar();
    const valido = { especie: 'humano', piezas: {}, colores: { pelo: '#A0B0C0', piel: 'rojo' } };
    expect((await c.pedir('aspecto.guardar', { quien: 'supervisor', aspecto: 'humano' }, 'a1')).error).toBe('Ese aspecto no es válido.');
    expect((await c.pedir('aspecto.guardar', { quien: 'supervisor' }, 'a2')).error).toBe('Ese aspecto no es válido.');
    expect((await c.pedir('aspecto.guardar', { quien: 'nadie', aspecto: valido }, 'a3')).error).toBe('No hay nadie con ese nombre en el refugio.');
    expect((await c.pedir('aspecto.guardar', { quien: 'mona', aspecto: valido }, 'a4')).error).toBe('La Octocat es como es: su aspecto no se toca.');
    expect((await c.pedir('aspecto.guardar', { quien: 'supervisor', aspecto: valido }, 'a5')).datos).toBe(true);
    expect(c.estado().supervisor.aspecto).toMatchObject({ especie: 'humano', colores: { pelo: '#a0b0c0' } });
    expect((await c.pedir('aspecto.guardar', { quien: 'supervisor', aspecto: null }, 'a6')).datos).toBe(true);
    expect(c.estado().supervisor.aspecto).toBeUndefined();
    c.ws.close();
  });

  it('abrirEn rechaza carpetas que no son de una sala, apps fuera de la lista y archivos', async () => {
    const c = await conectar();
    const sala = carpeta('refugio-caract-abrir-'); writeFileSync(path.join(sala, 'leeme.txt'), 'x');
    expect((await c.pedir('reclutar', { ruta: sala }, 'rec')).error).toBeUndefined();
    const fuera = carpeta('refugio-caract-fuera-');
    expect((await c.pedir('abrirEn', { app: 'finder', ruta: fuera }, 'o1')).error).toBe('Esa carpeta no pertenece a ninguna sala.');
    const soloCarpetas = 'Solo se abren carpetas de sala en Finder, Terminal o el editor.';
    expect((await c.pedir('abrirEn', { app: 'navegador', ruta: sala }, 'o2')).error).toBe(soloCarpetas);
    expect((await c.pedir('abrirEn', { app: 'finder', ruta: path.join(sala, 'leeme.txt') }, 'o3')).error).toBe(soloCarpetas);
    expect((await c.pedir('abrirEn', { app: 'finder', ruta: path.join(sala, 'no-existe') }, 'o4')).error).toBe(soloCarpetas);
    c.ws.close();
  }, 15_000);

  it('límite de sesiones: retomar una conversación ya abierta devuelve la misma sesión, incluso con el límite lleno', async () => {
    const c = await conectar();
    // con CLAUDE.md y sin confianza, la sesión espera la pregunta de confianza: cuenta como viva y no lanza Claude Code
    const dir = carpeta('refugio-caract-limite-'); writeFileSync(path.join(dir, 'CLAUDE.md'), '# Instrucciones de ejemplo\n');
    const salaId = (await c.pedir('reclutar', { ruta: dir }, 'rec')).datos.id;
    const habitanteId = c.estado().habitantes.find((h: any) => h.salaId === salaId).id;
    await c.pedir('guardar', { parche: { limiteSesiones: 1 } }, 'lim');
    const empezar = (peticion: string, reanudar?: string) => { c.enviar({ t: 'empezar', salaId, habitanteId, prompt: '', opciones: reanudar ? { reanudar } : {}, peticion }); return c.respuesta(peticion); };
    const id = (await empezar('e1', 'conv-ejemplo-1')).datos;
    expect(typeof id).toBe('string');
    const ses = await hasta(() => c.recibidos.filter(m => m.t === 'sesion' && m.sesion.id === id).pop()?.sesion);
    expect(ses).toMatchObject({ estado: 'esperando', claudeId: 'conv-ejemplo-1', pendiente: { tipo: 'confianza' } });
    expect((await empezar('e2', 'conv-ejemplo-1')).datos).toBe(id);
    expect((await empezar('e3')).error).toBe('Ya hay 1 sesiones vivas (el límite es 1). Cierra alguna o sube el límite en la cámara acorazada.');
    c.enviar({ t: 'cerrarSesion', sesionId: id });
    await c.pedir('guardar', { parche: { limiteSesiones: 6 } }, 'lim2');
    c.ws.close();
  }, 15_000);
});
