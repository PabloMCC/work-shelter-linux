// Atajos de teclado del refugio: una sola definición para comprobarlos y para enseñarlos.
// En macOS van todos con ⌘, como siempre. En Linux hay dos clases:
// - del refugio (J la música, K el buscador, M minimizar, B la barra, y los de ventana: T, E, flechas, números): con
//   Ctrl+Mayús, porque Ctrl+J, Ctrl+K, Ctrl+M y Ctrl+B son de los editores de las webs y Ctrl+W, de la terminal
// - de navegador (W cerrar, R recargar, [ ] atrás y adelante, = - 0 el zoom): con Ctrl, como en cualquier navegador.
//   Solo dentro de un navegador del refugio; en las demás ventanas, W es del refugio
// ATAJOS son las teclas que el refugio coge con el foco dentro de un navegador. electron/plataforma.cjs tiene la misma
// lista para Electron (test/electron-plataforma.test.ts comprueba que coinciden).
export type Clase = 'refugio' | 'navegador';
export const ATAJOS: Readonly<Record<string, Clase>> = {
  KeyJ: 'refugio', KeyK: 'refugio', KeyM: 'refugio', KeyB: 'refugio',
  KeyW: 'navegador', KeyR: 'navegador', BracketLeft: 'navegador', BracketRight: 'navegador', Equal: 'navegador', Minus: 'navegador', Digit0: 'navegador',
};

export const MAC = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform);
// el prefijo de los del refugio: ⌘ en macOS, Ctrl+Mayús en el resto (como las terminales de Linux)
export const CMD = MAC ? '⌘' : 'Ctrl+Mayús+';
// el de los atajos de escribir (dictar, adjuntar), que en Linux van con Ctrl solo
export const CTRL = MAC ? '⌘' : 'Ctrl+';

interface Teclas { code: string; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean }
// mac: la plataforma (por defecto, la de este navegador). clase: la de ATAJOS (fuera de la lista, del refugio).
// mayus: Mayús de más (⌘⇧W); sin decir, da igual. En los del refugio de Linux ya forma parte del atajo
export interface Opciones { mac?: boolean; clase?: Clase; mayus?: boolean }
const claseDe = (code: string, o: Opciones): Clase => o.clase ?? ATAJOS[code] ?? 'refugio';

/** ¿Lleva los modificadores de esa clase? ⌘ sin Control en macOS; Ctrl (y Mayús si es del refugio) en Linux. Nunca Alt. */
export function conModificador(e: Teclas, clase: Clase = 'refugio', mac = MAC): boolean {
  if (e.altKey) return false;
  if (mac) return e.metaKey && !e.ctrlKey;
  return e.ctrlKey && !e.metaKey && (clase === 'navegador' || e.shiftKey);
}

/** ¿Es esta pulsación el atajo de esa tecla (por `code`)? */
export function esAtajo(e: Teclas, code: string, o: Opciones = {}): boolean {
  const mac = o.mac ?? MAC, clase = claseDe(code, o);
  if (e.code !== code || !conModificador(e, clase, mac)) return false;
  return o.mayus === undefined || (!mac && clase === 'refugio') || e.shiftKey === o.mayus;
}

const NOMBRES: Record<string, string> = { BracketLeft: '[', BracketRight: ']', Equal: '+', Minus: '-' };
const nombre = (code: string) => NOMBRES[code] ?? code.replace(/^(Key|Digit)/, '');
/** Cómo se enseña: ⌘K y ⌘⇧W en macOS; Ctrl+Mayús+K y Ctrl+W en Linux. */
export function etiquetaAtajo(code: string, o: Opciones = {}): string {
  const mac = o.mac ?? MAC, clase = claseDe(code, o);
  if (mac) return '⌘' + (o.mayus ? '⇧' : '') + nombre(code);
  return 'Ctrl+' + (clase === 'refugio' || o.mayus ? 'Mayús+' : '') + nombre(code);
}
