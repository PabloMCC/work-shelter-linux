// Contrato de plataforma.ts: las órdenes de macOS y de Linux se comprueban a la vez, con la plataforma explícita, así
// que este test da lo mismo en un runner de macOS que en uno de Linux. Ninguno lanza procesos de verdad.
import { describe, it, expect, vi } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import {
  raizDatos, ordenAbrirUrl, ordenesRevelar, uriParaGestor, ordenesEditor, ordenesAdjunto, ordenPapelera,
  ordenTerminal, editorLinux, carpetaSockets, ordenBuscarClaude, ordenesAbrirEn, shellInteractivo, EDITORES_LINUX,
  lanzar, type Orden,
} from './plataforma.ts';

const CASA = '/home/alguien';
const nada = () => null;
// un PATH falso: solo están los programas de la lista (devuelve su ruta en /x)
const conPath = (...hay: string[]) => (n: string) => (hay.includes(n) ? `/x/${n}` : null);
// el instalador oficial de Zed deja ~/.local/bin/zed como enlace a zed.app/bin/zed, junto a zed.app/libexec/zed-editor
const ZED_APP = '/home/alguien/.local/zed.app';
const zedOficial = { real: (r: string) => (r === '/x/zed' ? `${ZED_APP}/bin/zed` : r), existe: (r: string) => r === `${ZED_APP}/libexec/zed-editor` };
// el zed de zfs-utils (el demonio de eventos de ZFS): un binario suelto en /usr/bin, sin libexec/zed-editor al lado
const zedDeZfs = { real: (r: string) => (r === '/x/zed' ? '/usr/bin/zed' : r), existe: () => false };

describe('raíz de datos', () => {
  it('macOS: Application Support, como siempre', () => {
    expect(raizDatos('darwin', { XDG_DATA_HOME: '/otra' }, CASA)).toBe(path.join(CASA, 'Library', 'Application Support', 'work-shelter-public'));
  });
  it('Linux: XDG_DATA_HOME si es absoluta; si no, ~/.local/share', () => {
    expect(raizDatos('linux', { XDG_DATA_HOME: '/datos' }, CASA)).toBe('/datos/work-shelter-public');
    expect(raizDatos('linux', { XDG_DATA_HOME: 'relativa/datos' }, CASA)).toBe(path.join(CASA, '.local', 'share', 'work-shelter-public'));
    expect(raizDatos('linux', {}, CASA)).toBe(path.join(CASA, '.local', 'share', 'work-shelter-public'));
  });
});

describe('abrir una dirección (OAuth)', () => {
  it('open en macOS, xdg-open en Linux', () => {
    expect(ordenAbrirUrl('https://login.example.com/a?b=1', 'darwin')).toEqual({ bin: '/usr/bin/open', args: ['https://login.example.com/a?b=1'] });
    expect(ordenAbrirUrl('http://127.0.0.1:9/x', 'linux')).toEqual({ bin: 'xdg-open', args: ['http://127.0.0.1:9/x'] });
  });
  it('solo http y https', () => {
    for (const p of ['darwin', 'linux'] as const) {
      expect(() => ordenAbrirUrl('file:///etc/passwd', p)).toThrow();
      expect(() => ordenAbrirUrl('javascript:alert(1)', p)).toThrow();
      expect(() => ordenAbrirUrl('no es una url', p)).toThrow();
    }
  });
});

describe('revelar', () => {
  it('macOS: open -R', () => {
    expect(ordenesRevelar('/a/b c.txt', 'darwin')).toEqual([{ bin: 'open', args: ['-R', '/a/b c.txt'] }]);
  });
  it('Linux: FileManager1 por D-Bus con la URI escapada (comas incluidas) y, si falla, la carpeta con xdg-open', () => {
    const [dbus, respaldo] = ordenesRevelar('/datos/mi carpeta/a,b.txt', 'linux');
    expect(dbus.bin).toBe('dbus-send');
    expect(dbus.args).toContain('--session');
    expect(dbus.args).toContain('--dest=org.freedesktop.FileManager1');
    expect(dbus.args).toContain('org.freedesktop.FileManager1.ShowItems');
    expect(dbus.args).toContain('array:string:file:///datos/mi%20carpeta/a%2Cb.txt');
    expect(dbus.args.at(-1)).toBe('string:');
    expect(respaldo).toEqual({ bin: 'xdg-open', args: ['/datos/mi carpeta'] });
  });
  it('la URI no deja comas sueltas (dbus-send parte el array por ellas)', () => {
    expect(uriParaGestor('/a,b/c,d')).toBe('file:///a%2Cb/c%2Cd');
  });
});

describe('editor', () => {
  it('Linux: zeditor, luego zed (solo el de Zed), cursor y code', () => {
    expect(EDITORES_LINUX).toEqual(['zeditor', 'zed', 'cursor', 'code']);
    expect(editorLinux({ buscar: conPath('code', 'cursor', 'zeditor', 'zed'), ...zedOficial })).toBe('/x/zeditor');
    expect(editorLinux({ buscar: conPath('code', 'cursor', 'zed'), ...zedOficial })).toBe('/x/zed');
    expect(editorLinux({ buscar: conPath('code', 'cursor') })).toBe('/x/cursor');
    expect(editorLinux({ buscar: conPath('code') })).toBe('/x/code');
    expect(editorLinux({ buscar: nada })).toBeNull();
  });
  it('Linux: el zed del demonio de ZFS nunca se lanza como editor', () => {
    expect(editorLinux({ buscar: conPath('code', 'cursor', 'zed'), ...zedDeZfs })).toBe('/x/cursor');
    expect(editorLinux({ buscar: conPath('code', 'zed'), ...zedDeZfs })).toBe('/x/code');
    expect(editorLinux({ buscar: conPath('zed'), ...zedDeZfs })).toBeNull();
    // si no se puede resolver el enlace, tampoco
    expect(editorLinux({ buscar: conPath('zed'), real: () => { throw new Error('ENOENT'); }, existe: () => true })).toBeNull();
    expect(ordenesEditor('/r/a.ts', { carpeta: false }, 'linux', { buscar: conPath('zed'), ...zedDeZfs })[0].bin).toBe('dbus-send');
  });
  it('Linux con editor: el archivo o la carpeta en el editor', () => {
    const o = { buscar: conPath('code') };
    expect(ordenesEditor('/r/a.ts', { carpeta: false }, 'linux', o)).toEqual([{ bin: '/x/code', args: ['/r/a.ts'] }]);
    expect(ordenesEditor('/r', { carpeta: true }, 'linux', o)).toEqual([{ bin: '/x/code', args: ['/r'] }]);
  });
  it('Linux sin editor: texto plano con xdg-open; lo demás (y lo ejecutable), solo enseñado', () => {
    expect(ordenesEditor('/r/notas.md', { carpeta: false }, 'linux', { buscar: nada })).toEqual([{ bin: 'xdg-open', args: ['/r/notas.md'] }]);
    expect(ordenesEditor('/r/notas.md', { carpeta: false, ejecutable: true }, 'linux', { buscar: nada })[0].bin).toBe('dbus-send');
    expect(ordenesEditor('/r/x.desktop', { carpeta: false }, 'linux', { buscar: nada })[0].bin).toBe('dbus-send');
    expect(ordenesEditor('/r', { carpeta: true }, 'linux', { buscar: nada })[0].bin).toBe('dbus-send');
  });
  it('macOS: Cursor o VS Code; sin ellos, open -t; carpetas sin editor y paquetes, en el Finder', () => {
    const cursor = (r: string) => r === '/Applications/Cursor.app';
    expect(ordenesEditor('/r/a.ts', { carpeta: false }, 'darwin', { existe: cursor })).toEqual([{ bin: 'open', args: ['-a', 'Cursor', '/r/a.ts'] }]);
    expect(ordenesEditor('/r/a.ts', { carpeta: false }, 'darwin', { existe: () => false })).toEqual([{ bin: 'open', args: ['-t', '/r/a.ts'] }]);
    expect(ordenesEditor('/r', { carpeta: true }, 'darwin', { existe: () => false })).toEqual([{ bin: 'open', args: ['-R', '/r'] }]);
    expect(ordenesEditor('/r/X.app', { carpeta: true, paquete: true }, 'darwin', { existe: cursor })).toEqual([{ bin: 'open', args: ['-R', '/r/X.app'] }]);
  });
});

describe('adjuntos', () => {
  it('macOS: imágenes y PDF en Vista Previa, texto con open -t, lo demás en el Finder', () => {
    expect(ordenesAdjunto('/a/f.png', { carpeta: false }, 'darwin')).toEqual([{ bin: 'open', args: ['-a', 'Preview', '/a/f.png'] }]);
    expect(ordenesAdjunto('/a/f.pdf', { carpeta: false }, 'darwin')).toEqual([{ bin: 'open', args: ['-a', 'Preview', '/a/f.pdf'] }]);
    expect(ordenesAdjunto('/a/f.sh', { carpeta: false }, 'darwin')).toEqual([{ bin: 'open', args: ['-t', '/a/f.sh'] }]);
    expect(ordenesAdjunto('/a/f.docx', { carpeta: false }, 'darwin')).toEqual([{ bin: 'open', args: ['-R', '/a/f.docx'] }]);
    expect(ordenesAdjunto('/a/d', { carpeta: true }, 'darwin')).toEqual([{ bin: 'open', args: ['-R', '/a/d'] }]);
  });
  it('Linux: imágenes y PDF con xdg-open; .desktop, .sh o AppImage nunca, solo enseñados', () => {
    expect(ordenesAdjunto('/a/f.png', { carpeta: false }, 'linux', { buscar: nada })).toEqual([{ bin: 'xdg-open', args: ['/a/f.png'] }]);
    expect(ordenesAdjunto('/a/f.PDF', { carpeta: false }, 'linux', { buscar: nada })).toEqual([{ bin: 'xdg-open', args: ['/a/f.PDF'] }]);
    for (const f of ['/a/x.desktop', '/a/x.sh', '/a/x.AppImage', '/a/x.docx']) expect(ordenesAdjunto(f, { carpeta: false }, 'linux', { buscar: nada })[0].bin).toBe('dbus-send');
    expect(ordenesAdjunto('/a/x.desktop', { carpeta: false }, 'linux', { buscar: conPath('zed') })[0].bin).toBe('dbus-send');
    expect(ordenesAdjunto('/a/f.png', { carpeta: false, ejecutable: true }, 'linux', { buscar: nada })[0].bin).toBe('dbus-send');
  });
  it('Linux: el texto en el editor si lo hay', () => {
    expect(ordenesAdjunto('/a/f.json', { carpeta: false }, 'linux', { buscar: conPath('cursor') })).toEqual([{ bin: '/x/cursor', args: ['/a/f.json'] }]);
  });
});

describe('extensiones de texto', () => {
  const editor = { buscar: conPath('code') };
  it('macOS: los scripts de shell también son texto de adjunto', () => {
    for (const f of ['/a/f.sh', '/a/f.zsh', '/a/f.tsx', '/a/f.mjs', '/a/f.yml', '/a/f.htm', '/a/f.patch']) expect(ordenesAdjunto(f, { carpeta: false }, 'darwin')).toEqual([{ bin: 'open', args: ['-t', f] }]);
    for (const f of ['/a/f.docx', '/a/f.desktop', '/a/f.shx']) expect(ordenesAdjunto(f, { carpeta: false }, 'darwin')[0].args[0]).toBe('-R');
  });
  it('Linux: el mismo texto de adjunto salvo los scripts de shell', () => {
    for (const f of ['/a/f.ts', '/a/f.cts', '/a/f.yaml', '/a/f.html', '/a/f.sql', '/a/f.diff']) expect(ordenesAdjunto(f, { carpeta: false }, 'linux', editor)).toEqual([{ bin: '/x/code', args: [f] }]);
    for (const f of ['/a/f.sh', '/a/f.zsh', '/a/f.SH']) expect(ordenesAdjunto(f, { carpeta: false }, 'linux', editor)[0].bin).toBe('dbus-send');
  });
  it('Linux sin editor: a xdg-open solo el texto plano, nunca código ni html', () => {
    for (const f of ['/a/f.txt', '/a/f.yml', '/a/f.jsonl', '/a/f.conf', '/a/f.patch']) expect(ordenesEditor(f, { carpeta: false }, 'linux', { buscar: nada })).toEqual([{ bin: 'xdg-open', args: [f] }]);
    for (const f of ['/a/f.html', '/a/f.js', '/a/f.xml', '/a/f.sh', '/a/f.py']) expect(ordenesEditor(f, { carpeta: false }, 'linux', { buscar: nada })[0].bin).toBe('dbus-send');
  });
});

describe('papelera', () => {
  it('macOS: /usr/bin/trash o, si no está, el Finder', () => {
    expect(ordenPapelera(['/a', '/b'], 'darwin', { existe: () => true })).toEqual({ bin: '/usr/bin/trash', args: ['/a', '/b'] });
    expect(ordenPapelera(['/a "x"'], 'darwin', { existe: () => false })).toEqual({ bin: 'osascript', args: ['-e', 'tell application "Finder" to delete {POSIX file "/a \\"x\\""}'] });
  });
  it('Linux: gio trash; sin gio, ninguna orden (nunca se borra para siempre)', () => {
    expect(ordenPapelera(['/a', '-b'], 'linux', { buscar: conPath('gio') })).toEqual({ bin: '/x/gio', args: ['trash', '--', '/a', '-b'] });
    expect(ordenPapelera(['/a'], 'linux', { buscar: nada })).toBeNull();
  });
});

describe('terminal en una carpeta', () => {
  it('macOS: Terminal', () => {
    expect(ordenTerminal('/r', 'darwin')).toEqual({ bin: 'open', args: ['-a', 'Terminal', '/r'] });
  });
  it('Linux: $TERMINAL, xdg-terminal-exec, konsole y gnome-terminal, por ese orden', () => {
    const todas = conPath('kitty', 'xdg-terminal-exec', 'konsole', 'gnome-terminal');
    expect(ordenTerminal('/r', 'linux', { env: { TERMINAL: 'kitty' }, buscar: todas })).toEqual({ bin: '/x/kitty', args: [], cwd: '/r' });
    expect(ordenTerminal('/r', 'linux', { env: {}, buscar: todas })).toEqual({ bin: '/x/xdg-terminal-exec', args: [], cwd: '/r' });
    expect(ordenTerminal('/r', 'linux', { env: {}, buscar: conPath('konsole', 'gnome-terminal') })).toEqual({ bin: '/x/konsole', args: ['--workdir', '/r'], cwd: '/r' });
    expect(ordenTerminal('/r', 'linux', { env: {}, buscar: conPath('gnome-terminal') })).toEqual({ bin: '/x/gnome-terminal', args: ['--working-directory=/r'], cwd: '/r' });
    expect(ordenTerminal('/r', 'linux', { env: { TERMINAL: 'no-esta' }, buscar: nada })).toBeNull();
  });
});

describe('abrir una carpeta de sala (Finder, Terminal, editor)', () => {
  it('macOS: lo de siempre', () => {
    expect(ordenesAbrirEn('finder', '/r', { paquete: false }, 'darwin')).toEqual([{ bin: 'open', args: ['/r'] }]);
    expect(ordenesAbrirEn('finder', '/r/X.app', { paquete: true }, 'darwin')).toEqual([{ bin: 'open', args: ['-R', '/r/X.app'] }]);
    expect(ordenesAbrirEn('editor', '/r', { paquete: false }, 'darwin', { existe: () => false })).toEqual([{ bin: 'open', args: ['-a', 'TextEdit', '/r'] }]);
    expect(ordenesAbrirEn('editor', '/r', { paquete: false }, 'darwin', { existe: r => r.includes('Visual Studio Code') })).toEqual([{ bin: 'open', args: ['-a', 'Visual Studio Code', '/r'] }]);
  });
  it('Linux: el gestor de archivos con xdg-open y el editor si lo hay (si no, la carpeta)', () => {
    expect(ordenesAbrirEn('finder', '/r', { paquete: false }, 'linux')).toEqual([{ bin: 'xdg-open', args: ['/r'] }]);
    expect(ordenesAbrirEn('editor', '/r', { paquete: false }, 'linux', { buscar: conPath('zeditor') })).toEqual([{ bin: '/x/zeditor', args: ['/r'] }]);
    expect(ordenesAbrirEn('editor', '/r', { paquete: false }, 'linux', { buscar: conPath('zed'), ...zedDeZfs })).toEqual([{ bin: 'xdg-open', args: ['/r'] }]);
    expect(ordenesAbrirEn('editor', '/r', { paquete: false }, 'linux', { buscar: nada })).toEqual([{ bin: 'xdg-open', args: ['/r'] }]);
  });
});

describe('shell y sockets', () => {
  it('buscar claude: zsh de login en macOS; el shell del usuario en Linux', () => {
    expect(ordenBuscarClaude('darwin', '/usr/bin/fish')).toEqual({ bin: '/bin/zsh', args: ['-lc', 'command -v claude'] });
    expect(ordenBuscarClaude('linux', '/usr/bin/fish')).toEqual({ bin: '/usr/bin/fish', args: ['-lc', 'command -v claude'] });
  });
  it('shell de las terminales: $SHELL; si falta, zsh en macOS y el del usuario (o sh) en Linux', () => {
    expect(shellInteractivo('darwin', { SHELL: '/bin/bash' })).toBe('/bin/bash');
    expect(shellInteractivo('darwin', {})).toBe('/bin/zsh');
    expect(shellInteractivo('linux', { SHELL: '/usr/bin/fish' })).toBe('/usr/bin/fish');
    expect(path.isAbsolute(shellInteractivo('linux', {}))).toBe(true);
  });
  it('sockets: XDG_RUNTIME_DIR en Linux si es absoluta y existe; si no (y en macOS), la temporal', () => {
    expect(carpetaSockets('linux', { XDG_RUNTIME_DIR: '/run/user/1000' }, () => true)).toBe('/run/user/1000');
    expect(carpetaSockets('linux', { XDG_RUNTIME_DIR: '/run/user/1000' }, () => false)).toBe(os.tmpdir());
    expect(carpetaSockets('linux', { XDG_RUNTIME_DIR: 'run/user' }, () => true)).toBe(os.tmpdir());
    expect(carpetaSockets('linux', {}, () => true)).toBe(os.tmpdir());
    expect(carpetaSockets('darwin', { XDG_RUNTIME_DIR: '/run/user/1000' }, () => true)).toBe(os.tmpdir());
  });
});

describe('lanzar con respaldo', () => {
  const a: Orden = { bin: 'a', args: ['1'] }, b: Orden = { bin: 'b', args: ['2'], cwd: '/r' };
  // un lanzador falso: esperar responde al momento con el resultado indicado por programa
  const falso = (falla: string[] = []) => ({
    esperar: vi.fn((o: Orden, cb: (err: Error | null) => void) => cb(falla.includes(o.bin) ? new Error('falló') : null)),
    soltar: vi.fn((_o: Orden) => {}),
  });
  it('si la primera falla, se lanza la siguiente', () => {
    const l = falso(['a']);
    lanzar([a, b], l);
    expect(l.esperar).toHaveBeenCalledWith(a, expect.any(Function));
    expect(l.soltar).toHaveBeenCalledExactlyOnceWith(b);
  });
  it('si la primera sale bien, el respaldo no se toca', () => {
    const l = falso();
    lanzar([a, b], l);
    expect(l.esperar).toHaveBeenCalledOnce();
    expect(l.soltar).not.toHaveBeenCalled();
  });
  it('una sola orden se suelta sin esperar; sin órdenes, nada', () => {
    const l = falso();
    lanzar([a], l);
    expect(l.soltar).toHaveBeenCalledExactlyOnceWith(a);
    expect(l.esperar).not.toHaveBeenCalled();
    const vacio = falso();
    lanzar([], vacio);
    expect(vacio.esperar).not.toHaveBeenCalled();
    expect(vacio.soltar).not.toHaveBeenCalled();
  });
});
