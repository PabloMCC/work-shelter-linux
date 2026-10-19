// El acceso en el menú de aplicaciones de Linux (scripts/instalar-app-linux.mjs): siempre en un XDG_DATA_HOME temporal,
// nunca en el ~/.local/share de quien prueba. Los programas que refrescan la caché del menú son de mentira (apuntan sus
// argumentos), así que no se toca nada del escritorio de verdad. SHELTER_COMO_LINUX deja ejecutarlo en el runner de
// macOS. No se abre Electron ni se ejecuta ./shelter.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import sharp from 'sharp';

type Rutas = { escritorio: string; apps: string; hicolor: string; iconos: { tamano: number; ruta: string }[] };
type Ejecutar = (orden: string, args: string[]) => boolean;
type Modulo = {
  ID: string; TAMANOS: number[];
  carpetaDatos(env: Record<string, string | undefined>, casa: string): string;
  rutas(datos: string): Rutas;
  argumentoExec(s: string): string;
  valorCadena(s: string): string;
  entradaEscritorio(raiz: string): string;
  instalar(o: { raiz: string; datos: string; ejecutar?: Ejecutar }): Promise<Rutas>;
  desinstalar(o: { datos: string; ejecutar?: Ejecutar }): string[];
};

const RAIZ = path.resolve(__dirname, '..');
const SCRIPT = path.join(RAIZ, 'scripts', 'instalar-app-linux.mjs');
const m = (await import(pathToFileURL(SCRIPT).href)) as Modulo;
const hayValidador = spawnSync('desktop-file-validate', ['--help'], { stdio: 'ignore' }).status === 0;

let dir = ''; let datos = ''; let repo = ''; let llamadas: string[][] = [];
const ejecutar: Ejecutar = (orden, args) => { llamadas.push([orden, ...args]); return true; };
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'menu-prueba-'));
  datos = path.join(dir, 'datos');
  // un repo con espacios, %, comillas, $ y acento grave en la ruta: lo peor que puede pasarle a una línea Exec
  repo = path.join(dir, 'mi repo %u "x" $HOME `y`');
  mkdirSync(path.join(repo, 'electron', 'icono'), { recursive: true });
  copyFileSync(path.join(RAIZ, 'electron', 'icono', 'icono.png'), path.join(repo, 'electron', 'icono', 'icono.png'));
  writeFileSync(path.join(repo, 'shelter'), '#!/bin/bash\n'); chmodSync(path.join(repo, 'shelter'), 0o755);
  llamadas = [];
});
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

// lee una línea Exec como un lanzador según la especificación Desktop Entry: primero los escapes de las cadenas (\\ y \s…),
// luego los argumentos entre comillas (\" \` \$ \\) y por último los códigos de campo (%% es un %)
function leerExec(valor: string): string[] {
  const cadena = valor.replace(/\\([\\stnr])/g, (_t, c: string) => ({ '\\': '\\', s: ' ', t: '\t', n: '\n', r: '\r' })[c]!);
  const args: string[] = []; let i = 0;
  while (i < cadena.length) {
    if (cadena[i] === ' ') { i++; continue; }
    let arg = '';
    if (cadena[i] === '"') {
      for (i++; cadena[i] !== '"'; i++) {
        if (i >= cadena.length) throw new Error('comillas sin cerrar');
        if (cadena[i] === '\\') { i++; expect('"`$\\').toContain(cadena[i]); }
        else expect('`$').not.toContain(cadena[i]);
        arg += cadena[i];
      }
      i++;
    } else { for (; i < cadena.length && cadena[i] !== ' '; i++) arg += cadena[i]; }
    args.push(arg.replace(/%(.)/g, (_t, c: string) => { expect(c).toBe('%'); return '%'; }));
  }
  return args;
}
const claves = (texto: string) => Object.fromEntries(texto.split('\n').filter(l => l.includes('=')).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));

describe('funciones puras', () => {
  it('carpetaDatos: XDG_DATA_HOME si es absoluto; si no, ~/.local/share', () => {
    expect(m.carpetaDatos({ XDG_DATA_HOME: '/datos' }, '/casa')).toBe('/datos');
    for (const xdg of ['relativa', '', undefined]) expect(m.carpetaDatos({ XDG_DATA_HOME: xdg }, '/casa')).toBe('/casa/.local/share');
  });
  it('rutas: el .desktop con el id de la ventana y los cinco tamaños del icono en hicolor', () => {
    const r = m.rutas('/d');
    expect(m.ID).toBe('work-shelter-public');
    expect(r.escritorio).toBe('/d/applications/work-shelter-public.desktop');
    expect(r.apps).toBe('/d/applications'); expect(r.hicolor).toBe('/d/icons/hicolor');
    expect(r.iconos.map(i => i.tamano)).toEqual([48, 64, 128, 256, 512]);
    expect(r.iconos[0].ruta).toBe('/d/icons/hicolor/48x48/apps/work-shelter-public.png');
  });
  it('argumentoExec: entre comillas, con los escapes de la especificación (y el % doblado)', () => {
    expect(m.argumentoExec('/a b/shelter')).toBe('"/a b/shelter"');
    expect(m.argumentoExec('/a%b')).toBe('"/a%%b"');
    expect(m.argumentoExec('/a"b')).toBe('"/a\\\\"b"');
    expect(m.argumentoExec('/a$b`c')).toBe('"/a\\\\$b\\\\`c"');
    expect(m.argumentoExec('/a\\b')).toBe('"/a\\\\\\\\b"');   // una barra invertida de verdad son cuatro en el archivo
    for (const s of ['/a b/shelter', '/x/100% "q" $HOME `id` \\n/ñ', '/%%/%u']) expect(leerExec(m.argumentoExec(s))).toEqual([s]);
  });
  it('argumentoExec y valorCadena rechazan los caracteres de control (no se pueden poner en una línea)', () => {
    expect(() => m.argumentoExec('/a\nb')).toThrow(); expect(() => m.valorCadena('/a\tb')).toThrow();
    expect(m.valorCadena('/a\\b %u')).toBe('/a\\\\b %u');
  });
});

describe('la entrada del menú', () => {
  it('abre ./shelter de este repo desde el menú, con su carpeta, su icono y la clase de la ventana', () => {
    const texto = m.entradaEscritorio(repo);
    expect(texto.split('\n')[0]).toBe('[Desktop Entry]');
    const c = claves(texto);
    expect(c).toMatchObject({ Type: 'Application', Name: 'work-shelter', Icon: 'work-shelter-public', Terminal: 'false', Categories: 'Development;', StartupNotify: 'true', StartupWMClass: 'work-shelter-public' });
    expect(c.GenericName).toBe('Refugio para Claude Code'); expect(c.Comment).toBeTruthy();
    expect(leerExec(c.Exec)).toEqual(['env', 'SHELTER_DESDE_MENU=1', path.join(repo, 'shelter')]);
    expect(c.TryExec.replace(/\\\\/g, '\\')).toBe(path.join(repo, 'shelter'));
    expect(c.Path.replace(/\\\\/g, '\\')).toBe(repo);
  });
  it.runIf(hayValidador)('desktop-file-validate la da por buena (con la ruta difícil)', async () => {
    const r = await m.instalar({ raiz: repo, datos, ejecutar });
    const v = spawnSync('desktop-file-validate', [r.escritorio], { encoding: 'utf8' });
    expect(v.stdout + v.stderr).toBe(''); expect(v.status).toBe(0);
  });
});

describe('instalar y desinstalar', () => {
  it('escribe el .desktop y los cinco iconos del tamaño justo (con transparencia) y refresca el menú', async () => {
    const r = await m.instalar({ raiz: repo, datos, ejecutar });
    expect(readFileSync(r.escritorio, 'utf8')).toBe(m.entradaEscritorio(repo));
    expect(statSync(r.escritorio).mode & 0o777).toBe(0o644);
    for (const { tamano, ruta } of r.iconos) {
      const meta = await sharp(ruta).metadata();
      expect([meta.format, meta.width, meta.height, meta.hasAlpha]).toEqual(['png', tamano, tamano, true]);
    }
    expect(llamadas).toContainEqual(['update-desktop-database', r.apps]);
    expect(llamadas.some(l => l[0] === 'gtk-update-icon-cache')).toBe(false);   // sin index.theme en hicolor, no
    expect(llamadas).toContainEqual(['kbuildsycoca6']);
  });
  it('con un index.theme en su hicolor, también refresca la caché de iconos de GTK', async () => {
    mkdirSync(path.join(datos, 'icons', 'hicolor'), { recursive: true }); writeFileSync(path.join(datos, 'icons', 'hicolor', 'index.theme'), '[Icon Theme]\n');
    const r = await m.instalar({ raiz: repo, datos, ejecutar });
    expect(llamadas).toContainEqual(['gtk-update-icon-cache', '-q', '-t', r.hicolor]);
  });
  it('repetirlo deja exactamente los mismos archivos', async () => {
    const r = await m.instalar({ raiz: repo, datos, ejecutar });
    const foto = () => [r.escritorio, ...r.iconos.map(i => i.ruta)].map(f => readFileSync(f).toString('base64'));
    const antes = foto(); const lista = readdirSync(datos, { recursive: true }).sort();
    await m.instalar({ raiz: repo, datos, ejecutar });
    expect(foto()).toEqual(antes); expect(readdirSync(datos, { recursive: true }).sort()).toEqual(lista);
  });
  it('desinstalar quita solo lo suyo (no lo de al lado ni las carpetas) y refresca el menú', async () => {
    const r = await m.instalar({ raiz: repo, datos, ejecutar });
    const ajenos = [path.join(r.apps, 'otra.desktop'), path.join(r.hicolor, '48x48', 'apps', 'otra.png')];
    for (const f of ajenos) writeFileSync(f, 'ajeno');
    llamadas = [];
    const quitados = m.desinstalar({ datos, ejecutar });
    expect(quitados.sort()).toEqual([r.escritorio, ...r.iconos.map(i => i.ruta)].sort());
    for (const f of quitados) expect(existsSync(f)).toBe(false);
    for (const f of ajenos) expect(readFileSync(f, 'utf8')).toBe('ajeno');
    expect(existsSync(r.apps)).toBe(true);
    expect(llamadas).toContainEqual(['update-desktop-database', r.apps]);
    expect(m.desinstalar({ datos, ejecutar })).toEqual([]);   // otra vez: no hay nada que quitar
  });
});

describe('la orden (node scripts/instalar-app-linux.mjs)', () => {
  // programas de mentira para refrescar el menú; el PATH solo los tiene a ellos y a este Node
  const falsos = path.join(tmpdir(), `menu-falsos-${process.pid}`);
  const orden = (args: string[], conFalsos = true) => {
    mkdirSync(falsos, { recursive: true });
    for (const p of ['update-desktop-database', 'gtk-update-icon-cache', 'kbuildsycoca6']) {
      writeFileSync(path.join(falsos, p), `#!/bin/bash\nprintf '%s\\n' "${p} $*" >> "$REG"\n`); chmodSync(path.join(falsos, p), 0o755);
    }
    const env = { PATH: `${conFalsos ? `${falsos}:` : ''}${path.dirname(process.execPath)}:/usr/bin:/bin`, HOME: path.join(dir, 'casa'), XDG_DATA_HOME: datos, REG: path.join(dir, 'reg'), SHELTER_COMO_LINUX: '1' };
    const r = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', env });
    return { codigo: r.status, salida: r.stdout, error: r.stderr, reg: existsSync(env.REG) ? readFileSync(env.REG, 'utf8') : '' };
  };
  afterEach(() => { rmSync(falsos, { recursive: true, force: true }); });
  it('instala en XDG_DATA_HOME, dice dónde y cómo quitarlo, y desinstala', () => {
    const r = orden([]);
    expect(r.codigo).toBe(0); expect(r.error).toBe('');
    const escritorio = path.join(datos, 'applications', 'work-shelter-public.desktop');
    expect(r.salida).toContain(escritorio); expect(r.salida).toContain('./shelter desinstalar-app');
    expect(leerExec(claves(readFileSync(escritorio, 'utf8')).Exec).at(-1)).toBe(path.join(RAIZ, 'shelter'));
    expect(r.reg).toContain(`update-desktop-database ${path.join(datos, 'applications')}`);
    const d = orden(['--desinstalar']);
    expect(d.codigo).toBe(0); expect(existsSync(escritorio)).toBe(false); expect(d.salida).toContain(escritorio);
  });
  it('sin los programas de refresco, en silencio', () => {
    const r = orden([], false);
    expect(r.codigo).toBe(0); expect(r.error).toBe('');
  });
});

describe('una sola identidad: .desktop, package.json y la ventana', () => {
  const plataforma = createRequire(import.meta.url)('../electron/plataforma.cjs') as { nombreEscritorio(p: string): string | null };
  it('desktopName de package.json, el de electron/plataforma.cjs y el archivo instalado son el mismo', () => {
    const paquete = JSON.parse(readFileSync(path.join(RAIZ, 'package.json'), 'utf8')) as { desktopName?: string };
    expect(paquete.desktopName).toBe(`${m.ID}.desktop`);
    expect(plataforma.nombreEscritorio('linux')).toBe(`${m.ID}.desktop`);
    expect(path.basename(m.rutas('/d').escritorio)).toBe(paquete.desktopName);
    expect(claves(m.entradaEscritorio(repo)).StartupWMClass).toBe(m.ID);
  });
  it('electron/main.cjs fija el nombre antes de que Electron esté listo (antes de crear ninguna ventana)', () => {
    const t = readFileSync(path.join(RAIZ, 'electron', 'main.cjs'), 'utf8');
    const fija = t.indexOf('app.setDesktopName(');
    expect(fija).toBeGreaterThan(0); expect(fija).toBeLessThan(t.indexOf('app.whenReady()'));
  });
});
