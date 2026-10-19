// QA: coste real por fotograma dentro de la app (Electron), con el mismo método que qa-coste-fotograma.mjs (bucle
// parado con __noLoop, un paso y readPixels para sincronizar CPU y GPU), y además: llamadas y triángulos de todo el
// fotograma (con varios pases de postproceso, renderer.info se reinicia en cada render si no se desactiva), fotogramas
// con y sin mapa de sombras por separado, programas de shader, memoria de GPU y qué GPU se ha usado.
// Cada medición arranca su propio servidor con datos temporales y sin repos de ejemplo (la escena es siempre la misma)
// y lo apaga al cerrar la ventana, como hace la app. Necesita los assets descargados y la interfaz compilada.
// Uso: node scripts/qa-coste-electron.mjs [ancho x alto] [--angle=gl|vulkan|metal] [--veces=N] [--espera=ms]
// En un portátil con dos GPU, la que se use depende del sistema: la línea "gpu" del resultado dice cuál ha sido.
import { _electron } from 'playwright';
import electron from 'electron';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const opciones = process.argv.slice(2);
const [w, h] = (opciones.find(o => /^\d+x\d+$/.test(o)) || '1440x900').split('x').map(Number);
const angle = opciones.find(o => o.startsWith('--angle='))?.slice(8);
// las opciones de Chromium van delante del guion de la app; Vulkan, además, hay que activarlo
const chromium = angle ? [`--use-angle=${angle}`, ...(angle === 'vulkan' ? ['--enable-features=Vulkan'] : [])] : [];
const veces = +(opciones.find(o => o.startsWith('--veces='))?.slice(8) || 1);
const esperaMs = +(opciones.find(o => o.startsWith('--espera='))?.slice(9) || 0);   // tras __ready, antes de medir
const PUERTO = process.env.SHELTER_PUERTO || '3791';
const espera = ms => new Promise(r => setTimeout(r, ms));

async function servidor() {
  const datos = mkdtempSync(join(tmpdir(), 'shelter-medicion-'));
  const p = spawn(process.execPath, ['server/supervisor.mjs'], { stdio: 'ignore', env: { ...process.env, SHELTER_DATOS: datos, SHELTER_PUERTO: PUERTO, SHELTER_SIN_EJEMPLOS: '1' } });
  for (let i = 0; i < 80; i++) {
    try { if ((await fetch(`http://127.0.0.1:${PUERTO}/salud`)).ok) { const token = readFileSync(join(datos, 'token'), 'utf8').trim(); return { p, datos, url: `http://127.0.0.1:${PUERTO}/#t=${token}` }; } } catch {}
    await espera(250);
  }
  p.kill('SIGINT'); rmSync(datos, { recursive: true, force: true });
  throw new Error(`El servidor no ha arrancado en el puerto ${PUERTO}.`);
}

async function medir() {
  const s = await servidor();
  let app;
  try {
    // su propio perfil: con el juego abierto, la instancia única no le entrega la medición
    app = await _electron.launch({ executablePath: electron, args: [...chromium, `--user-data-dir=${join(s.datos, 'electron')}`, 'electron/main.cjs'], env: { ...process.env, SHELTER_URL: s.url } });
    const pg = await app.firstWindow();
    await app.evaluate(({ BrowserWindow }, [w, h]) => BrowserWindow.getAllWindows()[0].setContentSize(w, h), [w, h]);
    // __noLoop tiene que existir antes de que arranque el juego: se añade y se recarga
    await pg.addInitScript('window.__noLoop = true;');
    await pg.reload();
    await pg.evaluate(async () => { await window.__ready(); });
    if (esperaMs) await pg.waitForTimeout(esperaMs);
    const gpu = await app.evaluate(({ app }) => app.getGPUFeatureStatus());
    const r = await pg.evaluate(() => {
      const m = window.__refugio.motor, ren = m.renderer, gl = ren.getContext(), px = new Uint8Array(4);
      const paso = () => { window.__step(1 / 60); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); };
      for (let i = 0; i < 20; i++) paso();
      ren.info.autoReset = false;
      const conSombra = [], sinSombra = []; let llamadas = 0, triangulos = 0;
      for (let i = 0; i < 120; i++) {
        ren.info.reset();
        const t = performance.now(); paso(); const ms = performance.now() - t;
        // el paso acaba de decidir si rehacía el mapa de sombras (uno de cada 3 fotogramas, o de cada 6 de lejos)
        (m.cuadro % (m.sombrasCongeladas ? 6 : 3) === 0 ? conSombra : sinSombra).push(ms);
        llamadas = Math.max(llamadas, ren.info.render.calls); triangulos = Math.max(triangulos, ren.info.render.triangles);
      }
      const resumen = ts => { const o = [...ts].sort((a, b) => a - b); return { n: o.length, medianaMs: +o[Math.floor(o.length / 2)].toFixed(2), p95Ms: +o[Math.min(o.length - 1, Math.floor(o.length * 0.95))].toFixed(2) }; };
      const todos = resumen([...conSombra, ...sinSombra]);
      const info = gl.getExtension('WEBGL_debug_renderer_info');
      return {
        ...todos, fpsPosible: +(1000 / todos.medianaMs).toFixed(0), conSombra: resumen(conSombra), sinSombra: resumen(sinSombra),
        llamadasMax: llamadas, triangulosMax: triangulos, programas: ren.info.programs?.length ?? null,
        memoria: { ...ren.info.memory }, pixeles: `${ren.domElement.width}x${ren.domElement.height}`, dpr: +window.devicePixelRatio.toFixed(2),
        gpu: info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
        tiempoGpuMedible: !!gl.getExtension('EXT_disjoint_timer_query_webgl2'),
      };
    });
    return { ...r, ventana: `${w}x${h}`, angle: angle ?? 'por defecto', estadoGpu: gpu };
  } finally {
    // también si Electron no ha llegado a arrancar: que no quede el servidor vivo ocupando el puerto
    await app?.close().catch(() => {});
    // la ventana, al cerrarse, ya pide al servidor que se apague: solo se espera si aún sigue vivo
    if (s.p.exitCode === null && s.p.signalCode === null) { s.p.kill('SIGINT'); await new Promise(r => s.p.once('exit', r)); }
    rmSync(s.datos, { recursive: true, force: true });
  }
}

for (let i = 0; i < veces; i++) console.log(JSON.stringify(await medir()));
