// Lo que cambia entre macOS y Linux (y el resto de Unix, que va por la rama freedesktop): dónde viven los datos, con
// qué se abre una dirección, un archivo o una carpeta, la papelera, la terminal, el shell y los sockets. Cada cosa es
// una función pura que devuelve la orden (`{ bin, args }`) con la plataforma como parámetro, para que el contrato se
// pruebe igual en los dos sistemas, más unos lanzadores finos que la ejecutan. En macOS todo es lo de siempre.
// Módulo hoja: no importa nada del servidor (ejemplos.ts no puede importar estado.ts y los dos lo usan).
import { execFile, execFileSync, spawn } from 'node:child_process';
import { accessSync, constants, existsSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/** Una orden por lanzar: el programa, sus argumentos y, si hace falta, la carpeta desde la que se lanza */
export interface Orden { bin: string; args: string[]; cwd?: string }
export type Plataforma = NodeJS.Platform;
type Entorno = Record<string, string | undefined>;
/** Busca un ejecutable y devuelve su ruta (o null); en los tests, un PATH falso */
export type Buscador = (nombre: string) => string | null;
export interface Deteccion { buscar?: Buscador; existe?: (ruta: string) => boolean; env?: Entorno }
/** Lo que se sabe del destino antes de decidir con qué abrirlo */
export interface Destino { carpeta: boolean; paquete?: boolean; ejecutable?: boolean }

const esMac = (p: Plataforma) => p === 'darwin';
const APP = 'work-shelter-public';

/** Un ejecutable del PATH (o una ruta absoluta ejecutable), sin pasar por `which` */
export function enPath(nombre: string, ruta = process.env.PATH ?? ''): string | null {
  if (!nombre) return null;
  const candidatos = nombre.includes('/') ? (path.isAbsolute(nombre) ? [nombre] : []) : ruta.split(path.delimiter).filter(d => path.isAbsolute(d)).map(d => path.join(d, nombre));
  for (const c of candidatos) try { accessSync(c, constants.X_OK); if (statSync(c).isFile()) return c; } catch {}
  return null;
}
const buscarEnPath: Buscador = n => enPath(n);

// ---------------------------------------------------------------- datos de la app
/** Carpeta de datos de la app fuera del repo: Application Support en macOS; `$XDG_DATA_HOME` (o ~/.local/share) en Linux */
export function raizDatos(p: Plataforma = process.platform, env: Entorno = process.env, casa = os.homedir()) {
  if (esMac(p)) return path.join(casa, 'Library', 'Application Support', APP);
  // la especificación XDG manda ignorar una ruta relativa
  const xdg = env.XDG_DATA_HOME;
  return path.join(xdg && path.isAbsolute(xdg) ? xdg : path.join(casa, '.local', 'share'), APP);
}

// ---------------------------------------------------------------- direcciones (OAuth)
/** El navegador del sistema con una dirección http o https (cualquier otro esquema podría abrir o ejecutar algo local) */
export function ordenAbrirUrl(url: string, p: Plataforma = process.platform): Orden {
  let u: URL;
  try { u = new URL(url); } catch { throw new Error('Esa dirección no es válida.'); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('Solo se abren direcciones http o https.');
  return esMac(p) ? { bin: '/usr/bin/open', args: [url] } : { bin: 'xdg-open', args: [url] };
}
/** Abre la dirección en el navegador sin esperar (si no hay con qué, quien llama ya la enseña para copiarla) */
export function abrirUrl(url: string) {
  let o: Orden;
  try { o = ordenAbrirUrl(url); } catch { return; }
  execFile(o.bin, o.args, () => {});
}

// ---------------------------------------------------------------- revelar en el gestor de archivos
/** URI de archivo para FileManager1: dbus-send parte los arrays por las comas, así que también van escapadas */
export const uriParaGestor = (abs: string) => pathToFileURL(abs).href.replace(/,/g, '%2C');
/** Enseñar un archivo o carpeta sin abrirlo: `open -R`; en Linux, el gestor de archivos por D-Bus y, si no, su carpeta */
export function ordenesRevelar(abs: string, p: Plataforma = process.platform): Orden[] {
  if (esMac(p)) return [{ bin: 'open', args: ['-R', abs] }];
  // --print-reply espera la respuesta: sin él, dbus-send sale bien aunque nadie atienda FileManager1 y no habría respaldo
  return [
    { bin: 'dbus-send', args: ['--session', '--print-reply', '--reply-timeout=8000', '--dest=org.freedesktop.FileManager1', '--type=method_call', '/org/freedesktop/FileManager1', 'org.freedesktop.FileManager1.ShowItems', `array:string:${uriParaGestor(abs)}`, 'string:'] },
    { bin: 'xdg-open', args: [path.dirname(abs)] },
  ];
}

// ---------------------------------------------------------------- editor
/** Editores de Linux, por preferencia (zeditor es el nombre de Zed en algunas distribuciones) */
export const EDITORES_LINUX = ['zed', 'zeditor', 'cursor', 'code'] as const;
export const editorLinux = (buscar: Buscador = buscarEnPath) => EDITORES_LINUX.map(e => buscar(e)).find((r): r is string => !!r) ?? null;
const EDITORES_MAC = [['/Applications/Cursor.app', 'Cursor'], ['/Applications/Visual Studio Code.app', 'Visual Studio Code']] as const;
const editorMac = (existe: (r: string) => boolean = existsSync) => EDITORES_MAC.find(([ruta]) => existe(ruta))?.[1] ?? null;

// sin editor, en Linux solo se le da a xdg-open texto plano que no sea ejecutable: un .sh, un .desktop, un AppImage o
// un .html irían a su app por defecto, que puede ejecutarlos (en macOS `open -t` fuerza el editor de texto)
const TEXTO_PLANO = /\.(txt|md|markdown|json|jsonl|csv|tsv|log|ya?ml|toml|ini|conf|diff|patch)$/i;
/** Un archivo o carpeta en el editor; sin editor, el de texto (macOS) o texto plano con xdg-open; lo demás, revelado */
export function ordenesEditor(real: string, d: Destino, p: Plataforma = process.platform, o: Deteccion = {}): Orden[] {
  if (esMac(p)) {
    const editor = editorMac(o.existe);
    if (d.carpeta && (d.paquete || !editor)) return ordenesRevelar(real, p);
    return [{ bin: 'open', args: editor ? ['-a', editor, real] : ['-t', real] }];
  }
  const editor = editorLinux(o.buscar);
  if (editor) return [{ bin: editor, args: [real] }];
  if (!d.carpeta && !d.ejecutable && TEXTO_PLANO.test(real)) return [{ bin: 'xdg-open', args: [real] }];
  return ordenesRevelar(real, p);
}

// ---------------------------------------------------------------- adjuntos
const DE_VISTA_PREVIA = /\.(png|jpe?g|gif|webp|heic|heif|bmp|tiff?|pdf)$/i;
const DE_TEXTO = /\.(txt|md|markdown|json|jsonl|csv|tsv|log|ya?ml|toml|ini|conf|xml|html?|css|[cm]?[jt]sx?|py|rb|go|rs|java|kt|swift|c|h|cc|cpp|hpp|sh|zsh|sql|diff|patch)$/i;
// en Linux los scripts de shell no cuentan como texto de adjunto: sin editor, enseñados
const DE_TEXTO_LINUX = /\.(txt|md|markdown|json|jsonl|csv|tsv|log|ya?ml|toml|ini|conf|xml|html?|css|[cm]?[jt]sx?|py|rb|go|rs|java|kt|swift|c|h|cc|cpp|hpp|sql|diff|patch)$/i;
/** Adjuntos: imágenes y PDF en su visor, texto en el editor; lo demás (.docx, .zip, .desktop…), solo revelado */
export function ordenesAdjunto(real: string, d: Destino, p: Plataforma = process.platform, o: Deteccion = {}): Orden[] {
  if (d.carpeta) return ordenesRevelar(real, p);
  if (esMac(p)) return [{ bin: 'open', args: DE_VISTA_PREVIA.test(real) ? ['-a', 'Preview', real] : DE_TEXTO.test(real) ? ['-t', real] : ['-R', real] }];
  if (DE_VISTA_PREVIA.test(real) && !d.ejecutable) return [{ bin: 'xdg-open', args: [real] }];
  if (DE_TEXTO_LINUX.test(real)) return ordenesEditor(real, d, p, o);
  return ordenesRevelar(real, p);
}

// ---------------------------------------------------------------- papelera
/** A la papelera (recuperable): /usr/bin/trash o el Finder en macOS; `gio trash` en Linux. Sin gio, null: nunca borrar */
export function ordenPapelera(abs: string[], p: Plataforma = process.platform, o: Deteccion = {}): Orden | null {
  if (esMac(p)) {
    if ((o.existe ?? existsSync)('/usr/bin/trash')) return { bin: '/usr/bin/trash', args: abs };
    // macOS anteriores a /usr/bin/trash: el Finder
    return { bin: 'osascript', args: ['-e', `tell application "Finder" to delete {${abs.map(a => `POSIX file ${JSON.stringify(a)}`).join(', ')}}`] };
  }
  const gio = (o.buscar ?? buscarEnPath)('gio');
  return gio ? { bin: gio, args: ['trash', '--', ...abs] } : null;
}

// ---------------------------------------------------------------- terminal y carpetas de sala
/** Una terminal abierta en `dir`: Terminal en macOS; en Linux la primera que haya ($TERMINAL primero), o null */
export function ordenTerminal(dir: string, p: Plataforma = process.platform, o: Deteccion = {}): Orden | null {
  if (esMac(p)) return { bin: 'open', args: ['-a', 'Terminal', dir] };
  const buscar = o.buscar ?? buscarEnPath, env = o.env ?? process.env;
  // $TERMINAL y xdg-terminal-exec no tienen una opción común para la carpeta: la toman del cwd
  const candidatas: [string | undefined, string[]][] = [[env.TERMINAL, []], ['xdg-terminal-exec', []], ['konsole', ['--workdir', dir]], ['gnome-terminal', [`--working-directory=${dir}`]]];
  for (const [nombre, args] of candidatas) { const bin = nombre ? buscar(nombre) : null; if (bin) return { bin, args, cwd: dir }; }
  return null;
}
/** Una carpeta de sala en el gestor de archivos ('finder'), la terminal o el editor */
export function ordenesAbrirEn(app: 'finder' | 'terminal' | 'editor', dir: string, d: { paquete: boolean }, p: Plataforma = process.platform, o: Deteccion = {}): Orden[] {
  if (app === 'terminal') {
    const t = ordenTerminal(dir, p, o);
    if (!t) throw new Error('No encuentro ninguna terminal: instala una (Konsole, GNOME Terminal…) o pon su nombre en la variable TERMINAL.');
    return [t];
  }
  if (esMac(p)) {
    if (app === 'finder') return [{ bin: 'open', args: d.paquete ? ['-R', dir] : [dir] }];
    const existe = o.existe ?? existsSync;
    return [{ bin: 'open', args: existe('/Applications/Cursor.app') ? ['-a', 'Cursor', dir] : existe('/Applications/Visual Studio Code.app') ? ['-a', 'Visual Studio Code', dir] : ['-a', 'TextEdit', dir] }];
  }
  const editor = app === 'editor' ? editorLinux(o.buscar) : null;
  return [editor ? { bin: editor, args: [dir] } : { bin: 'xdg-open', args: [dir] }];
}

/** Lanza la primera orden; si hay respaldo, espera a que salga bien y si no, prueba la siguiente. La última, suelta. */
export function lanzar(ordenes: Orden[]) {
  const [o, ...resto] = ordenes;
  if (!o) return;
  // sin listener de 'error', un programa que no existe tumbaría el servidor
  if (!resto.length) { spawn(o.bin, o.args, { detached: true, stdio: 'ignore', cwd: o.cwd }).on('error', () => {}).unref(); return; }
  execFile(o.bin, o.args, { timeout: 10_000, cwd: o.cwd }, err => { if (err) lanzar(resto); });
}

// ---------------------------------------------------------------- shell y sockets
/** El shell del usuario: $SHELL, el de su cuenta o, en último caso, sh */
export function shellDelUsuario(env: Entorno = process.env) {
  if (env.SHELL) return env.SHELL;
  try { const s = os.userInfo().shell; if (s) return s; } catch {}
  return '/bin/sh';
}
/** El shell de las terminales del juego */
export const shellInteractivo = (p: Plataforma = process.platform, env: Entorno = process.env) => (esMac(p) ? env.SHELL || '/bin/zsh' : shellDelUsuario(env));
/** Preguntar a un shell de login dónde está `claude` (lo que haya puesto el usuario en su perfil) */
export const ordenBuscarClaude = (p: Plataforma, shell: string): Orden => ({ bin: esMac(p) ? '/bin/zsh' : shell, args: ['-lc', 'command -v claude'] });
/** La ruta de `claude`: en Linux, primero el PATH heredado; si no, el shell de login */
export function buscarClaude(p: Plataforma = process.platform): string | undefined {
  if (!esMac(p)) { const r = enPath('claude'); if (r) return r; }
  const o = ordenBuscarClaude(p, shellDelUsuario());
  try { return execFileSync(o.bin, o.args, { encoding: 'utf8', timeout: 5000 }).trim() || undefined; } catch { return undefined; }
}
/** Carpeta de los sockets Unix: la temporal en macOS (ya es privada); en Linux, $XDG_RUNTIME_DIR (privada) si la hay */
export function carpetaSockets(p: Plataforma = process.platform, env: Entorno = process.env, existe: (r: string) => boolean = existsSync) {
  const xdg = env.XDG_RUNTIME_DIR;
  return !esMac(p) && xdg && path.isAbsolute(xdg) && existe(xdg) ? xdg : os.tmpdir();
}
