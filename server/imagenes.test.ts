import { describe, it, expect, vi } from 'vitest';
import { ordenDecodificar, imagenParaClaude, miniaturaJpeg } from './imagenes.ts';

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

describe('sin sharp (su binario nativo no carga en este sistema)', () => {
  const ruta = '/no/importa/foto.jpg';
  it('la imagen va solo por su ruta, la miniatura falla con un error claro y se avisa una vez, sin rutas', async () => {
    const aviso = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const rota = async (): Promise<never> => { throw new Error('Could not load the "sharp" module from /home/alguien/proyecto/node_modules'); };
      expect(await imagenParaClaude(ruta, { cargarSharp: rota })).toBeNull();
      expect(await imagenParaClaude(ruta, { cargarSharp: rota })).toBeNull();
      await expect(miniaturaJpeg(ruta, 360, { cargarSharp: rota })).rejects.toThrow(/librería de imágenes/);
      expect(aviso).toHaveBeenCalledTimes(1);
      expect(String(aviso.mock.calls[0][0])).toMatch(/sharp/);
      expect(String(aviso.mock.calls[0][0])).not.toMatch(/\/home|node_modules/);
    } finally { aviso.mockRestore(); }
  });
  it('sin sharp tampoco se lanza el decodificador externo', async () => {
    const llamadas: unknown[] = [];
    const o = { plataforma: 'linux' as const, buscar: (n: string) => '/x/' + n, ejecutar: async (x: unknown) => { llamadas.push(x); }, cargarSharp: async (): Promise<never> => { throw new Error('no'); } };
    const aviso = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try { expect(await imagenParaClaude('/u/a.heic', o)).toBeNull(); } finally { aviso.mockRestore(); }
    expect(llamadas).toEqual([]);
  });
  it('si sharp carga pero no se deja limitar a los formatos de la lista, tampoco se usa, con su propio aviso', async () => {
    const aviso = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const sinBloqueo = async () => ({ block: () => { throw new Error('block no existe'); }, unblock: () => {}, cache: () => {} }) as never;
      expect(await imagenParaClaude('/no/importa/foto.jpg', { cargarSharp: sinBloqueo })).toBeNull();
      await expect(miniaturaJpeg('/no/importa/foto.jpg', 360, { cargarSharp: sinBloqueo })).rejects.toThrow(/librería de imágenes/);
      expect(aviso).toHaveBeenCalledTimes(1);
      const texto = String(aviso.mock.calls[0][0]);
      expect(texto).toMatch(/formatos/); expect(texto).not.toMatch(/No pude cargar/);
    } finally { aviso.mockRestore(); }
  });
});
