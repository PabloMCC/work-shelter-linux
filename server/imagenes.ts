// Las imágenes de los adjuntos, con sharp (libvips) en macOS y en Linux: medir, girar según el EXIF, reducir, convertir
// y hacer miniaturas. sharp solo lee lo que hace falta (lista blanca de cargadores: JPEG, PNG, WebP, GIF y TIFF), con
// tope de píxeles y de tiempo, y parando en el primer error, porque los archivos llegan de fuera.
// HEIC y HEIF van antes por el decodificador del sistema, en otro proceso: `sips` en macOS, `heif-dec` de libheif en
// Linux. No se empaqueta ninguno (HEVC tiene patentes) y los binarios de sharp no traen HEVC. El BMP, que sharp tampoco
// lee, igual: `sips` en macOS; en Linux no hay. Sin decodificador, la imagen va solo por su ruta.
// sharp se carga la primera vez que hace falta: si su binario nativo no carga en este sistema, el servidor arranca igual
// y las imágenes van solo por su ruta, sin miniatura.
import path from 'node:path';
import os from 'node:os';
import { readFileSync, statSync, rmSync, mkdtempSync } from 'node:fs';
import { execFile } from 'node:child_process';
import type { default as SharpT, SharpOptions } from 'sharp';
import { enPath, type Buscador, type Orden, type Plataforma } from './plataforma.ts';

// 100 MP: una foto de móvil de 48 o 50 MP (8160x6144) entra con margen; una de 200 MP casi nunca cabe en los 20 MB de un
// adjunto, y decodificar más costaría cientos de MB de memoria: va solo por su ruta
const ENTRADA = { limitInputPixels: 100_000_000, failOn: 'error' } as const;
const TOPE = { seconds: 20 };                     // por operación de sharp, para que un archivo hostil no la eternice

export const MAX_LADO = 2000;                    // lado mayor de una imagen que va a Claude
export const MAX_IMAGEN = 3.5 * 1024 * 1024;     // la API admite 5 MB en base64: con 3,5 MB de imagen hay margen
/** Las que la API admite tal cual (si caben), por extensión */
export const DIRECTAS: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' };
const POR_FORMATO: Record<string, string> = { png: 'image/png', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' };
// lo que sharp no lee y pasa antes por el programa del sistema
const necesitaDecodificador = (ruta: string) => ['.heic', '.heif', '.bmp'].includes(path.extname(ruta).toLowerCase());

/** Cómo se carga sharp; en los tests, uno que falla como cuando su binario nativo no existe para este sistema */
export type CargarSharp = () => Promise<typeof SharpT>;
/** Lo que se mira, se lanza fuera y se carga, cambiable en los tests: la plataforma, el PATH, cómo se ejecuta una orden y sharp */
export interface OpcionesImagen { plataforma?: Plataforma; buscar?: Buscador; ejecutar?: (o: Orden) => Promise<void>; cargarSharp?: CargarSharp }
const ejecutarReal = (o: Orden) => new Promise<void>((ok, ko) => execFile(o.bin, o.args, { timeout: 30_000 }, e => (e ? ko(e) : ok())));
const cargarReal: CargarSharp = async () => (await import('sharp')).default;

// una carga por cargador (en producción, una sola); si falla, un aviso y null para siempre. El aviso no lleva el error:
// trae rutas de la instalación
const cargas = new WeakMap<CargarSharp, Promise<typeof SharpT | null>>();
function conSharp(cargar: CargarSharp = cargarReal) {
  let carga = cargas.get(cargar);
  if (!carga) {
    carga = (async () => {
      try {
        const s = await cargar();
        s.block({ operation: ['VipsForeignLoad'] });
        s.unblock({ operation: ['Jpeg', 'Png', 'Webp', 'Gif', 'Nsgif', 'Tiff'].flatMap(f => [`VipsForeignLoad${f}File`, `VipsForeignLoad${f}Buffer`]) });
        s.cache(false);   // servidor de larga vida y pocas imágenes: sin caché que crezca
        return s;
      } catch {
        console.warn('No pude cargar sharp, la librería de imágenes (su binario no existe para este sistema o no es compatible). Las imágenes adjuntas irán solo por su ruta y sin miniatura; reinstalar las dependencias suele arreglarlo.');
        return null;
      }
    })();
    cargas.set(cargar, carga);
  }
  return carga;
}

/** La orden que pasa un HEIC/HEIF o BMP a PNG con el programa del sistema; null si sharp lo lee solo o no hay con qué */
export function ordenDecodificar(entrada: string, salida: string, p: Plataforma = process.platform, buscar: Buscador = n => enPath(n)): Orden | null {
  if (!necesitaDecodificador(entrada)) return null;
  if (p === 'darwin') return { bin: '/usr/bin/sips', args: ['-s', 'format', 'png', entrada, '--out', salida] };
  if (path.extname(entrada).toLowerCase() === '.bmp') return null;
  // heif-dec desde libheif 1.17; antes se llamaba heif-convert, con los mismos argumentos
  const bin = buscar('heif-dec') ?? buscar('heif-convert');
  return bin ? { bin, args: [entrada, salida] } : null;
}

// la imagen legible por sharp (la original o la que deja el decodificador en una carpeta temporal), solo durante `uso`
async function conLegible<T>(ruta: string, o: OpcionesImagen, uso: (legible: string) => Promise<T>): Promise<T> {
  if (!necesitaDecodificador(ruta)) return uso(ruta);
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'shelter-dec-'));
  try {
    const salida = path.join(tmp, 'd.png'), orden = ordenDecodificar(ruta, salida, o.plataforma, o.buscar);
    if (!orden) throw new Error('No hay con qué leer esta imagen en este sistema.');
    await (o.ejecutar ?? ejecutarReal)(orden);
    return await uso(salida);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
}

/** El bloque de imagen para Claude: tal cual si la API la admite, cabe y no lleva metadatos ocultos; si no, girada,
 *  reducida y en PNG o JPEG; null si no cabe o no hay sharp */
export async function imagenParaClaude(ruta: string, o: OpcionesImagen = {}): Promise<{ media_type: string; data: string } | null> {
  const sharp = await conSharp(o.cargarSharp);
  if (!sharp) return null;
  const abrir = (entrada: string | Buffer, extra: SharpOptions = {}) => sharp(entrada, { ...ENTRADA, ...extra }).timeout(TOPE);
  return conLegible(ruta, o, async legible => {
    const m = await abrir(legible).metadata();
    if (!m.width || !m.height) return null;
    // tal cual solo si la extensión dice lo mismo que el contenido (un WebP llamado .png no va como image/png) y no hay
    // EXIF, XMP ni IPTC, que pueden llevar el GPS de la foto, el autor o el equipo. Un perfil ICC solo no dice nada de nadie
    const directa = DIRECTAS[path.extname(ruta).toLowerCase()];
    const limpia = !m.exif && !m.xmp && !m.iptc;
    if (directa && directa === POR_FORMATO[m.format] && limpia && Math.max(m.width, m.height) <= MAX_LADO && statSync(ruta).size <= MAX_IMAGEN) return { media_type: directa, data: readFileSync(ruta).toString('base64') };
    // se decodifica una vez: girada según el EXIF, con el lado mayor como mucho de MAX_LADO, en píxeles de 8 bits; de ahí
    // salen los intentos (PNG si ya lo era y cabe, si no JPEG). sharp no copia metadatos a la salida salvo que se le pida
    const { data, info } = await abrir(legible).rotate().resize({ width: MAX_LADO, height: MAX_LADO, fit: 'inside', withoutEnlargement: true }).raw({ depth: 'uchar' }).toBuffer({ resolveWithObject: true });
    const pixeles = () => abrir(data, { raw: { width: info.width, height: info.height, channels: info.channels } });
    for (const [formato, calidad] of [['png', 0], ['jpeg', 88], ['jpeg', 72]] as const) {
      // PNG solo si el original lo era (lo que deja el decodificador externo también es PNG, y ese no cuenta)
      if (formato === 'png' && (m.format !== 'png' || legible !== ruta)) continue;
      // el JPEG no tiene transparencia: sobre blanco, no sobre negro
      const datos = formato === 'png' ? await pixeles().png().toBuffer() : await pixeles().flatten({ background: '#ffffff' }).jpeg({ quality: calidad }).toBuffer();
      if (datos.length <= MAX_IMAGEN) return { media_type: formato === 'png' ? 'image/png' : 'image/jpeg', data: datos.toString('base64') };
    }
    return null;
  });
}

/** Miniatura JPEG en data URL, girada según el EXIF y con el lado mayor como mucho de `lado` */
export async function miniaturaJpeg(ruta: string, lado: number, o: OpcionesImagen = {}): Promise<string> {
  const sharp = await conSharp(o.cargarSharp);
  if (!sharp) throw new Error('No se pueden hacer miniaturas: la librería de imágenes (sharp) no carga en este sistema.');
  return conLegible(ruta, o, async legible => {
    const datos = await sharp(legible, ENTRADA).timeout(TOPE).rotate().resize({ width: lado, height: lado, fit: 'inside', withoutEnlargement: true }).flatten({ background: '#ffffff' }).jpeg({ quality: 75 }).toBuffer();
    return 'data:image/jpeg;base64,' + datos.toString('base64');
  });
}
