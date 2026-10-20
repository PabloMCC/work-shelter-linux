// Acceso a work-shelter en el menú de aplicaciones de Linux (KDE, GNOME y los demás que siguen las especificaciones de
// freedesktop): una entrada .desktop y su icono en hicolor, en ${XDG_DATA_HOME:-~/.local/share}, solo para tu usuario y
// sin sudo. La entrada abre ./shelter de este repo con SHELTER_DESDE_MENU=1 (sin terminal: su salida va a shelter.log),
// así que el juego se sigue actualizando desde el repo sin reinstalar; hay que repetirlo solo si se mueve la carpeta.
// Lo lanzan `./shelter instalar-app` y `./shelter desinstalar-app`.
// Uso: node scripts/instalar-app-linux.mjs [--desinstalar]
// El nombre del archivo (work-shelter-public.desktop) es también la identidad de la ventana: electron/main.cjs lo fija con
// app.setDesktopName y Electron lo usa como app_id en Wayland y WM_CLASS en X11 (StartupWMClass), y package.json lo
// repite en desktopName; test/instalar-app-linux.test.ts comprueba que los tres coinciden.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const ID = 'work-shelter-public';
export const TAMANOS = [48, 64, 128, 256, 512];
const RAIZ = path.resolve(import.meta.dirname, '..');

// ${XDG_DATA_HOME:-~/.local/share}; uno que no sea una ruta absoluta no vale (especificación XDG Base Directory)
export function carpetaDatos(env = process.env, casa = os.homedir()) {
  const xdg = env.XDG_DATA_HOME;
  return xdg && path.isAbsolute(xdg) ? xdg : path.join(casa, '.local', 'share');
}

// lo que se instala, y lo único que se quita al desinstalar
export function rutas(datos) {
  const apps = path.join(datos, 'applications');
  const hicolor = path.join(datos, 'icons', 'hicolor');
  return {
    apps, hicolor, escritorio: path.join(apps, `${ID}.desktop`),
    iconos: TAMANOS.map(tamano => ({ tamano, ruta: path.join(hicolor, `${tamano}x${tamano}`, 'apps', `${ID}.png`) })),
  };
}

// una línea de un archivo .desktop no puede llevar caracteres de control (un salto de línea la partiría)
function sinControl(s) {
  if (/[\u0000-\u001f\u007f]/.test(s)) throw new Error(`La ruta lleva caracteres de control y no cabe en el menú: ${JSON.stringify(s)}`);
  return s;
}
// valor de tipo cadena (Path, TryExec): la barra invertida se escribe \\
export const valorCadena = s => sinControl(s).replace(/\\/g, '\\\\');
// un argumento de Exec según la especificación Desktop Entry: entre comillas, con \ delante de " ` $ y \; el % doblado
// (los códigos de campo); y encima, el escape de las cadenas (cada \ se dobla: una barra de verdad son cuatro)
export const argumentoExec = s => valorCadena(`"${sinControl(s).replace(/["`$\\]/g, '\\$&').replace(/%/g, '%%')}"`);

export function entradaEscritorio(raiz) {
  const shelter = path.join(raiz, 'shelter');
  return [
    '[Desktop Entry]',
    'Type=Application',
    'Name=work-shelter',
    'GenericName=Refugio para Claude Code',
    'Comment=El refugio subterráneo jugable para trabajar con Claude Code',
    // si la carpeta se mueve o se borra, la entrada se esconde sola en vez de fallar
    `TryExec=${valorCadena(shelter)}`,
    `Exec=env SHELTER_DESDE_MENU=1 ${argumentoExec(shelter)}`,
    `Path=${valorCadena(raiz)}`,
    `Icon=${ID}`,
    'Terminal=false',
    'Categories=Development;',
    'Keywords=claude;refugio;juego;',
    'StartupNotify=true',
    `StartupWMClass=${ID}`,
    '',
  ].join('\n');
}

// escribe sin dejar nunca un archivo a medias (otro nombre y luego rename, que es atómico)
function escribir(archivo, datos) {
  fs.mkdirSync(path.dirname(archivo), { recursive: true });
  const tmp = `${archivo}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, datos, { mode: 0o644 });
  fs.chmodSync(tmp, 0o644);
  fs.renameSync(tmp, archivo);
}

// un programa del sistema que puede no estar (cada escritorio trae los suyos): sin él o si falla, en silencio
export function ejecutarSiHay(orden, args) {
  try { execFileSync(orden, args, { stdio: 'ignore', timeout: 60_000 }); return true; } catch { return false; }
}

// que el menú vea los cambios ya: la base de datos de los .desktop, la caché de iconos de GTK (solo si ese hicolor tiene
// su index.theme; sin él, gtk-update-icon-cache falla y no hace falta) y la caché de KDE
function refrescar(r, ejecutar) {
  ejecutar('update-desktop-database', [r.apps]);
  if (fs.existsSync(path.join(r.hicolor, 'index.theme'))) ejecutar('gtk-update-icon-cache', ['-q', '-t', r.hicolor]);
  ejecutar('kbuildsycoca6', []);
}

export async function instalar({ raiz = RAIZ, datos = carpetaDatos(), ejecutar = ejecutarSiHay } = {}) {
  const r = rutas(datos);
  const entrada = entradaEscritorio(raiz);   // primero: si la ruta no cabe, no se escribe nada
  const { default: sharp } = await import('sharp');
  const fuente = path.join(raiz, 'electron', 'icono', 'icono.png');
  for (const { tamano, ruta } of r.iconos) {
    // lanczos3 y PNG con su canal alfa, sin metadatos
    const png = await sharp(fuente).resize(tamano, tamano, { kernel: 'lanczos3', fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).ensureAlpha().png().toBuffer();
    escribir(ruta, png);
  }
  escribir(r.escritorio, entrada);
  refrescar(r, ejecutar);
  return r;
}

// quita exactamente lo que pone instalar (ni las carpetas ni nada de al lado); devuelve lo quitado
export function desinstalar({ datos = carpetaDatos(), ejecutar = ejecutarSiHay } = {}) {
  const r = rutas(datos);
  const quitados = [r.escritorio, ...r.iconos.map(i => i.ruta)].filter(f => {
    try { fs.unlinkSync(f); return true; } catch (e) { if (e.code === 'ENOENT') return false; throw e; }
  });
  if (quitados.length) refrescar(r, ejecutar);
  return quitados;
}

async function principal(args) {
  if (process.platform !== 'linux' && !process.env.SHELTER_COMO_LINUX) {
    console.error('El acceso en el menú es solo para Linux (en macOS, ./shelter instalar-app crea la app).');
    return 1;
  }
  const datos = carpetaDatos();
  if (args.includes('--desinstalar')) {
    const quitados = desinstalar({ datos });
    if (!quitados.length) { console.log(`No había ningún acceso de work-shelter en el menú (${path.join(datos, 'applications')}).`); return 0; }
    console.log('Quitado el acceso de work-shelter del menú de aplicaciones:');
    for (const f of quitados) console.log(`  ${f}`);
    return 0;
  }
  const r = await instalar({ datos });
  console.log('work-shelter ya está en el menú de aplicaciones (en Desarrollo), solo para tu usuario:');
  console.log(`  Entrada: ${r.escritorio}`);
  console.log(`  Iconos: ${path.join(r.hicolor, '{' + TAMANOS.map(t => `${t}x${t}`).join(',') + '}', 'apps', `${ID}.png`)}`);
  console.log(`Abre ./shelter de ${RAIZ}; lo que escribe va a shelter.log, en la carpeta de los registros.`);
  console.log('Si mueves la carpeta del juego, vuelve a ejecutar ./shelter instalar-app. Para quitarlo: ./shelter desinstalar-app');
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  principal(process.argv.slice(2)).then(c => process.exit(c), e => { console.error(`No he podido crear el acceso en el menú: ${e?.message ?? e}`); process.exit(1); });
}
