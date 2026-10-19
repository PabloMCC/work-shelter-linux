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

# ./shelter instalar-app solo crea la app de macOS: en otro sistema lo dice y sale con 1, antes de preparar nada
instalar_app_disponible() {
  local so; so="$(so_node)" || return 1
  [ "$so" = darwin ] && return 0
  echo "El acceso en el menú de aplicaciones aún no está disponible en este sistema (instalar-app solo crea la app de macOS)." >&2
  echo "  Mientras tanto, abre work-shelter desde una terminal en esta carpeta con: ./shelter" >&2
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

# Ruta del binario de Electron según su propio paquete (Electron.app/Contents/MacOS/Electron en macOS, dist/electron en
# Linux) con el Node que se le pase; vacía si aún no está descargado
electron_binario() { "$1" -p "require('electron')" 2>/dev/null || true; }

# ¿Dice el registro que Chromium no ha podido aislarse? Pasa con chrome-sandbox sin SUID de root y los espacios de nombres
# de usuario bloqueados (Ubuntu 23.10+ con AppArmor, por ejemplo)
registro_pide_sandbox() { grep -qiE 'SUID sandbox|chrome-sandbox|No usable sandbox|user namespaces' "$1" 2>/dev/null; }

# Abre la ventana del juego con su salida en el registro: ventana_electron <electron> <registro> [argumentos…]. Devuelve 0
# si se cierra bien o tras usarla un rato, y 1 si cae nada más abrir (el lanzador abre entonces el navegador)
ventana_electron() {
  local bin="$1" log="$2" inicio="$SECONDS" codigo=0; shift 2
  "$bin" "$@" >>"$log" 2>&1 || codigo=$?
  [ "$codigo" -eq 0 ] && return 0
  printf 'La ventana del juego (Electron) se ha cerrado con un error (código %s). Registro: %s\n' "$codigo" "$log" >&2
  [ $((SECONDS - inicio)) -ge "${MARGEN_ELECTRON:-10}" ] && return 0
  if registro_pide_sandbox "$log"; then
    echo "  Este sistema no deja a Electron usar su aislamiento (sandbox), que protege del contenido web: el diagnóstico de work-shelter explica cómo permitirlo de forma segura." >&2
  fi
  return 1
}
