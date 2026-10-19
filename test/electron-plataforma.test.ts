// Lo que la ventana (Electron) decide según el sistema (electron/plataforma.cjs): funciones puras con la plataforma como
// parámetro, así que se prueban macOS y Linux en cualquier runner. No se abre Electron.
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

type Entrada = { meta?: boolean; control?: boolean };
const p = createRequire(import.meta.url)('../electron/plataforma.cjs') as {
  carpetaRegistros(plataforma: string, env: Record<string, string | undefined>, casa: string): string;
  shellDeUsuario(env: Record<string, string | undefined>, info?: { shell?: string | null } | null, plataforma?: string): string;
  rutasExtra(plataforma: string, casa: string, repo?: string, leer?: (dir: string) => string[]): string[];
  atajoWebview(plataforma: string, entrada: Entrada): boolean;
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
  it('en macOS, las de siempre: ~/.local/bin, Homebrew, /usr/local/bin y el Node portátil', () => {
    expect(p.rutasExtra('darwin', '/casa', '/repo', leer)).toEqual(['/casa/.local/bin', '/opt/homebrew/bin', '/usr/local/bin', '/repo/.runtime/node-v22.20.0-darwin-arm64/bin', '/repo/.runtime/node-v22.20.0-linux-x64/bin']);
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
