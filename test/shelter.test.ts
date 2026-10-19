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
const bash = (orden: string, o: { s?: string; m?: string; real?: boolean; entrada?: string } = {}) => {
  unameFalso();
  const r = spawnSync('/bin/bash', ['-c', `source "${PLATAFORMA}"; ${orden}`], {
    encoding: 'utf8', input: o.entrada ?? '',
    env: { PATH: o.real ? `${process.env.PATH}` : dir, REG: reg, FALSO_S: o.s ?? 'Linux', FALSO_M: o.m ?? 'x86_64' },
  });
  return { codigo: r.status, salida: r.stdout.trim(), error: r.stderr.trim() };
};
const registro = () => (existsSync(reg) ? readFileSync(reg, 'utf8').trim().split('\n') : []);

const SUMAS: Record<string, string> = {
  'darwin-arm64': 'cc04a76a09f79290194c0646f48fec40354d88969bec467789a5d55dd097f949',
  'darwin-x64': '00df9c5df3e4ec6848c26b70fb47bf96492f342f4bed6b17f12d99b3a45eeecc',
  'linux-arm64': '4181609e03dcb9880e7e5bf956061ecc0503c77a480c6631d868cb1f65a2c7dd',
  'linux-x64': 'eeaccb0378b79406f2208e8b37a62479c70595e20be6b659125eb77dd1ab2a29',
};

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
  it('da la suma oficial de cada combinación', () => {
    for (const [clave, suma] of Object.entries(SUMAS)) {
      const [so, arq] = clave.split('-');
      expect(bash(`suma_node ${so} ${arq}`)).toMatchObject({ codigo: 0, salida: suma });
    }
  });
  it('sin suma conocida se niega (nunca se descarga nada sin comprobar)', () => {
    for (const par of ['linux riscv64', 'win x64', 'darwin', '']) {
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
