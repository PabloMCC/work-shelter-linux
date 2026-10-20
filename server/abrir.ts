// Abrir cosas del refugio sin ejecutar nada por el camino. Abrir un archivo con la app por defecto de su tipo puede ser
// ejecutarlo: en macOS un .app, .command, .terminal, .tool, .fileloc, .webloc, .workflow o .pkg de un repo clonado (o de
// un adjunto); en Linux un .desktop, un AppImage o un script con permiso de ejecución. Por eso: el editor (Cursor o VS
// Code; en Linux también Zed) si lo hay; si no, el editor de texto del sistema (`open -t`, o en Linux xdg-open solo con
// texto plano no ejecutable) y, para lo demás, el gestor de archivos, que solo lo enseña (plataforma.ts). Y antes de
// nada, la ruta real (con los enlaces resueltos) tiene que seguir dentro de la raíz que toca.
import fs from 'node:fs/promises';
import path from 'node:path';
import { lanzar, ordenesAdjunto, ordenesEditor } from './plataforma.ts';

/** La ruta real de `abs`, que tiene que caer dentro de la ruta real de `raiz` */
export async function realDentro(raiz: string, abs: string) {
  const [r, a] = await Promise.all([fs.realpath(raiz), fs.realpath(abs)]);
  if (a !== r && !a.startsWith(r + path.sep)) throw new Error('Esa ruta sale de la carpeta de la sala.');
  return a;
}
// paquetes: carpetas que el Finder trata como un archivo (abrirlas puede ejecutarlas)
const PAQUETE = /\.(app|bundle|framework|plugin|kext|prefpane|appex|xpc|workflow|action|saver|qlgenerator|mdimporter|pkg|mpkg|xcodeproj|xcworkspace|playground)$/i;
export const esPaquete = (ruta: string) => PAQUETE.test(ruta.replace(/\/+$/, ''));

// con permiso de ejecución (en Linux, xdg-open podría lanzarlo en vez de enseñarlo)
const ejecutable = (st: { mode: number }) => (st.mode & 0o111) !== 0;

/** Un archivo o carpeta de `raiz` en el editor; sin editor, el de texto del sistema (carpetas y paquetes: revelados) */
export async function abrirEnEditor(raiz: string, abs: string) {
  const real = await realDentro(raiz, abs), st = await fs.stat(real);
  lanzar(ordenesEditor(real, { carpeta: st.isDirectory(), paquete: esPaquete(real), ejecutable: ejecutable(st) }));
}

// adjuntos: imágenes y PDF en su visor (Vista Previa en macOS), texto en el editor; lo demás (un .docx, un .zip, un
// .command, un .desktop…), enseñado en el gestor de archivos para que lo abra el Supervisor sabiendo qué es
export async function abrirAdjunto(raiz: string, abs: string) {
  const real = await realDentro(raiz, abs), st = await fs.stat(real);
  lanzar(ordenesAdjunto(real, { carpeta: !st.isFile(), ejecutable: ejecutable(st) }));
}
