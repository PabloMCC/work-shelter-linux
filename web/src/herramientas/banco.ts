// Herramienta de desarrollo: banco de render, misma escena con WebGLRenderer o con WebGPURenderer (?motor=webgl|webgpu).
// Escena determinista (semilla fija y lista fija de modelos de indice.json) con una carga parecida a la de la app:
// ~790 llamadas y ~1M de triángulos por fotograma contando el pase de sombras. Solo el núcleo del renderer: materiales
// tal como vienen del glTF, sin postproceso. El sol rehace su mapa de sombras en cada fotograma (la app lo hace 1 de 3).
// Contrato de QA: window.__ready() carga, monta, arranca el renderer y compila; window.__medir(n) mide n fotogramas.
// Parámetros: motor, n (llamadas objetivo del pase principal), t (triángulos objetivo por fotograma), aa=1 (antialias),
// ancho y alto (CSS) y pr (densidad de píxeles del render).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const q = new URLSearchParams(location.search);
const motor = q.get('motor') === 'webgpu' ? 'webgpu' : 'webgl';
const objetivoLlamadas = +(q.get('n') || 394);        // pase principal; el de sombras dibuja las mismas piezas
const objetivoTriangulos = +(q.get('t') || 1_000_000); // los dos pases juntos
const antialias = q.get('aa') === '1';
// tamaño y densidad fijos, no los de la ventana: el devicePixelRatio de Electron cambia de un arranque a otro
const ancho = +(q.get('ancho') || 1440), alto = +(q.get('alto') || 900), densidad = +(q.get('pr') || 1.35);
// KayKit y Quaternius, de los densos para llegar a ~1270 triángulos por llamada
const GRUPOS: [string, number][] = [['resource-bits', 132], ['props_kaykit', 18], ['restaurant-bits', 64], ['cyberpunk_pack', 32]];
const CELDA = 2.5;

// generador con semilla (mulberry32): la escena sale igual en cada ejecución y en los dos motores
function azar(semilla: number) {
  return () => { semilla |= 0; semilla = (semilla + 0x6d2b79f5) | 0; let t = Math.imul(semilla ^ (semilla >>> 15), 1 | semilla); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

type Pieza = { nombre: string; o: THREE.Object3D; llamadas: number; triangulos: number };
type Motor = { render: () => void; sincronizar: () => Promise<void>; info: () => { llamadas: number; triangulos: number }; reiniciarInfo: () => void; gpu: string; backend: string };

const scene = new THREE.Scene();
scene.background = new THREE.Color('#1b1c20');
const cam = new THREE.PerspectiveCamera(50, ancho / alto, 0.5, 400);
const descartadas: string[] = [];
let m: Motor | null = null, errorArranque: string | null = null, piezasColocadas = 0, visibles = 0;

function medirPieza(o: THREE.Object3D) {
  let llamadas = 0, triangulos = 0;
  o.traverse((n: any) => {
    if (!n.isMesh) return;
    n.castShadow = true; n.receiveShadow = true;
    const g = n.geometry as THREE.BufferGeometry, cuenta = g.index ? g.index.count : g.attributes.position.count;
    if (Array.isArray(n.material)) { for (const gr of g.groups) { llamadas++; triangulos += gr.count / 3; } }
    else { llamadas++; triangulos += cuenta / 3; }
  });
  return { llamadas, triangulos };
}

async function cargarPiezas(): Promise<Pieza[]> {
  const indice = await (await fetch('/assets/indice.json')).json();
  const loader = new GLTFLoader(), piezas: Pieza[] = [];
  for (const [grupo, cuantos] of GRUPOS) for (const ruta of (indice[grupo] || []).slice(0, cuantos) as string[]) {
    try {
      const o = (await loader.loadAsync('/assets/' + ruta.split('/').map(encodeURIComponent).join('/'))).scene;
      // fuera las que tienen esqueleto (el skinning es otro coste) o transmisión: WebGL la resuelve con un pase extra
      // que vuelve a dibujar todo lo opaco y WebGPU con una copia de pantalla, y eso no es comparar el mismo trabajo
      let fuera = false; o.traverse((n: any) => { if (n.isSkinnedMesh || [].concat(n.material ?? []).some((mt: any) => mt.transmission > 0)) fuera = true; });
      if (fuera) { descartadas.push(ruta.split('/').pop()!); continue; }
      // a escala de celda: el tamaño no cambia los triángulos y deja la cuadrícula pareja
      const box = new THREE.Box3().setFromObject(o), tam = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
      const k = (CELDA * 0.8) / (Math.max(tam.x, tam.y, tam.z) || 1);
      const raiz = new THREE.Group(); o.position.set(-c.x, -box.min.y, -c.z); raiz.add(o); raiz.scale.setScalar(k);
      const { llamadas, triangulos } = medirPieza(raiz);
      if (llamadas > 0) piezas.push({ nombre: ruta.split('/').pop()!, o: raiz, llamadas, triangulos });
    } catch (e) { console.log('FALLO ' + ruta + ' ' + e); }
  }
  (window as any).__piezas = piezas.map(p => ({ nombre: p.nombre, llamadas: p.llamadas, triangulos: p.triangulos }));
  return piezas;
}

// elige piezas con la semilla hasta llenar las llamadas objetivo, tirando hacia la media de triángulos por llamada que falta
function elegir(piezas: Pieza[]) {
  const r = azar(1234), elegidas: Pieza[] = [], porPase = objetivoTriangulos / 2;
  let llamadas = 0, triangulos = 0;
  while (llamadas < objetivoLlamadas) {
    const quedan = objetivoLlamadas - llamadas, ritmo = Math.max(0, porPase - triangulos) / quedan;
    const caben = piezas.filter(p => p.llamadas <= quedan);
    if (!caben.length) break;
    const altas = caben.filter(p => p.triangulos / p.llamadas >= ritmo), bajas = caben.filter(p => p.triangulos / p.llamadas < ritmo);
    const media = triangulos / Math.max(1, llamadas);
    const lote = (media < ritmo ? altas : bajas).length ? (media < ritmo ? altas : bajas) : caben;
    const p = lote[Math.floor(r() * lote.length)];
    elegidas.push(p); llamadas += p.llamadas; triangulos += p.triangulos;
  }
  return { elegidas, rot: azar(99) };
}

function montar(piezas: Pieza[]) {
  const { elegidas, rot } = elegir(piezas);
  const lado = Math.ceil(Math.sqrt(elegidas.length)), mitad = (lado * CELDA) / 2;
  elegidas.forEach((p, i) => {
    const o = p.o.clone();
    o.position.set((i % lado) * CELDA - mitad + CELDA / 2, 0, Math.floor(i / lado) * CELDA - mitad + CELDA / 2);
    o.rotation.y = rot() * Math.PI * 2;
    scene.add(o);
  });
  piezasColocadas = elegidas.length;
  const suelo = new THREE.Mesh(new THREE.PlaneGeometry(mitad * 2.2, mitad * 2.2), new THREE.MeshStandardMaterial({ color: '#6b6f78', roughness: 0.9 }));
  suelo.rotation.x = -Math.PI / 2; suelo.receiveShadow = true; scene.add(suelo);

  scene.add(new THREE.HemisphereLight('#dfe8ff', '#4a4038', 1.2));
  const sol = new THREE.DirectionalLight('#fff3e0', 2.5);
  sol.position.set(mitad * 0.8, mitad * 1.6, mitad * 0.6); sol.target.position.set(0, 0, 0);
  sol.castShadow = true; sol.shadow.mapSize.set(1536, 1536); sol.shadow.bias = -0.0005; sol.shadow.normalBias = 0.02;
  const sc = sol.shadow.camera; sc.left = -mitad * 1.25; sc.right = mitad * 1.25; sc.top = mitad * 1.25; sc.bottom = -mitad * 1.25; sc.near = 0.5; sc.far = mitad * 5;
  scene.add(sol, sol.target);

  // cámara fija que ve toda la cuadrícula: así los dos pases dibujan todas las piezas
  cam.position.set(0, mitad * 1.55, mitad * 1.75); cam.lookAt(0, 0, -mitad * 0.1); cam.far = mitad * 8; cam.updateProjectionMatrix(); cam.updateMatrixWorld();
  scene.updateMatrixWorld(true);
  const fr = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
  visibles = 0; scene.traverse((n: any) => { if (n.isMesh) { n.geometry.computeBoundingSphere(); if (fr.intersectsSphere(new THREE.Sphere().copy(n.geometry.boundingSphere).applyMatrix4(n.matrixWorld))) visibles++; } });
}

function canvasA(r: { domElement: HTMLCanvasElement; setPixelRatio(v: number): void; setSize(w: number, h: number): void }) {
  r.setPixelRatio(densidad); r.setSize(ancho, alto); document.body.append(r.domElement);
}

async function motorWebGL(): Promise<Motor> {
  const r = new THREE.WebGLRenderer({ antialias, powerPreference: 'high-performance' });
  r.outputColorSpace = THREE.SRGBColorSpace; r.toneMapping = THREE.ACESFilmicToneMapping;
  r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFShadowMap;
  canvasA(r);
  r.info.autoReset = false;   // si no, el reinicio de render() se come las llamadas del pase de sombras
  const gl = r.getContext(), px = new Uint8Array(4), ext = gl.getExtension('WEBGL_debug_renderer_info');
  r.compile(scene, cam);
  return {
    render: () => r.render(scene, cam),
    sincronizar: async () => { gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); },
    info: () => ({ llamadas: r.info.render.calls, triangulos: r.info.render.triangles }),
    reiniciarInfo: () => r.info.reset(),
    gpu: String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)),
    backend: 'WebGLRenderer',
  };
}

async function motorWebGPU(): Promise<Motor> {
  if (!('gpu' in navigator) || !navigator.gpu) throw new Error('navigator.gpu no existe: WebGPU no está disponible en este navegador');
  const { WebGPURenderer } = await import('three/webgpu');
  const r = new WebGPURenderer({ antialias, powerPreference: 'high-performance' });
  r.outputColorSpace = THREE.SRGBColorSpace; r.toneMapping = THREE.ACESFilmicToneMapping;
  r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFShadowMap;
  canvasA(r);
  await r.init();
  const b = r.backend as any;
  // WebGPURenderer cae solo a WebGL2 si no consigue adaptador: eso no es WebGPU y no se mide como tal
  if (!b.isWebGPUBackend) throw new Error('WebGPURenderer ha caído al backend WebGL2: WebGPU no está disponible');
  const device = b.device as GPUDevice, ai = device.adapterInfo;
  if ((ai as any)?.isFallbackAdapter || ai?.architecture === 'swiftshader') throw new Error('el adaptador WebGPU es por software (SwiftShader), no la GPU');
  await r.compileAsync(scene, cam);
  return {
    render: () => r.render(scene, cam),
    sincronizar: () => device.queue.onSubmittedWorkDone(),
    info: () => ({ llamadas: r.info.render.drawCalls, triangulos: r.info.render.triangles }),
    reiniciarInfo: () => r.info.reset(),
    gpu: [ai?.vendor, ai?.architecture, ai?.device, ai?.description].filter(Boolean).join(' / '),
    backend: 'WebGPUBackend',
  };
}

const ceder = () => new Promise<void>(res => setTimeout(res, 0));
const resumen = (ts: number[]) => { const o = [...ts].sort((a, b) => a - b); return { mediana: +o[Math.floor(o.length / 2)].toFixed(2), p95: +o[Math.min(o.length - 1, Math.floor(o.length * 0.95))].toFixed(2) }; };

(window as any).__ready = async () => {
  try {
    montar(await cargarPiezas());
    m = motor === 'webgpu' ? await motorWebGPU() : await motorWebGL();
    for (let i = 0; i < 3; i++) { m.render(); await m.sincronizar(); }
  } catch (e) { errorArranque = String((e as Error)?.message ?? e); }
};

// n fotogramas tras `calentar`, cada uno: render + espera a que la GPU acabe (CPU y GPU). Entre fotogramas se cede el
// hilo fuera del cronómetro en los dos motores, para que la composición de la ventana no caiga dentro de la medida.
(window as any).__medir = async (n = 120, calentar = 20) => {
  const base = { motor, pixeles: '', densidad, dprVentana: +devicePixelRatio.toFixed(2), piezas: piezasColocadas, mallasVisibles: visibles, descartadas };
  if (!m) return { ...base, error: errorArranque ?? 'sin arrancar: falta __ready()' };
  const cv = document.querySelector('canvas')!; base.pixeles = `${cv.width}x${cv.height}`;
  for (let i = 0; i < calentar; i++) { m.render(); await m.sincronizar(); await ceder(); }
  const tiempos: number[] = [], cpu: number[] = []; let llamadas = 0, triangulos = 0;
  for (let i = 0; i < n; i++) {
    m.reiniciarInfo();
    const t0 = performance.now(); m.render(); const t1 = performance.now(); await m.sincronizar(); const t2 = performance.now();
    tiempos.push(t2 - t0); cpu.push(t1 - t0);
    const inf = m.info(); llamadas = Math.max(llamadas, inf.llamadas); triangulos = Math.max(triangulos, inf.triangulos);
    await ceder();
  }
  // ráfaga: n fotogramas seguidos y una sola espera al final (ritmo sostenido, sin la latencia de cada espera)
  const r0 = performance.now(); for (let i = 0; i < n; i++) m.render(); await m.sincronizar(); const rafaga = (performance.now() - r0) / n;
  // coste de la propia espera sin trabajo: el suelo de la medida por fotograma
  const vacio: number[] = []; for (let i = 0; i < 30; i++) { await ceder(); const t = performance.now(); await m.sincronizar(); vacio.push(performance.now() - t); }
  const t = resumen(tiempos);
  return {
    ...base, mediana: t.mediana, p95: t.p95, cpuMediana: resumen(cpu).mediana, rafagaMsPorFotograma: +rafaga.toFixed(2),
    esperaVaciaMediana: resumen(vacio).mediana, llamadas, triangulos: Math.round(triangulos), gpu: m.gpu, backend: m.backend, antialias,
  };
};
(window as any).__step = () => { m?.render(); };
