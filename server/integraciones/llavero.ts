// Secretos en el llavero del sistema, sin dependencias nativas: en macOS con /usr/bin/security; en Linux con
// `secret-tool` (paquete libsecret), que habla con el servicio de secretos del escritorio (KWallet, GNOME Keyring,
// KeePassXC…). Servicio «work-shelter-public», cuenta «<fuente>.<campo>» (p. ej. linear.apiKey, outlook.refreshToken).
// El secreto NUNCA va en argv (se vería en `ps`): `security -i` lee la orden por stdin y `secret-tool store` lee el valor
// por stdin. En macOS el valor va en base64 para evitar comillas en el modo interactivo y que `-w` lo devuelva en
// hexadecimal si no es ASCII. Sin `secret-tool` o sin servicio de secretos, falla cerrado: nunca se guarda en otro sitio.
// Contrapartida (documentada): mientras el llavero está desbloqueado, otro proceso del mismo usuario podría leer el
// elemento sin aviso (en macOS la app de confianza es el propio `security`). Para un equipo personal se acepta; nunca
// se escribe en .data/, git ni logs.
import { execFile } from 'node:child_process';
import { enPath, type Buscador } from '../plataforma.ts';

export const SERVICIO = 'work-shelter-public';
const SECURITY = '/usr/bin/security';
const NO_EXISTE = 44;

export interface Llavero {
  leer(cuenta: string): Promise<string | null>;
  guardar(cuenta: string, valor: string): Promise<void>;
  borrar(cuenta: string): Promise<void>;
}

export interface Resultado { codigo: number; salida: string; error: string }
/** Lanza un programa con el secreto (si lo hay) por stdin; en los tests, un falso que no toca el llavero real */
export type Ejecutar = (bin: string, args: string[], entrada?: string, tiempo?: number) => Promise<Resultado>;
const ejecutarReal: Ejecutar = (bin, args, entrada, tiempo = 15_000) => new Promise(resolve => {
  const p = execFile(bin, args, { timeout: tiempo, maxBuffer: 1 << 20 }, (err, salida, error) => {
    const codigo = err ? (typeof (err as any).code === 'number' ? (err as any).code : -1) : 0;
    resolve({ codigo, salida: String(salida), error: String(error) });
  });
  // un programa que cierra stdin antes de tiempo no debe tumbar el servidor (el código de salida ya dice el fallo)
  p.stdin?.on('error', () => {});
  if (entrada !== undefined) { p.stdin?.end(entrada); }
});

// Mensaje sin el secreto: solo el código y la primera línea de stderr (que no lo contiene)
function fallo(que: string, r: { codigo: number; error: string }, mac = true) {
  const detalle = `(código ${r.codigo}${r.error.trim() ? ': ' + r.error.trim().split('\n')[0] : ''})`;
  return new Error(mac
    ? `El llavero de macOS no pudo ${que} ${detalle}. ¿Está bloqueado o se denegó el acceso?`
    : `El llavero del sistema no pudo ${que} ${detalle}. ¿Está bloqueado, se denegó el acceso o no hay un servicio de secretos (KWallet, GNOME Keyring…) en marcha?`);
}

const validaCuenta = (c: string) => { if (!/^[a-z]+\.[A-Za-z0-9_-]+$/.test(c)) throw new Error('Cuenta de llavero no válida: ' + c); };

export const llaveroMac: Llavero = {
  async leer(cuenta) {
    validaCuenta(cuenta);
    const r = await ejecutarReal(SECURITY, ['find-generic-password', '-s', SERVICIO, '-a', cuenta, '-w']);
    if (r.codigo === NO_EXISTE) return null;
    if (r.codigo !== 0) throw fallo('leer el secreto', r);
    const b64 = r.salida.trim();
    try { return Buffer.from(b64, 'base64').toString('utf8'); } catch { return null; }
  },
  async guardar(cuenta, valor) {
    validaCuenta(cuenta);
    const b64 = Buffer.from(valor, 'utf8').toString('base64');
    const fuente = cuenta.split('.')[0];
    // `security -i` lee órdenes por stdin: el secreto no aparece en la lista de procesos
    const r = await ejecutarReal(SECURITY, ['-i'], `add-generic-password -U -s ${SERVICIO} -a ${cuenta} -l "work-shelter: ${fuente}" -w ${b64}\n`);
    if (r.codigo !== 0) throw fallo('guardar el secreto', r);
    // En modo interactivo `security` puede salir con 0 aunque la orden falle: se comprueba leyendo
    const leido = await this.leer(cuenta);
    if (leido !== valor) throw fallo('guardar el secreto', { codigo: r.codigo, error: r.error || 'no se pudo verificar' });
  },
  async borrar(cuenta) {
    validaCuenta(cuenta);
    const r = await ejecutarReal(SECURITY, ['delete-generic-password', '-s', SERVICIO, '-a', cuenta]);
    if (r.codigo !== 0 && r.codigo !== NO_EXISTE) throw fallo('borrar el secreto', r);
  },
};

/** Lo cambiable del llavero de Linux en los tests: cómo se lanza el programa y dónde se busca `secret-tool` */
export interface OpcionesLinux { ejecutar?: Ejecutar; buscar?: Buscador }
// el escritorio puede pedir desbloquear el llavero y la persona tiene que contestar: más margen que en macOS
const TIEMPO_LINUX = 120_000;
export function crearLlaveroLinux(o: OpcionesLinux = {}): Llavero {
  const ejecutar = o.ejecutar ?? ejecutarReal, buscar = o.buscar ?? (n => enPath(n));
  const secretTool = () => {
    const bin = buscar('secret-tool');
    if (!bin) throw new Error('No encuentro `secret-tool`, que guarda las credenciales en el llavero del sistema: instala el paquete libsecret (necesita un servicio de secretos en marcha, como KWallet o GNOME Keyring). Sin él no se guarda ninguna credencial.');
    return bin;
  };
  const atributos = (cuenta: string) => ['service', SERVICIO, 'account', cuenta];
  // `secret-tool` sale con 1 y sin stderr cuando el elemento no existe; con stderr, es un fallo de verdad
  const noExiste = (r: Resultado) => r.codigo === 1 && !r.error.trim();
  return {
    async leer(cuenta) {
      validaCuenta(cuenta);
      const r = await ejecutar(secretTool(), ['lookup', ...atributos(cuenta)], undefined, TIEMPO_LINUX);
      if (r.codigo === 0) return r.salida;
      if (noExiste(r)) return null;
      throw fallo('leer el secreto', r, false);
    },
    async guardar(cuenta, valor) {
      validaCuenta(cuenta);
      const fuente = cuenta.split('.')[0];
      const r = await ejecutar(secretTool(), ['store', `--label=work-shelter: ${fuente}`, ...atributos(cuenta)], valor, TIEMPO_LINUX);
      if (r.codigo !== 0) throw fallo('guardar el secreto', r, false);
      const leido = await this.leer(cuenta);
      if (leido !== valor) throw fallo('guardar el secreto', { codigo: r.codigo, error: r.error || 'no se pudo verificar' }, false);
    },
    async borrar(cuenta) {
      validaCuenta(cuenta);
      const r = await ejecutar(secretTool(), ['clear', ...atributos(cuenta)], undefined, TIEMPO_LINUX);
      if (r.codigo !== 0 && !noExiste(r)) throw fallo('borrar el secreto', r, false);
    },
  };
}
export const llaveroLinux = crearLlaveroLinux();
/** El llavero de este sistema: el de macOS en un Mac y el del servicio de secretos en el resto */
export const llaveroSistema: Llavero = process.platform === 'darwin' ? llaveroMac : llaveroLinux;

// Llavero en memoria para pruebas (nunca se usa en producción salvo que lo pidan las pruebas)
export function llaveroMemoria(inicial: Record<string, string> = {}): Llavero & { datos: Map<string, string> } {
  const datos = new Map(Object.entries(inicial));
  return { datos, async leer(c) { return datos.get(c) ?? null; }, async guardar(c, v) { datos.set(c, v); }, async borrar(c) { datos.delete(c); } };
}

let actual: Llavero = llaveroSistema;
export function usarLlavero(l: Llavero) { actual = l; }
export const leerSecreto = (cuenta: string) => actual.leer(cuenta);
export const guardarSecreto = (cuenta: string, valor: string) => actual.guardar(cuenta, valor);
export const borrarSecreto = (cuenta: string) => actual.borrar(cuenta);
