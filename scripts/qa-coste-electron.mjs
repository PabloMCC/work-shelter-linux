// QA: coste real por fotograma dentro de la app (Electron), con el mismo método que qa-coste-fotograma.mjs (bucle
// parado con __noLoop, un paso y readPixels para sincronizar CPU y GPU), y además: llamadas y triángulos de todo el
// fotograma (con varios pases de postproceso, renderer.info se reinicia en cada render si no se desactiva), fotogramas
// con y sin mapa de sombras por separado, programas de shader, memoria de GPU y qué GPU se ha usado.
// Cada medición arranca su propio servidor con datos temporales y sin repos de ejemplo (la escena es siempre la misma)
// y lo apaga al cerrar la ventana, como hace la app. Necesita los assets descargados y la interfaz compilada.
// Uso: node scripts/qa-coste-electron.mjs [ancho x alto] [--angle=gl|vulkan|metal] [--veces=N] [--espera=ms] [--json=archivo]
// En un portátil con dos GPU, la que se use depende del sistema: la línea "gpu" del resultado dice cuál ha sido.
// La primera línea de cada medición es la de siempre (mismos campos, comparable con lo medido antes). Detrás van:
// - tiempo de GPU por fotograma (EXT_disjoint_timer_query_webgl2), alrededor del mismo paso que mide la CPU;
// - programas de shader tras __ready, tras calentar y tras medir (los que aparecen jugando son tirones), y las luces
//   visibles por tipo al empezar y al acabar (cambiar el número de luces recompila los materiales);
// - desglose de un fotograma con mapa de sombras: llamadas y triángulos por pase (sombras, escena, cada pase de
//   postproceso) y, en sombras y escena, por hijo directo de la escena. Se intercepta renderer.renderBufferDirect
//   desde aquí, sin tocar la app, y se deja como estaba.
// Con --json=archivo, cada medición se añade al archivo como una línea JSON con el commit y la huella de dist/web.
import { _electron } from 'playwright';
import electron from 'electron';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { servidor, leerOpciones, resumen, filtrarGpu, agregarDesglose, huellaBuild, commitActual, crearRegistro, anadirJson, nuevos, cifra, cerrarApp } from './qa-medicion.mjs';

let opciones;
try { opciones = leerOpciones(process.argv.slice(2)); } catch (e) { console.error(e.message); process.exit(2); }
const { w, h, angle, chromium, veces, esperaMs } = opciones;   // esperaMs: tras __ready, antes de medir

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
    const r = await pg.evaluate(async () => {
      const m = window.__refugio.motor, ren = m.renderer, gl = ren.getContext(), px = new Uint8Array(4);
      const programas = () => ren.info.programs?.length ?? null;
      // las que ve el renderer (las invisibles no cuentan para los programas)
      const luces = () => { const n = {}; m.scene.traverseVisible(o => { if (o.isLight) n[o.type] = (n[o.type] ?? 0) + 1; }); return n; };
      const programasTrasReady = programas(), lucesInicio = luces();
      const paso = () => { window.__step(1 / 60); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); };
      for (let i = 0; i < 20; i++) paso();
      const programasTrasCalentar = programas();
      // el contador de fotogramas decide qué pasos llevan sombra y dónde se hace el desglose: sin él, nada de esto vale
      if (!Number.isInteger(m.cuadro)) throw new Error(`El motor no expone un contador de fotogramas entero (cuadro = ${m.cuadro}): no se puede medir.`);
      ren.info.autoReset = false;
      // tiempo de GPU: una consulta por paso. El resultado no llega hasta volver al bucle de eventos (lo dice WebGL 2),
      // así que los pasos van seguidos, como siempre, y se recogen después. Ojo: es el tiempo que pasa en la GPU entre
      // las dos marcas, huecos incluidos: si la CPU tarda en mandar el trabajo, la GPU espera y eso también cuenta
      const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
      if (ext) gl.getParameter(ext.GPU_DISJOINT_EXT);   // leerlo lo pone a cero: solo cuenta lo que pase desde aquí
      const conSombra = [], sinSombra = [], consultas = []; let llamadas = 0, triangulos = 0;
      for (let i = 0; i < 120; i++) {
        ren.info.reset();
        const q = ext ? gl.createQuery() : null;
        const t = performance.now();
        if (q) gl.beginQuery(ext.TIME_ELAPSED_EXT, q);
        window.__step(1 / 60);
        if (q) gl.endQuery(ext.TIME_ELAPSED_EXT);
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        const ms = performance.now() - t;
        // el paso acaba de decidir si rehacía el mapa de sombras (uno de cada 3 fotogramas, o de cada 6 de lejos)
        const sombra = m.cuadro % (m.sombrasCongeladas ? 6 : 3) === 0;
        (sombra ? conSombra : sinSombra).push(ms);
        if (q) consultas.push({ q, sombra, ns: null, disjunta: false });
        llamadas = Math.max(llamadas, ren.info.render.calls); triangulos = Math.max(triangulos, ren.info.render.triangles);
      }
      const programasTrasMedir = programas();
      if (ext) {
        // si la GPU avisa de algo disjunto (cambio de frecuencia, otro proceso…), lo que aún no se había recogido no vale
        let pendientes = consultas;
        if (gl.getParameter(ext.GPU_DISJOINT_EXT)) { for (const c of pendientes) c.disjunta = true; pendientes = []; }
        const limite = performance.now() + 3000;
        while (pendientes.length && performance.now() < limite) {
          await new Promise(r => setTimeout(r, 16));
          const listas = pendientes.filter(c => gl.getQueryParameter(c.q, gl.QUERY_RESULT_AVAILABLE));
          if (gl.getParameter(ext.GPU_DISJOINT_EXT)) { for (const c of pendientes) c.disjunta = true; pendientes = []; break; }
          for (const c of listas) c.ns = gl.getQueryParameter(c.q, gl.QUERY_RESULT);
          pendientes = pendientes.filter(c => !listas.includes(c));
        }
        for (const c of consultas) gl.deleteQuery(c.q);
      }

      // desglose: se avanza hasta que el paso siguiente rehaga el mapa de sombras y se intercepta ese fotograma
      // con tope: si el contador no avanza de uno en uno, falla en vez de quedarse dando vueltas dentro de la página
      const k = m.sombrasCongeladas ? 6 : 3;
      for (let i = 0; (m.cuadro + 1) % k !== 0; i++) {
        if (i >= 2 * k) throw new Error(`No se llega a un fotograma con mapa de sombras en ${2 * k} pasos (cuadro = ${m.cuadro}, uno de cada ${k}).`);
        paso();
      }
      const escena = m.scene, lista = [], nombres = new Map();
      // cada objeto se cuenta en su antepasado que cuelga directamente de la escena; los grupos sin nombre, con su
      // tipo, su posición en la escena y el primer nombre que haya dentro, para poder encontrarlos
      const nombre = o => {
        if (o.name) return o.name;
        let dentro = ''; o.traverse(d => { if (!dentro && d.name) dentro = d.name; });
        return `${o.type} #${escena.children.indexOf(o)}${dentro ? ` (${dentro}…)` : ''}`;
      };
      const grupo = o => {
        while (o.parent && o.parent !== escena) o = o.parent;
        if (o.parent !== escena) return '(fuera de la escena)';
        if (!nombres.has(o)) nombres.set(o, nombre(o));
        return nombres.get(o);
      };
      let pase = '(fuera del composer)';
      const etiquetaPase = (p, i) => `post ${i}: ${p.name}${p.effects?.length ? `(${p.effects.map(e => e.name.replace(/Effect$/, '')).join(', ')})` : ''}`;
      const original = ren.renderBufferDirect, envueltos = [];
      ren.renderBufferDirect = function (...a) {
        const [, scene, , , object] = a, c0 = ren.info.render.calls, t0 = ren.info.render.triangles;
        const resultado = original.apply(this, a);
        // el mapa de sombras dibuja sin escena (scene null); la escena, con la del motor; el postproceso, con la suya
        const enEscena = scene === null || scene === escena;
        for (let i = 0; i < ren.info.render.calls - c0; i++) {
          lista.push({ pase: scene === null ? 'sombras' : scene === escena ? 'escena' : pase, grupo: enEscena ? grupo(object) : null, triangulos: i ? 0 : ren.info.render.triangles - t0 });
        }
        return resultado;
      };
      m.composer.passes.forEach((p, i) => {
        const propio = Object.hasOwn(p, 'render'), render = p.render;
        envueltos.push({ p, propio, render });
        p.render = function (...a) { pase = etiquetaPase(p, i); try { return render.apply(this, a); } finally { pase = '(fuera del composer)'; } };
      });
      let llamadasInfo;
      try { ren.info.reset(); paso(); llamadasInfo = ren.info.render.calls; }
      finally {
        ren.renderBufferDirect = original;
        for (const { p, propio, render } of envueltos) { if (propio) p.render = render; else delete p.render; }
      }

      const info = gl.getExtension('WEBGL_debug_renderer_info');
      return {
        conSombra, sinSombra, llamadasMax: llamadas, triangulosMax: triangulos, programas: programasTrasMedir,
        memoria: { ...ren.info.memory }, pixeles: `${ren.domElement.width}x${ren.domElement.height}`, dpr: +window.devicePixelRatio.toFixed(2),
        gpu: info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
        tiempoGpuMedible: !!ext,
        gpuMuestras: consultas.map(({ ns, disjunta, sombra }) => ({ ns, disjunta, sombra })),
        programasTrasReady, programasTrasCalentar, programasTrasDesglose: programas(),
        lucesInicio, lucesFin: luces(), desgloseLlamadas: lista, desgloseLlamadasInfo: llamadasInfo,
      };
    });
    const todos = resumen([...r.conSombra, ...r.sinSombra]);
    // la línea de siempre: mismos campos y en el mismo orden
    const linea = {
      ...todos, fpsPosible: +(1000 / todos.medianaMs).toFixed(0), conSombra: resumen(r.conSombra), sinSombra: resumen(r.sinSombra),
      llamadasMax: r.llamadasMax, triangulosMax: r.triangulosMax, programas: r.programas, memoria: r.memoria, pixeles: r.pixeles, dpr: r.dpr,
      gpu: r.gpu, tiempoGpuMedible: r.tiempoGpuMedible, ventana: `${w}x${h}`, angle: angle ?? 'por defecto', estadoGpu: gpu,
    };
    const tiempoGpu = !r.tiempoGpuMedible ? null : (() => {
      const f = filtrarGpu(r.gpuMuestras), con = filtrarGpu(r.gpuMuestras.filter(x => x.sombra)), sin = filtrarGpu(r.gpuMuestras.filter(x => !x.sombra));
      return { ...resumen(f.ms), conSombra: resumen(con.ms), sinSombra: resumen(sin.ms), disjuntas: f.disjuntas, sinResultado: f.sinResultado };
    })();
    // en pantalla, los 15 primeros grupos y el resto; en el JSON, todos
    const desglose = { ...agregarDesglose(r.desgloseLlamadas), llamadasInfo: r.desgloseLlamadasInfo };
    const desgloseCompleto = { ...agregarDesglose(r.desgloseLlamadas, Infinity), llamadasInfo: r.desgloseLlamadasInfo };
    // sin renderer.info.programs los recuentos son null y los nuevos también: no medible, no 0
    const programas = { trasReady: r.programasTrasReady, trasCalentar: r.programasTrasCalentar, trasMedir: r.programas, trasDesglose: r.programasTrasDesglose, nuevosDuranteMedicion: nuevos(r.programasTrasCalentar, r.programas) };
    return { linea, tiempoGpu, programas, luces: { inicio: r.lucesInicio, fin: r.lucesFin }, desglose, desgloseCompleto };
  } finally {
    // también si Electron no ha llegado a arrancar: que no quede el servidor vivo ocupando el puerto
    await cerrarApp(app);
    // sin el aviso de salida la ventana no pide al servidor que se apague: se apaga aquí si sigue vivo
    if (s.p.exitCode === null && s.p.signalCode === null) { s.p.kill('SIGINT'); await new Promise(r => s.p.once('exit', r)); }
    rmSync(s.datos, { recursive: true, force: true });
  }
}

const textoLuces = l => Object.entries(l).sort(([a], [b]) => a.localeCompare(b)).map(([t, n]) => `${t} ${n}`).join(', ') || 'ninguna';
const tabla = (cubos, sangria) => cubos.map(c => `${sangria}${c.nombre.padEnd(48)} ${String(c.llamadas).padStart(5)} llamadas ${String(c.triangulos).padStart(9)} triángulos${c.grupos ? ` (${c.grupos} grupos)` : ''}`).join('\n');

// la huella y el commit, una vez: son los del build que se va a medir
const build = huellaBuild(), commit = commitActual();
for (let i = 0; i < veces; i++) {
  const { linea, tiempoGpu, programas, luces, desglose, desgloseCompleto } = await medir();
  console.log(JSON.stringify(linea));
  console.log(tiempoGpu
    ? `tiempo de GPU: mediana ${cifra(tiempoGpu.medianaMs, ' ms')}, p95 ${cifra(tiempoGpu.p95Ms, ' ms')} (n=${tiempoGpu.n}; con sombra ${cifra(tiempoGpu.conSombra.medianaMs)}/${cifra(tiempoGpu.conSombra.p95Ms)}, sin sombra ${cifra(tiempoGpu.sinSombra.medianaMs)}/${cifra(tiempoGpu.sinSombra.p95Ms)}; descartadas: ${tiempoGpu.disjuntas} disjuntas, ${tiempoGpu.sinResultado} sin resultado)`
    : 'tiempo de GPU: no medible (esta GPU o este ANGLE no dan EXT_disjoint_timer_query_webgl2)');
  console.log(`programas: ${cifra(programas.trasReady)} tras __ready, ${cifra(programas.trasCalentar)} tras calentar, ${cifra(programas.trasMedir)} tras medir, ${cifra(programas.trasDesglose)} tras el desglose (nuevos durante la medición: ${cifra(programas.nuevosDuranteMedicion)})`);
  console.log(`luces visibles: al empezar ${textoLuces(luces.inicio)}; al acabar ${textoLuces(luces.fin)}`);
  console.log(`desglose de un fotograma con mapa de sombras: ${desglose.total.llamadas} llamadas, ${desglose.total.triangulos} triángulos (renderer.info: ${desglose.llamadasInfo} llamadas)`);
  console.log(`  por pase:\n${tabla(desglose.porPase, '    ')}`);
  for (const [pase, cubos] of Object.entries(desglose.porGrupo)) console.log(`  ${pase}, por hijo directo de la escena:\n${tabla(cubos, '    ')}`);
  if (opciones.json) {
    anadirJson(opciones.json, crearRegistro({ guion: 'qa-coste-electron', fecha: new Date(), commit, build, opciones: { ventana: `${w}x${h}`, angle: angle ?? 'por defecto', veces, esperaMs }, resultado: { ...linea, tiempoGpu, programasPorFase: programas, luces, desglose: desgloseCompleto } }));
    console.log(`json: añadido a ${opciones.json}`);
  }
}
