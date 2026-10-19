// QA: ¿renderiza WebGPURenderer la carga de la app más rápido que WebGLRenderer en esta máquina? Abre
// web/banco-webgpu.html en el Electron de la app, una ventana nueva por motor y vez, y mide como qa-coste-electron.mjs
// (paso a paso con espera a la GPU, mediana y p95). Arranca su propio Vite y lo apaga al acabar, también si algo falla.
// Uso: node scripts/qa-banco-webgpu.mjs [--veces=N] [--motor=webgl|webgpu|ambos] [--angle=gl|vulkan] [--densidad=1.35] [ancho x alto]
// --angle solo afecta a WebGL (WebGPU va por Dawn sobre Vulkan). Una línea JSON por medición.
import { _electron } from 'playwright';
import electron from 'electron';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const opciones = process.argv.slice(2);
const op = n => opciones.find(o => o.startsWith(`--${n}=`))?.slice(n.length + 3);
const [w, h] = (opciones.find(o => /^\d+x\d+$/.test(o)) || '1440x900').split('x').map(Number);
const veces = +(op('veces') || 1);
const motores = { webgl: ['webgl'], webgpu: ['webgpu'], ambos: ['webgl', 'webgpu'] }[op('motor') || 'ambos'];
if (!motores) throw new Error('--motor ha de ser webgl, webgpu o ambos');
const angle = op('angle');
// densidad del render fija en la página (?pr=): el devicePixelRatio de la ventana cambia de un arranque a otro
const densidad = op('densidad') || '1.35';
const PUERTO = process.env.SHELTER_PUERTO_VITE || '5180';
const espera = ms => new Promise(r => setTimeout(r, ms));

// main mínimo: una ventana visible con la URL dada (electron/main.cjs no vale, apaga el servidor de la app al cerrar)
const dir = mkdtempSync(join(tmpdir(), 'banco-webgpu-'));
const main = join(dir, 'main.cjs');
writeFileSync(main, `const { app, BrowserWindow } = require('electron');
app.whenReady().then(() => {
  const [w, h] = process.env.BANCO_TAM.split('x').map(Number);
  const v = new BrowserWindow({ width: w, height: h, useContentSize: true, show: true, webPreferences: { backgroundThrottling: false } });
  v.loadURL(process.env.BANCO_URL);
});
app.on('window-all-closed', () => app.quit());
`);

let vite = null;
const apagarVite = async () => {
  if (!vite || vite.exitCode !== null || vite.signalCode !== null) return;
  const fin = new Promise(r => vite.once('exit', r));
  try { process.kill(-vite.pid, 'SIGTERM'); } catch {}   // el grupo entero: Vite y su esbuild
  await Promise.race([fin, espera(3000)]);
  if (vite.exitCode === null && vite.signalCode === null) { try { process.kill(-vite.pid, 'SIGKILL'); } catch {} await fin; }
};
for (const s of ['SIGINT', 'SIGTERM']) process.once(s, async () => { await apagarVite(); rmSync(dir, { recursive: true, force: true }); process.exit(130); });

async function arrancarVite() {
  vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js'], { stdio: 'ignore', detached: true, env: { ...process.env, SHELTER_PUERTO_VITE: PUERTO } });
  for (let i = 0; i < 120; i++) {
    if (vite.exitCode !== null) throw new Error(`Vite ha salido (código ${vite.exitCode}); ¿puerto ${PUERTO} ocupado?`);
    try { if ((await fetch(`http://127.0.0.1:${PUERTO}/banco-webgpu.html`)).ok) return; } catch {}
    await espera(250);
  }
  throw new Error(`Vite no responde en el puerto ${PUERTO}.`);
}

async function medir(motor) {
  // en Linux WebGPU necesita la función Vulkan de Chromium (sin ella no hay adaptador, aunque getGPUFeatureStatus diga
  // enabled); se pasa a los dos motores para que las opciones sean las mismas. WebGL sigue con ANGLE GL salvo --angle.
  const chromium = ['--enable-features=Vulkan', ...(motor === 'webgl' && angle ? [`--use-angle=${angle}`] : [])];
  let app;
  try {
    app = await _electron.launch({ executablePath: electron, args: [...chromium, main], env: { ...process.env, BANCO_URL: `http://127.0.0.1:${PUERTO}/banco-webgpu.html?motor=${motor}&ancho=${w}&alto=${h}&pr=${densidad}`, BANCO_TAM: `${w}x${h}` } });
    const pg = await app.firstWindow();
    await pg.waitForFunction(() => typeof window.__ready === 'function', null, { timeout: 60000 });
    const t = Date.now();
    await pg.evaluate(async () => { await window.__ready(); });
    const preparacionMs = Date.now() - t;
    const estadoGpu = await app.evaluate(({ app }) => app.getGPUFeatureStatus());
    const versionElectron = await app.evaluate(() => process.versions.electron);
    const r = await pg.evaluate(async () => await window.__medir(120, 20));
    return { ...r, ventana: `${w}x${h}`, angle: motor === 'webgl' ? (angle ?? 'por defecto') : 'no aplica', preparacionMs, electron: versionElectron, estadoWebgpu: estadoGpu.webgpu };
  } catch (e) {
    return { motor, error: String(e?.message ?? e).split('\n')[0] };
  } finally {
    await app?.close().catch(() => {});
  }
}

let codigo = 0;
try {
  await arrancarVite();
  // el orden se alterna en cada vez, para que ninguno de los dos salga siempre primero (caché de disco, reloj de la GPU)
  for (let i = 0; i < veces; i++) for (const motor of i % 2 ? [...motores].reverse() : motores) {
    const r = await medir(motor);
    if (r.error) codigo = 1;
    console.log(JSON.stringify({ vez: i + 1, ...r }));
  }
} catch (e) {
  console.error(String(e?.message ?? e)); codigo = 1;
} finally {
  await apagarVite();
  rmSync(dir, { recursive: true, force: true });
}
process.exit(codigo);
