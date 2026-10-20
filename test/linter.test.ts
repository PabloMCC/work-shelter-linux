// La supresión masiva de Oxlint (oxlint-suppressions.json, pnpm lint / lint:prune) va con opciones que sus autores
// quitaron de la ayuda mientras deciden el diseño final (--suppress-all, --prune-suppressions): este test comprueba,
// con el oxlint del proyecto y en una carpeta aparte, que siguen haciendo lo que el repo da por hecho. Si una versión
// nueva de oxlint lo cambia, falla aquí antes que en la CI de nadie. Incluye una regla con tipos (tsgolint).
// La carpeta aparte no lleva node_modules: oxlint recorrería sus miles de archivos y tsgolint llenó 34 GB de memoria
// en un minuto. tsgolint se le indica con OXLINT_TSGOLINT_PATH, y el primer test comprueba que solo se revisa a.ts.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const RAIZ = path.resolve(__dirname, '..');
const OXLINT = path.join(RAIZ, 'node_modules', '.bin', 'oxlint');
const TSGOLINT = path.join(RAIZ, 'node_modules', '.bin', 'tsgolint');
let dir = '';

const CONFIG = { options: { typeAware: true }, rules: { 'eslint/no-debugger': 'error', 'typescript/no-floating-promises': 'error' } };
const CODIGO = 'export async function tarea() { return 1; }\nexport function uno() { tarea(); }\nexport function dos() { tarea(); }\n';

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'linter-prueba-'));
  writeFileSync(path.join(dir, 'tsconfig.json'), JSON.stringify({ compilerOptions: { strict: true, noEmit: true, module: 'ESNext', target: 'ES2022' }, include: ['*.ts'] }));
  writeFileSync(path.join(dir, '.oxlintrc.json'), JSON.stringify(CONFIG));
  writeFileSync(path.join(dir, 'a.ts'), CODIGO);
});
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

const oxlint = (...args: string[]) => {
  const r = spawnSync(OXLINT, args, {
    cwd: dir, encoding: 'utf8', env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1', OXLINT_TSGOLINT_PATH: TSGOLINT },
  });
  return { codigo: r.status, salida: (r.stdout || '') + (r.stderr || '') };
};
const supresiones = () => JSON.parse(readFileSync(path.join(dir, 'oxlint-suppressions.json'), 'utf8'));

describe('oxlint: supresión masiva (lo que dan por hecho pnpm lint y lint:prune)', () => {
  it('solo revisa el archivo de la carpeta aparte, con la regla con tipos activa', () => {
    const r = oxlint('--format=json');
    const informe = JSON.parse(r.salida);
    expect(informe.number_of_files).toBe(1);
    expect(informe.diagnostics.map((d: { code: string }) => d.code)).toEqual([
      'typescript(no-floating-promises)', 'typescript(no-floating-promises)',
    ]);
  });

  it('sin el archivo de supresiones, lo que incumple falla (también la regla con tipos)', () => {
    const r = oxlint();
    expect(r.codigo).toBe(1);
    expect(r.salida).toMatch(/no-floating-promises/);
  });

  it('--suppress-all cuenta por archivo y regla, y con esa cuenta pasa', () => {
    expect(oxlint('--suppress-all').codigo).toBe(0);
    expect(supresiones()).toEqual({ 'a.ts': { 'typescript/no-floating-promises': { count: 2 } } });
    expect(oxlint().codigo).toBe(0);
  });

  it('un incumplimiento nuevo falla aunque la regla ya tenga cuenta', () => {
    oxlint('--suppress-all');
    writeFileSync(path.join(dir, 'a.ts'), CODIGO + 'export function tres() { tarea(); }\n');
    const r = oxlint();
    expect(r.codigo).toBe(1);
    expect(r.salida).toMatch(/new violations not covered by the suppressions file/);
  });

  it('uno arreglado falla hasta que --prune-suppressions baja la cuenta', () => {
    oxlint('--suppress-all');
    writeFileSync(path.join(dir, 'a.ts'), 'export async function tarea() { return 1; }\nexport async function uno() { await tarea(); }\nexport function dos() { tarea(); }\n');
    const r = oxlint();
    expect(r.codigo).toBe(1);
    expect(r.salida).toMatch(/suppressions that do not occur anymore/);
    expect(oxlint('--prune-suppressions').codigo).toBe(0);
    expect(supresiones()).toEqual({ 'a.ts': { 'typescript/no-floating-promises': { count: 1 } } });
    expect(oxlint().codigo).toBe(0);
  });

  it('una regla nueva sin cuenta (un debugger) falla aunque haya archivo de supresiones', () => {
    oxlint('--suppress-all');
    writeFileSync(path.join(dir, 'b.ts'), 'export function f() { debugger; }\n');
    expect(oxlint().codigo).toBe(1);
  });
});
