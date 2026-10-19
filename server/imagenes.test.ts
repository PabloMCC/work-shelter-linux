import { describe, it, expect } from 'vitest';
import { ordenDecodificar } from './imagenes.ts';

describe('decodificador externo (HEIC y BMP, que sharp no lee)', () => {
  const todos = (n: string) => '/usr/bin/' + n;
  it('en macOS, sips para HEIC, HEIF y BMP', () => {
    for (const ext of ['heic', 'HEIF', 'bmp']) expect(ordenDecodificar(`/u/a.${ext}`, '/t/a.png', 'darwin', () => null)).toEqual({ bin: '/usr/bin/sips', args: ['-s', 'format', 'png', `/u/a.${ext}`, '--out', '/t/a.png'] });
  });
  it('en Linux, heif-dec de libheif; si no, heif-convert (libheif antigua); si no, nada', () => {
    expect(ordenDecodificar('/u/a.heic', '/t/a.png', 'linux', todos)).toEqual({ bin: '/usr/bin/heif-dec', args: ['/u/a.heic', '/t/a.png'] });
    expect(ordenDecodificar('/u/a.heif', '/t/a.png', 'linux', n => (n === 'heif-convert' ? todos(n) : null))).toEqual({ bin: '/usr/bin/heif-convert', args: ['/u/a.heif', '/t/a.png'] });
    expect(ordenDecodificar('/u/a.heic', '/t/a.png', 'linux', () => null)).toBeNull();
  });
  it('en Linux no hay con qué leer un BMP; y lo que sharp lee no pasa por fuera', () => {
    expect(ordenDecodificar('/u/a.bmp', '/t/a.png', 'linux', todos)).toBeNull();
    for (const ext of ['png', 'jpg', 'tiff', 'webp', 'gif']) {
      expect(ordenDecodificar(`/u/a.${ext}`, '/t/a.png', 'linux', todos)).toBeNull();
      expect(ordenDecodificar(`/u/a.${ext}`, '/t/a.png', 'darwin', todos)).toBeNull();
    }
  });
});
