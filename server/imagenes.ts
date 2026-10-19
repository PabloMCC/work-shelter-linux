// Las imágenes de los adjuntos, con sharp (libvips) en macOS y en Linux: medir, girar según el EXIF, reducir, convertir
// y hacer miniaturas. sharp solo lee lo que hace falta (lista blanca de cargadores: JPEG, PNG, WebP, GIF y TIFF), con
// tope de píxeles y parando en el primer error, porque los archivos llegan de fuera.
// HEIC y HEIF van antes por el decodificador del sistema, en otro proceso: `sips` en macOS, `heif-dec` de libheif en
// Linux. No se empaqueta ninguno (HEVC tiene patentes) y los binarios de sharp no traen HEVC. El BMP, que sharp tampoco
// lee, igual: `sips` en macOS; en Linux no hay. Sin decodificador, la imagen va solo por su ruta.
import path from 'node:path';
import os from 'node:os';
import { readFileSync, statSync, rmSync, mkdtempSync } from 'node:fs';
import { execFile } from 'node:child_process';
import sharp from 'sharp';
import { enPath, type Buscador, type Orden, type Plataforma } from './plataforma.ts';

sharp.block({ operation: ['VipsForeignLoad'] });
sharp.unblock({ operation: ['Jpeg', 'Png', 'Webp', 'Gif', 'Nsgif', 'Tiff'].flatMap(f => [`VipsForeignLoad${f}File`, `VipsForeignLoad${f}Buffer`]) });
sharp.cache(false);   // servidor de larga vida y pocas imágenes: sin caché que crezca
const ENTRADA = { limitInputPixels: 100_000_000, failOn: 'error' } as const;

export const MAX_LADO = 2000;                    // lado mayor de una imagen que va a Claude
export const MAX_IMAGEN = 3.5 * 1024 * 1024;     // la API admite 5 MB en base64: con 3,5 MB de imagen hay margen
/** Las que la API admite tal cual (si caben), por extensión */
export const DIRECTAS: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' };
const POR_FORMATO: Record<string, string> = { png: 'image/png', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' };
const HEIF = new Set(['.heic', '.heif']);

/** Lo que se mira y se lanza fuera, cambiable en los tests: la plataforma, el PATH y cómo se ejecuta una orden */
export interface OpcionesImagen { plataforma?: Plataforma; buscar?: Buscador; ejecutar?: (o: Orden) => Promise<void> }
const ejecutarReal = (o: Orden) => new Promise<void>((ok, ko) => execFile(o.bin, o.args, { timeout: 30_000 }, e => (e ? ko(e) : ok())));

/** La orden que pasa un HEIC/HEIF o BMP a PNG con el programa del sistema; null si sharp lo lee solo o no hay con qué */
export function ordenDecodificar(entrada: string, salida: string, p: Plataforma = process.platform, buscar: Buscador = n => enPath(n)): Orden | null {
  const ext = path.extname(entrada).toLowerCase();
  if (!HEIF.has(ext) && ext !== '.bmp') return null;
  if (p === 'darwin') return { bin: '/usr/bin/sips', args: ['-s', 'format', 'png', entrada, '--out', salida] };
  if (ext === '.bmp') return null;
  // heif-dec desde libheif 1.17; antes se llamaba heif-convert, con los mismos argumentos
  const bin = buscar('heif-dec') ?? buscar('heif-convert');
  return bin ? { bin, args: [entrada, salida] } : null;
}

// la imagen legible por sharp (la original o la que deja el decodificador en una carpeta temporal), solo durante `uso`
async function conLegible<T>(ruta: string, o: OpcionesImagen, uso: (legible: string) => Promise<T>): Promise<T> {
  const ext = path.extname(ruta).toLowerCase();
  if (!HEIF.has(ext) && ext !== '.bmp') return uso(ruta);
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'shelter-dec-'));
  try {
    const salida = path.join(tmp, 'd.png'), orden = ordenDecodificar(ruta, salida, o.plataforma, o.buscar);
    if (!orden) throw new Error('No hay con qué leer esta imagen en este sistema.');
    await (o.ejecutar ?? ejecutarReal)(orden);
    return await uso(salida);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
}

/** El bloque de imagen para Claude: tal cual si la API la admite y cabe; si no, girada, reducida y en PNG o JPEG; null si no cabe */
export function imagenParaClaude(ruta: string, o: OpcionesImagen = {}): Promise<{ media_type: string; data: string } | null> {
  return conLegible(ruta, o, async legible => {
    const m = await sharp(legible, ENTRADA).metadata();
    if (!m.width || !m.height) return null;
    // tal cual solo si la extensión dice lo mismo que el contenido: un WebP llamado .png no va como image/png
    const directa = DIRECTAS[path.extname(ruta).toLowerCase()];
    if (directa && directa === POR_FORMATO[m.format] && Math.max(m.width, m.height) <= MAX_LADO && statSync(ruta).size <= MAX_IMAGEN) return { media_type: directa, data: readFileSync(ruta).toString('base64') };
    // grande o en otro formato: a JPEG (o PNG si ya lo era y cabe) con el lado mayor como mucho de MAX_LADO
    const base = () => sharp(legible, ENTRADA).rotate().resize({ width: MAX_LADO, height: MAX_LADO, fit: 'inside', withoutEnlargement: true });
    for (const [formato, calidad] of [['png', 0], ['jpeg', 88], ['jpeg', 72]] as const) {
      // PNG solo si el original lo era (lo que deja el decodificador externo también es PNG, y ese no cuenta)
      if (formato === 'png' && (m.format !== 'png' || legible !== ruta)) continue;
      // el JPEG no tiene transparencia: sobre blanco, no sobre negro
      const datos = formato === 'png' ? await base().png().toBuffer() : await base().flatten({ background: '#ffffff' }).jpeg({ quality: calidad }).toBuffer();
      if (datos.length <= MAX_IMAGEN) return { media_type: formato === 'png' ? 'image/png' : 'image/jpeg', data: datos.toString('base64') };
    }
    return null;
  });
}

/** Miniatura JPEG en data URL, girada según el EXIF y con el lado mayor como mucho de `lado` */
export function miniaturaJpeg(ruta: string, lado: number, o: OpcionesImagen = {}): Promise<string> {
  return conLegible(ruta, o, async legible => {
    const datos = await sharp(legible, ENTRADA).rotate().resize({ width: lado, height: lado, fit: 'inside', withoutEnlargement: true }).flatten({ background: '#ffffff' }).jpeg({ quality: 75 }).toBuffer();
    return 'data:image/jpeg;base64,' + datos.toString('base64');
  });
}
