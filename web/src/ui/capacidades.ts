// Lo que solo funciona en macOS por ahora (salir a la superficie, el dictado y Spotify; shared/protocolo.ts): fuera,
// sus botones, entradas de menú y teclas siguen a la vista, apagados, y al usarlos avisan en vez de hacer nada
import { AVISOS_CAPACIDAD, type Capacidades } from '@shared/protocolo';
import { vivo } from '../red/cliente';
import { SFX } from '../audio/sonido';

export type Capacidad = keyof Capacidades;
export const disponible = (c: Capacidad) => vivo.get().capacidades[c];
export const useDisponible = (c: Capacidad) => vivo.usar(e => e.capacidades[c]);
export const avisoCapacidad = (c: Capacidad) => AVISOS_CAPACIDAD[c];
/** El aviso de que aún no está, con el sonido de «no se puede» */
export function avisarNoDisponible(c: Capacidad) {
  SFX.noPermitido();
  vivo.set(x => ({ avisos: [...x.avisos.slice(-4), { id: Date.now() + Math.random(), nivel: 'aviso', texto: AVISOS_CAPACIDAD[c] }] }));
}
