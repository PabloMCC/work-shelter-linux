// QA: el ritmo real del juego dentro de la app (Electron), con el bucle de verdad (sin __noLoop): qa-coste-electron.mjs
// mide cuánto cuesta un fotograma, y esto, cuántos se pintan y cada cuánto. Mide durante --segundos (10 por defecto)
// tras calentar 3 s:
// - el intervalo de requestAnimationFrame (mediana), que dice a cuántos Hz va la pantalla;
// - cuántos fotogramas pinta el motor por segundo (se envuelve __motor.paso para apuntar cuándo se llama) y el
//   intervalo entre ellos: mediana, p95 y el peor, que es el tirón que se nota;
// - lo que tarda paso() en la CPU (sin esperar a la GPU: es lo que se manda, no lo que se pinta) y los programas de
//   shader al empezar y al acabar.
// El motor solo pinta con la ventana en primer plano (web/src/motor/foco.ts), y una ventana abierta por Playwright puede
// no tener el foco. Para que el bucle corra se prueba, por orden, lo que ya ofrece la app: (1) dar el foco a la ventana
// desde el proceso principal, (2) mandar a la página el aviso «foco» que manda el proceso principal (electron/main.cjs),
// y (3) llamar a __motor.alCambiarPrimerPlano(true), que es lo que hace foco.ts al volver al primer plano. La salida
// dice cuál ha hecho falta y si el bucle se ha parado durante la medición (entonces no vale).
// Uso: node scripts/qa-bucle-electron.mjs [ancho x alto] [--angle=gl|vulkan|metal] [--veces=N] [--espera=ms] [--segundos=N] [--json=archivo]
import { _electron } from 'playwright';
import electron from 'electron';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { servidor, leerOpciones, resumen, intervalos, huellaBuild, commitActual, crearRegistro, anadirJson, nuevos, cifra } from './qa-medicion.mjs';

let opciones;
try { opciones = leerOpciones(process.argv.slice(2)); } catch (e) { console.error(e.message); process.exit(2); }
const { w, h, angle, chromium, veces, esperaMs, segundos } = opciones;   // esperaMs: tras __ready, antes de calentar
const CALENTAR_MS = 3000;

async function medir() {
  const s = await servidor();
  let app;
  try {
    // su propio perfil: con el juego abierto, la instancia única no le entrega la medición
    app = await _electron.launch({ executablePath: electron, args: [...chromium, `--user-data-dir=${join(s.datos, 'electron')}`, 'electron/main.cjs'], env: { ...process.env, SHELTER_URL: s.url } });
    const pg = await app.firstWindow();
    await app.evaluate(({ BrowserWindow }, [w, h]) => BrowserWindow.getAllWindows()[0].setContentSize(w, h), [w, h]);
    // sin recargar (aquí no hay __noLoop que meter antes): se espera a que la página haya puesto __ready
    await pg.waitForFunction(() => typeof window.__ready === 'function', null, { timeout: 60_000 });
    await pg.evaluate(async () => { await window.__ready(); });
    if (esperaMs) await pg.waitForTimeout(esperaMs);
    // marcas: cada paso() del motor (y lo que tarda), cada rAF de la pantalla y cada cambio de primer plano
    await pg.evaluate(() => {
      const m = window.__motor, q = window.__qaBucle = { pasos: [], cpu: [], raf: [], cambios: [], midiendo: true };
      const paso = m.paso;
      m.paso = function (...a) { const t = performance.now(); try { return paso.apply(this, a); } finally { q.pasos.push(t); q.cpu.push(performance.now() - t); } };
      const cambiar = m.alCambiarPrimerPlano;
      m.alCambiarPrimerPlano = function (...a) { q.cambios.push({ t: performance.now(), activo: a[0] }); return cambiar.apply(this, a); };
      const raf = t => { q.raf.push(t); if (q.midiendo) requestAnimationFrame(raf); };
      requestAnimationFrame(raf);
    });
    const corre = () => pg.evaluate(async () => { const n = window.__qaBucle.pasos.length; await new Promise(r => setTimeout(r, 500)); return window.__qaBucle.pasos.length > n; });
    let arranque = 'ya corría';
    if (!await corre()) {
      arranque = 'foco de la ventana';
      await app.evaluate(({ BrowserWindow }) => { const v = BrowserWindow.getAllWindows()[0]; v.show(); v.focus(); });
    }
    if (!await corre()) {
      arranque = 'aviso «foco» a la página';
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('foco', true));
    }
    if (!await corre()) {
      arranque = 'forzado con __motor.alCambiarPrimerPlano(true)';
      await pg.evaluate(() => window.__motor.alCambiarPrimerPlano(true));
    }
    if (!await corre()) throw new Error('El bucle del motor no corre ni forzándolo (¿página oculta? sin rAF no hay bucle).');
    await pg.waitForTimeout(CALENTAR_MS);
    const r = await pg.evaluate(async ms => {
      const m = window.__motor, ren = m.renderer, gl = ren.getContext(), q = window.__qaBucle;
      const programasInicio = ren.info.programs?.length ?? null;
      q.pasos.length = 0; q.cpu.length = 0; q.raf.length = 0; q.cambios.length = 0;
      const t0 = performance.now();
      await new Promise(r => setTimeout(r, ms));
      const duracionMs = performance.now() - t0;
      q.midiendo = false;
      const info = gl.getExtension('WEBGL_debug_renderer_info');
      return {
        pasos: [...q.pasos], cpu: [...q.cpu], raf: [...q.raf], cambios: [...q.cambios], t0, duracionMs,
        programasInicio, programasFin: ren.info.programs?.length ?? null,
        pixeles: `${ren.domElement.width}x${ren.domElement.height}`, dpr: +window.devicePixelRatio.toFixed(2),
        gpu: info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
      };
    }, segundos * 1000);
    const pantalla = intervalos(r.raf), pintados = intervalos(r.pasos);
    return {
      ventana: `${w}x${h}`, pixeles: r.pixeles, dpr: r.dpr, gpu: r.gpu, angle: angle ?? 'por defecto', segundos: +(r.duracionMs / 1000).toFixed(2), arranque,
      pantalla: { ...pantalla, hz: pantalla.medianaMs ? +(1000 / pantalla.medianaMs).toFixed(1) : null },
      pintadosPorSegundo: +(r.pasos.length / (r.duracionMs / 1000)).toFixed(1), pintados: r.pasos.length, intervaloPintados: pintados,
      cpuPaso: resumen(r.cpu), programas: { inicio: r.programasInicio, fin: r.programasFin, nuevos: nuevos(r.programasInicio, r.programasFin) },
      // un cambio de primer plano durante la medición la invalida: el bucle se ha parado (o se ha vuelto a poner) a mitad
      cambiosPrimerPlano: r.cambios.map(c => ({ ms: +(c.t - r.t0).toFixed(0), activo: c.activo })),
    };
  } finally {
    // también si Electron no ha llegado a arrancar: que no quede el servidor vivo ocupando el puerto
    await app?.close().catch(() => {});
    // la ventana, al cerrarse, ya pide al servidor que se apague: solo se espera si aún sigue vivo
    if (s.p.exitCode === null && s.p.signalCode === null) { s.p.kill('SIGINT'); await new Promise(r => s.p.once('exit', r)); }
    rmSync(s.datos, { recursive: true, force: true });
  }
}

// la huella y el commit, una vez: son los del build que se va a medir
const build = huellaBuild(), commit = commitActual();
for (let i = 0; i < veces; i++) {
  const r = await medir();
  console.log(`bucle real ${r.ventana} (${r.pixeles}, dpr ${r.dpr}), angle ${r.angle}, gpu ${r.gpu}`);
  console.log(`  ${r.segundos} s tras ${CALENTAR_MS / 1000} s de calentar; el bucle corre por: ${r.arranque}`);
  console.log(`  pantalla: rAF cada ${cifra(r.pantalla.medianaMs, ' ms')} de mediana (${cifra(r.pantalla.hz, ' Hz')}; n=${r.pantalla.n})`);
  console.log(`  motor: ${r.pintadosPorSegundo} fotogramas pintados por segundo (${r.pintados})`);
  console.log(`  intervalo entre pintados: mediana ${cifra(r.intervaloPintados.medianaMs, ' ms')}, p95 ${cifra(r.intervaloPintados.p95Ms, ' ms')}, máximo ${cifra(r.intervaloPintados.maxMs, ' ms')}`);
  console.log(`  CPU dentro de paso(): mediana ${cifra(r.cpuPaso.medianaMs, ' ms')}, p95 ${cifra(r.cpuPaso.p95Ms, ' ms')} (sin esperar a la GPU)`);
  console.log(`  programas: ${cifra(r.programas.inicio)} al empezar, ${cifra(r.programas.fin)} al acabar (nuevos: ${cifra(r.programas.nuevos)})`);
  console.log(r.cambiosPrimerPlano.length
    ? `  AVISO: el primer plano ha cambiado durante la medición (${r.cambiosPrimerPlano.map(c => `${c.activo ? 'activo' : 'parado'} a los ${c.ms} ms`).join(', ')}): no vale`
    : '  primer plano: sin cambios durante la medición');
  if (opciones.json) {
    anadirJson(opciones.json, crearRegistro({ guion: 'qa-bucle-electron', fecha: new Date(), commit, build, opciones: { ventana: r.ventana, angle: r.angle, veces, esperaMs, segundos, calentarMs: CALENTAR_MS }, resultado: r }));
    console.log(`  json: añadido a ${opciones.json}`);
  }
}
