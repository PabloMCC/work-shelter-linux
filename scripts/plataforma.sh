#!/bin/bash
# work-shelter — lo que el lanzador ./shelter decide según el sistema (macOS o Linux). Se carga con `source`: solo define
# funciones, sin efectos al cargarse. Compatible con el bash 3.2 de macOS (nada de bash 4) y con `set -euo pipefail`.

# Nombre del sistema como lo usa Node en sus descargas: darwin | linux. Cualquier otro, error.
so_node() {
  local s; s="$(uname -s)"
  case "$s" in
    Darwin) echo darwin ;;
    Linux) echo linux ;;
    *) printf 'work-shelter solo funciona en macOS y Linux (este sistema es «%s»).\n' "$s" >&2; return 1 ;;
  esac
}

# Node mínimo de una versión x.y.z (su número antes del primer punto): nodo_minimo <versión>. Si eso no es un número,
# nada y 1. ./shelter y el diagnóstico sacan así el mínimo de NODO_VERSION, sin escribirlo a mano
nodo_minimo() {
  local m="${1:-}"; m="${m%%.*}"
  case "$m" in ''|*[!0-9]*) return 1 ;; esac
  echo "$m"
}

# Arquitectura como la usa Node en sus descargas: x64 | arm64. Cualquier otra, error, que pide instalar el mínimo de
# <versión> si llega: arq_node [<versión>]
arq_node() {
  local m n; m="$(uname -m)"
  case "$m" in
    x86_64|amd64) echo x64 ;;
    arm64|aarch64) echo arm64 ;;
    *) n="$(nodo_minimo "${1:-}")" || n=""
      printf 'No hay un Node portátil para esta arquitectura («%s»): instala Node%s desde https://nodejs.org\n' "$m" "${n:+ $n}" >&2; return 1 ;;
  esac
}

# Suma SHA-256 oficial del Node portátil (https://nodejs.org/dist/v<versión>/SHASUMS256.txt): suma_node <versión> <so>
# <arq>. Sin suma conocida no hay descarga: nunca se ejecuta un Node sin comprobar. Cambiar NODO_VERSION en ./shelter sin
# añadir aquí las sumas de la nueva falla antes de descargar nada.
suma_node() {
  local n
  # de https://nodejs.org/dist/v<versión>/SHASUMS256.txt.asc, con su firma comprobada con gpg contra las claves de
  # https://github.com/nodejs/release-keys antes de copiar sus cuatro líneas .tar.gz (darwin-arm64, darwin-x64,
  # linux-arm64, linux-x64)
  case "${1:-}-${2:-}-${3:-}" in
    24.22.0-darwin-arm64) echo 6a9724d9b50a5f22b4816cded441b5a8d9ddae546191a5e5b7efa5a5e2ee26d5 ;;
    24.22.0-darwin-x64) echo 495e3f273c645f3c4677d438304cdfc701729ea5dec5728f5c8e76a2dece4b91 ;;
    24.22.0-linux-arm64) echo b7e7991d5407815adfa74a2a9cd4db683552c8ce32ff4a295c22e972849c3f5d ;;
    24.22.0-linux-x64) echo 28ea0a438de9a13bd7891fd758eee6c7819ee8af5442dfd8d45bd65e56d4228c ;;
    *) n="$(nodo_minimo "${1:-}")" || n=""
      printf 'No conozco la suma oficial de Node v%s para «%s %s»: no lo descargo. Instala Node%s desde https://nodejs.org\n' "${1:-}" "${2:-}" "${3:-}" "${n:+ $n}" >&2; return 1 ;;
  esac
}

# Tras instalar un Node portátil, borra los anteriores del mismo sistema y arquitectura: al subir NODO_VERSION el viejo
# (unos 100 MB) se quedaría para siempre, y Electron añade al PATH el bin/ de cada portátil (electron/plataforma.cjs).
# borrar_nodos_viejos <raíz> <carpeta nueva, .runtime/…> <so> <arq>: solo <raíz>/.runtime/node-v<x.y.z>-<so>-<arq>,
# nunca la nueva ni las de otro sistema o arquitectura. Sin alguno de los datos no borra nada y devuelve 1
borrar_nodos_viejos() { borrar_versiones_viejas node-v "$@"; }

# Lo común de borrar_nodos_viejos y borrar_pnpm_viejos: borrar_versiones_viejas <prefijo> <raíz> <carpeta nueva> <so>
# <arq> borra <raíz>/.runtime/<prefijo><versión>-<so>-<arq> salvo la nueva, solo si <versión> es una serie de números
# con puntos, nunca un enlace ni lo de otro sistema o arquitectura. Sin alguno de los datos no borra nada y devuelve 1
borrar_versiones_viejas() {
  local prefijo="${1:-}" raiz="${2:-}" nueva="${3:-}" so="${4:-}" arq="${5:-}" d n v
  [ -n "$prefijo" ] && [ -n "$raiz" ] && [ -n "$nueva" ] && [ -n "$so" ] && [ -n "$arq" ] || return 1
  nueva="${nueva##*/}"
  # sin coincidencias, el patrón queda tal cual y no es una carpeta: no se borra nada
  for d in "$raiz/.runtime/$prefijo"*"-$so-$arq"; do
    [ -d "$d" ] && [ ! -L "$d" ] || continue
    n="${d##*/}"; [ "$n" != "$nueva" ] || continue
    v="${n#"$prefijo"}"; v="${v%-"$so"-"$arq"}"
    case "$v" in ''|*[!0-9.]*|.*|*.|*..*) continue ;; esac   # solo versiones x.y.z de números
    rm -rf "$d" || true
  done
  return 0
}

# pnpm fijado: ./shelter nunca usa un pnpm del sistema. Instala las dependencias con el de packageManager
# (package.json), el ejecutable autónomo que publica pnpm en el registro de npm (@pnpm/exe.<so>-<arq>, no necesita
# Node), comprobado con la integridad sha512 que el propio pnpm guarda de él en pnpm-lock.yaml
# (packageManagerDependencies) antes de extraer nada. Los nombres de sistema y arquitectura son los de so_node y
# arq_node, que coinciden con los de esos paquetes.

# Versión de pnpm de packageManager: version_pnpm <node> <package.json>. Solo «pnpm@x.y.z» (con o sin «+huella» detrás);
# cualquier otra cosa, nada y 1
version_pnpm() {
  [ -n "${1:-}" ] && [ -n "${2:-}" ] || return 1
  "$1" -e '
    let pm = "";
    try { pm = String(JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8")).packageManager ?? ""); } catch {}
    const m = /^pnpm@(\d+\.\d+\.\d+)(\+[A-Za-z0-9.+/=-]+)?$/.exec(pm);
    if (!m) process.exit(1);
    console.log(m[1]);
  ' "$2" 2>/dev/null
}

# Carpeta de un pnpm (relativa a la raíz) y dirección de su paquete en el registro:
# carpeta_pnpm|url_pnpm <ver> <so> <arq>
carpeta_pnpm() { [ -n "${1:-}" ] && [ -n "${2:-}" ] && [ -n "${3:-}" ] || return 1; echo ".runtime/pnpm-$1-$2-$3"; }
url_pnpm() {
  [ -n "${1:-}" ] && [ -n "${2:-}" ] && [ -n "${3:-}" ] || return 1
  echo "https://registry.npmjs.org/@pnpm/exe.$2-$3/-/exe.$2-$3-$1.tgz"
}

# Integridad esperada del pnpm de un sistema según el lockfile: integridad_pnpm <pnpm-lock.yaml> <ver> <so> <arq>. Busca
# la clave «  '@pnpm/exe.<so>-<arq>@<ver>':» (sección packages) y vale solo si la línea siguiente es su
# «resolution: {integrity: sha512-…}» con un sha512 completo (88 caracteres en base64). La misma clave en snapshots no
# lleva esa línea y se salta. Sin ella, falla cerrado con un mensaje: nunca se descarga un pnpm sin saber qué esperar
integridad_pnpm() {
  local lock="${1:-}" ver="${2:-}" so="${3:-}" arq="${4:-}" clave l sig="" v=""
  if [ -n "$ver" ] && [ -n "$so" ] && [ -n "$arq" ] && [ -f "$lock" ]; then
    clave="@pnpm/exe.$so-$arq@$ver"
    while IFS= read -r l || [ -n "$l" ]; do
      if [ -n "$sig" ]; then
        sig=""
        case "$l" in "    resolution: {integrity: sha512-"*"}") v="${l#"    resolution: {integrity: "}"; v="${v%\}}"; break ;; esac
      fi
      if [ "$l" = "  '$clave':" ] || [ "$l" = "  $clave:" ]; then sig=1; fi
    done < "$lock"
  fi
  # sha512 en base64: 86 caracteres y «==»
  case "$v" in sha512-*==) case "${v#sha512-}" in *[!A-Za-z0-9+/=]*) v="" ;; esac ;; *) v="" ;; esac
  [ "${#v}" -eq 95 ] || v=""
  if [ -z "$v" ]; then
    printf 'No encuentro en %s la huella de pnpm %s para «%s %s»: no lo descargo.\n' "${lock:-pnpm-lock.yaml}" "$ver" "$so" "$arq" >&2
    return 1
  fi
  echo "$v"
}

# Comprueba un archivo contra una integridad «sha512-<base64>» con el Node que se le pase (node:crypto, igual en macOS
# y en Linux): sha512_comprobar <node> <archivo> <integridad>. 0 si cuadra; 1 si no, o con otro algoritmo o nada
sha512_comprobar() {
  [ -n "${1:-}" ] && [ -n "${2:-}" ] || return 1
  case "${3:-}" in sha512-?*) ;; *) return 1 ;; esac
  "$1" -e '
    const [archivo, esperada] = process.argv.slice(1);
    const h = require("node:crypto").createHash("sha512").update(require("node:fs").readFileSync(archivo)).digest("base64");
    process.exit("sha512-" + h === esperada ? 0 : 1);
  ' "$2" "$3" 2>/dev/null
}

# Tras instalar un pnpm, borra los anteriores del mismo sistema y arquitectura (unos 60 MB cada uno), con las mismas
# reglas que borrar_nodos_viejos: borrar_pnpm_viejos <raíz> <carpeta nueva, .runtime/…> <so> <arq>
borrar_pnpm_viejos() { borrar_versiones_viejas pnpm- "$@"; }

# Comprueba líneas «SUMA  archivo» que llegan por la entrada: sha256sum (Linux) o, si no está, shasum (macOS)
sha256_comprobar() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum -c -
  elif command -v shasum >/dev/null 2>&1; then shasum -a 256 -c -
  else echo "No encuentro sha256sum ni shasum para comprobar la descarga." >&2; return 1; fi
}

# Huella SHA-1 de un archivo, solo el hexadecimal (el sello de las dependencias). shasum primero, como siempre en macOS:
# los sellos ya guardados siguen valiendo; sha1sum da la misma cifra en Linux.
huella_de() {
  local h
  if command -v shasum >/dev/null 2>&1; then h="$(shasum "$1")"
  elif command -v sha1sum >/dev/null 2>&1; then h="$(sha1sum "$1")"
  else echo "No encuentro shasum ni sha1sum." >&2; return 1; fi
  echo "${h%% *}"
}

# Abre una URL en el navegador: open en macOS, xdg-open en Linux. Sin xdg-open (o si falla), la escribe para abrirla a mano.
abrir_url() {
  if [ "$(so_node)" = darwin ]; then open "$1"; return; fi
  if command -v xdg-open >/dev/null 2>&1 && xdg-open "$1" >/dev/null 2>&1; then return 0; fi
  echo "No he podido abrir el navegador. Abre a mano: $1"
}

# ./shelter instalar-app: la app de macOS o el acceso en el menú de Linux. En otro sistema lo dice so_node y sale con 1,
# antes de preparar nada
instalar_app_disponible() { so_node >/dev/null; }

# El instalador de cada sistema (relativo a la raíz del repo): instalar-app.mjs en macOS, instalar-app-linux.mjs en Linux
instalador_app() {
  local so; so="$(so_node)" || return 1
  if [ "$so" = darwin ]; then echo scripts/instalar-app.mjs; else echo scripts/instalar-app-linux.mjs; fi
}

# ./shelter desinstalar-app quita el acceso en el menú de Linux; en macOS la app se borra como cualquier otra
desinstalar_app_disponible() {
  local so; so="$(so_node)" || return 1
  [ "$so" = linux ] && return 0
  echo "desinstalar-app solo se usa en Linux. En macOS, arrastra /Applications/work-shelter-public.app a la papelera." >&2
  return 1
}

# Carpeta de los registros: ~/Library/Logs/work-shelter-public en macOS (la misma de electron/main.cjs) y
# $XDG_STATE_HOME/work-shelter-public en Linux (~/.local/state si no está o no es una ruta absoluta)
carpeta_registros() {
  local so; so="$(so_node)" || return 1
  if [ "$so" = darwin ]; then echo "$HOME/Library/Logs/work-shelter-public"; return; fi
  case "${XDG_STATE_HOME:-}" in
    /*) echo "$XDG_STATE_HOME/work-shelter-public" ;;
    *) echo "$HOME/.local/state/work-shelter-public" ;;
  esac
}

# Abierto desde el menú (SHELTER_DESDE_MENU) no hay terminal: lo que escribe ./shelter, errores incluidos, va desde aquí
# a shelter.log, en la carpeta de los registros (carpeta y archivos solo legibles por ti). registro_desde_menu [nuevo]:
# - sin nada, se añade al final: un arranque que solo trae al frente la ventana, o que espera al cerrojo, no toca lo que
#   va escribiendo el refugio ya abierto
# - con «nuevo» (solo el arranque que va a abrir el servidor, justo antes): el anterior pasa a shelter.log.1 y se empieza
#   otro, así que no crece sin fin. Lo ya escrito por este arranque queda en el anterior
# Si no se puede preparar, devuelve 1 y la salida se queda donde estaba
registro_desde_menu() {
  local log; log="$(carpeta_registros)/shelter.log" || return 1
  (
    umask 077
    mkdir -p "${log%/*}" || exit 1
    # rotar: el anterior a shelter.log.1, cerrado a 600 aunque viniera con otros permisos
    if [ "${1:-}" = nuevo ] && [ -e "$log" ]; then mv -f "$log" "$log.1" && chmod 600 "$log.1" || exit 1; fi
    # el que se usa: se crea si no está y queda a 600
    : >> "$log" && chmod 600 "$log"
  ) 2>/dev/null || return 1
  # siempre añadiendo: tras rotar, la salida deja el archivo apartado y pasa al nuevo
  exec >>"$log" 2>&1
  echo "== $(date '+%Y-%m-%d %H:%M:%S') · abierto desde el menú${1:+ · este arranque abre el refugio} =="
}

# Cerrojo del lanzador: dos ./shelter a la vez (un doble clic en el menú) no pueden preparar lo mismo a la vez (pnpm,
# Electron, el material, la compilación, el servidor) o se pisan en node_modules. Es una carpeta (mkdir es atómico en
# macOS y en Linux, que no traen el mismo flock) con el pid del dueño dentro. tomar_cerrojo <carpeta> [segundos]: espera
# como mucho esos segundos (SHELTER_ESPERA_CERROJO, 120 por omisión) avisando una vez; si el dueño ya no vive, el
# cerrojo se recupera. Nunca se quita uno cuyo dueño sigue vivo. Recuperarlo pasa por un segundo cerrojo (<carpeta>.romper,
# también con el pid de su dueño y recuperable con la misma regla, por si un SIGKILL lo deja puesto) para que dos que
# esperan no se lo quiten el uno al otro. soltar_cerrojo lo quita solo si es suyo
CERROJO_LANZADOR=""
# 5 s a 0,2 s por vuelta: una carpeta de cerrojo sin pid más tiempo que eso es de un dueño que murió entre crearla y
# escribirlo
VUELTAS_SIN_PID=25
pid_de_cerrojo() { local pid=""; { read -r pid < "$1/pid"; } 2>/dev/null || true; [ -n "$pid" ] || return 1; echo "$pid"; }
# ¿Sigue vivo el dueño? 0 sí, 1 no; sin pid (lo está creando) cuenta como vivo
dueno_vivo() { local pid; pid="$(pid_de_cerrojo "$1")" || return 0; kill -0 "$pid" 2>/dev/null; }
# ¿Está abandonado? cerrojo_abandonado <carpeta> <vueltas sin pid>: su dueño murió o lleva demasiado sin pid
cerrojo_abandonado() { ! dueno_vivo "$1" || [ "$2" -gt "$VUELTAS_SIN_PID" ]; }
tomar_cerrojo() {
  local d="$1" romper="$1.romper" max="${2:-${SHELTER_ESPERA_CERROJO:-120}}" vueltas=0 avisado="" sin_pid=0 sin_pid_romper=0 ok
  mkdir -p "${d%/*}" 2>/dev/null || true
  while :; do
    if mkdir "$d" 2>/dev/null; then echo "$$" > "$d/pid"; CERROJO_LANZADOR="$d"; return 0; fi
    if pid_de_cerrojo "$d" >/dev/null; then sin_pid=0; else sin_pid=$((sin_pid + 1)); fi
    if [ -d "$romper" ] && ! pid_de_cerrojo "$romper" >/dev/null; then sin_pid_romper=$((sin_pid_romper + 1)); else sin_pid_romper=0; fi
    # un .romper abandonado (su dueño murió dentro de la recuperación) bloquearía todos los arranques para siempre
    if [ -d "$romper" ] && cerrojo_abandonado "$romper" "$sin_pid_romper"; then rm -rf "$romper"; sin_pid_romper=0; fi
    if cerrojo_abandonado "$d" "$sin_pid" && mkdir "$romper" 2>/dev/null; then
      echo "$$" > "$romper/pid"
      if cerrojo_abandonado "$d" "$sin_pid"; then rm -rf "$d"; fi
      ok=1; mkdir "$d" 2>/dev/null && { echo "$$" > "$d/pid"; CERROJO_LANZADOR="$d"; ok=0; }
      rm -rf "$romper"
      [ "$ok" = 0 ] && return 0
      sin_pid=0; continue
    fi
    # vueltas de 0,2 s (SECONDS solo cuenta segundos enteros y se adelantaría hasta uno)
    if [ "$vueltas" -ge $((max * 5)) ]; then
      printf 'Otro arranque de work-shelter (pid %s) sigue preparándolo después de %s s: no lo toco.\n' "$(pid_de_cerrojo "$d" || echo '?')" "$max" >&2
      return 1
    fi
    [ -n "$avisado" ] || { avisado=1; echo "Otro arranque de work-shelter está preparándolo: espero a que termine…" >&2; }
    sleep 0.2; vueltas=$((vueltas + 1))
  done
}
soltar_cerrojo() {
  [ -n "$CERROJO_LANZADOR" ] || return 0
  [ "$(pid_de_cerrojo "$CERROJO_LANZADOR" 2>/dev/null)" = "$$" ] && rm -rf "$CERROJO_LANZADOR"
  CERROJO_LANZADOR=""
}

# Ruta del binario de Electron según su propio paquete (Electron.app/Contents/MacOS/Electron en macOS, dist/electron en
# Linux) con el Node que se le pase; vacía si aún no está descargado
electron_binario() { "$1" -p "require('electron')" 2>/dev/null || true; }

# El binario de Electron si ya está descargado, sin Node y sin descargar nada (require('electron') lo descargaría si
# falta): node_modules/electron/dist/<path.txt>, como lo resuelve su propio paquete. Falla si no está o no se puede ejecutar
electron_ya_descargado() {
  local e="$1/node_modules/electron" p=""
  { read -r p < "$e/path.txt"; } 2>/dev/null || true
  [ -n "$p" ] && [ -x "$e/dist/$p" ] || return 1
  echo "$e/dist/$p"
}

# ./shelter no ha conseguido el cerrojo (otro arranque sigue preparando después de la espera): aquí nunca se prepara nada
# (ni Node, ni pnpm, ni Electron, ni el material, ni la compilación), que sería pisar al otro. ya_abierto_sin_cerrojo
# <raíz> <puerto> <datos>. Dos caminos:
# - Un servidor contesta /salud: el refugio ya está abierto. Desde la app de macOS se le pasa su dirección (la línea
#   SHELTER_URL); si no, se lanza el Electron ya descargado, si lo está, y su cerrojo de una sola ventana
#   (requestSingleInstanceLock en electron/main.cjs) trae al frente la que ya está. Su salida se añade a electron.log
#   con ventana_electron, como la de la ventana normal, sin vaciarlo (es el de la ventana abierta); si no se puede, se
#   queda en la de aquí. Si ninguna ventana tiene ese cerrojo (un servidor sin ventana, SHELTER_SIN_VENTANA), este
#   Electron pasa a ser la ventana y aquí se espera a que se cierre: es lo buscado. Devuelve 0.
# - Nadie contesta: el otro aún no tiene el servidor en marcha. Lo dice y devuelve 1, para volver a intentarlo luego
ya_abierto_sin_cerrojo() {
  local raiz="$1" puerto="$2" datos="$3" token="" url bin log
  if ! curl -fs "http://127.0.0.1:$puerto/salud" >/dev/null 2>&1; then
    echo "Otro arranque de work-shelter sigue preparándolo y aún no ha abierto el refugio. Vuelve a intentarlo dentro de un momento." >&2
    return 1
  fi
  { read -r token < "$datos/token"; } 2>/dev/null || true
  url="http://127.0.0.1:$puerto/#t=$token"
  if [ -n "${SHELTER_DESDE_APP:-}" ]; then echo "SHELTER_URL=$url"; return 0; fi
  if [ -z "${SHELTER_SIN_VENTANA:-}" ] && bin="$(electron_ya_descargado "$raiz")"; then
    echo "Ya hay un work-shelter abierto en el puerto $puerto: traigo su ventana al frente."
    log="$(carpeta_registros)/electron.log" && ( umask 077; mkdir -p "${log%/*}" && : >> "$log" ) 2>/dev/null || log=""
    ( cd "$raiz" && SHELTER_URL="$url" ventana_electron "$bin" "$log" electron/main.cjs ) || true
  else
    echo "Ya hay un work-shelter abierto: http://127.0.0.1:$puerto"
  fi
  return 0
}

# ¿Dice el registro que Chromium no ha podido aislarse? Pasa con chrome-sandbox sin SUID de root y los espacios de nombres
# de usuario bloqueados (Ubuntu 23.10+ con AppArmor, por ejemplo)
registro_pide_sandbox() { grep -qiE 'SUID sandbox|chrome-sandbox|No usable sandbox|user namespaces' "$1" 2>/dev/null; }

# Abre la ventana del juego con su salida en el registro: ventana_electron <electron> <registro> [argumentos…]. Devuelve 0
# si se cierra bien o tras usarla un rato, y 1 si cae nada más abrir (el lanzador abre entonces el navegador). «Nada más
# abrir» es antes de 10 s: un fallo de arranque (sandbox, bibliotecas, pantalla) cae enseguida; más tarde, ya se ha
# usado y abrir el navegador sería una sorpresa. MARGEN_ELECTRON=<segundos> cambia el umbral (las pruebas usan 0).
# Con el registro vacío (no se pudo crear), la salida va a la terminal y no se habla del registro ni se busca en él
ventana_electron() {
  local bin="$1" log="$2" inicio="$SECONDS" codigo=0; shift 2
  if [ -n "$log" ]; then "$bin" "$@" >>"$log" 2>&1 || codigo=$?; else "$bin" "$@" || codigo=$?; fi
  [ "$codigo" -eq 0 ] && return 0
  printf 'La ventana del juego (Electron) se ha cerrado con un error (código %s).%s\n' "$codigo" "${log:+ Registro: $log}" >&2
  [ $((SECONDS - inicio)) -ge "${MARGEN_ELECTRON:-10}" ] && return 0
  if [ -n "$log" ] && registro_pide_sandbox "$log"; then
    echo "  Este sistema no deja a Electron usar su aislamiento (sandbox), que protege del contenido web: el diagnóstico (./shelter doctor) explica cómo permitirlo de forma segura." >&2
  fi
  return 1
}
