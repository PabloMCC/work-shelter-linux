// Llavero de Linux con un `secret-tool` falso: nunca habla con el servicio de secretos real. Comprueba las órdenes,
// que el secreto solo viaja por stdin, cómo se distingue «no existe» de un fallo y que ningún error lleva el secreto.
import { describe, expect, it } from 'vitest';
import { crearLlaveroLinux, SERVICIO, type Ejecutar } from './llavero.ts';

type Llamada = { bin: string; args: string[]; entrada?: string };
type Respuesta = { codigo: number; salida?: string; error?: string };
const BIN = '/usr/bin/secret-tool';
const SECRETO = 'lin_api_secreto_muy_privado';

// el error con que falla una promesa (si no falla, uno que no cumple ninguna comprobación)
const errorDe = (p: Promise<unknown>) => p.then(() => new Error('no falló'), e => e as Error);

function falso(respuestas: Respuesta[], ruta: string | null = BIN) {
  const llamadas: Llamada[] = [];
  const ejecutar: Ejecutar = async (bin, args, entrada) => {
    llamadas.push({ bin, args, entrada });
    const r = respuestas.shift() ?? { codigo: 0 };
    return { codigo: r.codigo, salida: r.salida ?? '', error: r.error ?? '' };
  };
  const buscados: string[] = [];
  const llavero = crearLlaveroLinux({ ejecutar, buscar: n => { buscados.push(n); return ruta; } });
  return { llavero, llamadas, buscados };
}

describe('llavero de Linux (secret-tool)', () => {
  it('leer: devuelve la salida exacta, sin recortar', async () => {
    const { llavero, llamadas, buscados } = falso([{ codigo: 0, salida: ' con espacios ' }]);
    expect(await llavero.leer('linear.apiKey')).toBe(' con espacios ');
    expect(buscados).toEqual(['secret-tool']);
    expect(llamadas).toEqual([{ bin: BIN, args: ['lookup', 'service', SERVICIO, 'account', 'linear.apiKey'], entrada: undefined }]);
  });
  it('leer: salida 1 sin stderr es que no existe', async () => {
    const { llavero } = falso([{ codigo: 1 }]);
    expect(await llavero.leer('outlook.refreshToken')).toBeNull();
  });
  it('leer: salida 1 con stderr es un fallo claro, sin el secreto', async () => {
    const { llavero } = falso([{ codigo: 1, error: 'secret-tool: No se pudo conectar: sin servicio\nmás detalle' }]);
    const err = await errorDe(llavero.leer('linear.apiKey'));
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toMatch(/llavero del sistema no pudo leer/);
    expect(err.message).toContain('No se pudo conectar');
    expect(err.message).not.toContain('más detalle');
    expect(err.message).not.toMatch(/macOS/);
  });
  it('guardar: el secreto va solo por stdin y se verifica leyendo', async () => {
    const { llavero, llamadas } = falso([{ codigo: 0 }, { codigo: 0, salida: SECRETO }]);
    await llavero.guardar('linear.apiKey', SECRETO);
    expect(llamadas).toHaveLength(2);
    expect(llamadas[0]).toEqual({ bin: BIN, args: ['store', '--label=work-shelter: linear', 'service', SERVICIO, 'account', 'linear.apiKey'], entrada: SECRETO });
    for (const l of llamadas) expect(l.args.join(' ')).not.toContain(SECRETO);
    expect(llamadas[1].args).toEqual(['lookup', 'service', SERVICIO, 'account', 'linear.apiKey']);
  });
  it('guardar: si lo leído no coincide, falla sin decir el secreto', async () => {
    const { llavero } = falso([{ codigo: 0 }, { codigo: 0, salida: 'otra cosa' }]);
    const err = await errorDe(llavero.guardar('linear.apiKey', SECRETO));
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toMatch(/no pudo guardar/);
    expect(err.message).not.toContain(SECRETO);
    expect(err.message).not.toContain('otra cosa');
  });
  it('guardar: un fallo de store no se esconde y no lleva el secreto', async () => {
    const { llavero, llamadas } = falso([{ codigo: 1, error: 'secret-tool: Cannot create an item in a locked collection' }]);
    const err = await errorDe(llavero.guardar('linear.apiKey', SECRETO));
    expect(err.message).toMatch(/no pudo guardar.*locked collection/);
    expect(err.message).not.toContain(SECRETO);
    expect(llamadas).toHaveLength(1);
  });
  it('borrar: vale con salida 0 y con «no existe»', async () => {
    const { llavero, llamadas } = falso([{ codigo: 0 }, { codigo: 1 }]);
    await llavero.borrar('slack.token');
    await llavero.borrar('slack.token');
    expect(llamadas.map(l => l.args)).toEqual([['clear', 'service', SERVICIO, 'account', 'slack.token'], ['clear', 'service', SERVICIO, 'account', 'slack.token']]);
  });
  it('borrar: un fallo con stderr se lanza', async () => {
    const { llavero } = falso([{ codigo: 1, error: 'secret-tool: No se pudo conectar' }]);
    await expect(llavero.borrar('slack.token')).rejects.toThrow(/no pudo borrar/);
  });
  it('sin secret-tool en el PATH: error que pide libsecret y no se ejecuta nada', async () => {
    const { llavero, llamadas } = falso([], null);
    const intentos: Promise<unknown>[] = [llavero.leer('linear.apiKey'), llavero.guardar('linear.apiKey', SECRETO), llavero.borrar('linear.apiKey')];
    for (const p of intentos) {
      const err = await errorDe(p);
      expect(err.message).toMatch(/secret-tool/);
      expect(err.message).toMatch(/libsecret/);
      expect(err.message).not.toContain(SECRETO);
    }
    expect(llamadas).toEqual([]);
  });
  it('cuenta no válida: se rechaza antes de ejecutar nada', async () => {
    const { llavero, llamadas, buscados } = falso([]);
    await expect(llavero.leer('Linear.apiKey')).rejects.toThrow(/Cuenta de llavero no válida/);
    await expect(llavero.guardar('linear', SECRETO)).rejects.toThrow(/Cuenta de llavero no válida/);
    await expect(llavero.borrar('linear.api key')).rejects.toThrow(/Cuenta de llavero no válida/);
    expect(llamadas).toEqual([]);
    expect(buscados).toEqual([]);
  });
});
