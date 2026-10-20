// Atajos del refugio (teclas.ts): la comprobación y las etiquetas, en macOS y en Linux en cualquier equipo (la plataforma
// va como opción). Las pruebas corren en Node, sin KeyboardEvent: basta un objeto con su forma.
import { describe, it, expect, vi } from 'vitest';
import { ATAJOS, esAtajo, etiquetaAtajo, etiquetasAyuda, atajoNavegador, teclasDeElectron } from './teclas';
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
    expect(esAtajo(ev('KeyK', { meta: true, shift: true }), 'KeyK', { ...mac, mayusExtra: false })).toBe(false);
    expect(esAtajo(ev('KeyW', { meta: true }), 'KeyW', { ...mac, mayusExtra: true })).toBe(false);
    expect(esAtajo(ev('KeyW', { meta: true, shift: true }), 'KeyW', { ...mac, mayusExtra: true })).toBe(true);
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
      expect(esAtajo(ev(c, { ctrl: true }), c, { ...linux, mayusExtra: false })).toBe(false);
      expect(esAtajo(ev(c, { ctrl: true, shift: true, meta: true }), c, linux)).toBe(false);
      expect(esAtajo(ev(c, { ctrl: true, shift: true, alt: true }), c, linux)).toBe(false);
      expect(esAtajo(ev(c, { meta: true, shift: true }), c, linux)).toBe(false);
    }
  });
  it('los de navegador, con Ctrl, como en cualquier navegador (Mayús según se pida)', () => {
    for (const c of ['KeyW', 'KeyR', 'BracketLeft', 'Equal']) expect(esAtajo(ev(c, { ctrl: true }), c, linux)).toBe(true);
    expect(esAtajo(ev('KeyR', { ctrl: true, shift: true }), 'KeyR', linux)).toBe(true);
    expect(esAtajo(ev('BracketLeft', { ctrl: true, shift: true }), 'BracketLeft', { ...linux, mayusExtra: false })).toBe(false);
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
    expect(etiquetaAtajo('KeyW', { mac: true, mayusExtra: true })).toBe('⌘⇧W');
    expect(etiquetaAtajo('BracketLeft', { mac: true })).toBe('⌘[');
    expect(etiquetaAtajo('KeyR', { mac: true })).toBe('⌘R');
  });
  it('en Linux, Ctrl+Mayús para las del refugio y Ctrl para las de navegador', () => {
    for (const [c, t] of [['KeyK', 'Ctrl+Mayús+K'], ['KeyJ', 'Ctrl+Mayús+J'], ['KeyM', 'Ctrl+Mayús+M'], ['KeyB', 'Ctrl+Mayús+B'], ['KeyW', 'Ctrl+W'], ['KeyR', 'Ctrl+R'], ['BracketLeft', 'Ctrl+['], ['BracketRight', 'Ctrl+]'], ['Equal', 'Ctrl++'], ['Minus', 'Ctrl+-'], ['Digit0', 'Ctrl+0'], ['KeyT', 'Ctrl+Mayús+T']]) {
      expect(etiquetaAtajo(c, { mac: false })).toBe(t);
    }
    expect(etiquetaAtajo('KeyW', { mac: false, clase: 'refugio' })).toBe('Ctrl+Mayús+W');
    expect(etiquetaAtajo('KeyR', { mac: false, mayusExtra: true })).toBe('Ctrl+Mayús+R');
  });
});

describe('etiquetasAyuda (la ayuda F1: ventanas, escribir, git y pánico)', () => {
  it('en macOS, las de siempre', () => {
    expect(etiquetasAyuda(true)).toEqual({
      buscador: '⌘K', musica: '⌘J', barra: '⌘B', minimizar: '⌘M', pestanaNueva: '⌘T', cerrar: '⌘W / ⌘⇧W', pestanas: '⌘1…⌘9, ⌃Tab',
      ampliar: '⌘↑', abajo: '⌘↓', sacar: '⌘⇧E', dictar: '⌘D', adjuntar: '⌘U', commit: '⌘Intro', vistasGit: '⌘1…⌘4', panico: '⇧⌥⌘Esc', mayus: '⇧',
    });
  });
  it('en Linux, sin ⌘: Ctrl+Mayús las de ventana y Ctrl solo las de escribir', () => {
    const t = etiquetasAyuda(false);
    expect(t).toEqual({
      buscador: 'Ctrl+Mayús+K', musica: 'Ctrl+Mayús+J', barra: 'Ctrl+Mayús+B', minimizar: 'Ctrl+Mayús+M', pestanaNueva: 'Ctrl+Mayús+T', cerrar: 'Ctrl+Mayús+W',
      pestanas: 'Ctrl+Mayús+1…9, Ctrl+Tab', ampliar: 'Ctrl+Mayús+↑', abajo: 'Ctrl+Mayús+↓', sacar: 'Ctrl+Mayús+E', dictar: 'Ctrl+D', adjuntar: 'Ctrl+U',
      commit: 'Ctrl+Intro', vistasGit: 'Ctrl+Mayús+1…4', panico: 'Ctrl+Mayús+Alt+Esc', mayus: 'Mayús+',
    });
    for (const v of Object.values(t)) expect(v).not.toMatch(/[⌘⇧⌥⌃]/);
  });
  it('en Linux, las de ventana son las que atiende atajoVentana', () => {
    const a = acciones(), linux = { mac: false };
    expect(atajoVentana(tecla('KeyT', { ctrl: true, shift: true }), { ...a, nuevaPestana: vi.fn() }, linux)).toBe(true);
    expect(atajoVentana(tecla('Digit9', { ctrl: true, shift: true }), a, linux)).toBe(true);
    expect(atajoVentana(tecla('KeyE', { ctrl: true, shift: true }), { ...a, sacar: vi.fn() }, linux)).toBe(true);
    expect(atajoVentana({ ...ev('ArrowUp', { ctrl: true, shift: true }), key: 'ArrowUp' } as unknown as KeyboardEvent, a, linux)).toBe(true);
    expect(atajoVentana(tecla('KeyT', { meta: true }), { ...a, nuevaPestana: vi.fn() }, linux)).toBe(false);
  });
});

describe('atajoNavegador (lo que el refugio coge dentro de un navegador; la misma regla que Electron)', () => {
  it('con Mayús de más no valen atrás y adelante, ni en macOS ⌘⇧J y ⌘⇧K (van a la página)', () => {
    for (const c of ['BracketLeft', 'BracketRight']) {
      expect(atajoNavegador(ev(c, { meta: true, shift: true }), true)).toBeNull();
      expect(atajoNavegador(ev(c, { ctrl: true, shift: true }), false)).toBeNull();
      expect(atajoNavegador(ev(c, { ctrl: true }), false)).toBe(c);
    }
    for (const c of ['KeyJ', 'KeyK']) {
      expect(atajoNavegador(ev(c, { meta: true, shift: true }), true)).toBeNull();
      expect(atajoNavegador(ev(c, { meta: true }), true)).toBe(c);
      expect(atajoNavegador(ev(c, { ctrl: true, shift: true }), false)).toBe(c);
    }
  });
  it('fuera de la lista, nada', () => {
    expect(atajoNavegador(ev('KeyT', { meta: true }), true)).toBeNull();
    expect(atajoNavegador(ev('KeyT', { ctrl: true, shift: true }), false)).toBeNull();
  });
});

describe('teclasDeElectron (lo que reenvía Electron a la interfaz)', () => {
  it('con los modificadores, tal cual', () => {
    expect(teclasDeElectron({ code: 'KeyM', key: 'M', shiftKey: true, ctrlKey: true, metaKey: false })).toEqual({ code: 'KeyM', key: 'M', shiftKey: true, ctrlKey: true, metaKey: false });
  });
  it('sin ellos (una ventana de Electron anterior, que solo mandaba ⌘), como ⌘', () => {
    expect(teclasDeElectron({ code: 'KeyW', key: 'w', shiftKey: true })).toEqual({ code: 'KeyW', key: 'w', shiftKey: true, ctrlKey: false, metaKey: true });
    expect(teclasDeElectron({ code: 'KeyB', key: 'b' })).toEqual({ code: 'KeyB', key: 'b', shiftKey: false, ctrlKey: false, metaKey: true });
  });
  it('con uno solo, el otro es falso', () => {
    expect(teclasDeElectron({ code: 'KeyW', key: 'w', ctrlKey: true })).toEqual({ code: 'KeyW', key: 'w', shiftKey: false, ctrlKey: true, metaKey: false });
  });
});

// la plataforma va como opción: los dos sistemas se prueban en cualquier runner
const acciones = () => ({ maximizada: false, cerrarPestana: vi.fn(), cerrarVentana: vi.fn(), minimizar: vi.fn(), alternarMaximizar: vi.fn(), irPestana: vi.fn(), moverPestana: vi.fn() }) satisfies AccionesVentana;
const tecla = (code: string, m: Mods = {}) => ev(code, m) as unknown as KeyboardEvent;
describe('atajoVentana en Linux', () => {
  const linux = { mac: false };
  it('en un navegador, Ctrl+W cierra y Ctrl+Mayús+M minimiza (lo que reenvía Electron)', () => {
    const a = acciones();
    expect(atajoVentana(tecla('KeyW', { ctrl: true }), a, { ...linux, navegador: true })).toBe(true);
    expect(atajoVentana(tecla('KeyM', { ctrl: true, shift: true }), a, { ...linux, navegador: true })).toBe(true);
    expect(a.cerrarPestana).toHaveBeenCalledOnce(); expect(a.minimizar).toHaveBeenCalledOnce();
    expect(atajoVentana(tecla('KeyM', { ctrl: true }), a, { ...linux, navegador: true })).toBe(false);
    expect(atajoVentana(tecla('KeyW', { meta: true }), a, { ...linux, navegador: true })).toBe(false);
  });
  it('en las demás ventanas, Ctrl+W sigue siendo de la terminal; Ctrl+Mayús+W cierra la pestaña (no la ventana)', () => {
    const a = acciones();
    expect(atajoVentana(tecla('KeyW', { ctrl: true }), a, linux)).toBe(false);
    expect(atajoVentana(tecla('KeyW', { ctrl: true, shift: true }), a, linux)).toBe(true);
    expect(a.cerrarPestana).toHaveBeenCalledOnce(); expect(a.cerrarVentana).not.toHaveBeenCalled();
  });
  it('la etiqueta y la comprobación de W dicen lo mismo', () => {
    expect(etiquetaAtajo('KeyW', { ...linux, clase: 'refugio' })).toBe('Ctrl+Mayús+W');
    expect(etiquetaAtajo('KeyW', linux)).toBe('Ctrl+W');
  });
});

describe('atajoVentana en macOS', () => {
  const mac = { mac: true };
  it('⌘W cierra la pestaña, ⌘⇧W la ventana y ⌘M minimiza, como siempre', () => {
    const a = acciones();
    expect(atajoVentana(tecla('KeyW', { meta: true }), a, mac)).toBe(true);
    expect(atajoVentana(tecla('KeyW', { meta: true, shift: true }), a, mac)).toBe(true);
    expect(atajoVentana(tecla('KeyM', { meta: true }), a, { ...mac, navegador: true })).toBe(true);
    expect(a.cerrarPestana).toHaveBeenCalledOnce(); expect(a.cerrarVentana).toHaveBeenCalledOnce(); expect(a.minimizar).toHaveBeenCalledOnce();
  });
  it('con Control, nada', () => {
    const a = acciones();
    expect(atajoVentana(tecla('KeyW', { ctrl: true }), a, mac)).toBe(false);
    expect(atajoVentana(tecla('KeyM', { ctrl: true, shift: true }), a, mac)).toBe(false);
  });
});
