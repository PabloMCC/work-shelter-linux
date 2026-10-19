// Lo que el lanzador ./shelter decide según el sistema (scripts/plataforma.sh): cada función se prueba en un bash aparte
// con un PATH falso (uname, sumas y navegadores de mentira que apuntan sus argumentos), así que da lo mismo en un runner
// de macOS que en uno de Linux. Nunca se ejecuta ./shelter.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

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
    env: { PATH: o.real ? `${process.env.PATH}` : dir, REG: reg, FALSO_S: o.s ?? 'Linux', FALSO_M: o.m ?? 'x86_64', ...o.env },
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
    expect(bash('suma_node 22.20.0 linux x64').salida).toBe('eeaccb0378b79406f2208e8b37a62479c70595e20be6b659125eb77dd1ab2a29');
    expect(bash('suma_node 22.20.0 darwin arm64').salida).toBe('cc04a76a09f79290194c0646f48fec40354d88969bec467789a5d55dd097f949');
  });
  it('otra versión sin sus sumas se niega antes de descargar, con un mensaje que la nombra', () => {
    const r = bash('suma_node 22.21.0 linux x64');
    expect(r.codigo).not.toBe(0); expect(r.salida).toBe(''); expect(r.error).toContain('22.21.0');
  });
  it('sin suma conocida se niega (nunca se descarga nada sin comprobar)', () => {
    for (const par of ['22.20.0 linux riscv64', '22.20.0 win x64', '22.20.0 darwin', 'linux x64', '']) {
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

describe('instalar_app_disponible (la puerta de ./shelter instalar-app)', () => {
  it('en macOS deja pasar sin decir nada', () => {
    expect(bash('instalar_app_disponible', { s: 'Darwin' })).toMatchObject({ codigo: 0, salida: '', error: '' });
  });
  it('en Linux sale con 1 y explica cómo abrirlo mientras tanto', () => {
    const r = bash('instalar_app_disponible', { s: 'Linux' });
    expect(r.codigo).toBe(1); expect(r.error).toContain('instalar-app'); expect(r.error).toContain('./shelter');
  });
  it('en un sistema desconocido también se niega', () => {
    expect(bash('instalar_app_disponible', { s: 'FreeBSD' }).codigo).not.toBe(0);
  });
  it('./shelter la consulta antes de preparar nada (antes de Node, dependencias y descargas)', () => {
    const t = readFileSync(path.join(RAIZ, 'shelter'), 'utf8');
    const puerta = t.indexOf('instalar_app_disponible || exit 1');
    expect(puerta).toBeGreaterThan(0);
    for (const paso of ['# 1. Node', 'curl ', 'npm', 'install.js']) expect(puerta).toBeLessThan(t.indexOf(paso));
    expect(t).not.toMatch(/uname -s/);
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
  it('un fallo tras usarla un rato no abre el navegador: solo avisa del registro', () => {
    const r = lanzar('exit 3', { MARGEN_ELECTRON: '0' });
    expect(r.codigo).toBe(0); expect(r.error).toContain('electron.log');
  });
});
