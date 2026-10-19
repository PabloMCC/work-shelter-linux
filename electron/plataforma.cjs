// Lo que la ventana (Electron) decide según el sistema, macOS o Linux: funciones puras, con la plataforma como parámetro
// (por defecto la de este proceso) para probar las dos en cualquier equipo (test/electron-plataforma.test.ts).
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const NOMBRE = 'work-shelter-public';

// los registros: ~/Library/Logs en macOS; en Linux, $XDG_STATE_HOME (~/.local/state si no está o no es absoluto)
function carpetaRegistros(plataforma = process.platform, env = process.env, casa = os.homedir()) {
  if (plataforma === 'darwin') return path.join(casa, 'Library/Logs', NOMBRE);
  const xdg = env.XDG_STATE_HOME;
  return path.join(xdg && path.isAbsolute(xdg) ? xdg : path.join(casa, '.local/state'), NOMBRE);
}

// el shell de inicio de quien usa el equipo: $SHELL, si no el de su cuenta y, si no, /bin/zsh en macOS y /bin/sh en Linux
function shellDeUsuario(env = process.env, info = null, plataforma = process.platform) {
  return env.SHELL || info?.shell || (plataforma === 'darwin' ? '/bin/zsh' : '/bin/sh');
}

// lo que se añade al PATH heredado: ~/.local/bin (Claude Code), en macOS las de Homebrew, y el Node portátil que descarga
// ./shelter en .runtime/ (solo el de este sistema: el de macOS en macOS y el de Linux en Linux)
function rutasExtra(plataforma = process.platform, casa = os.homedir(), repo, leer = fs.readdirSync) {
  const extra = [path.join(casa, '.local/bin')];
  if (plataforma === 'darwin') extra.push('/opt/homebrew/bin', '/usr/local/bin');
  const propio = n => new RegExp(`^node-.*-${plataforma === 'darwin' ? 'darwin' : 'linux'}-`).test(n);
  if (repo) { const rt = path.join(repo, '.runtime'); try { extra.push(...leer(rt).filter(propio).map(n => path.join(rt, n, 'bin'))); } catch {} }
  return extra;
}

// las teclas de ventana dentro de un navegador del refugio: con Command en macOS y con Control en Linux (sin la otra)
function atajoWebview(plataforma = process.platform, k = {}) {
  return plataforma === 'darwin' ? !!k.meta && !k.control : !!k.control && !k.meta;
}

// las teclas que el refugio coge con el foco dentro de un navegador, y su clase: las del refugio (la música, el
// buscador, minimizar y la barra) van con Ctrl+Mayús en Linux, porque Ctrl+J/K/M/B son de los editores de las webs; las
// de navegador (cerrar, recargar, atrás y adelante, zoom), con Ctrl. En macOS, todas con Command. La misma lista que la
// interfaz (web/src/ui/teclas.ts; test/electron-plataforma.test.ts comprueba que coinciden)
const ATAJOS = Object.freeze({
  KeyJ: 'refugio', KeyK: 'refugio', KeyM: 'refugio', KeyB: 'refugio',
  KeyW: 'navegador', KeyR: 'navegador', BracketLeft: 'navegador', BracketRight: 'navegador', Equal: 'navegador', Minus: 'navegador', Digit0: 'navegador',
});
// con una Mayús de más no valen atrás y adelante ni, en macOS, la música y el buscador (⌘⇧J y ⌘⇧K, a la página, como
// siempre). La misma regla que la interfaz (teclas.ts, atajoNavegador; el test recorre todas las combinaciones)
const sinMayusExtra = (code, mac) => code === 'BracketLeft' || code === 'BracketRight' || (mac && (code === 'KeyJ' || code === 'KeyK'));
// la tecla (su `code`) si la pulsación es uno de esos atajos; si no, null y va a la página
function atajoNavegador(plataforma = process.platform, k = {}) {
  const clase = ATAJOS[k.code];
  if (!clase || k.alt || !atajoWebview(plataforma, k)) return null;
  const mac = plataforma === 'darwin';
  if (!mac && clase === 'refugio' && !k.shift) return null;
  if (k.shift && sinMayusExtra(k.code, mac)) return null;
  return k.code;
}
// las que se reenvían a la interfaz (minimizar, cerrar y la barra); las demás las resuelve Electron. Una tecla nueva en
// ATAJOS no se reenvía hasta que se añada aquí
const REENVIADAS = Object.freeze(['KeyM', 'KeyW', 'KeyB']);
// lo que se reenvía a la interfaz (window.__atajoNavegador): los modificadores tal cual, para que su comprobación
// (teclas.ts) valga en los dos sistemas
const teclasReenviadas = k => ({ code: k.code, key: k.key, shiftKey: !!k.shift, ctrlKey: !!k.control, metaKey: !!k.meta });

// salir a la superficie: ⇧⌥⌘Esc en macOS, Mayús+Alt+Ctrl+Esc en Linux
const PANICO = 'Shift+Alt+CommandOrControl+Escape';
// en macOS esconde el juego y saca lo abierto a la superficie (iTerm o Terminal); en Linux eso aún no está y la tecla
// solo lo esconde (lo abierto sigue en el juego)
const panicoSacaASuperficie = (plataforma = process.platform) => plataforma === 'darwin';
const etiquetaPanico = (plataforma = process.platform) => (panicoSacaASuperficie(plataforma) ? 'Salir a la superficie' : 'Esconder el juego');

// fuera del juego solo se abren webs y correo: nada de file:, javascript: ni esquemas que lanzan otras apps
const EXTERNOS = ['http:', 'https:', 'mailto:'];
function esEnlaceExterno(u) {
  if (typeof u !== 'string') return false;
  try { return EXTERNOS.includes(new URL(u).protocol); } catch { return false; }
}

// la identidad de la ventana en Linux: el nombre del .desktop del menú (scripts/instalar-app-linux.mjs y `desktopName` de
// package.json). Electron lo usa como app_id en Wayland y como WM_CLASS en X11, y así el escritorio le pone su icono y la
// agrupa con su entrada. Lanzado como `electron electron/main.cjs` no lee el package.json del repo (se quedaría con el
// de Electron), así que main.cjs lo fija. En macOS no hace falta: la identidad la da la app
const nombreEscritorio = (plataforma = process.platform) => (plataforma === 'linux' ? `${NOMBRE}.desktop` : null);

// otro arranque (./shelter con el servidor ya abierto) pasa su dirección a la ventana que ya está: solo se acepta la del
// servidor local del juego (http://127.0.0.1:<puerto>/)
function urlDelServidorLocal(u) {
  if (typeof u !== 'string') return false;
  try { const x = new URL(u); return x.protocol === 'http:' && x.hostname === '127.0.0.1' && x.pathname === '/'; } catch { return false; }
}

module.exports = { nombreEscritorio, urlDelServidorLocal, carpetaRegistros, shellDeUsuario, rutasExtra, atajoWebview, ATAJOS, atajoNavegador, REENVIADAS, teclasReenviadas, PANICO, panicoSacaASuperficie, etiquetaPanico, esEnlaceExterno };
