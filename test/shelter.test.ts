// Lo que el lanzador ./shelter decide según el sistema (scripts/plataforma.sh): cada función se prueba en un bash aparte
// con un PATH falso (uname, sumas y navegadores de mentira que apuntan sus argumentos), así que da lo mismo en un runner
// de macOS que en uno de Linux. Nunca se ejecuta ./shelter.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const RAIZ = path.resolve(__dirname, '..');
const PLATAFORMA = path.join(RAIZ, 'scripts', 'plataforma.sh');
let dir = ''; let reg = '';

beforeEach(() => { dir = mkdtempSync(path.join(tmpdir(), 'shelter-prueba-')); reg = path.join(dir, 'registro'); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

// un programa falso en el PATH de la prueba: apunta su nombre, sus argumentos y lo que le llegue por la entrada
const falso = (nombre: string, salida = 0) => {
  const f = path.join(dir, nombre);
  writeFileSync(f, `#!/bin/bash\nprintf '%s\\n' "${nombre} $*" >> "$REG"\nif [ ! -t 0 ]; then while IFS= read -r l; do printf '%s\\n' "$l" >> "$REG"; done; fi\nexit ${salida}\n`);
  chmodSync(f, 0o755);
};
const unameFalso = () => {
  const f = path.join(dir, 'uname');
  writeFileSync(f, '#!/bin/bash\ncase "$1" in -s) echo "$FALSO_S" ;; -m) echo "$FALSO_M" ;; *) exit 1 ;; esac\n');
  chmodSync(f, 0o755);
};
// bash con plataforma.sh cargado; sin `real`, el PATH solo tiene los programas falsos
const bash = (orden: string, o: { s?: string; m?: string; real?: boolean; entrada?: string; env?: Record<string, string> } = {}) => {
  unameFalso();
  const r = spawnSync('/bin/bash', ['-c', `source "${PLATAFORMA}"; ${orden}`], {
    encoding: 'utf8', input: o.entrada ?? '',
    // con HOME: en los runners de macOS, sin él, el entorno de Homebrew escribe un error en stderr
    env: { PATH: o.real ? `${process.env.PATH}` : dir, HOME: dir, REG: reg, FALSO_S: o.s ?? 'Linux', FALSO_M: o.m ?? 'x86_64', ...o.env },
  });
  return { codigo: r.status, salida: r.stdout.trim(), error: r.stderr.trim() };
};
const registro = () => (existsSync(reg) ? readFileSync(reg, 'utf8').trim().split('\n') : []);

describe('sintaxis', () => {
  it('shelter y plataforma.sh pasan bash -n', () => {
    for (const f of [path.join(RAIZ, 'shelter'), PLATAFORMA]) expect(spawnSync('/bin/bash', ['-n', f]).status).toBe(0);
  });
});

describe('so_node y arq_node', () => {
  it('traduce el sistema al nombre de Node', () => {
    expect(bash('so_node', { s: 'Darwin' })).toMatchObject({ codigo: 0, salida: 'darwin' });
    expect(bash('so_node', { s: 'Linux' })).toMatchObject({ codigo: 0, salida: 'linux' });
  });
  it('un sistema desconocido da un error claro', () => {
    const r = bash('so_node', { s: 'FreeBSD' });
    expect(r.codigo).not.toBe(0); expect(r.salida).toBe(''); expect(r.error).toContain('FreeBSD');
  });
  it('traduce la arquitectura', () => {
    for (const [m, a] of [['x86_64', 'x64'], ['amd64', 'x64'], ['arm64', 'arm64'], ['aarch64', 'arm64']]) {
      for (const s of ['Darwin', 'Linux']) expect(bash('arq_node', { s, m })).toMatchObject({ codigo: 0, salida: a });
    }
  });
  it('una arquitectura desconocida da un error claro', () => {
    const r = bash('arq_node', { m: 'riscv64' });
    expect(r.codigo).not.toBe(0); expect(r.salida).toBe(''); expect(r.error).toContain('riscv64');
  });
});

describe('suma_node', () => {
  // las sumas viven solo en plataforma.sh: aquí, dos comprobadas a mano contra SHASUMS256.txt y el formato de todas
  it('da la suma oficial de la versión de ./shelter para cada combinación', () => {
    const version = /^NODO_VERSION="([^"]+)"/m.exec(readFileSync(path.join(RAIZ, 'shelter'), 'utf8'))?.[1];
    const sumas = new Set<string>();
    for (const par of ['darwin arm64', 'darwin x64', 'linux arm64', 'linux x64']) {
      const r = bash(`suma_node ${version} ${par}`);
      expect(r.codigo).toBe(0); expect(r.salida).toMatch(/^[0-9a-f]{64}$/); sumas.add(r.salida);
    }
    expect(sumas.size).toBe(4);
    expect(bash('suma_node 24.22.0 linux x64').salida).toBe('28ea0a438de9a13bd7891fd758eee6c7819ee8af5442dfd8d45bd65e56d4228c');
    expect(bash('suma_node 24.22.0 darwin arm64').salida).toBe('6a9724d9b50a5f22b4816cded441b5a8d9ddae546191a5e5b7efa5a5e2ee26d5');
  });
  it('otra versión sin sus sumas se niega antes de descargar, con un mensaje que la nombra', () => {
    const r = bash('suma_node 24.21.0 linux x64');
    expect(r.codigo).not.toBe(0); expect(r.salida).toBe(''); expect(r.error).toContain('24.21.0');
  });
  it('sin suma conocida se niega (nunca se descarga nada sin comprobar)', () => {
    for (const par of ['24.22.0 linux riscv64', '24.22.0 win x64', '24.22.0 darwin', 'linux x64', '']) {
      const r = bash(`suma_node ${par}`);
      expect(r.codigo).not.toBe(0); expect(r.salida).toBe('');
    }
  });
});

describe('sha256_comprobar', () => {
  it('usa sha256sum si está', () => {
    falso('sha256sum'); falso('shasum');
    expect(bash('sha256_comprobar', { entrada: 'abc  f\n' }).codigo).toBe(0);
    expect(registro()).toEqual(['sha256sum -c -', 'abc  f']);
  });
  it('si no, shasum -a 256', () => {
    falso('shasum');
    expect(bash('sha256_comprobar', { entrada: 'abc  f\n' }).codigo).toBe(0);
    expect(registro()).toEqual(['shasum -a 256 -c -', 'abc  f']);
  });
  it('propaga el fallo de la comprobación', () => {
    falso('sha256sum', 1);
    expect(bash('sha256_comprobar', { entrada: 'abc  f\n' }).codigo).not.toBe(0);
  });
  it('sin ninguna de las dos, falla', () => {
    const r = bash('sha256_comprobar', { entrada: 'abc  f\n' });
    expect(r.codigo).not.toBe(0); expect(r.error).not.toBe('');
  });
  it('con las herramientas reales del sistema acepta la buena y rechaza la mala', () => {
    const f = path.join(dir, 'datos'); writeFileSync(f, 'work-shelter\n');
    const buena = createHash('sha256').update('work-shelter\n').digest('hex');
    expect(bash('sha256_comprobar >/dev/null', { real: true, entrada: `${buena}  ${f}\n` }).codigo).toBe(0);
    expect(bash('sha256_comprobar >/dev/null 2>&1', { real: true, entrada: `${'0'.repeat(64)}  ${f}\n` }).codigo).not.toBe(0);
  });
});

describe('huella_de (el sello de package-lock.json)', () => {
  it('es la SHA-1 en hexadecimal, la misma que guardaba el sello hasta ahora', () => {
    const f = path.join(dir, 'lock'); writeFileSync(f, '{"lockfileVersion":3}\n');
    const sha1 = createHash('sha1').update('{"lockfileVersion":3}\n').digest('hex');
    expect(bash(`huella_de "${f}"`, { real: true })).toMatchObject({ codigo: 0, salida: sha1 });
  });
  it('usa shasum si está (macOS, como antes) y si no sha1sum', () => {
    falso('shasum'); falso('sha1sum');
    bash('huella_de lock');
    expect(registro()).toEqual(['shasum lock']);
    rmSync(path.join(dir, 'shasum')); rmSync(reg);
    bash('huella_de lock');
    expect(registro()).toEqual(['sha1sum lock']);
  });
  it('sin ninguna de las dos, falla', () => {
    expect(bash('huella_de lock').codigo).not.toBe(0);
  });
});

describe('abrir_url', () => {
  const URL = 'http://127.0.0.1:3778/#t=abc';
  it('en macOS usa open', () => {
    falso('open'); falso('xdg-open');
    expect(bash(`abrir_url "${URL}"`, { s: 'Darwin' }).codigo).toBe(0);
    expect(registro()).toEqual([`open ${URL}`]);
  });
  it('en Linux usa xdg-open', () => {
    falso('open'); falso('xdg-open');
    expect(bash(`abrir_url "${URL}"`, { s: 'Linux' }).codigo).toBe(0);
    expect(registro()).toEqual([`xdg-open ${URL}`]);
  });
  it('en Linux sin xdg-open escribe la URL para abrirla a mano', () => {
    falso('open');
    const r = bash(`abrir_url "${URL}"`, { s: 'Linux' });
    expect(r.codigo).toBe(0); expect(r.salida).toContain(URL); expect(registro()).toEqual([]);
  });
  it('en Linux, si xdg-open falla, también escribe la URL', () => {
    falso('xdg-open', 3);
    const r = bash(`abrir_url "${URL}"`, { s: 'Linux' });
    expect(r.codigo).toBe(0); expect(r.salida).toContain(URL); expect(registro()).toEqual([`xdg-open ${URL}`]);
  });
});

describe('instalar-app y desinstalar-app (sus puertas y su instalador)', () => {
  it('instalar_app_disponible: en macOS y en Linux deja pasar sin decir nada; en otro sistema se niega', () => {
    expect(bash('instalar_app_disponible', { s: 'Darwin' })).toMatchObject({ codigo: 0, salida: '', error: '' });
    expect(bash('instalar_app_disponible', { s: 'Linux' })).toMatchObject({ codigo: 0, salida: '', error: '' });
    const r = bash('instalar_app_disponible', { s: 'FreeBSD' });
    expect(r.codigo).not.toBe(0); expect(r.error).toContain('FreeBSD');
  });
  it('instalador_app: la app de macOS o el acceso en el menú de Linux', () => {
    expect(bash('instalador_app', { s: 'Darwin' })).toMatchObject({ codigo: 0, salida: 'scripts/instalar-app.mjs' });
    expect(bash('instalador_app', { s: 'Linux' })).toMatchObject({ codigo: 0, salida: 'scripts/instalar-app-linux.mjs' });
    expect(bash('instalador_app', { s: 'FreeBSD' }).codigo).not.toBe(0);
  });
  it('desinstalar_app_disponible: solo en Linux; en macOS lo dice y sale con 1', () => {
    expect(bash('desinstalar_app_disponible', { s: 'Linux' })).toMatchObject({ codigo: 0, salida: '', error: '' });
    const r = bash('desinstalar_app_disponible', { s: 'Darwin' });
    expect(r.codigo).toBe(1); expect(r.error).toMatch(/solo.*Linux/);
    expect(bash('desinstalar_app_disponible', { s: 'FreeBSD' }).codigo).not.toBe(0);
  });
  it('./shelter consulta las puertas antes de preparar nada; desinstalar va tras Node y antes de las dependencias', () => {
    const t = readFileSync(path.join(RAIZ, 'shelter'), 'utf8');
    const nodo = t.indexOf('# 1. Node');
    for (const puerta of ['instalar_app_disponible || exit 1', 'desinstalar_app_disponible || exit 1']) {
      const i = t.indexOf(puerta);
      expect(i, puerta).toBeGreaterThan(0);
      for (const paso of ['# 1. Node', 'curl ', 'npm', 'install.js']) expect(i, puerta).toBeLessThan(t.indexOf(paso));
    }
    const quitar = t.indexOf('scripts/instalar-app-linux.mjs --desinstalar');
    expect(quitar).toBeGreaterThan(nodo);
    for (const paso of ['# 2. Claude', 'npm ci', 'install.js', 'descargar-assets']) expect(quitar).toBeLessThan(t.indexOf(paso));
    expect(t).toMatch(/exec "\$NODE" "\$\(instalador_app\)" "\$@"/);
    expect(t).not.toMatch(/uname -s/);
  });
});

describe('registro_desde_menu (./shelter abierto desde el menú, sin terminal)', () => {
  // con las herramientas reales pero el uname falso delante: estas pruebas son de la carpeta de Linux (en macOS, uname
  // diría Darwin y el registro iría a ~/Library/Logs)
  const comoLinux = () => (unameFalso(), { PATH: `${dir}:${process.env.PATH}` });
  it('manda lo que se escriba (también los errores) al shelter.log, solo legible por ti', () => {
    const estado = path.join(dir, 'estado');
    const r = bash('registro_desde_menu && { echo hola; echo fallo >&2; }', { real: true, env: { ...comoLinux(), XDG_STATE_HOME: estado } });
    expect(r).toMatchObject({ codigo: 0, salida: '', error: '' });
    const log = path.join(estado, 'work-shelter-public', 'shelter.log');
    const texto = readFileSync(log, 'utf8');
    expect(texto).toMatch(/^== .+ ==$/m); expect(texto).toContain('hola'); expect(texto).toContain('fallo');
    expect(statSync(log).mode & 0o777).toBe(0o600); expect(statSync(path.dirname(log)).mode & 0o777).toBe(0o700);
  });
  it('sin más, se añade al final: un arranque que solo trae al frente la ventana no rota el registro del que está abierto', () => {
    const estado = path.join(dir, 'estado'); const log = path.join(estado, 'work-shelter-public', 'shelter.log');
    const env = { ...comoLinux(), XDG_STATE_HOME: estado };
    bash('registro_desde_menu && echo primero', { real: true, env });
    bash('registro_desde_menu && echo segundo', { real: true, env });
    const texto = readFileSync(log, 'utf8');
    expect(texto).toContain('primero'); expect(texto).toContain('segundo');
    expect(texto.indexOf('primero')).toBeLessThan(texto.indexOf('segundo'));
    expect(existsSync(`${log}.1`)).toBe(false);
    expect(statSync(log).mode & 0o777).toBe(0o600);
  });
  it('con «nuevo» (el arranque que abre el servidor) empieza un registro nuevo y guarda solo el anterior en shelter.log.1', () => {
    const estado = path.join(dir, 'estado'); const log = path.join(estado, 'work-shelter-public', 'shelter.log');
    const env = { ...comoLinux(), XDG_STATE_HOME: estado };
    bash('registro_desde_menu && echo primero', { real: true, env });
    bash('registro_desde_menu nuevo && echo segundo', { real: true, env });
    expect(readFileSync(log, 'utf8')).toContain('segundo'); expect(readFileSync(log, 'utf8')).not.toContain('primero');
    expect(readFileSync(`${log}.1`, 'utf8')).toContain('primero');
    bash('registro_desde_menu nuevo && echo tercero', { real: true, env });
    expect(readFileSync(log, 'utf8')).toContain('tercero');
    expect(readFileSync(`${log}.1`, 'utf8')).toContain('segundo'); expect(readFileSync(`${log}.1`, 'utf8')).not.toContain('primero');
    for (const f of [log, `${log}.1`]) expect(statSync(f).mode & 0o777, f).toBe(0o600);
  });
  it('lo ya redirigido sigue en el registro tras rotar: lo de antes queda en shelter.log.1 y lo de después en el nuevo', () => {
    const estado = path.join(dir, 'estado'); const log = path.join(estado, 'work-shelter-public', 'shelter.log');
    bash('registro_desde_menu && echo antes && registro_desde_menu nuevo && echo despues', { real: true, env: { ...comoLinux(), XDG_STATE_HOME: estado } });
    expect(readFileSync(`${log}.1`, 'utf8')).toContain('antes'); expect(readFileSync(`${log}.1`, 'utf8')).not.toContain('despues');
    expect(readFileSync(log, 'utf8')).toContain('despues'); expect(readFileSync(log, 'utf8')).not.toContain('antes');
  });
  it('un registro que ya existía con otros permisos queda a 600, se añada o se rote', () => {
    const estado = path.join(dir, 'estado'); const log = path.join(estado, 'work-shelter-public', 'shelter.log');
    mkdirSync(path.dirname(log), { recursive: true }); writeFileSync(log, 'viejo\n'); chmodSync(log, 0o644);
    bash('registro_desde_menu', { real: true, env: { ...comoLinux(), XDG_STATE_HOME: estado } });
    expect(statSync(log).mode & 0o777).toBe(0o600); expect(readFileSync(log, 'utf8')).toMatch(/^viejo\n/);
    chmodSync(log, 0o644);
    bash('registro_desde_menu nuevo', { real: true, env: { ...comoLinux(), XDG_STATE_HOME: estado } });
    expect(statSync(log).mode & 0o777).toBe(0o600); expect(statSync(`${log}.1`).mode & 0o777).toBe(0o600);
    expect(readFileSync(`${log}.1`, 'utf8')).toMatch(/^viejo\n/);
  });
  it('si no se puede crear el registro, falla y la salida se queda donde estaba', () => {
    const tapon = path.join(dir, 'tapon'); writeFileSync(tapon, '');   // un archivo donde tendría que ir la carpeta
    const r = bash('registro_desde_menu || echo sigue', { real: true, env: { ...comoLinux(), XDG_STATE_HOME: tapon } });
    expect(r.salida).toBe('sigue');
  });
  it('./shelter lo usa con SHELTER_DESDE_MENU nada más cargar plataforma.sh, antes de preparar nada', () => {
    const t = readFileSync(path.join(RAIZ, 'shelter'), 'utf8');
    const i = t.indexOf('registro_desde_menu');
    expect(i).toBeGreaterThan(t.indexOf('source scripts/plataforma.sh'));
    expect(t.slice(t.lastIndexOf('\n', i), i)).toContain('SHELTER_DESDE_MENU');
    for (const paso of ['# 1. Node', 'curl ', 'npm']) expect(i).toBeLessThan(t.indexOf(paso));
    expect(t.slice(i, t.indexOf('\n', i))).toMatch(/registro_desde_menu \|\| true/);   // al principio, sin rotar
  });
  it('./shelter solo rota cuando este arranque va a abrir el servidor: justo antes del supervisor, nunca con uno que contesta', () => {
    const t = readFileSync(path.join(RAIZ, 'shelter'), 'utf8');
    expect(t.split('registro_desde_menu nuevo')).toHaveLength(2);
    const rota = t.indexOf('registro_desde_menu nuevo');
    const sinServidor = t.indexOf('\nelse\n', t.indexOf('traigo su ventana al frente'));
    expect(sinServidor).toBeGreaterThan(0);
    expect(rota).toBeGreaterThan(sinServidor); expect(rota).toBeLessThan(t.indexOf('server/supervisor.mjs'));
    expect(t.slice(t.lastIndexOf('\n', rota), rota)).toContain('SHELTER_DESDE_MENU');
  });
});

describe('tomar_cerrojo (dos arranques a la vez no preparan a la vez)', () => {
  const cerrojo = () => path.join(dir, '.runtime', 'lanzador.lock');
  it('dos a la vez, sin esperar: solo uno se lo queda (10 rondas)', { timeout: 20_000 }, () => {
    for (let i = 0; i < 10; i++) {
      rmSync(path.join(dir, '.runtime'), { recursive: true, force: true });
      const uno = `source "${PLATAFORMA}"; tomar_cerrojo "${cerrojo()}" 0 2>/dev/null && { echo dentro; sleep 0.1; }`;
      const r = bash(`for q in A B; do bash -c '${uno}' & done; wait`, { real: true });
      expect(r.salida.split('\n').filter(Boolean)).toHaveLength(1);
    }
  });
  it('el segundo espera a que el primero lo suelte y entonces se lo queda', () => {
    const r = bash(`( tomar_cerrojo "${cerrojo()}" && { echo "A dentro"; sleep 1; echo "A fuera"; soltar_cerrojo; } ) &
      sleep 0.3; tomar_cerrojo "${cerrojo()}" 10 && echo "B dentro"; wait`, { real: true });
    expect(r.salida.split('\n')).toEqual(['A dentro', 'A fuera', 'B dentro']);
    expect(r.error).toContain('Otro arranque de work-shelter está preparándolo');
    expect(r.error.match(/espero/g)).toHaveLength(1);   // avisa una sola vez
  });
  it('con el dueño muerto, se recupera', () => {
    const muerto = spawnSync('true').pid!;
    mkdirSync(cerrojo(), { recursive: true }); writeFileSync(path.join(cerrojo(), 'pid'), `${muerto}\n`);
    const r = bash(`tomar_cerrojo "${cerrojo()}" 2 && cat "${path.join(cerrojo(), 'pid')}" && echo "$$"`, { real: true });
    const [pid, propio] = r.salida.split('\n');
    expect(r.codigo).toBe(0); expect(pid).toBe(propio); expect(existsSync(`${cerrojo()}.romper`)).toBe(false);
  });
  it('dos procesos a la vez ante un cerrojo de un dueño muerto: solo uno lo recupera (10 rondas)', { timeout: 20_000 }, () => {
    const muerto = spawnSync('true').pid!;
    for (let i = 0; i < 10; i++) {
      rmSync(path.join(dir, '.runtime'), { recursive: true, force: true });
      mkdirSync(cerrojo(), { recursive: true }); writeFileSync(path.join(cerrojo(), 'pid'), `${muerto}\n`);
      const uno = `source "${PLATAFORMA}"; tomar_cerrojo "${cerrojo()}" 0 2>/dev/null && { echo dentro; sleep 0.2; }`;
      const r = bash(`for q in A B; do bash -c '${uno}' & done; wait`, { real: true });
      expect(r.salida.split('\n').filter(Boolean)).toEqual(['dentro']);
      expect(existsSync(`${cerrojo()}.romper`)).toBe(false);
    }
  });
  it('con el dueño vivo, espera, se rinde con un mensaje claro y no le quita el cerrojo', () => {
    mkdirSync(cerrojo(), { recursive: true }); writeFileSync(path.join(cerrojo(), 'pid'), `${process.pid}\n`);
    const inicio = Date.now();
    const r = bash(`tomar_cerrojo "${cerrojo()}" 1`, { real: true });
    expect(r.codigo).toBe(1); expect(Date.now() - inicio).toBeGreaterThanOrEqual(900);
    expect(r.error).toContain(`Otro arranque de work-shelter (pid ${process.pid}) sigue preparándolo`);
    expect(readFileSync(path.join(cerrojo(), 'pid'), 'utf8').trim()).toBe(String(process.pid));
  });
  it('un .romper abandonado (su dueño murió entre crearlo y quitarlo) se recupera', () => {
    const muerto = spawnSync('true').pid!;
    for (const c of [cerrojo(), `${cerrojo()}.romper`]) { mkdirSync(c, { recursive: true }); writeFileSync(path.join(c, 'pid'), `${muerto}\n`); }
    const r = bash(`tomar_cerrojo "${cerrojo()}" 2 && cat "${path.join(cerrojo(), 'pid')}" && echo "$$"`, { real: true });
    const [pid, propio] = r.salida.split('\n');
    expect(r.codigo).toBe(0); expect(pid).toBe(propio); expect(existsSync(`${cerrojo()}.romper`)).toBe(false);
  });
  it('un .romper de un dueño vivo se respeta: no se toca ni se recupera el cerrojo', () => {
    const muerto = spawnSync('true').pid!;
    mkdirSync(cerrojo(), { recursive: true }); writeFileSync(path.join(cerrojo(), 'pid'), `${muerto}\n`);
    mkdirSync(`${cerrojo()}.romper`); writeFileSync(path.join(`${cerrojo()}.romper`, 'pid'), `${process.pid}\n`);
    const r = bash(`tomar_cerrojo "${cerrojo()}" 1`, { real: true });
    expect(r.codigo).toBe(1);
    expect(readFileSync(path.join(`${cerrojo()}.romper`, 'pid'), 'utf8').trim()).toBe(String(process.pid));
    expect(readFileSync(path.join(cerrojo(), 'pid'), 'utf8').trim()).toBe(String(muerto));
  });
  it('pid_de_cerrojo sin archivo pid falla sin ruido en stderr', () => {
    expect(bash(`pid_de_cerrojo "${path.join(dir, 'nada')}"`, { real: true })).toMatchObject({ codigo: 1, salida: '', error: '' });
    mkdirSync(cerrojo(), { recursive: true }); writeFileSync(path.join(cerrojo(), 'pid'), '123');   // sin salto de línea
    expect(bash(`pid_de_cerrojo "${cerrojo()}"`, { real: true })).toMatchObject({ codigo: 0, salida: '123', error: '' });
  });
  it('soltar_cerrojo solo quita el suyo', () => {
    mkdirSync(cerrojo(), { recursive: true }); writeFileSync(path.join(cerrojo(), 'pid'), `${process.pid}\n`);
    bash(`CERROJO_LANZADOR="${cerrojo()}"; soltar_cerrojo`, { real: true });
    expect(existsSync(cerrojo())).toBe(true);
    expect(bash(`tomar_cerrojo "${cerrojo()}" 0 2>/dev/null || exit 9`, { real: true }).codigo).toBe(9);
    rmSync(cerrojo(), { recursive: true });
    expect(bash(`tomar_cerrojo "${cerrojo()}" 0 && soltar_cerrojo && [ ! -e "${cerrojo()}" ]`, { real: true }).codigo).toBe(0);
  });
  it('./shelter lo toma antes de preparar nada, lo suelta antes de cada exec posterior y cuando el servidor contesta', () => {
    const t = readFileSync(path.join(RAIZ, 'shelter'), 'utf8');
    const toma = t.indexOf('tomar_cerrojo "$RAIZ/.runtime/lanzador.lock"');
    expect(toma).toBeGreaterThan(t.indexOf("trap 'soltar_cerrojo' EXIT"));
    for (const paso of ['# 1. Node', 'curl -fL', 'npm ci', 'install.js']) expect(toma).toBeLessThan(t.indexOf(paso));
    // cada exec tras tomarlo lo suelta antes (superficie y enganchar van antes de tomarlo: no lo esperan)
    for (const l of t.slice(toma).split('\n').filter(l => /\bexec "\$NODE"/.test(l))) expect(l, l).toContain('soltar_cerrojo; exec');
    expect(t.indexOf('soltar_cerrojo   # el servidor ya contesta')).toBeGreaterThan(t.indexOf('URL="http://127.0.0.1:$PUERTO/#t='));
    expect(t).toContain('traigo su ventana al frente');
  });
  it('./shelter, si no consigue el cerrojo, no prepara nada: va directo a ya_abierto_sin_cerrojo y sale', () => {
    const t = readFileSync(path.join(RAIZ, 'shelter'), 'utf8');
    const linea = t.split('\n').find(l => l.includes('tomar_cerrojo "$RAIZ/.runtime/lanzador.lock"'))!;
    expect(linea).toMatch(/^if ! tomar_cerrojo "\$RAIZ\/\.runtime\/lanzador\.lock"; then ya_abierto_sin_cerrojo "\$RAIZ" "\$PUERTO" "\$DATOS" && exit 0; exit 1; fi$/);
    expect(t.indexOf('PUERTO="${SHELTER_PUERTO:-3778}"')).toBeLessThan(t.indexOf(linea));
    expect(t.indexOf('DATOS="${SHELTER_DATOS:-$RAIZ/.data}"')).toBeLessThan(t.indexOf(linea));
  });
  it('superficie y enganchar no esperan al cerrojo (no preparan nada) ni descargan Node', () => {
    const t = readFileSync(path.join(RAIZ, 'shelter'), 'utf8');
    const toma = t.indexOf('tomar_cerrojo "$RAIZ/.runtime/lanzador.lock"');
    const sub = t.indexOf('exec "$NODE" --import tsx server/superficie.ts');
    expect(sub).toBeGreaterThan(0); expect(sub).toBeLessThan(toma);
    expect(t.slice(0, toma)).not.toMatch(/curl -fL|npm" ci|install\.js/);
  });
});

describe('ya_abierto_sin_cerrojo (se agotó la espera del cerrojo: nunca se prepara nada)', () => {
  const juego = () => path.join(dir, 'juego'); const datos = () => path.join(dir, 'datos');
  // el binario de Electron ya descargado, como lo deja su paquete: dist/<path.txt>
  const electronDescargado = () => {
    const e = path.join(juego(), 'node_modules', 'electron'); mkdirSync(path.join(e, 'dist'), { recursive: true });
    writeFileSync(path.join(e, 'path.txt'), 'electron');
    const f = path.join(e, 'dist', 'electron');
    writeFileSync(f, '#!/bin/bash\nprintf \'%s\\n\' "electron $* url=$SHELTER_URL" >> "$REG"\n'); chmodSync(f, 0o755);
  };
  // los que preparan, de mentira: si alguno se llamara, quedaría en el registro
  const llamar = (servidor: boolean, env: Record<string, string> = {}) => {
    falso('curl', servidor ? 0 : 7); for (const p of ['npm', 'node', 'npx', 'tar']) falso(p);
    mkdirSync(datos(), { recursive: true }); writeFileSync(path.join(datos(), 'token'), 'secreto\n');
    return bash(`ya_abierto_sin_cerrojo "${juego()}" 3778 "${datos()}"`, { env });
  };
  const SALUD = 'curl -fs http://127.0.0.1:3778/salud';
  it('con un servidor que contesta y Electron ya descargado: lo lanza para traer al frente la ventana abierta y sale con 0', () => {
    electronDescargado();
    const r = llamar(true);
    expect(r.codigo).toBe(0); expect(r.salida).toContain('traigo su ventana al frente');
    expect(registro()).toEqual([SALUD, 'electron electron/main.cjs url=http://127.0.0.1:3778/#t=secreto']);
  });
  it('la salida del Electron que trae al frente la ventana va a electron.log (añadida, solo legible por ti), no se tira', () => {
    electronDescargado();
    const f = path.join(juego(), 'node_modules', 'electron', 'dist', 'electron');
    writeFileSync(f, '#!/bin/bash\necho "dice algo"\necho "y un error" >&2\n'); chmodSync(f, 0o755);
    const log = path.join(dir, 'estado', 'work-shelter-public', 'electron.log');
    mkdirSync(path.dirname(log), { recursive: true }); writeFileSync(log, 'de la ventana abierta\n');
    // con mkdir y chmod de verdad (los falsos, antes en el PATH, siguen ganando)
    const env = { XDG_STATE_HOME: path.join(dir, 'estado'), PATH: `${dir}:/usr/bin:/bin` };
    const r = llamar(true, env);
    expect(r.codigo).toBe(0); expect(r.salida).not.toContain('dice algo'); expect(r.error).not.toContain('y un error');
    expect(readFileSync(log, 'utf8')).toBe('de la ventana abierta\ndice algo\ny un error\n');
    rmSync(path.dirname(log), { recursive: true });
    llamar(true, env);
    expect(statSync(log).mode & 0o777).toBe(0o600); expect(statSync(path.dirname(log)).mode & 0o777).toBe(0o700);
  });
  it('con un servidor que contesta y sin Electron descargado: no descarga nada, dice dónde está y sale con 0', () => {
    const r = llamar(true);
    expect(r.codigo).toBe(0); expect(r.salida).toContain('http://127.0.0.1:3778');
    expect(registro()).toEqual([SALUD]);
    mkdirSync(path.join(juego(), 'node_modules', 'electron', 'dist'), { recursive: true });   // paquete sin binario
    writeFileSync(path.join(juego(), 'node_modules', 'electron', 'path.txt'), 'electron'); rmSync(reg);
    expect(llamar(true).codigo).toBe(0); expect(registro()).toEqual([SALUD]);
  });
  it('desde la app de macOS: le pasa la dirección en su línea SHELTER_URL, sin lanzar otra ventana', () => {
    electronDescargado();
    const r = llamar(true, { SHELTER_DESDE_APP: '1' });
    expect(r.codigo).toBe(0); expect(r.salida).toBe('SHELTER_URL=http://127.0.0.1:3778/#t=secreto');
    expect(registro()).toEqual([SALUD]);
  });
  it('sin servidor que conteste: 1 con un mensaje claro, sin preparar ni lanzar nada', () => {
    electronDescargado();
    const r = llamar(false);
    expect(r.codigo).toBe(1); expect(r.error).toMatch(/Otro arranque de work-shelter.*Vuelve a intentarlo dentro de un momento/s);
    expect(registro()).toEqual([SALUD]);
  });
});

describe('nodo_disponible (./shelter: el Node que ya hay, sin descargar nada)', () => {
  // las funciones del Node de ./shelter, tal cual, sin ejecutar el lanzador
  const funciones = () => {
    const t = readFileSync(path.join(RAIZ, 'shelter'), 'utf8');
    const i = t.search(/^[a-z_]+\(\) \{/m); const fin = t.indexOf('\n}\n', t.indexOf('nodo_disponible() {'));
    return t.slice(i, fin + 3);
  };
  it('con el portátil ya descargado deja NODE, NPM y el PATH apuntando a él, y no deja otras variables', () => {
    const raiz = path.join(dir, 'raiz'); const bin = path.join(raiz, '.runtime', 'node-v24.22.0-linux-x64', 'bin');
    mkdirSync(bin, { recursive: true }); writeFileSync(path.join(bin, 'node'), '#!/bin/bash\n'); chmodSync(path.join(bin, 'node'), 0o755);
    writeFileSync(path.join(dir, 'funciones.sh'), funciones());
    const r = bash(`RAIZ="${raiz}"; NODO_VERSION=24.22.0; cd "$RAIZ"; source "${path.join(dir, 'funciones.sh')}"; nodo_disponible && echo "$NODE|$NPM|\${PATH%%:*}|\${DIR-sin DIR}|\${SO-sin SO}|\${ARQ-sin ARQ}"`);
    expect(r).toMatchObject({ codigo: 0, error: '' });
    expect(r.salida).toBe(`${bin}/node|${bin}/npm|${bin}|sin DIR|sin SO|sin ARQ`);
  });
  it('sin Node del sistema ni portátil, falla sin tocar nada', () => {
    const raiz = path.join(dir, 'raiz'); mkdirSync(raiz);
    writeFileSync(path.join(dir, 'funciones.sh'), funciones());
    const r = bash(`RAIZ="${raiz}"; NODO_VERSION=24.22.0; cd "$RAIZ"; source "${path.join(dir, 'funciones.sh')}"; nodo_disponible || echo "no|\${NODE-sin NODE}|\${PATH}"`);
    expect(r.salida).toBe(`no|sin NODE|${dir}`);
  });
  it('la carpeta del portátil, su PATH, NODE y NPM se escriben en un solo sitio (la descarga usa lo mismo)', () => {
    const t = readFileSync(path.join(RAIZ, 'shelter'), 'utf8');
    expect(t.split('export PATH=')).toHaveLength(2);
    expect(t.split('NODE="$RAIZ/')).toHaveLength(2); expect(t.split('NPM="$RAIZ/')).toHaveLength(2);
    expect(t.split('node-v$NODO_VERSION-')).toHaveLength(2);
  });
});

describe('borrar_nodos_viejos (al subir NODO_VERSION, el portátil anterior no se queda)', () => {
  const runtime = () => path.join(dir, 'raiz', '.runtime');
  const preparar = (nombres: string[]) => {
    for (const n of nombres) mkdirSync(path.join(runtime(), n, 'bin'), { recursive: true });
    writeFileSync(path.join(runtime(), 'lanzador.lock'), '');
  };
  const queda = (n: string) => existsSync(path.join(runtime(), n));
  it('borra el anterior del mismo sistema y arquitectura; deja el nuevo, los de otra arquitectura y lo demás', () => {
    preparar(['node-v22.20.0-linux-x64', 'node-v24.9.0-linux-x64', 'node-v24.22.0-linux-x64', 'node-v22.20.0-linux-arm64', 'node-v22.20.0-darwin-x64', 'nodejunk', 'node-vX-linux-x64']);
    const r = bash(`borrar_nodos_viejos "${path.join(dir, 'raiz')}" .runtime/node-v24.22.0-linux-x64 linux x64`, { real: true });
    expect(r).toMatchObject({ codigo: 0, error: '' });
    for (const n of ['node-v22.20.0-linux-x64', 'node-v24.9.0-linux-x64']) expect(queda(n), n).toBe(false);
    for (const n of ['node-v24.22.0-linux-x64', 'node-v22.20.0-linux-arm64', 'node-v22.20.0-darwin-x64', 'nodejunk', 'node-vX-linux-x64', 'lanzador.lock']) expect(queda(n), n).toBe(true);
  });
  it('sin ningún otro portátil (ni .runtime), no borra nada y sale con 0', () => {
    preparar(['node-v24.22.0-linux-x64']);
    expect(bash(`borrar_nodos_viejos "${path.join(dir, 'raiz')}" .runtime/node-v24.22.0-linux-x64 linux x64`, { real: true })).toMatchObject({ codigo: 0, error: '' });
    expect(queda('node-v24.22.0-linux-x64')).toBe(true); expect(queda('lanzador.lock')).toBe(true);
    expect(bash(`borrar_nodos_viejos "${path.join(dir, 'nada')}" .runtime/node-v24.22.0-linux-x64 linux x64`, { real: true })).toMatchObject({ codigo: 0, error: '' });
  });
  it('sin la carpeta nueva, el sistema o la arquitectura no borra nada', () => {
    preparar(['node-v22.20.0-linux-x64']);
    for (const args of ['"" linux x64', '.runtime/node-v24.22.0-linux-x64 "" x64', '.runtime/node-v24.22.0-linux-x64 linux ""']) {
      expect(bash(`borrar_nodos_viejos "${path.join(dir, 'raiz')}" ${args}`, { real: true }).codigo, args).toBe(1);
    }
    expect(queda('node-v22.20.0-linux-x64')).toBe(true);
  });
  it('./shelter lo llama solo tras descargar, comprobar y descomprimir el nuevo, dentro del paso 1', () => {
    const t = readFileSync(path.join(RAIZ, 'shelter'), 'utf8');
    const i = t.indexOf('borrar_nodos_viejos "$RAIZ" "$DIR" "$SO" "$ARQ"');
    expect(i).toBeGreaterThan(0);
    for (const antes of ['curl -fL', 'sha256_comprobar', 'tar -xzf', 'usar_nodo_portatil "$DIR"']) expect(i, antes).toBeGreaterThan(t.indexOf(antes));
    expect(i).toBeLessThan(t.indexOf('\nfi\n', t.indexOf('# 1. Node')));
    expect(t.slice(t.lastIndexOf('\n', i), i)).toMatch(/\[ -x "\$DIR\/bin\/node" \] && $/);   // solo si el nuevo está
  });
});

describe('carpeta_registros', () => {
  it('en macOS, ~/Library/Logs/work-shelter-public', () => {
    expect(bash('carpeta_registros', { s: 'Darwin', env: { HOME: '/casa', XDG_STATE_HOME: '/estado' } }).salida).toBe('/casa/Library/Logs/work-shelter-public');
  });
  it('en Linux, $XDG_STATE_HOME/work-shelter-public si es absoluto; si no, ~/.local/state', () => {
    expect(bash('carpeta_registros', { env: { HOME: '/casa', XDG_STATE_HOME: '/estado' } }).salida).toBe('/estado/work-shelter-public');
    expect(bash('carpeta_registros', { env: { HOME: '/casa' } }).salida).toBe('/casa/.local/state/work-shelter-public');
    expect(bash('carpeta_registros', { env: { HOME: '/casa', XDG_STATE_HOME: 'relativa' } }).salida).toBe('/casa/.local/state/work-shelter-public');
    expect(bash('carpeta_registros', { env: { HOME: '/casa', XDG_STATE_HOME: '' } }).salida).toBe('/casa/.local/state/work-shelter-public');
  });
});

describe('carpeta_registros y carpetaRegistros (electron/plataforma.cjs) dicen lo mismo', () => {
  const js = createRequire(import.meta.url)('../electron/plataforma.cjs') as { carpetaRegistros(so: string, env: Record<string, string | undefined>, casa: string): string };
  it('en macOS y en Linux, con XDG_STATE_HOME absoluto, relativo, vacío o sin poner', () => {
    for (const [s, so] of [['Darwin', 'darwin'], ['Linux', 'linux']]) {
      for (const xdg of ['/estado', 'relativa', '', undefined]) {
        const env: Record<string, string> = { HOME: '/casa', ...(xdg === undefined ? {} : { XDG_STATE_HOME: xdg }) };
        expect(bash('carpeta_registros', { s, env }).salida).toBe(js.carpetaRegistros(so, env, '/casa'));
      }
    }
  });
});

describe('electron_binario', () => {
  const nodoFalso = (cuerpo: string) => { const f = path.join(dir, 'node'); writeFileSync(f, `#!/bin/bash\n${cuerpo}\n`); chmodSync(f, 0o755); };
  it('da la ruta que devuelve require(\'electron\')', () => {
    nodoFalso('echo "/repo/node_modules/electron/dist/electron"');
    expect(bash('electron_binario node')).toMatchObject({ codigo: 0, salida: '/repo/node_modules/electron/dist/electron' });
  });
  it('vacía y sin error si el paquete aún no tiene su binario', () => {
    nodoFalso('echo "Error: Electron failed to install correctly" >&2; exit 1');
    expect(bash('electron_binario node')).toMatchObject({ codigo: 0, salida: '', error: '' });
  });
});

describe('registro_pide_sandbox', () => {
  const con = (texto: string) => { const f = path.join(dir, 'electron.log'); writeFileSync(f, texto); return bash(`registro_pide_sandbox "${f}"`, { real: true }).codigo; };
  it('reconoce el aislamiento de Chromium bloqueado (SUID o espacios de nombres de usuario)', () => {
    expect(con("[1:FATAL:setuid_sandbox_host.cc] The SUID sandbox helper binary was found, but is not configured correctly. You need to make sure that /x/chrome-sandbox is owned by root and has mode 4755.\n")).toBe(0);
    expect(con('[1:FATAL:zygote_host_impl_linux.cc] No usable sandbox! If you are running on Ubuntu 23.10+ or another Linux distro that has disabled unprivileged user namespaces with AppArmor...\n')).toBe(0);
  });
  it('otros fallos o un registro que no existe no dan la pista', () => {
    expect(con('Error: Cannot find module electron/main.cjs\n')).not.toBe(0);
    expect(bash(`registro_pide_sandbox "${path.join(dir, 'no-existe')}"`, { real: true }).codigo).not.toBe(0);
  });
});

describe('ventana_electron', () => {
  const electronFalso = (cuerpo: string) => { const f = path.join(dir, 'electron'); writeFileSync(f, `#!/bin/bash\n${cuerpo}\n`); chmodSync(f, 0o755); return f; };
  const lanzar = (cuerpo: string, env: Record<string, string> = {}) => {
    const bin = electronFalso(cuerpo), log = path.join(dir, 'electron.log');
    const r = bash(`SHELTER_URL=http://x ventana_electron "${bin}" "${log}" electron/main.cjs`, { real: true, env });
    return { ...r, log: existsSync(log) ? readFileSync(log, 'utf8') : '' };
  };
  it('si se cierra bien, 0 y su salida queda en el registro (con el entorno y los argumentos)', () => {
    const r = lanzar('echo "url=$SHELTER_URL args=$*"');
    expect(r).toMatchObject({ codigo: 0, error: '' }); expect(r.log).toContain('url=http://x args=electron/main.cjs');
  });
  it('si cae nada más abrir, 1 y dice dónde está el registro (el lanzador abre entonces el navegador)', () => {
    const r = lanzar('echo "algo fue mal" >&2; exit 5');
    expect(r.codigo).toBe(1); expect(r.error).toContain(path.join(dir, 'electron.log')); expect(r.log).toContain('algo fue mal');
    expect(r.error).not.toMatch(/sandbox/i);
  });
  it('si cae por el aislamiento bloqueado, añade la pista sin proponer quitarlo', () => {
    const r = lanzar('echo "No usable sandbox! ... unprivileged user namespaces with AppArmor" >&2; exit 133');
    expect(r.codigo).toBe(1); expect(r.error).toMatch(/aislamiento/); expect(r.error).toMatch(/diagnóstico/); expect(r.error).not.toMatch(/no-sandbox/);
  });
  it('sin registro (no se pudo crear su carpeta), la salida va a la terminal y no se habla de registro ni de sandbox', () => {
    const bin = electronFalso('echo "No usable sandbox!" >&2; exit 133');
    const r = bash(`SHELTER_URL=http://x ventana_electron "${bin}" "" electron/main.cjs`, { real: true });
    expect(r.codigo).toBe(1); expect(r.error).toContain('código 133'); expect(r.error).toContain('No usable sandbox!');
    expect(r.error).not.toMatch(/Registro|\/dev\/null|aislamiento/);
  });
  it('un fallo tras usarla un rato no abre el navegador: solo avisa del registro', () => {
    const r = lanzar('exit 3', { MARGEN_ELECTRON: '0' });
    expect(r.codigo).toBe(0); expect(r.error).toContain('electron.log');
  });
});
