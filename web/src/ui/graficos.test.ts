// Sin WebGL2 el refugio no se puede dibujar: la comprobación (con un lienzo de mentira, las pruebas corren en Node) y
// el texto de la pantalla que lo explica.
import { describe, it, expect } from 'vitest';
import { hayWebGL2, textoSinGraficos } from './graficos';

const lienzo = (getContext: (tipo: string) => unknown) => () => ({ getContext }) as unknown as HTMLCanvasElement;

describe('hayWebGL2', () => {
  it('sí, si el lienzo da un contexto webgl2', () => {
    const pedidos: string[] = [];
    expect(hayWebGL2(lienzo(t => { pedidos.push(t); return {}; }))).toBe(true);
    expect(pedidos).toEqual(['webgl2']);
  });
  it('no, si el lienzo no da contexto', () => expect(hayWebGL2(lienzo(() => null))).toBe(false));
  it('no, si pedirlo falla (o ni siquiera se puede crear el lienzo)', () => {
    expect(hayWebGL2(lienzo(() => { throw new Error('GPU bloqueada'); }))).toBe(false);
    expect(hayWebGL2(() => { throw new Error('sin document'); })).toBe(false);
  });
});

describe('textoSinGraficos', () => {
  it('explica qué pasa y qué hacer: controladores y aceleración por hardware', () => {
    const { titulo, parrafos } = textoSinGraficos();
    const todo = [titulo, ...parrafos].join(' ');
    expect(titulo).toBeTruthy();
    expect(todo).toMatch(/WebGL2/);
    expect(todo).toMatch(/controladores/i);
    expect(todo).toMatch(/aceleración por hardware/i);
    expect(todo).toMatch(/máquina virtual/i);
  });
  it('no propone quitar protecciones de la GPU ni del aislamiento', () => {
    const todo = [textoSinGraficos().titulo, ...textoSinGraficos().parrafos].join(' ');
    for (const prohibido of ['--ignore-gpu-blocklist', '--no-sandbox', '--disable-gpu-sandbox', 'blocklist', 'sandbox']) expect(todo).not.toContain(prohibido);
  });
});
