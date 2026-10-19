import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, symlinkSync } from 'node:fs';
import { randomFillSync } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import sharp from 'sharp';
import { Adjuntos, textoConAdjuntos, separarAdjuntos, nombreAdjunto, CABECERA } from './adjuntos.ts';
import { enPath, type Orden } from './plataforma.ts';

let datos: string, adj: Adjuntos;
beforeAll(() => { datos = mkdtempSync(path.join(os.tmpdir(), 'shelter-adj-')); adj = new Adjuntos(datos); });
afterAll(() => rmSync(datos, { recursive: true, force: true }));

// PNG de 1×1 transparente
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

// las imágenes de prueba se generan aquí, con sharp: no hay binarios en el repo
const lisa = (width: number, height: number) => sharp({ create: { width, height, channels: 3, background: { r: 200, g: 90, b: 40 } } });
const ruido = (width: number, height: number) => { const b = Buffer.alloc(width * height * 3); randomFillSync(b); return sharp(b, { raw: { width, height, channels: 3 } }); };
const subir = async (a: Adjuntos, nombre: string, img: ReturnType<typeof sharp> | Buffer) => a.guardar(nombre, (Buffer.isBuffer(img) ? img : await img.toBuffer()).toString('base64'));
const medidas = async (base64: string) => { const m = await sharp(Buffer.from(base64, 'base64')).metadata(); return { ancho: m.width, alto: m.height, formato: m.format }; };
const soloRuta = (texto: string, ruta: string) => [{ type: 'text', text: `${texto}\n\n${CABECERA}\n- ${ruta}` }];

describe('adjuntos del intercomunicador', () => {
  it('guarda en su carpeta, con nombre limpio, y solo da por propios los suyos', () => {
    const r = adj.guardar('mi captura/../x?.png', PNG);
    expect(r.startsWith(path.join(datos, 'uploads') + path.sep)).toBe(true);
    expect(nombreAdjunto(r)).toBe('mi captura_.._x_.png');
    expect(adj.propio(r)).toBe(true);
    expect(adj.propio('/etc/hosts')).toBe(false);
    expect(adj.propio(path.join(datos, 'uploads', '..', 'fuera.png'))).toBe(false);
    expect(adj.propio(path.dirname(r))).toBe(false);
    expect(adj.describir([r, '/etc/hosts'])).toEqual([{ ruta: r, nombre: 'mi captura_.._x_.png', imagen: true }]);
  });

  it('un enlace dentro de la carpeta de adjuntos que apunta fuera no es propio', () => {
    const fuera = path.join(datos, 'secreto.png');
    writeFileSync(fuera, Buffer.from(PNG, 'base64'));
    const enlace = path.join(path.dirname(adj.guardar('normal.png', PNG)), 'enlace.png');
    symlinkSync(fuera, enlace);
    expect(adj.propio(enlace)).toBe(false);
    expect(adj.describir([enlace])).toEqual([]);
    expect(new Adjuntos(path.join(datos, 'no-existe')).propio(fuera)).toBe(false);
  });

  it('la lista de adjuntos va al final del texto y se recupera al leer la conversación', () => {
    const a = [{ ruta: '/d/uploads/2026-10-14/mf3k2a1-captura.png', nombre: 'captura.png', imagen: true }, { ruta: '/d/uploads/2026-10-14/mf3k2a2-informe.pdf', nombre: 'informe.pdf', imagen: false }];
    const t = textoConAdjuntos('Mira esto\n\ny dime', a);
    expect(t).toBe(`Mira esto\n\ny dime\n\n${CABECERA}\n- ${a[0].ruta} (imagen, incluida en este mensaje)\n- ${a[1].ruta}`);
    expect(separarAdjuntos(t)).toEqual({ texto: 'Mira esto\n\ny dime', adjuntos: a });
    expect(separarAdjuntos(textoConAdjuntos('', a)).texto).toBe('');
    expect(separarAdjuntos('sin adjuntos')).toEqual({ texto: 'sin adjuntos', adjuntos: [] });
    expect(separarAdjuntos(`habla de ${CABECERA} sin lista`).adjuntos).toEqual([]);
  });

  it('lo que no es imagen va por su ruta, al final del texto', async () => {
    const doc = adj.guardar('b.txt', Buffer.from('hola').toString('base64'));
    expect(await adj.contenido('lee esto', adj.describir([doc]))).toEqual([{ type: 'text', text: `lee esto\n\n${CABECERA}\n- ${doc}` }]);
    expect(await adj.contenido('solo texto', [])).toBe('solo texto');
  });

  it('las imágenes van dentro del mensaje y además por su ruta (una pequeña, tal cual)', async () => {
    const img = adj.guardar('a.png', PNG), doc = adj.guardar('b.txt', Buffer.from('hola').toString('base64'));
    const c = await adj.contenido('¿qué ves?', adj.describir([img, doc])) as any[];
    expect(c[0]).toEqual({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: PNG } });
    expect(c[1].type).toBe('text');
    expect(c[1].text).toContain(`- ${img} (imagen, incluida en este mensaje)`);
    expect(c[1].text).toContain(`- ${doc}`);
  });

  it('las imágenes grandes se reducen antes de mandarlas, y la miniatura es un JPEG de 360 de lado mayor', async () => {
    const ruta = await subir(adj, 'grande.jpg', lisa(4000, 3000).jpeg());
    const c = await adj.contenido('', adj.describir([ruta])) as any[];
    expect(c[0].type).toBe('image');
    expect(c[0].source.media_type).toBe('image/jpeg');
    expect(await medidas(c[0].source.data)).toEqual({ ancho: 2000, alto: 1500, formato: 'jpeg' });
    expect(Buffer.from(c[0].source.data, 'base64').length).toBeLessThanOrEqual(3.5 * 1024 * 1024);
    const mini = await adj.miniatura(ruta);
    expect(mini.startsWith('data:image/jpeg;base64,')).toBe(true);
    expect(await medidas(mini.slice('data:image/jpeg;base64,'.length))).toEqual({ ancho: 360, alto: 270, formato: 'jpeg' });
  }, 30_000);

  it('un PNG de lado admitido pero de más de 3,5 MB va como JPEG que cabe', async () => {
    const ruta = await subir(adj, 'ruido.png', ruido(2000, 2000).png());
    const c = await adj.contenido('', adj.describir([ruta])) as any[];
    expect(c[0].source.media_type).toBe('image/jpeg');
    expect(await medidas(c[0].source.data)).toEqual({ ancho: 2000, alto: 2000, formato: 'jpeg' });
    expect(Buffer.from(c[0].source.data, 'base64').length).toBeLessThanOrEqual(3.5 * 1024 * 1024);
  }, 30_000);

  it('un PNG grande que cabe al reducirlo sigue siendo PNG', async () => {
    const ruta = await subir(adj, 'plano.png', lisa(3000, 1000).png());
    const c = await adj.contenido('', adj.describir([ruta])) as any[];
    expect(c[0].source.media_type).toBe('image/png');
    expect(await medidas(c[0].source.data)).toEqual({ ancho: 2000, alto: 667, formato: 'png' });
  }, 30_000);

  it('un TIFF se convierte (la API no lo admite)', async () => {
    const ruta = await subir(adj, 'escaneo.tiff', lisa(300, 200).tiff());
    const c = await adj.contenido('', adj.describir([ruta])) as any[];
    expect(c[0].source.media_type).toBe('image/jpeg');
    expect(await medidas(c[0].source.data)).toEqual({ ancho: 300, alto: 200, formato: 'jpeg' });
  });

  it('la orientación EXIF se aplica: la foto sale derecha', async () => {
    const ruta = await subir(adj, 'movil.jpg', lisa(3000, 1000).jpeg().withMetadata({ orientation: 6 }));
    expect((await sharp(ruta).metadata()).orientation).toBe(6);
    const c = await adj.contenido('', adj.describir([ruta])) as any[];
    expect(await medidas(c[0].source.data)).toEqual({ ancho: 667, alto: 2000, formato: 'jpeg' });
    expect(await medidas((await adj.miniatura(ruta)).split(',')[1])).toEqual({ ancho: 120, alto: 360, formato: 'jpeg' });
  }, 30_000);

  it('una foto pequeña con EXIF (GPS incluido) no va tal cual: se recodifica sin metadatos', async () => {
    const original = await lisa(1200, 800).jpeg().withExif({ IFD0: { Copyright: 'alguien' }, IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '40/1 25/1 0/1', GPSLongitudeRef: 'W', GPSLongitude: '3/1 42/1 0/1' } }).toBuffer();
    expect((await sharp(original).metadata()).exif).toBeDefined();
    const ruta = await subir(adj, 'con-gps.jpg', original);
    const c = await adj.contenido('', adj.describir([ruta])) as any[];
    const enviada = Buffer.from(c[0].source.data, 'base64');
    expect(c[0].source.media_type).toBe('image/jpeg');
    expect(enviada.equals(original)).toBe(false);
    const m = await sharp(enviada).metadata();
    expect([m.width, m.height, m.exif, m.xmp, m.iptc]).toEqual([1200, 800, undefined, undefined, undefined]);
  });

  it('un PNG con EXIF se recodifica y sigue siendo PNG (sin pérdida); uno sin metadatos, o un JPEG solo con perfil ICC, va tal cual', async () => {
    const conExif = await subir(adj, 'con-exif.png', lisa(300, 200).png().withExif({ IFD0: { Artist: 'alguien' } }));
    expect((await sharp(conExif).metadata()).exif).toBeDefined();
    const c = await adj.contenido('', adj.describir([conExif])) as any[];
    expect(c[0].source.media_type).toBe('image/png');
    expect((await sharp(Buffer.from(c[0].source.data, 'base64')).metadata()).exif).toBeUndefined();
    for (const [nombre, img] of [['limpio.png', lisa(300, 200).png()], ['icc.jpg', lisa(300, 200).jpeg().withIccProfile('srgb')]] as const) {
      const original = await img.toBuffer(), ruta = await subir(adj, nombre, original);
      const d = await adj.contenido('', adj.describir([ruta])) as any[];
      expect(d[0].source.data).toBe(original.toString('base64'));
    }
  });

  it('una foto pequeña con orientación EXIF 6 llega derecha', async () => {
    const ruta = await subir(adj, 'girada.jpg', lisa(300, 100).jpeg().withMetadata({ orientation: 6 }));
    const c = await adj.contenido('', adj.describir([ruta])) as any[];
    const m = await sharp(Buffer.from(c[0].source.data, 'base64')).metadata();
    expect([m.width, m.height, m.orientation]).toEqual([100, 300, undefined]);
  });

  it('un WebP o un JPEG con nombre de PNG no va como image/png tal cual: se recodifica', async () => {
    for (const img of [lisa(300, 200).webp(), lisa(300, 200).jpeg()]) {
      const original = await img.toBuffer(), ruta = await subir(adj, 'disfrazado.png', original);
      const c = await adj.contenido('', adj.describir([ruta])) as any[];
      expect(c[0].source.media_type).toBe('image/jpeg');
      expect(c[0].source.data).not.toBe(original.toString('base64'));
      expect(await medidas(c[0].source.data)).toEqual({ ancho: 300, alto: 200, formato: 'jpeg' });
    }
  });

  it('un formato que sharp no debe leer (SVG con nombre de PNG) no se decodifica: va solo por su ruta', async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>');
    const ruta = await subir(adj, 'trampa.png', svg);
    expect(await adj.contenido('mira', adj.describir([ruta]))).toEqual(soloRuta('mira', ruta));
    await expect(adj.miniatura(ruta)).rejects.toThrow();
  });

  it('sin decodificador externo, un HEIC va solo por su ruta (y un BMP en Linux, que no tiene)', async () => {
    const llamadas: Orden[] = [];
    const sin = new Adjuntos(datos, { plataforma: 'linux', buscar: () => null, ejecutar: async o => { llamadas.push(o); } });
    const heic = sin.guardar('foto.heic', Buffer.from('no importa').toString('base64'));
    expect(await sin.contenido('mira', sin.describir([heic]))).toEqual(soloRuta('mira', heic));
    await expect(sin.miniatura(heic)).rejects.toThrow();
    const conHeif = new Adjuntos(datos, { plataforma: 'linux', buscar: n => '/x/' + n, ejecutar: async o => { llamadas.push(o); } });
    const bmp = conHeif.guardar('dibujo.bmp', Buffer.from('BM').toString('base64'));
    expect(await conHeif.contenido('mira', conHeif.describir([bmp]))).toEqual(soloRuta('mira', bmp));
    expect(llamadas).toEqual([]);
  });

  it('con decodificador externo, un HEIC pasa por él y va como imagen', async () => {
    const llamadas: Orden[] = [];
    const con = new Adjuntos(datos, { plataforma: 'linux', buscar: n => (n === 'heif-dec' ? '/x/heif-dec' : null), ejecutar: async o => { llamadas.push(o); await lisa(2400, 1200).png().toFile(o.args[1]); } });
    const heic = con.guardar('foto.heic', Buffer.from('falso').toString('base64'));
    const c = await con.contenido('', con.describir([heic])) as any[];
    expect(c[0].source.media_type).toBe('image/jpeg');
    expect(await medidas(c[0].source.data)).toEqual({ ancho: 2000, alto: 1000, formato: 'jpeg' });
    expect(llamadas[0].bin).toBe('/x/heif-dec');
    expect(llamadas[0].args[0]).toBe(heic);
    expect(llamadas[0].args[1]).toMatch(/\.png$/);
    expect((await con.miniatura(heic)).startsWith('data:image/jpeg;base64,')).toBe(true);
  }, 30_000);

  // HEIC de verdad, con el decodificador del sistema: libheif en Linux (heif-enc para crearlo), sips en macOS
  const hayLibheif = process.platform === 'linux' && !!enPath('heif-enc') && !!enPath('heif-dec');
  it.runIf(hayLibheif || process.platform === 'darwin')('un HEIC real se decodifica con el programa del sistema', async () => {
    const tmp = mkdtempSync(path.join(os.tmpdir(), 'shelter-adj-heic-'));
    try {
      const png = path.join(tmp, 'base.png'), heic = path.join(tmp, 'base.heic');
      await lisa(640, 480).png().toFile(png);
      if (process.platform === 'darwin') execFileSync('/usr/bin/sips', ['-s', 'format', 'heic', png, '--out', heic], { stdio: 'ignore' });
      else execFileSync('heif-enc', [png, '-o', heic], { stdio: 'ignore' });
      const ruta = adj.guardar('real.heic', readFileSync(heic).toString('base64'));
      const c = await adj.contenido('', adj.describir([ruta])) as any[];
      expect(c[0].type).toBe('image');
      expect(await medidas(c[0].source.data)).toEqual({ ancho: 640, alto: 480, formato: 'jpeg' });
    } finally { rmSync(tmp, { recursive: true, force: true }); }
  }, 30_000);
});
