// Lo que el lanzador ./shelter decide según el sistema (scripts/plataforma.sh): cada función se prueba en un bash aparte
// con un PATH falso (uname, sumas y navegadores de mentira que apuntan sus argumentos), así que da lo mismo en un runner
// de macOS que en uno de Linux. Nunca se ejecuta ./shelter.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, truncateSync, writeFileSync } from 'node:fs';
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

describe('nodo_minimo', () => {
  it('da el número antes del primer punto; sin una versión de números, nada y 1', () => {
    expect(bash('nodo_minimo 24.22.0')).toMatchObject({ codigo: 0, salida: '24' });
    expect(bash('nodo_minimo 26.1.0')).toMatchObject({ codigo: 0, salida: '26' });
    for (const v of ['', 'linux', 'v24.22.0', '.1.0']) expect(bash(`nodo_minimo '${v}'`)).toMatchObject({ codigo: 1, salida: '', error: '' });
  });
  // el mínimo sale solo de NODO_VERSION: un número a mano en una comparación o en un mensaje se quedaría atrás al subirla
  it('ni ./shelter, ni el diagnóstico, ni plataforma.sh escriben a mano el mínimo de Node', () => {
    for (const f of ['shelter', path.join('scripts', 'doctor.sh'), path.join('scripts', 'plataforma.sh')]) {
      const t = readFileSync(path.join(RAIZ, f), 'utf8');
      expect(t, f).not.toMatch(/-(ge|gt|le|lt)\s+"?[1-9]\d\b/);
      expect(t, f).not.toMatch(/Node [1-9]\d\b/);
    }
  });
  it('los mensajes de error dicen el mínimo de la versión que reciben', () => {
    expect(bash('arq_node 24.22.0', { m: 'riscv64' }).error).toContain('instala Node 24 desde https://nodejs.org');
    expect(bash('suma_node 26.1.0 linux x64').error).toContain('Instala Node 26 desde https://nodejs.org');
    expect(bash('suma_node linux x64').error).toContain('Instala Node desde https://nodejs.org');
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

describe('huella_de (el sello de las dependencias)', () => {
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
      for (const paso of ['# 1. Node', 'curl ', '"$PNPM" install', 'install.js']) expect(i, puerta).toBeLessThan(t.indexOf(paso));
    }
    const quitar = t.indexOf('scripts/instalar-app-linux.mjs --desinstalar');
    expect(quitar).toBeGreaterThan(nodo);
    for (const paso of ['# 2. Claude', '"$PNPM" install', 'install.js', 'descargar-assets']) expect(quitar).toBeLessThan(t.indexOf(paso));
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
    for (const paso of ['# 1. Node', 'curl ', '"$PNPM" install']) expect(i).toBeLessThan(t.indexOf(paso));
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
    for (const paso of ['# 1. Node', 'curl -fL', '"$PNPM" install', 'install.js']) expect(toma).toBeLessThan(t.indexOf(paso));
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
    expect(t.slice(0, toma)).not.toMatch(/curl -fL|PNPM" install|install\.js/);
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
    falso('curl', servidor ? 0 : 7); for (const p of ['pnpm', 'npm', 'node', 'npx', 'tar']) falso(p);
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
  it('con el portátil ya descargado deja NODE y el PATH apuntando a él, y no deja otras variables (tampoco NPM)', () => {
    const raiz = path.join(dir, 'raiz'); const bin = path.join(raiz, '.runtime', 'node-v24.22.0-linux-x64', 'bin');
    mkdirSync(bin, { recursive: true }); writeFileSync(path.join(bin, 'node'), '#!/bin/bash\n'); chmodSync(path.join(bin, 'node'), 0o755);
    writeFileSync(path.join(dir, 'funciones.sh'), funciones());
    const r = bash(`RAIZ="${raiz}"; NODO_VERSION=24.22.0; cd "$RAIZ"; source "${path.join(dir, 'funciones.sh')}"; nodo_disponible && echo "$NODE|\${NPM-sin NPM}|\${PATH%%:*}|\${DIR-sin DIR}|\${SO-sin SO}|\${ARQ-sin ARQ}"`);
    expect(r).toMatchObject({ codigo: 0, error: '' });
    expect(r.salida).toBe(`${bin}/node|sin NPM|${bin}|sin DIR|sin SO|sin ARQ`);
  });
  it('sin Node del sistema ni portátil, falla sin tocar nada', () => {
    const raiz = path.join(dir, 'raiz'); mkdirSync(raiz);
    writeFileSync(path.join(dir, 'funciones.sh'), funciones());
    const r = bash(`RAIZ="${raiz}"; NODO_VERSION=24.22.0; cd "$RAIZ"; source "${path.join(dir, 'funciones.sh')}"; nodo_disponible || echo "no|\${NODE-sin NODE}|\${PATH}"`);
    expect(r.salida).toBe(`no|sin NODE|${dir}`);
  });
  it('la carpeta del portátil, su PATH y NODE se escriben en un solo sitio (la descarga usa lo mismo); npm ya no se usa', () => {
    const t = readFileSync(path.join(RAIZ, 'shelter'), 'utf8');
    expect(t.split('export PATH=')).toHaveLength(2);
    expect(t.split('NODE="$RAIZ/')).toHaveLength(2); expect(t).not.toMatch(/\bNPM\b/);
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
    preparar(['node-v22.20.0-linux-x64', 'node-v24.9.0-linux-x64', 'node-v24.22.0-linux-x64', 'node-v22.20.0-linux-arm64', 'node-v22.20.0-darwin-x64', 'nodejunk', 'node-vX-linux-x64', 'node-v22.20.0-linux-x64.parcial']);
    const r = bash(`borrar_nodos_viejos "${path.join(dir, 'raiz')}" .runtime/node-v24.22.0-linux-x64 linux x64`, { real: true });
    expect(r).toMatchObject({ codigo: 0, error: '' });
    for (const n of ['node-v22.20.0-linux-x64', 'node-v24.9.0-linux-x64']) expect(queda(n), n).toBe(false);
    // una instalación a medias (.parcial) no es una versión: la borra borrar_parciales, no esta
    for (const n of ['node-v24.22.0-linux-x64', 'node-v22.20.0-linux-arm64', 'node-v22.20.0-darwin-x64', 'nodejunk', 'node-vX-linux-x64', 'node-v22.20.0-linux-x64.parcial', 'lanzador.lock']) expect(queda(n), n).toBe(true);
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
    for (const antes of ['curl -fL', 'sha256_comprobar', 'instalar_extraido .runtime/node.tar.gz', 'usar_nodo_portatil "$DIR"']) expect(i, antes).toBeGreaterThan(t.indexOf(antes));
    expect(i).toBeLessThan(t.indexOf('\nfi\n', t.indexOf('# 1. Node')));
    expect(t.slice(t.lastIndexOf('\n', i), i)).toMatch(/\[ -x "\$DIR\/bin\/node" \] && $/);   // solo si el nuevo está
  });
  it('./shelter para si falla la extracción del nuevo, y borra la descarga (lo extraído a medias lo borra instalar_extraido)', () => {
    const t = readFileSync(path.join(RAIZ, 'shelter'), 'utf8');
    const linea = t.split('\n').find(l => l.includes('instalar_extraido .runtime/node.tar.gz')) ?? '';
    expect(linea).toMatch(/^ {2}instalar_extraido \.runtime\/node\.tar\.gz "\$DIR" bin\/node "\$\{DIR#\.runtime\/\}" \|\| \{ rm -f \.runtime\/node\.tar\.gz; rojo "[^"]+"; exit 1; \}$/);
  });
});

describe('pnpm fijado (./shelter nunca usa un pnpm del sistema)', () => {
  const LOCK = path.join(RAIZ, 'pnpm-lock.yaml');
  const VERSION = /"packageManager": "pnpm@(\d+\.\d+\.\d+)"/.exec(readFileSync(path.join(RAIZ, 'package.json'), 'utf8'))?.[1] ?? '';
  const NODO = process.execPath;
  it('version_pnpm: la versión de packageManager de package.json; si no es pnpm@x.y.z, nada y 1', () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    expect(bash(`version_pnpm "${NODO}" "${path.join(RAIZ, 'package.json')}"`)).toMatchObject({ codigo: 0, salida: VERSION });
    const pj = path.join(dir, 'package.json');
    writeFileSync(pj, JSON.stringify({ packageManager: 'pnpm@12.14.0+sha512.abc' }));
    expect(bash(`version_pnpm "${NODO}" "${pj}"`)).toMatchObject({ codigo: 0, salida: '12.14.0' });
    for (const pm of [undefined, 'npm@11.0.0', 'pnpm@latest', 'pnpm@12', 'pnpm@12.14.0; rm -rf /', ' pnpm@12.14.0']) {
      writeFileSync(pj, JSON.stringify(pm === undefined ? {} : { packageManager: pm }));
      expect(bash(`version_pnpm "${NODO}" "${pj}"`), String(pm)).toMatchObject({ codigo: 1, salida: '' });
    }
    expect(bash(`version_pnpm "${NODO}" "${path.join(dir, 'no-existe.json')}"`)).toMatchObject({ codigo: 1, salida: '' });
  });
  it('carpeta_pnpm y url_pnpm: la carpeta en .runtime y el paquete del registro de npm para cada sistema', () => {
    expect(bash('carpeta_pnpm 12.14.0 linux x64').salida).toBe('.runtime/pnpm-12.14.0-linux-x64');
    expect(bash('url_pnpm 12.14.0 darwin arm64').salida).toBe('https://registry.npmjs.org/@pnpm/exe.darwin-arm64/-/exe.darwin-arm64-12.14.0.tgz');
    expect(bash('url_pnpm 12.14.0 linux x64').salida).toBe('https://registry.npmjs.org/@pnpm/exe.linux-x64/-/exe.linux-x64-12.14.0.tgz');
    for (const f of ['carpeta_pnpm', 'url_pnpm']) {
      for (const args of ['"" linux x64', '12.14.0 "" x64', '12.14.0 linux ""']) expect(bash(`${f} ${args}`).codigo, `${f} ${args}`).toBe(1);
    }
  });
  it('integridad_pnpm: en el pnpm-lock.yaml de verdad hay un sha512 para los 4 sistemas, el mismo que lee un analizador aparte', () => {
    const texto = readFileSync(LOCK, 'utf8');
    const vistas = new Set<string>();
    for (const [so, arq] of [['darwin', 'arm64'], ['darwin', 'x64'], ['linux', 'arm64'], ['linux', 'x64']]) {
      const r = bash(`integridad_pnpm "${LOCK}" ${VERSION} ${so} ${arq}`);
      expect(r.codigo, `${so}-${arq}`).toBe(0); expect(r.salida).toMatch(/^sha512-[A-Za-z0-9+/]{86}==$/);
      const clave = `\n  '@pnpm/exe.${so}-${arq}@${VERSION}':\n    resolution: {integrity: `;
      const i = texto.indexOf(clave); expect(i, clave).toBeGreaterThan(0);
      expect(r.salida).toBe(texto.slice(i + clave.length, texto.indexOf('}', i + clave.length)));
      vistas.add(r.salida);
    }
    expect(vistas.size).toBe(4);
  });
  it('integridad_pnpm: sin ese sistema, esa versión o el archivo, falla con un mensaje y no da nada', () => {
    for (const args of [`${VERSION} freebsd arm64`, `${VERSION} linux ""`, `0.0.1 linux x64`, `"" linux x64`]) {
      const r = bash(`integridad_pnpm "${LOCK}" ${args}`);
      expect(r.codigo, args).toBe(1); expect(r.salida, args).toBe(''); expect(r.error, args).toContain('pnpm');
    }
    expect(bash(`integridad_pnpm "${path.join(dir, 'no-existe.yaml')}" ${VERSION} linux x64`)).toMatchObject({ codigo: 1, salida: '' });
  });
  it('integridad_pnpm: solo vale la línea resolution justo debajo de la clave y con un sha512 completo', () => {
    const lock = path.join(dir, 'pnpm-lock.yaml');
    const buena = `sha512-${'A'.repeat(86)}==`;
    // como en snapshots: la clave sin resolution debajo no da nada
    writeFileSync(lock, `snapshots:\n\n  '@pnpm/exe.linux-x64@1.2.3':\n    optional: true\n`);
    expect(bash(`integridad_pnpm "${lock}" 1.2.3 linux x64`).codigo).toBe(1);
    for (const mala of ['sha1-abc', `sha512-${'A'.repeat(85)}==`, `sha512-${'A'.repeat(85)}$==`, `sha512-${'A'.repeat(86)}== `]) {
      writeFileSync(lock, `packages:\n\n  '@pnpm/exe.linux-x64@1.2.3':\n    resolution: {integrity: ${mala}}\n`);
      expect(bash(`integridad_pnpm "${lock}" 1.2.3 linux x64`), mala).toMatchObject({ codigo: 1, salida: '' });
    }
    // la de otra arquitectura con el mismo prefijo (linux-x64-musl) no se confunde con linux-x64
    writeFileSync(lock, `packages:\n\n  '@pnpm/exe.linux-x64-musl@1.2.3':\n    resolution: {integrity: sha512-${'B'.repeat(86)}==}\n\n  '@pnpm/exe.linux-x64@1.2.3':\n    resolution: {integrity: ${buena}}\n`);
    expect(bash(`integridad_pnpm "${lock}" 1.2.3 linux x64`)).toMatchObject({ codigo: 0, salida: buena });
  });
  it('sha512_comprobar: acepta el archivo que cuadra con su integridad y rechaza el alterado, otro algoritmo o nada', () => {
    const f = path.join(dir, 'pnpm.tgz'); writeFileSync(f, 'pnpm de verdad\n');
    const buena = `sha512-${createHash('sha512').update('pnpm de verdad\n').digest('base64')}`;
    expect(bash(`sha512_comprobar "${NODO}" "${f}" "${buena}"`)).toMatchObject({ codigo: 0, salida: '' });
    writeFileSync(f, 'pnpm alterado\n');
    expect(bash(`sha512_comprobar "${NODO}" "${f}" "${buena}"`).codigo).toBe(1);
    writeFileSync(f, 'pnpm de verdad\n');
    const sha256 = `sha256-${createHash('sha256').update('pnpm de verdad\n').digest('base64')}`;
    for (const i of [sha256, buena.slice('sha512-'.length), '', 'sha512-']) expect(bash(`sha512_comprobar "${NODO}" "${f}" "${i}"`).codigo, i).toBe(1);
    expect(bash(`sha512_comprobar "${NODO}" "${path.join(dir, 'no-existe')}" "${buena}"`).codigo).toBe(1);
  });
});

describe('borrar_pnpm_viejos (al subir la versión de pnpm, el anterior no se queda)', () => {
  const runtime = () => path.join(dir, 'raiz', '.runtime');
  const preparar = (nombres: string[]) => {
    for (const n of nombres) mkdirSync(path.join(runtime(), n), { recursive: true });
    writeFileSync(path.join(runtime(), 'lanzador.lock'), '');
  };
  const queda = (n: string) => existsSync(path.join(runtime(), n));
  it('borra el anterior del mismo sistema y arquitectura; deja el nuevo, los de otra arquitectura, los Node y lo demás', () => {
    preparar(['pnpm-11.25.0-linux-x64', 'pnpm-12.9.1-linux-x64', 'pnpm-12.14.0-linux-x64', 'pnpm-11.25.0-linux-arm64', 'pnpm-11.25.0-darwin-x64', 'pnpm-1.0.0-musl-linux-x64', 'pnpmjunk', 'pnpm-X-linux-x64', 'node-v22.20.0-linux-x64', 'pnpm-11.25.0-linux-x64.parcial']);
    const r = bash(`borrar_pnpm_viejos "${path.join(dir, 'raiz')}" .runtime/pnpm-12.14.0-linux-x64 linux x64`, { real: true });
    expect(r).toMatchObject({ codigo: 0, error: '' });
    for (const n of ['pnpm-11.25.0-linux-x64', 'pnpm-12.9.1-linux-x64']) expect(queda(n), n).toBe(false);
    for (const n of ['pnpm-12.14.0-linux-x64', 'pnpm-11.25.0-linux-arm64', 'pnpm-11.25.0-darwin-x64', 'pnpm-1.0.0-musl-linux-x64', 'pnpmjunk', 'pnpm-X-linux-x64', 'node-v22.20.0-linux-x64', 'pnpm-11.25.0-linux-x64.parcial', 'lanzador.lock']) expect(queda(n), n).toBe(true);
  });
  it('sin ningún otro pnpm (ni .runtime), no borra nada y sale con 0', () => {
    preparar(['pnpm-12.14.0-linux-x64']);
    expect(bash(`borrar_pnpm_viejos "${path.join(dir, 'raiz')}" .runtime/pnpm-12.14.0-linux-x64 linux x64`, { real: true })).toMatchObject({ codigo: 0, error: '' });
    expect(queda('pnpm-12.14.0-linux-x64')).toBe(true); expect(queda('lanzador.lock')).toBe(true);
    expect(bash(`borrar_pnpm_viejos "${path.join(dir, 'nada')}" .runtime/pnpm-12.14.0-linux-x64 linux x64`, { real: true })).toMatchObject({ codigo: 0, error: '' });
  });
  it('sin la carpeta nueva, el sistema o la arquitectura no borra nada', () => {
    preparar(['pnpm-11.25.0-linux-x64']);
    for (const args of ['"" linux x64', '.runtime/pnpm-12.14.0-linux-x64 "" x64', '.runtime/pnpm-12.14.0-linux-x64 linux ""']) {
      expect(bash(`borrar_pnpm_viejos "${path.join(dir, 'raiz')}" ${args}`, { real: true }).codigo, args).toBe(1);
    }
    expect(queda('pnpm-11.25.0-linux-x64')).toBe(true);
  });
});

describe('instalar_extraido y borrar_parciales (Node y pnpm se colocan de golpe: nunca un ejecutable a medias en su sitio)', () => {
  const raiz = () => path.join(dir, 'raiz');
  const runtime = () => path.join(raiz(), '.runtime');
  const NODO = 'node-v9.9.9-linux-x64';
  // un paquete .tar.gz de prueba hecho con tar de verdad: <carpeta>/<ejecutable>, más otro archivo, con relleno aleatorio
  // (no se comprime, así que un paquete cortado se corta a mitad del ejecutable)
  const paquete = (nombre: string, carpeta: string, ejecutable: string) => {
    const fuente = path.join(dir, `fuente-${nombre}`); const f = path.join(fuente, carpeta, ejecutable);
    mkdirSync(path.dirname(f), { recursive: true });
    writeFileSync(f, `#!/bin/bash\necho ${nombre}\n# ${randomBytes(300_000).toString('base64')}\n`); chmodSync(f, 0o755);
    writeFileSync(path.join(fuente, carpeta, 'otro.txt'), 'otro\n');
    const tgz = path.join(dir, nombre);
    expect(spawnSync('tar', ['-czf', tgz, '-C', fuente, carpeta.split('/')[0]]).status).toBe(0);
    return tgz;
  };
  const nodo = () => paquete('node.tar.gz', NODO, 'bin/node');
  const pnpm = () => paquete('pnpm.tgz', 'package', 'pnpm');
  // como lo llama ./shelter: desde la raíz, con la carpeta final relativa
  const instalar = (args: string, env: Record<string, string> = {}) => {
    mkdirSync(runtime(), { recursive: true });
    return bash(`cd "${raiz()}" && instalar_extraido ${args}`, { real: true, env });
  };
  const contenido = () => readdirSync(runtime()).sort();
  const ejecutable = (f: string) => existsSync(f) && statSync(f).isFile() && (statSync(f).mode & 0o111) !== 0;

  it('Node: deja la carpeta final con su bin/node ejecutable, completo, y ninguna carpeta temporal', () => {
    const tgz = nodo();
    expect(instalar(`"${tgz}" .runtime/${NODO} bin/node ${NODO}`)).toMatchObject({ codigo: 0, error: '' });
    const bin = path.join(runtime(), NODO, 'bin', 'node');
    expect(ejecutable(bin)).toBe(true);
    expect(readFileSync(bin, 'utf8')).toBe(readFileSync(path.join(dir, 'fuente-node.tar.gz', NODO, 'bin', 'node'), 'utf8'));
    expect(existsSync(path.join(runtime(), NODO, 'otro.txt'))).toBe(true);
    expect(contenido()).toEqual([NODO]);
  });
  it('pnpm: solo el ejecutable del paquete, en la carpeta final, y ninguna carpeta temporal', () => {
    const tgz = pnpm();
    expect(instalar(`"${tgz}" .runtime/pnpm-1.2.3-linux-x64 pnpm . --strip-components=1 package/pnpm`)).toMatchObject({ codigo: 0, error: '' });
    expect(ejecutable(path.join(runtime(), 'pnpm-1.2.3-linux-x64', 'pnpm'))).toBe(true);
    expect(readdirSync(path.join(runtime(), 'pnpm-1.2.3-linux-x64'))).toEqual(['pnpm']);
    expect(contenido()).toEqual(['pnpm-1.2.3-linux-x64']);
  });
  it('un paquete cortado: sale con error, no aparece la carpeta final y no queda nada a medias', () => {
    for (const [tgz, args] of [[nodo(), `.runtime/${NODO} bin/node ${NODO}`], [pnpm(), '.runtime/pnpm-1.2.3-linux-x64 pnpm . --strip-components=1 package/pnpm']]) {
      truncateSync(tgz, Math.floor(statSync(tgz).size * 0.6));
      const r = instalar(`"${tgz}" ${args}`);
      expect(r.codigo, args).not.toBe(0);
      expect(contenido(), args).toEqual([]);
    }
  });
  it('un paquete sin el ejecutable esperado: sale con error y no deja nada', () => {
    const tgz = pnpm();
    expect(instalar(`"${tgz}" .runtime/${NODO} bin/node ${NODO}`).codigo).not.toBe(0);
    expect(instalar(`"${tgz}" .runtime/pnpm-1.2.3-linux-x64 bin/pnpm package`).codigo).not.toBe(0);
    expect(contenido()).toEqual([]);
  });
  it('si el lanzador muere a mitad de la extracción, la carpeta final no existe; el siguiente arranque limpia y la instala', () => {
    const tgz = nodo();
    // un tar que deja el ejecutable a medias (ya ejecutable) donde le dicen y mata al bash que lo llamó, como un SIGKILL
    // o un apagón en mitad de la extracción
    const falsos = path.join(dir, 'falsos'); mkdirSync(falsos);
    writeFileSync(path.join(falsos, 'tar'), `#!/bin/bash\nwhile [ $# -gt 0 ]; do [ "$1" = -C ] && d="$2"; shift; done\nmkdir -p "$d/${NODO}/bin"\nprintf '#!/bin/bash\\necho a med' > "$d/${NODO}/bin/node"; chmod 755 "$d/${NODO}/bin/node"\nkill -KILL $PPID\nexit 2\n`);
    chmodSync(path.join(falsos, 'tar'), 0o755);
    const r = instalar(`"${tgz}" .runtime/${NODO} bin/node ${NODO}; echo "no debería seguir"`, { PATH: `${falsos}:${process.env.PATH}` });
    expect(r.salida).toBe('');
    expect(existsSync(path.join(runtime(), NODO))).toBe(false);   // nodo_disponible no lo dará por bueno
    expect(contenido()).toEqual([`${NODO}.parcial`]);
    // siguiente arranque: el paso 1 borra lo que quedó a medias y la instalación sale bien
    expect(bash(`borrar_parciales "${raiz()}" node-v`, { real: true })).toMatchObject({ codigo: 0, error: '' });
    expect(contenido()).toEqual([]);
    expect(instalar(`"${tgz}" .runtime/${NODO} bin/node ${NODO}`).codigo).toBe(0);
    expect(ejecutable(path.join(runtime(), NODO, 'bin', 'node'))).toBe(true);
    expect(contenido()).toEqual([NODO]);
  });
  it('una carpeta final sin ejecutable (de una versión anterior del lanzador) se sustituye, no se mete dentro', () => {
    mkdirSync(path.join(runtime(), NODO, 'bin'), { recursive: true });
    writeFileSync(path.join(runtime(), NODO, 'bin', 'basura'), '');
    mkdirSync(path.join(runtime(), `${NODO}.parcial`, 'bin'), { recursive: true });
    const tgz = nodo();
    expect(instalar(`"${tgz}" .runtime/${NODO} bin/node ${NODO}`).codigo).toBe(0);
    expect(ejecutable(path.join(runtime(), NODO, 'bin', 'node'))).toBe(true);
    expect(existsSync(path.join(runtime(), NODO, NODO))).toBe(false);
    expect(existsSync(path.join(runtime(), NODO, 'bin', 'basura'))).toBe(false);
    expect(contenido()).toEqual([NODO]);
  });
  it('sin alguno de los datos, con la carpeta final fuera de .runtime/ o con un origen que sale de lo extraído, no hace nada', () => {
    const tgz = nodo();
    for (const args of [
      `"" .runtime/${NODO} bin/node ${NODO}`, `"${tgz}" "" bin/node ${NODO}`, `"${tgz}" .runtime/${NODO} "" ${NODO}`, `"${tgz}" .runtime/${NODO} bin/node ""`,
      `"${tgz}" otra/${NODO} bin/node ${NODO}`, `"${tgz}" ${NODO} bin/node ${NODO}`, `"${tgz}" .runtime bin/node ${NODO}`, `"${tgz}" .runtime/.. bin/node ${NODO}`,
      `"${tgz}" .runtime/${NODO}.parcial bin/node ${NODO}`, `"${tgz}" .runtime/${NODO} bin/node ..`, `"${tgz}" .runtime/${NODO} bin/node ../x`, `"${tgz}" .runtime/${NODO} bin/node /tmp`,
    ]) expect(instalar(args).codigo, args).toBe(1);
    expect(contenido()).toEqual([]);
    expect(readdirSync(raiz()).sort()).toEqual(['.runtime']);
  });
  it('borrar_parciales: solo las carpetas <prefijo><x.y.z>-<so>-<arq>.parcial de .runtime/; nunca las finales, enlaces ni lo demás', () => {
    const fuera = path.join(dir, 'fuera'); mkdirSync(fuera);
    for (const n of [`${NODO}.parcial`, 'node-v24.22.0-darwin-arm64.parcial', NODO, 'pnpm-12.14.0-linux-x64.parcial', 'pnpm-12.14.0-linux-x64', 'nodejunk.parcial', 'node-vX-linux-x64.parcial', 'node-v1.0.0.parcial']) mkdirSync(path.join(runtime(), n), { recursive: true });
    writeFileSync(path.join(runtime(), 'node-v2.0.0-linux-x64.parcial'), '');
    symlinkSync(fuera, path.join(runtime(), 'node-v3.0.0-linux-x64.parcial'));
    mkdirSync(path.join(raiz(), 'node-v1.0.0-linux-x64.parcial'));
    expect(bash(`borrar_parciales "${raiz()}" node-v`, { real: true })).toMatchObject({ codigo: 0, error: '' });
    expect(contenido()).toEqual([NODO, 'node-v1.0.0.parcial', 'node-v2.0.0-linux-x64.parcial', 'node-v3.0.0-linux-x64.parcial', 'node-vX-linux-x64.parcial', 'nodejunk.parcial', 'pnpm-12.14.0-linux-x64', 'pnpm-12.14.0-linux-x64.parcial'].sort());
    expect(existsSync(fuera)).toBe(true); expect(existsSync(path.join(raiz(), 'node-v1.0.0-linux-x64.parcial'))).toBe(true);
    expect(bash(`borrar_parciales "${raiz()}" pnpm-`, { real: true })).toMatchObject({ codigo: 0, error: '' });
    expect(contenido()).not.toContain('pnpm-12.14.0-linux-x64.parcial'); expect(contenido()).toContain('pnpm-12.14.0-linux-x64');
    // sin raíz o con otro prefijo (también vacío, que lo cogería todo), nada
    for (const args of ['"" node-v', `"${raiz()}" ""`, `"${raiz()}" node`, `"${raiz()}" "*"`]) expect(bash(`borrar_parciales ${args}`, { real: true }).codigo, args).toBe(1);
    expect(contenido()).toContain('node-vX-linux-x64.parcial');
    expect(bash(`borrar_parciales "${path.join(dir, 'nada')}" node-v`, { real: true })).toMatchObject({ codigo: 0, error: '' });
  });
  it('instalar_extraido extrae siempre en la carpeta temporal y solo renombra a la final tras ver el ejecutable', () => {
    const p = readFileSync(PLATAFORMA, 'utf8');
    const cuerpo = p.slice(p.indexOf('instalar_extraido() {'), p.indexOf('\n}\n', p.indexOf('instalar_extraido() {')));
    expect(cuerpo).toContain('tar -xzf "$paquete" -C "$parcial"');
    expect(cuerpo.split('tar ')).toHaveLength(2);
    const mv = cuerpo.indexOf('mv "$desde" "$final"');
    expect(mv).toBeGreaterThan(cuerpo.indexOf('[ -x "$desde/$ejecutable" ]'));
    expect(cuerpo.split(/\bmv /)).toHaveLength(2);
  });
  it('./shelter: nada se extrae directamente; Node y pnpm pasan por instalar_extraido y cada paso limpia antes lo que quedó a medias', () => {
    const t = readFileSync(path.join(RAIZ, 'shelter'), 'utf8');
    expect(t).not.toMatch(/(^|[\s;&|(])tar\s/m);
    expect(t).not.toMatch(/mkdir -p "\$PDIR"/);
    expect(t.split('instalar_extraido ')).toHaveLength(3);
    const toma = t.indexOf('tomar_cerrojo "$RAIZ/.runtime/lanzador.lock"');
    const nodo = t.indexOf('borrar_parciales "$RAIZ" node-v || true');
    expect(nodo).toBeGreaterThan(toma);
    expect(nodo).toBeGreaterThan(t.indexOf('# 1. Node'));
    expect(nodo).toBeLessThan(t.indexOf('if ! nodo_disponible; then'));
    const pn = t.indexOf('borrar_parciales "$RAIZ" pnpm- || true');
    expect(pn).toBeGreaterThan(t.indexOf('PDIR="$(carpeta_pnpm'));
    expect(pn).toBeLessThan(t.indexOf('if [ ! -x "$PNPM" ]; then'));
  });
});

describe('./shelter instala las dependencias con su propio pnpm, comprobado', () => {
  const t = readFileSync(path.join(RAIZ, 'shelter'), 'utf8');
  const lineas = t.split('\n');
  // pnpm no trae node-gyp (npm sí): sin él en las dependencias, node-pty, que en Linux se compila, falla en un equipo sin
  // node-gyp instalado. Fijado a una versión exacta, con su integridad en pnpm-lock.yaml como todo lo demás
  it('node-gyp va fijado en devDependencies y en pnpm-lock.yaml (node-pty lo necesita para compilar en Linux)', () => {
    const pj = JSON.parse(readFileSync(path.join(RAIZ, 'package.json'), 'utf8')) as { devDependencies?: Record<string, string> };
    const v = pj.devDependencies?.['node-gyp'] ?? '';
    expect(v).toMatch(/^\d+\.\d+\.\d+$/);
    const lock = readFileSync(path.join(RAIZ, 'pnpm-lock.yaml'), 'utf8');
    expect(lock).toContain(`\n      node-gyp:\n        specifier: ${v}\n        version: ${v}\n`);
    expect(lock).toMatch(new RegExp(`\\n  node-gyp@${v.replace(/\./g, '\\.')}:\\n    resolution: \\{integrity: sha512-`));
  });
  it('nunca busca ni usa un pnpm (o un npm) del sistema', () => {
    expect(t).not.toMatch(/command -v pnpm|which pnpm|type -p pnpm/);
    for (const l of lineas.filter(l => /\binstall --frozen-lockfile\b/.test(l))) expect(l, l).toMatch(/^\s*"\$PNPM" install /);
    expect(t).not.toMatch(/npm ci|"\$NPM"|package-lock\.json/);
    expect(t).toMatch(/PNPM="\$RAIZ\/\$PDIR\/pnpm"/);
  });
  it('instala siempre también las de desarrollo, sin tocar el lockfile ni cambiar de pnpm', () => {
    const l = lineas.find(l => l.includes('"$PNPM" install')) ?? '';
    for (const op of ['--frozen-lockfile', '--prod=false', '--pm-on-fail=error']) expect(l, op).toContain(` ${op}`);
    expect(l).not.toMatch(/ --dev\b| --prod\b(?!=false)| -P\b| -D\b/);
    expect(l).toContain('Falló la instalación de dependencias (pnpm install).');
  });
  it('el sello cubre pnpm-lock.yaml y pnpm-workspace.yaml (un cambio en allowBuilds también reinstala)', () => {
    const l = lineas.find(l => l.startsWith('HUELLA=')) ?? '';
    expect(l).toContain('huella_de pnpm-lock.yaml'); expect(l).toContain('huella_de pnpm-workspace.yaml');
  });
  it('lee la integridad del lockfile, descarga, comprueba, descomprime y solo entonces lo usa', () => {
    const orden = ['version_pnpm "$NODE" package.json', 'integridad_pnpm pnpm-lock.yaml', 'curl -fL --progress-bar "$(url_pnpm', 'sha512_comprobar "$NODE" .runtime/pnpm.tgz', 'instalar_extraido .runtime/pnpm.tgz', 'borrar_pnpm_viejos "$RAIZ" "$PDIR" "$SO" "$ARQ"', '"$PNPM" install'];
    const pos = orden.map(p => t.indexOf(p));
    for (const [k, p] of orden.entries()) expect(pos[k], p).toBeGreaterThan(0);
    for (let k = 1; k < pos.length; k++) expect(pos[k], orden[k]).toBeGreaterThan(pos[k - 1]);
    expect(t.split('instalar_extraido .runtime/pnpm.tgz')).toHaveLength(2);
  });
  it('si algo falla al conseguir pnpm, borra lo descargado o extraído a medias y sale con 1', () => {
    const de = (p: string) => lineas.find(l => l.includes(p)) ?? '';
    expect(de('integridad_pnpm pnpm-lock.yaml')).toMatch(/\|\| \{ rojo "[^"]+"; exit 1; \}$/);
    expect(de('curl -fL --progress-bar "$(url_pnpm')).toMatch(/\|\| \{ rm -f \.runtime\/pnpm\.tgz; rojo "[^"]+"; exit 1; \}$/);
    expect(de('sha512_comprobar "$NODE" .runtime/pnpm.tgz')).toMatch(/\|\| \{ rm -f \.runtime\/pnpm\.tgz; rojo "[^"]+"; exit 1; \}$/);
    expect(de('instalar_extraido .runtime/pnpm.tgz')).toMatch(/^ {4}instalar_extraido \.runtime\/pnpm\.tgz "\$PDIR" pnpm \. --strip-components=1 package\/pnpm \|\| \{ rm -f \.runtime\/pnpm\.tgz; rojo "[^"]+"; exit 1; \}$/);
  });
  it('mantiene la descarga aparte del binario de Electron', () => {
    expect(t).toContain('"$NODE" node_modules/electron/install.js');
    expect(t.indexOf('"$PNPM" install')).toBeGreaterThan(0);
    expect(t.indexOf('"$NODE" node_modules/electron/install.js')).toBeGreaterThan(t.indexOf('"$PNPM" install'));
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
