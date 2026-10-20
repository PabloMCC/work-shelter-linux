// Pantalla en lugar del juego cuando el equipo no da WebGL2 (graficos.ts): con el aspecto de la de carga, sin motor 3D.
import { textoSinGraficos } from './graficos';

export function SinGraficos() {
  const { titulo, parrafos } = textoSinGraficos();
  return (
    <div className="pantalla-carga" role="alert">
      <div className="titulo-carga">{titulo}</div>
      <div style={{ maxWidth: '38em', padding: '0 1.5em', textAlign: 'center', lineHeight: 1.5 }}>
        {parrafos.map((p, i) => <p key={i} className="texto-carga" style={{ margin: '0.8em 0' }}>{p}</p>)}
      </div>
    </div>
  );
}
