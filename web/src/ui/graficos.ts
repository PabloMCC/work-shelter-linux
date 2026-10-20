// El refugio se dibuja con WebGL2 (three.js). Si el equipo no lo da (controladores, aceleración apagada, máquina virtual
// o escritorio remoto), three lanza al crear el renderer y la página se quedaría en negro: se mira antes y, si no hay,
// se enseña una pantalla que lo explica (SinGraficos.tsx). El lienzo se puede cambiar para probarlo en Node.
export function hayWebGL2(crearCanvas: () => HTMLCanvasElement = () => document.createElement('canvas')): boolean {
  try {
    const gl = crearCanvas().getContext('webgl2') as WebGL2RenderingContext | null;
    if (!gl) return false;
    // el contexto de prueba se suelta enseguida: los navegadores limitan cuántos hay vivos y three crea el suyo después
    try { gl.getExtension?.('WEBGL_lose_context')?.loseContext(); } catch {}
    return true;
  } catch { return false; }
}

export function textoSinGraficos(): { titulo: string; parrafos: string[] } {
  return {
    titulo: 'Sin gráficos 3D',
    parrafos: [
      'Este equipo no le está dando a work-shelter la aceleración 3D que necesita (WebGL2), así que el refugio no se puede dibujar.',
      'Suele pasar porque faltan los controladores de la tarjeta gráfica o están anticuados, porque la aceleración por hardware está desactivada, o porque se está usando en una máquina virtual o en un escritorio remoto.',
      'Qué hacer: instala o actualiza los controladores gráficos desde la herramienta de software de tu sistema, activa la aceleración por hardware si la tienes apagada y vuelve a abrir work-shelter. En Linux, ./shelter doctor comprueba si el sistema ve una tarjeta gráfica.',
    ],
  };
}
