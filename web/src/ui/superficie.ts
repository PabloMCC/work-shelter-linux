// Salir a la superficie desde el juego: una conversación o una terminal sigue en una terminal de tu escritorio
// (iTerm, o Terminal). Lo hace el servidor (server/escritorio.ts); aquí solo se pide y se avisa si no se puede.
import { cliente, vivo } from '../red/cliente';
import { SFX } from '../audio/sonido';
import { avisarNoDisponible, disponible } from './capacidades';

export function sacarASuperficie(que: { sesiones?: string[]; terminales?: string[]; todo?: boolean }) {
  // fuera de macOS aún no está: se avisa y no se pide nada (el servidor tampoco sacaría nada)
  if (!disponible('superficie')) { avisarNoDisponible('superficie'); return; }
  SFX.clic();
  cliente.accion('superficie.sacar', que).catch((e: Error) => {
    SFX.noPermitido();
    vivo.set(x => ({ avisos: [...x.avisos.slice(-4), { id: Date.now() + Math.random(), nivel: 'error', texto: e.message }] }));
  });
}
