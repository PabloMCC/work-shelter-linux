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

# Arquitectura como la usa Node en sus descargas: x64 | arm64. Cualquier otra, error.
arq_node() {
  local m; m="$(uname -m)"
  case "$m" in
    x86_64|amd64) echo x64 ;;
    arm64|aarch64) echo arm64 ;;
    *) printf 'No hay un Node portátil para esta arquitectura («%s»): instala Node 22 desde https://nodejs.org\n' "$m" >&2; return 1 ;;
  esac
}

# Suma SHA-256 oficial del Node portátil (https://nodejs.org/dist/v<versión>/SHASUMS256.txt): suma_node <versión> <so>
# <arq>. Sin suma conocida no hay descarga: nunca se ejecuta un Node sin comprobar. Cambiar NODO_VERSION en ./shelter sin
# añadir aquí las sumas de la nueva falla antes de descargar nada.
suma_node() {
  case "${1:-}-${2:-}-${3:-}" in
    22.20.0-darwin-arm64) echo cc04a76a09f79290194c0646f48fec40354d88969bec467789a5d55dd097f949 ;;
    22.20.0-darwin-x64) echo 00df9c5df3e4ec6848c26b70fb47bf96492f342f4bed6b17f12d99b3a45eeecc ;;
    22.20.0-linux-arm64) echo 4181609e03dcb9880e7e5bf956061ecc0503c77a480c6631d868cb1f65a2c7dd ;;
    22.20.0-linux-x64) echo eeaccb0378b79406f2208e8b37a62479c70595e20be6b659125eb77dd1ab2a29 ;;
    *) printf 'No conozco la suma oficial de Node v%s para «%s %s»: no lo descargo. Instala Node 22 desde https://nodejs.org\n' "${1:-}" "${2:-}" "${3:-}" >&2; return 1 ;;
  esac
}

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
# a shelter.log, en la carpeta de los registros (carpeta y archivos solo legibles por ti). Cada arranque empieza uno
# nuevo y guarda solo el anterior en shelter.log.1, así que no crece sin fin. Si no se puede crear, devuelve 1 y la
# salida se queda donde estaba
registro_desde_menu() {
  local log; log="$(carpeta_registros)/shelter.log" || return 1
  ( umask 077; mkdir -p "${log%/*}" && { [ ! -e "$log" ] || { mv -f "$log" "$log.1" && chmod 600 "$log.1"; }; } && : > "$log" && chmod 600 "$log" ) 2>/dev/null || return 1
  exec >>"$log" 2>&1
  echo "== $(date '+%Y-%m-%d %H:%M:%S') · abierto desde el menú =="
}

# Cerrojo del lanzador: dos ./shelter a la vez (un doble clic en el menú) no pueden preparar lo mismo a la vez (npm ci,
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
# (ni Node, ni npm ci, ni Electron, ni el material, ni la compilación), que sería pisar al otro. ya_abierto_sin_cerrojo
# <raíz> <puerto> <datos>. Dos caminos:
# - Un servidor contesta /salud: el refugio ya está abierto. Desde la app de macOS se le pasa su dirección (la línea
#   SHELTER_URL); si no, se lanza el Electron ya descargado, si lo está, y su cerrojo de una sola ventana
#   (requestSingleInstanceLock en electron/main.cjs) trae al frente la que ya está. Devuelve 0.
# - Nadie contesta: el otro aún no tiene el servidor en marcha. Lo dice y devuelve 1, para volver a intentarlo luego
ya_abierto_sin_cerrojo() {
  local raiz="$1" puerto="$2" token="" url bin
  if ! curl -fs "http://127.0.0.1:$puerto/salud" >/dev/null 2>&1; then
    echo "Otro arranque de work-shelter sigue preparándolo y aún no ha abierto el refugio. Vuelve a intentarlo dentro de un momento." >&2
    return 1
  fi
  { read -r token < "$3/token"; } 2>/dev/null || true
  url="http://127.0.0.1:$puerto/#t=$token"
  if [ -n "${SHELTER_DESDE_APP:-}" ]; then echo "SHELTER_URL=$url"; return 0; fi
  if [ -z "${SHELTER_SIN_VENTANA:-}" ] && bin="$(electron_ya_descargado "$raiz")"; then
    echo "Ya hay un work-shelter abierto en el puerto $puerto: traigo su ventana al frente."
    ( cd "$raiz" && SHELTER_URL="$url" "$bin" electron/main.cjs ) >/dev/null 2>&1 || true
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
