// Lo que comparten los guiones de medición dentro de la app (qa-coste-electron.mjs, qa-bucle-electron.mjs): el
// servidor propio de cada medición.
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
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
