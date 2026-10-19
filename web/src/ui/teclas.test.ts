// Atajos del refugio (teclas.ts): la comprobación y las etiquetas, en macOS y en Linux en cualquier equipo (la plataforma
// va como opción). Las pruebas corren en Node, sin KeyboardEvent: basta un objeto con su forma.
import { describe, it, expect, vi } from 'vitest';
import { ATAJOS, MAC, esAtajo, etiquetaAtajo } from './teclas';
import { atajoVentana, type AccionesVentana } from './ventanas';

type Mods = { meta?: boolean; ctrl?: boolean; shift?: boolean; alt?: boolean };
const ev = (code: string, m: Mods = {}) => ({ code, key: '', metaKey: !!m.meta, ctrlKey: !!m.ctrl, shiftKey: !!m.shift, altKey: !!m.alt, preventDefault() {}, stopPropagation() {} });

describe('ATAJOS', () => {
  it('J, K, M y B son del refugio; W, R, [ ] y el zoom, de navegador', () => {
    for (const c of ['KeyJ', 'KeyK', 'KeyM', 'KeyB']) expect(ATAJOS[c]).toBe('refugio');
    for (const c of ['KeyW', 'KeyR', 'BracketLeft', 'BracketRight', 'Equal', 'Minus', 'Digit0']) expect(ATAJOS[c]).toBe('navegador');
  });
});

describe('esAtajo en macOS', () => {
  const mac = { mac: true };
  it('con ⌘ y sin Control ni Alt, en todas', () => {
    for (const c of Object.keys(ATAJOS)) {
      expect(esAtajo(ev(c, { meta: true }), c, mac)).toBe(true);
      expect(esAtajo(ev(c, { meta: true, ctrl: true }), c, mac)).toBe(false);
      expect(esAtajo(ev(c, { meta: true, alt: true }), c, mac)).toBe(false);
      expect(esAtajo(ev(c, { ctrl: true, shift: true }), c, mac)).toBe(false);
    }
  });
  it('Mayús, según se pida: cualquiera, sin ella (⌘K) o con ella (⌘⇧W)', () => {
    expect(esAtajo(ev('KeyJ', { meta: true, shift: true }), 'KeyJ', mac)).toBe(true);
    expect(esAtajo(ev('KeyK', { meta: true, shift: true }), 'KeyK', { ...mac, mayus: false })).toBe(false);
    expect(esAtajo(ev('KeyW', { meta: true }), 'KeyW', { ...mac, mayus: true })).toBe(false);
    expect(esAtajo(ev('KeyW', { meta: true, shift: true }), 'KeyW', { ...mac, mayus: true })).toBe(true);
  });
  it('otra tecla no vale', () => {
    expect(esAtajo(ev('KeyL', { meta: true }), 'KeyK', mac)).toBe(false);
  });
});

describe('esAtajo en Linux', () => {
  const linux = { mac: false };
  it('los del refugio, con Ctrl+Mayús: Ctrl solo es de los editores de las webs', () => {
    for (const c of ['KeyJ', 'KeyK', 'KeyM', 'KeyB']) {
      expect(esAtajo(ev(c, { ctrl: true, shift: true }), c, linux)).toBe(true);
      expect(esAtajo(ev(c, { ctrl: true }), c, linux)).toBe(false);
      expect(esAtajo(ev(c, { ctrl: true }), c, { ...linux, mayus: false })).toBe(false);
      expect(esAtajo(ev(c, { ctrl: true, shift: true, meta: true }), c, linux)).toBe(false);
      expect(esAtajo(ev(c, { ctrl: true, shift: true, alt: true }), c, linux)).toBe(false);
      expect(esAtajo(ev(c, { meta: true, shift: true }), c, linux)).toBe(false);
    }
  });
  it('los de navegador, con Ctrl, como en cualquier navegador (Mayús según se pida)', () => {
    for (const c of ['KeyW', 'KeyR', 'BracketLeft', 'Equal']) expect(esAtajo(ev(c, { ctrl: true }), c, linux)).toBe(true);
    expect(esAtajo(ev('KeyR', { ctrl: true, shift: true }), 'KeyR', linux)).toBe(true);
    expect(esAtajo(ev('BracketLeft', { ctrl: true, shift: true }), 'BracketLeft', { ...linux, mayus: false })).toBe(false);
    expect(esAtajo(ev('KeyW', { meta: true }), 'KeyW', linux)).toBe(false);
  });
  it('la clase se puede forzar: W fuera de un navegador es del refugio (Ctrl+W es de la terminal)', () => {
    expect(esAtajo(ev('KeyW', { ctrl: true }), 'KeyW', { ...linux, clase: 'refugio' })).toBe(false);
    expect(esAtajo(ev('KeyW', { ctrl: true, shift: true }), 'KeyW', { ...linux, clase: 'refugio' })).toBe(true);
  });
  it('las que no están en la lista (T, E, números) van como las del refugio', () => {
    expect(esAtajo(ev('KeyT', { ctrl: true, shift: true }), 'KeyT', linux)).toBe(true);
    expect(esAtajo(ev('KeyT', { ctrl: true }), 'KeyT', linux)).toBe(false);
  });
});

describe('etiquetaAtajo', () => {
  it('en macOS, ⌘ y la tecla, como siempre', () => {
    expect(etiquetaAtajo('KeyK', { mac: true })).toBe('⌘K');
    expect(etiquetaAtajo('KeyJ', { mac: true })).toBe('⌘J');
    expect(etiquetaAtajo('KeyW', { mac: true })).toBe('⌘W');
    expect(etiquetaAtajo('KeyW', { mac: true, mayus: true })).toBe('⌘⇧W');
    expect(etiquetaAtajo('BracketLeft', { mac: true })).toBe('⌘[');
    expect(etiquetaAtajo('KeyR', { mac: true })).toBe('⌘R');
  });
  it('en Linux, Ctrl+Mayús para las del refugio y Ctrl para las de navegador', () => {
    for (const [c, t] of [['KeyK', 'Ctrl+Mayús+K'], ['KeyJ', 'Ctrl+Mayús+J'], ['KeyM', 'Ctrl+Mayús+M'], ['KeyB', 'Ctrl+Mayús+B'], ['KeyW', 'Ctrl+W'], ['KeyR', 'Ctrl+R'], ['BracketLeft', 'Ctrl+['], ['BracketRight', 'Ctrl+]'], ['Equal', 'Ctrl++'], ['Minus', 'Ctrl+-'], ['Digit0', 'Ctrl+0'], ['KeyT', 'Ctrl+Mayús+T']]) {
      expect(etiquetaAtajo(c, { mac: false })).toBe(t);
    }
    expect(etiquetaAtajo('KeyW', { mac: false, clase: 'refugio' })).toBe('Ctrl+Mayús+W');
    expect(etiquetaAtajo('KeyR', { mac: false, mayus: true })).toBe('Ctrl+Mayús+R');
  });
});

// atajoVentana lee la plataforma de este proceso (Node da «darwin» o «linux», nunca «Mac»): aquí, la de Linux
describe.runIf(!MAC)('atajoVentana en Linux', () => {
  const acciones = () => ({ maximizada: false, cerrarPestana: vi.fn(), cerrarVentana: vi.fn(), minimizar: vi.fn(), alternarMaximizar: vi.fn(), irPestana: vi.fn(), moverPestana: vi.fn() }) satisfies AccionesVentana;
  it('en un navegador, Ctrl+W cierra y Ctrl+Mayús+M minimiza (lo que reenvía Electron)', () => {
    const a = acciones();
    expect(atajoVentana(ev('KeyW', { ctrl: true }) as unknown as KeyboardEvent, a, { navegador: true })).toBe(true);
    expect(atajoVentana(ev('KeyM', { ctrl: true, shift: true }) as unknown as KeyboardEvent, a, { navegador: true })).toBe(true);
    expect(a.cerrarPestana).toHaveBeenCalledOnce(); expect(a.minimizar).toHaveBeenCalledOnce();
    expect(atajoVentana(ev('KeyM', { ctrl: true }) as unknown as KeyboardEvent, a, { navegador: true })).toBe(false);
  });
  it('en las demás ventanas, Ctrl+W sigue siendo de la terminal; cierra Ctrl+Mayús+W', () => {
    const a = acciones();
    expect(atajoVentana(ev('KeyW', { ctrl: true }) as unknown as KeyboardEvent, a)).toBe(false);
    expect(atajoVentana(ev('KeyW', { ctrl: true, shift: true }) as unknown as KeyboardEvent, a)).toBe(true);
    expect(a.cerrarPestana).toHaveBeenCalledOnce();
  });
  it('la etiqueta y la comprobación de W dicen lo mismo', () => {
    expect(etiquetaAtajo('KeyW', { clase: 'refugio' })).toBe('Ctrl+Mayús+W');
    expect(etiquetaAtajo('KeyW')).toBe('Ctrl+W');
  });
});
