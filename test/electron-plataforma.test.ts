// Lo que la ventana (Electron) decide según el sistema (electron/plataforma.cjs): funciones puras con la plataforma como
// parámetro, así que se prueban macOS y Linux en cualquier runner. No se abre Electron.
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { ATAJOS, atajoNavegador as atajoInterfaz } from '../web/src/ui/teclas';

type Entrada = { meta?: boolean; control?: boolean; shift?: boolean; alt?: boolean; code?: string; key?: string };
const p = createRequire(import.meta.url)('../electron/plataforma.cjs') as {
  carpetaRegistros(plataforma: string, env: Record<string, string | undefined>, casa: string): string;
  shellDeUsuario(env: Record<string, string | undefined>, info?: { shell?: string | null } | null, plataforma?: string): string;
  rutasExtra(plataforma: string, casa: string, repo?: string, leer?: (dir: string) => string[]): string[];
  atajoWebview(plataforma: string, entrada: Entrada): boolean;
  ATAJOS: Record<string, string>;
  atajoNavegador(plataforma: string, entrada: Entrada): string | null;
  REENVIADAS: readonly string[];
  teclasReenviadas(entrada: Entrada): { code?: string; key?: string; shiftKey: boolean; ctrlKey: boolean; metaKey: boolean };
  PANICO: string;
  esEnlaceExterno(url: unknown): boolean;
};

describe('carpetaRegistros', () => {
  it('en macOS, ~/Library/Logs/work-shelter-public, como siempre', () => {
    expect(p.carpetaRegistros('darwin', { XDG_STATE_HOME: '/estado' }, '/casa')).toBe('/casa/Library/Logs/work-shelter-public');
  });
  it('en Linux, $XDG_STATE_HOME si es absoluto; si no, ~/.local/state', () => {
    expect(p.carpetaRegistros('linux', { XDG_STATE_HOME: '/estado' }, '/casa')).toBe('/estado/work-shelter-public');
    for (const xdg of [undefined, '', 'relativa']) expect(p.carpetaRegistros('linux', { XDG_STATE_HOME: xdg }, '/casa')).toBe('/casa/.local/state/work-shelter-public');
  });
});

describe('shellDeUsuario', () => {
  it('$SHELL primero, en los dos sistemas', () => {
    for (const so of ['darwin', 'linux']) expect(p.shellDeUsuario({ SHELL: '/usr/bin/fish' }, { shell: '/bin/bash' }, so)).toBe('/usr/bin/fish');
  });
  it('sin $SHELL, el de la cuenta', () => {
    for (const so of ['darwin', 'linux']) expect(p.shellDeUsuario({}, { shell: '/bin/bash' }, so)).toBe('/bin/bash');
  });
  it('sin ninguno, /bin/zsh en macOS (como siempre) y /bin/sh en Linux', () => {
    expect(p.shellDeUsuario({ SHELL: '' }, null, 'darwin')).toBe('/bin/zsh');
    expect(p.shellDeUsuario({}, { shell: null }, 'linux')).toBe('/bin/sh');
  });
});

describe('rutasExtra', () => {
  const leer = (dir: string) => (dir === '/repo/.runtime' ? ['node-v22.20.0-darwin-arm64', 'node-v22.20.0-linux-x64', 'node.tar.gz', 'otra'] : []);
  it('en macOS, las de siempre: ~/.local/bin, Homebrew, /usr/local/bin y solo el Node portátil de macOS', () => {
    expect(p.rutasExtra('darwin', '/casa', '/repo', leer)).toEqual(['/casa/.local/bin', '/opt/homebrew/bin', '/usr/local/bin', '/repo/.runtime/node-v22.20.0-darwin-arm64/bin']);
  });
  it('en Linux, ~/.local/bin y solo el Node portátil de Linux, sin Homebrew', () => {
    expect(p.rutasExtra('linux', '/casa', '/repo', leer)).toEqual(['/casa/.local/bin', '/repo/.runtime/node-v22.20.0-linux-x64/bin']);
  });
  it('sin repo o sin .runtime, solo las fijas', () => {
    expect(p.rutasExtra('linux', '/casa', undefined, leer)).toEqual(['/casa/.local/bin']);
    expect(p.rutasExtra('darwin', '/casa', '/otro', () => { throw new Error('ENOENT'); })).toEqual(['/casa/.local/bin', '/opt/homebrew/bin', '/usr/local/bin']);
  });
});

describe('atajoWebview', () => {
  it('en macOS, Command sin Control', () => {
    expect(p.atajoWebview('darwin', { meta: true })).toBe(true);
    expect(p.atajoWebview('darwin', { meta: true, control: true })).toBe(false);
    expect(p.atajoWebview('darwin', { control: true })).toBe(false);
  });
  it('en Linux, Control sin la tecla del sistema', () => {
    expect(p.atajoWebview('linux', { control: true })).toBe(true);
    expect(p.atajoWebview('linux', { control: true, meta: true })).toBe(false);
    expect(p.atajoWebview('linux', { meta: true })).toBe(false);
    expect(p.atajoWebview('linux', {})).toBe(false);
  });
});

describe('atajoNavegador (las teclas que el refugio coge dentro de un navegador)', () => {
  const a = (so: string, code: string, m: Entrada = {}) => p.atajoNavegador(so, { code, ...m });
  it('en macOS, todas con Command, como siempre', () => {
    for (const code of Object.keys(p.ATAJOS)) expect(a('darwin', code, { meta: true })).toBe(code);
    for (const code of ['KeyM', 'KeyW', 'KeyB', 'KeyR', 'Equal']) expect(a('darwin', code, { meta: true, shift: true })).toBe(code);
  });
  it('en macOS, ⌘⇧J, ⌘⇧K y ⌘⇧[ ] siguen yendo a la página', () => {
    for (const code of ['KeyJ', 'KeyK', 'BracketLeft', 'BracketRight']) expect(a('darwin', code, { meta: true, shift: true })).toBeNull();
  });
  it('en Linux, las del refugio con Ctrl+Mayús; Ctrl solo va a la página (los editores de las webs)', () => {
    for (const code of ['KeyJ', 'KeyK', 'KeyM', 'KeyB']) {
      expect(a('linux', code, { control: true, shift: true })).toBe(code);
      expect(a('linux', code, { control: true })).toBeNull();
    }
  });
  it('en Linux, las de navegador con Ctrl, como en cualquier navegador (y Ctrl+Mayús+R sin caché)', () => {
    for (const code of ['KeyW', 'KeyR', 'BracketLeft', 'BracketRight', 'Equal', 'Minus', 'Digit0']) expect(a('linux', code, { control: true })).toBe(code);
    for (const code of ['KeyW', 'KeyR', 'Equal']) expect(a('linux', code, { control: true, shift: true })).toBe(code);
    for (const code of ['BracketLeft', 'BracketRight']) expect(a('linux', code, { control: true, shift: true })).toBeNull();
  });
  it('nada con Alt, con la tecla de la otra plataforma, con las dos o fuera de la lista', () => {
    expect(a('darwin', 'KeyK', { meta: true, alt: true })).toBeNull();
    expect(a('darwin', 'KeyK', { control: true })).toBeNull();
    expect(a('darwin', 'KeyK', { meta: true, control: true })).toBeNull();
    expect(a('linux', 'KeyK', { control: true, shift: true, alt: true })).toBeNull();
    expect(a('linux', 'KeyK', { meta: true, shift: true })).toBeNull();
    expect(a('linux', 'KeyK', { control: true, shift: true, meta: true })).toBeNull();
    for (const so of ['darwin', 'linux']) expect(a(so, 'KeyC', { meta: true, control: true })).toBeNull();
  });
  it('la misma lista que la interfaz (web/src/ui/teclas.ts): mismas teclas y mismas clases', () => {
    expect(p.ATAJOS).toEqual(ATAJOS);
  });
  it('la misma regla que la interfaz: en los dos sistemas, con cualquier combinación de ⌘, Ctrl, Mayús y Alt', () => {
    const bool = [false, true];
    let casos = 0;
    for (const so of ['darwin', 'linux']) for (const code of [...Object.keys(ATAJOS), 'KeyT', 'KeyC'])
      for (const meta of bool) for (const control of bool) for (const shift of bool) for (const alt of bool) {
        const e = { code, key: '', metaKey: meta, ctrlKey: control, shiftKey: shift, altKey: alt };
        expect([so, code, meta, control, shift, alt, atajoInterfaz(e, so === 'darwin')])
          .toEqual([so, code, meta, control, shift, alt, p.atajoNavegador(so, { code, meta, control, shift, alt })]);
        casos++;
      }
    expect(casos).toBe(2 * 13 * 16);
  });
});

describe('REENVIADAS', () => {
  it('a la interfaz solo van minimizar, cerrar y la barra (las demás las resuelve Electron)', () => {
    expect([...p.REENVIADAS].sort()).toEqual(['KeyB', 'KeyM', 'KeyW']);
    for (const c of p.REENVIADAS) expect(p.ATAJOS[c]).toBeDefined();
  });
});

describe('teclasReenviadas', () => {
  it('pasa a la interfaz los modificadores tal cual, para que su comprobación valga en los dos sistemas', () => {
    expect(p.teclasReenviadas({ code: 'KeyM', key: 'M', control: true, shift: true })).toEqual({ code: 'KeyM', key: 'M', shiftKey: true, ctrlKey: true, metaKey: false });
    expect(p.teclasReenviadas({ code: 'KeyW', key: 'w', meta: true })).toEqual({ code: 'KeyW', key: 'w', shiftKey: false, ctrlKey: false, metaKey: true });
  });
});

describe('PANICO', () => {
  it('Command en macOS (⇧⌥⌘Esc, como siempre) y Control en Linux, por CommandOrControl', () => {
    expect(p.PANICO).toBe('Shift+Alt+CommandOrControl+Escape');
  });
});

describe('esEnlaceExterno', () => {
  it('solo webs y correo', () => {
    for (const u of ['https://linear.app/x', 'http://ejemplo.com', 'mailto:a@b.c']) expect(p.esEnlaceExterno(u)).toBe(true);
  });
  it('ni archivos, ni javascript:, ni esquemas que lanzan otras apps, ni basura', () => {
    for (const u of ['file:///etc/passwd', 'javascript:alert(1)', 'linear://x', 'zoommtg://x', 'smb://servidor/x', 'no es una url', '', undefined, 42]) expect(p.esEnlaceExterno(u)).toBe(false);
  });
});
