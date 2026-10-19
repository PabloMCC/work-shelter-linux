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

# Suma SHA-256 oficial del Node portátil (https://nodejs.org/dist/v22.20.0/SHASUMS256.txt). Sin suma conocida no hay
# descarga: nunca se ejecuta un Node sin comprobar. Si cambia NODO_VERSION en ./shelter, cambian estas sumas.
suma_node() {
  case "${1:-}-${2:-}" in
    darwin-arm64) echo cc04a76a09f79290194c0646f48fec40354d88969bec467789a5d55dd097f949 ;;
    darwin-x64) echo 00df9c5df3e4ec6848c26b70fb47bf96492f342f4bed6b17f12d99b3a45eeecc ;;
    linux-arm64) echo 4181609e03dcb9880e7e5bf956061ecc0503c77a480c6631d868cb1f65a2c7dd ;;
    linux-x64) echo eeaccb0378b79406f2208e8b37a62479c70595e20be6b659125eb77dd1ab2a29 ;;
    *) printf 'No conozco la suma oficial de Node para «%s %s»: no lo descargo.\n' "${1:-}" "${2:-}" >&2; return 1 ;;
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
