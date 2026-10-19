// ./shelter doctor (scripts/doctor.sh): cada comprobación en un bash aparte con un PATH falso (solo los programas de la
// prueba) y una raíz falsa para /etc/os-release, /proc/sys, /dev/dri y /etc/apparmor.d (DOCTOR_RAIZ), así que da lo
// mismo en un runner de macOS que en uno de Linux. Nunca instala ni ejecuta nada del sistema.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { EDITORES_LINUX, editorLinux, ordenTerminal } from '../server/plataforma.ts';

const RAIZ = path.resolve(__dirname, '..');
const DOCTOR = path.join(RAIZ, 'scripts', 'doctor.sh');
let dir = ''; let bin = ''; let raiz = ''; let dist = '';

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'doctor-prueba-'));
  bin = path.join(dir, 'bin'); raiz = path.join(dir, 'raiz'); dist = path.join(dir, 'juego', 'node_modules', 'electron', 'dist');
  for (const d of [bin, raiz, dist]) mkdirSync(d, { recursive: true });
  // uname de mentira: el sistema y la arquitectura los decide cada prueba
  programa('uname', 'case "$1" in -s) echo "$FALSO_S" ;; -m) echo "$FALSO_M" ;; *) exit 1 ;; esac');
});
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

const escribir = (f: string, texto: string) => { mkdirSync(path.dirname(f), { recursive: true }); writeFileSync(f, texto); };
const programa = (nombre: string, cuerpo = 'exit 0', donde = bin) => {
  const f = path.join(donde, nombre); escribir(f, `#!/bin/bash\n${cuerpo}\n`); chmodSync(f, 0o755); return f;
};
const osRelease = (texto: string) => escribir(path.join(raiz, 'etc', 'os-release'), texto);
const sysctl = (nombre: string, valor: string) => escribir(path.join(raiz, 'proc', 'sys', nombre), `${valor}\n`);
// lo obligatorio presente: curl, git, tar, Node 22 y claude
const obligatorio = () => { for (const p of ['curl', 'git', 'tar', 'claude']) programa(p); programa('node', 'echo 22.20.0'); };

type Opciones = { s?: string; m?: string; env?: Record<string, string>; antes?: string };
const entorno = (o: Opciones) => ({
  // con HOME: en los runners de macOS, sin él, el entorno de Homebrew escribe un error en stderr
  PATH: bin, HOME: path.join(dir, 'casa'), FALSO_S: o.s ?? 'Linux', FALSO_M: o.m ?? 'x86_64',
  DOCTOR_RAIZ: raiz, DOCTOR_ELECTRON_DIST: dist, ...o.env,
});
// una función de doctor.sh (cargado con source; `antes` puede redefinir alguna, como dueno_y_modo)
const bash = (orden: string, o: Opciones = {}) => {
  const r = spawnSync('/bin/bash', ['-c', `source "${DOCTOR}"; ${o.antes ?? ''}\n${orden}`], { encoding: 'utf8', env: entorno(o) });
  return { codigo: r.status, salida: r.stdout.trim(), error: r.stderr.trim() };
};
// el diagnóstico entero, como lo lanza ./shelter doctor
const doctor = (o: Opciones = {}) => {
  const r = spawnSync('/bin/bash', [DOCTOR], { encoding: 'utf8', env: entorno(o) });
  return { codigo: r.status, salida: r.stdout, error: r.stderr };
};
const linea = (salida: string, texto: string) => salida.split('\n').find(l => l.includes(texto)) ?? '';

describe('sintaxis', () => {
  it('doctor.sh pasa bash -n', () => { expect(spawnSync('/bin/bash', ['-n', DOCTOR]).status).toBe(0); });
});

describe('familia_distro', () => {
  const familia = (texto: string | null, s = 'Linux') => { if (texto !== null) osRelease(texto); return bash('familia_distro', { s }).salida; };
  it('Arch y sus derivadas (CachyOS por ID_LIKE)', () => {
    expect(familia('NAME="Arch Linux"\nID=arch\n')).toBe('arch');
    expect(familia('NAME="CachyOS Linux"\nID=cachyos\nID_LIKE=arch\n')).toBe('arch');
  });
  it('Debian y Ubuntu (también Mint, por ID_LIKE con comillas)', () => {
    expect(familia('ID=debian\n')).toBe('debian');
    expect(familia('ID=ubuntu\nID_LIKE=debian\n')).toBe('debian');
    expect(familia('ID=linuxmint\nID_LIKE="ubuntu debian"\n')).toBe('debian');
  });
  it('Fedora y RHEL', () => {
    expect(familia('ID=fedora\n')).toBe('fedora');
    expect(familia('ID="rocky"\nID_LIKE="rhel centos fedora"\n')).toBe('fedora');
  });
  it('una desconocida, o sin os-release', () => {
    expect(familia('ID=gentoo\n')).toBe('desconocida');
    expect(familia(null)).toBe('desconocida');
  });
  it('macOS, aunque haya un os-release', () => {
    expect(familia('ID=arch\n', 'Darwin')).toBe('macos');
  });
});

describe('consejo_instalar: la orden de cada familia', () => {
  const consejo = (h: string, fam: string) => bash(`consejo_instalar ${h} ${fam}`).salida;
  it('secret-tool', () => {
    expect(consejo('secret-tool', 'arch')).toContain('sudo pacman -S --needed libsecret');
    expect(consejo('secret-tool', 'debian')).toContain('sudo apt install libsecret-tools');
    expect(consejo('secret-tool', 'fedora')).toContain('sudo dnf install libsecret');
  });
  it('heif, con el HEVC de RPM Fusion en Fedora', () => {
    expect(consejo('heif', 'arch')).toContain('sudo pacman -S --needed libheif');
    expect(consejo('heif', 'debian')).toContain('sudo apt install libheif-examples libheif-plugin-libde265');
    const f = consejo('heif', 'fedora');
    expect(f).toContain('sudo dnf install libheif-tools'); expect(f).toContain('libheif-freeworld');
    expect(consejo('heif', 'arch')).not.toContain('freeworld');
  });
  it('una familia desconocida recibe las tres órdenes', () => {
    const r = consejo('secret-tool', 'desconocida');
    for (const o of ['pacman -S --needed libsecret', 'apt install libsecret-tools', 'dnf install libsecret']) expect(r).toContain(o);
  });
  it('en macOS, sin gestor de paquetes: lo de Apple o la web oficial', () => {
    expect(consejo('git', 'macos')).toContain('xcode-select --install');
    expect(consejo('gh', 'macos')).toContain('https://cli.github.com');
    expect(consejo('git', 'macos')).not.toMatch(/pacman|apt|dnf|brew/);
  });
});

describe('el diagnóstico entero', () => {
  it('con todo lo obligatorio: sale con 0, «Todo listo.» y cuenta lo opcional que falta', () => {
    obligatorio(); osRelease('ID=arch\n'); sysctl('kernel/unprivileged_userns_clone', '1'); sysctl('user/max_user_namespaces', '100');
    const r = doctor();
    expect(r.codigo).toBe(0); expect(r.salida).not.toContain('✗');
    expect(r.salida).toContain('Todo listo.'); expect(r.salida).toMatch(/Opcionales que faltan: \d+/);
    expect(r.salida).toContain('familia Arch (pacman)');
  });
  it('sin git: sale con 1, lo marca con ✗ y da la orden de su familia', () => {
    obligatorio(); rmSync(path.join(bin, 'git')); osRelease('ID=ubuntu\nID_LIKE=debian\n');
    const r = doctor();
    expect(r.codigo).toBe(1); expect(linea(r.salida, 'git:')).toContain('✗');
    expect(r.salida).toContain('sudo apt install git'); expect(r.salida).toContain('Falta lo obligatorio marcado con ✗.');
  });
  it('sin Claude Code: ✗ con la web oficial; con ~/.local/bin/claude, vale', () => {
    obligatorio(); rmSync(path.join(bin, 'claude')); osRelease('ID=fedora\n');
    const r = doctor();
    expect(r.codigo).toBe(1); expect(linea(r.salida, 'claude')).toContain('✗'); expect(r.salida).toContain('https://docs.claude.com/claude-code');
    programa('claude', 'exit 0', path.join(dir, 'casa', '.local', 'bin'));
    expect(doctor().codigo).toBe(0);
  });
  it('sin Node 22 vale si se puede descargar el portátil; en una arquitectura sin él, ✗', () => {
    obligatorio(); programa('node', 'echo 20.20.2'); programa('sha256sum'); osRelease('ID=arch\n');
    const r = doctor();
    expect(r.codigo).toBe(0); expect(linea(r.salida, '✓ Node')).toMatch(/✓.*20\.20\.2.*descargará el oficial \(22\.20\.0\)/);
    const r2 = doctor({ m: 'riscv64' });
    expect(r2.codigo).toBe(1); expect(linea(r2.salida, '✗ Node')).toContain('Node 22 o superior'); expect(r2.salida).toContain('https://nodejs.org');
  });
  it('en macOS: sin aislamiento ni opcionales de Linux, y 0 con lo obligatorio', () => {
    obligatorio();
    const r = doctor({ s: 'Darwin', m: 'arm64' });
    expect(r.codigo).toBe(0); expect(r.salida).toContain('Sistema: macOS');
    expect(r.salida).not.toMatch(/sandbox|secret-tool|heif|xdg-open|pacman|apt |dnf/);
  });
  it('en un sistema que no es macOS ni Linux, 1 con un error claro', () => {
    const r = doctor({ s: 'FreeBSD' });
    expect(r.codigo).toBe(1); expect(r.error).toContain('FreeBSD');
  });
});

describe('comprobar_sandbox (el aislamiento de la ventana)', () => {
  const sandbox = (antes = '') => bash('comprobar_sandbox; echo "faltan=$DOCTOR_FALTAN"', { antes });
  const suid = 'dueno_y_modo() { echo "0 -rwsr-xr-x"; }';
  it('con chrome-sandbox de root y modo 4755, vale aunque los espacios de nombres estén bloqueados', () => {
    escribir(path.join(dist, 'chrome-sandbox'), ''); sysctl('kernel/unprivileged_userns_clone', '0');
    const r = sandbox(suid);
    expect(r.salida).toContain('✓'); expect(r.salida).toContain('chrome-sandbox'); expect(r.salida).toContain('faltan=0');
  });
  it('un chrome-sandbox que no es de root no basta', () => {
    escribir(path.join(dist, 'chrome-sandbox'), ''); sysctl('kernel/unprivileged_userns_clone', '0');
    expect(sandbox('dueno_y_modo() { echo "1000 -rwxr-xr-x"; }').salida).toContain('faltan=1');
  });
  it('con los espacios de nombres de usuario permitidos, vale', () => {
    sysctl('kernel/unprivileged_userns_clone', '1'); sysctl('user/max_user_namespaces', '124508');
    const r = sandbox();
    expect(r.salida).toMatch(/✓.*espacios de nombres/); expect(r.salida).toContain('faltan=0');
  });
  it('sin unprivileged_userns_clone (kernels sin ese parche), también vale', () => {
    sysctl('user/max_user_namespaces', '100');
    expect(sandbox().salida).toContain('faltan=0');
  });
  it('con max_user_namespaces a 0: ✗ y el ayudante SUID como solución', () => {
    sysctl('user/max_user_namespaces', '0');
    const r = sandbox();
    expect(r.salida).toContain('✗'); expect(r.salida).toContain('faltan=1');
    expect(r.salida).toContain(`sudo chown root:root "${path.join(dist, 'chrome-sandbox')}" && sudo chmod 4755 "${path.join(dist, 'chrome-sandbox')}"`);
    expect(r.salida).not.toMatch(/no-sandbox/);
  });
  it('Ubuntu con la restricción de AppArmor y sin perfil: ✗ con el ayudante chrome-sandbox, sin perfil ni --no-sandbox', () => {
    sysctl('kernel/unprivileged_userns_clone', '1'); sysctl('user/max_user_namespaces', '100'); sysctl('kernel/apparmor_restrict_unprivileged_userns', '1');
    const r = sandbox();
    const cs = path.join(dist, 'chrome-sandbox');
    expect(r.salida).toContain('✗'); expect(r.salida).toContain('faltan=1'); expect(r.salida).toContain('AppArmor');
    expect(r.salida).toContain(`sudo chown root:root "${cs}" && sudo chmod 4755 "${cs}"`);
    expect(r.salida).toMatch(/opción segura.*no puede crear un archivo SUID de root/);
    expect(r.salida).toMatch(/reinstal/);
    // un perfil `unconfined` + `userns` para un binario que tu usuario puede cambiar se salta la restricción: no se propone
    expect(r.salida).not.toMatch(/apparmor_parser|unconfined|userns,|sudo tee|abi </);
    expect(r.salida).not.toMatch(/no-sandbox|apparmor_restrict_unprivileged_userns=0|sysctl -w/);
  });
  const perfil = (nombre: string, texto: string) => escribir(path.join(raiz, 'etc', 'apparmor.d', nombre), texto);
  it('un perfil ya hecho para este binario exacto cuenta (informativo), con el aviso de que debilita la restricción', () => {
    sysctl('kernel/apparmor_restrict_unprivileged_userns', '1');
    const electron = path.join(dist, 'electron');
    for (const cabecera of [`"${electron}" flags=(unconfined) {`, `${electron} flags=(unconfined) {`, `profile shelter "${electron}" {`, `profile ${electron}{`]) {
      perfil('shelter', `abi <abi/4.0>,\ninclude <tunables/global>\n${cabecera}\n  userns,\n}\n`);
      const r = sandbox();
      expect(r.salida, cabecera).toMatch(/✓.*perfil/); expect(r.salida, cabecera).toContain('faltan=0');
      expect(r.salida, cabecera).toMatch(/debilita la restricción/); expect(r.salida, cabecera).toContain('sudo chmod 4755');
    }
  });
  it('un perfil de otro binario no cuenta, tampoco el de una ruta que solo empieza igual', () => {
    sysctl('kernel/apparmor_restrict_unprivileged_userns', '1');
    const electron = path.join(dist, 'electron');
    perfil('chrome', '/opt/google/chrome/chrome flags=(unconfined) {\n  userns,\n}\n');
    expect(sandbox().salida).toContain('faltan=1');
    perfil('chrome', `"${electron}-viejo" flags=(unconfined) {\n  userns,\n}\n`);
    expect(sandbox().salida).toContain('faltan=1');
    perfil('chrome', `${electron}2 flags=(unconfined) {\n  userns,\n}\n`);
    expect(sandbox().salida).toContain('faltan=1');
  });
  it('la ruta exacta sin userns en su bloque no cuenta (aunque otro perfil del archivo lo tenga)', () => {
    sysctl('kernel/apparmor_restrict_unprivileged_userns', '1');
    const electron = path.join(dist, 'electron');
    perfil('mezcla', `"${electron}" {\n  # userns, comentado\n}\n/opt/otro {\n  userns,\n}\n# ${electron} userns,\n`);
    expect(sandbox().salida).toContain('faltan=1');
  });
});

describe('opcionales de Linux', () => {
  it('secret-tool sin servicio de secretos: aviso opcional, no obligatorio', () => {
    programa('secret-tool'); programa('dbus-send', 'echo \'   string "org.freedesktop.DBus"\'');
    const r = bash('comprobar_llavero arch; echo "faltan=$DOCTOR_FALTAN opcionales=$DOCTOR_OPCIONALES"');
    expect(r.salida).toMatch(/· secret-tool.*servicio de secretos/); expect(r.salida).toContain('faltan=0 opcionales=1');
  });
  it('secret-tool con el servicio (en marcha o activable): bien', () => {
    programa('secret-tool');
    programa('dbus-send', 'case "$*" in *ListActivatableNames*) echo \'   string "org.freedesktop.secrets"\' ;; *) echo \'   string "org.freedesktop.DBus"\' ;; esac');
    const r = bash('comprobar_llavero arch; echo "opcionales=$DOCTOR_OPCIONALES"');
    expect(r.salida).toMatch(/✓ secret-tool/); expect(r.salida).toContain('opcionales=0');
  });
  it('sin secret-tool: la orden de la familia', () => {
    const r = bash('comprobar_llavero debian');
    expect(r.salida).toContain('· secret-tool'); expect(r.salida).toContain('sudo apt install libsecret-tools');
  });
  it('heif-dec, o heif-convert (su nombre antiguo, el de Ubuntu 24.04)', () => {
    programa('heif-convert');
    expect(bash('comprobar_heif debian').salida).toContain('✓ heif-convert');
    rmSync(path.join(bin, 'heif-convert'));
    expect(bash('comprobar_heif fedora').salida).toContain('sudo dnf install libheif-tools');
  });
  it('terminal: $TERMINAL primero; si no hay ninguna, cómo poner una', () => {
    programa('konsole'); programa('mi-terminal');
    expect(bash('comprobar_terminal', { env: { TERMINAL: 'mi-terminal' } }).salida).toContain('(mi-terminal)');
    expect(bash('comprobar_terminal').salida).toContain('(konsole)');
    rmSync(path.join(bin, 'konsole'));
    expect(bash('comprobar_terminal').salida).toContain('variable TERMINAL');
  });
  it('editor: un `zed` que no es Zed (el de ZFS) no cuenta; el de Zed sí', () => {
    programa('zed');
    expect(bash('comprobar_editor').salida).toMatch(/· Editor/);
    const zedApp = path.join(dir, 'zed.app');
    programa('zed', 'exit 0', path.join(zedApp, 'bin')); escribir(path.join(zedApp, 'libexec', 'zed-editor'), '');
    rmSync(path.join(bin, 'zed'));
    expect(bash('comprobar_editor', { env: { PATH: `${bin}:${path.join(zedApp, 'bin')}` } }).salida).toContain('✓ Editor (zed)');
    programa('code');
    expect(bash('comprobar_editor').salida).toContain('✓ Editor (code)');
  });
  it('gio y dbus-send con el paquete de cada familia', () => {
    expect(bash('consejo_instalar gio debian').salida).toContain('libglib2.0-bin');
    expect(bash('consejo_instalar gio arch').salida).toContain('glib2');
    expect(bash('consejo_instalar dbus-send debian').salida).toContain('dbus-bin');
    expect(bash('consejo_instalar dbus-send fedora').salida).toContain('dbus-tools');
  });
});

describe('./shelter doctor', () => {
  it('se despacha antes de preparar nada (antes de Node, dependencias y descargas)', () => {
    const t = readFileSync(path.join(RAIZ, 'shelter'), 'utf8');
    const puerta = t.indexOf('scripts/doctor.sh');
    expect(puerta).toBeGreaterThan(0);
    expect(t).toMatch(/doctor\)\s*exec bash scripts\/doctor\.sh/);
    for (const paso of ['# 1. Node', 'curl ', 'npm', 'install.js']) expect(puerta).toBeLessThan(t.indexOf(paso));
  });
  it('el aviso del lanzador cuando cae el aislamiento lleva a ./shelter doctor', () => {
    expect(readFileSync(path.join(RAIZ, 'scripts', 'plataforma.sh'), 'utf8')).toContain('./shelter doctor');
  });
});

// doctor.sh copia de server/plataforma.ts el orden de las terminales y de los editores y la regla del `zed` de Zed: si uno
// cambia sin el otro, el diagnóstico diría que hay una terminal o un editor que el juego no usaría
describe('mismo orden y misma regla que server/plataforma.ts', () => {
  const texto = readFileSync(DOCTOR, 'utf8');
  const bucle = (funcion: string, variable: string) => {
    const cuerpo = texto.slice(texto.indexOf(`${funcion}() {`));
    const m = cuerpo.match(new RegExp(`for ${variable} in ([^;]+);`));
    expect(m, funcion).not.toBeNull();
    return m![1].trim().split(/\s+/).map(t => (t === '"${TERMINAL:-}"' ? '$TERMINAL' : t));
  };
  it('editores', () => { expect(bucle('comprobar_editor', 'e')).toEqual([...EDITORES_LINUX]); });
  it('terminales ($TERMINAL primero)', () => {
    const pedidas: string[] = [];
    ordenTerminal('/tmp', 'linux', { env: { TERMINAL: '$TERMINAL' }, buscar: n => { pedidas.push(n); return null; } });
    expect(bucle('comprobar_terminal', 't')).toEqual(pedidas);
  });
  it('un `zed` solo vale con libexec/zed-editor junto a su ruta real, en los dos', () => {
    const app = path.join(dir, 'zed.app'); const zed = programa('zed', 'exit 0', path.join(app, 'bin'));
    const env = { PATH: `${bin}:${path.join(app, 'bin')}` };
    const ts = () => editorLinux({ buscar: n => (n === 'zed' ? zed : null) });
    expect(ts()).toBeNull(); expect(bash('comprobar_editor', { env }).salida).toMatch(/· Editor/);
    escribir(path.join(app, 'libexec', 'zed-editor'), '');
    expect(ts()).toBe(zed); expect(bash('comprobar_editor', { env }).salida).toContain('✓ Editor (zed)');
  });
});
