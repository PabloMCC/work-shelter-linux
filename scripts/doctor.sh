#!/bin/bash
# work-shelter — ./shelter doctor: comprueba lo que el juego necesita (obligatorio) y lo que mejora (opcional), sin
# preparar ni instalar nada. De lo que falte escribe la orden para instalarlo con pacman, apt o dnf (según
# /etc/os-release); las que piden sudo las ejecuta la persona, nunca este script. Sale con 0 si todo lo obligatorio está y
# con 1 si no. Compatible con el bash 3.2 de macOS. Cargado con `source` solo define funciones (así se prueba cada una).
# pnpm no se comprueba: ./shelter descarga el suyo (el de packageManager) y nunca usa uno del sistema.
# Para las pruebas: DOCTOR_RAIZ antepone una carpeta a /etc, /proc/sys y /dev; DOCTOR_ELECTRON_DIST cambia la carpeta
# del binario de Electron (por omisión, node_modules/electron/dist de este repositorio).

case "${BASH_SOURCE[0]}" in */*) DOCTOR_SCRIPTS="${BASH_SOURCE[0]%/*}" ;; *) DOCTOR_SCRIPTS=. ;; esac
RAIZ_DOCTOR="$(cd "$DOCTOR_SCRIPTS/.." && pwd)"
source "$DOCTOR_SCRIPTS/plataforma.sh"

DOCTOR_FALTAN=0; DOCTOR_OPCIONALES=0
bien() { printf '  ✓ %s\n' "$*"; }
mal() { printf '  ✗ %s\n' "$*"; DOCTOR_FALTAN=$((DOCTOR_FALTAN + 1)); }
opcional() { printf '  · %s\n' "$*"; DOCTOR_OPCIONALES=$((DOCTOR_OPCIONALES + 1)); }
detalle() { printf '      %s\n' "$*"; }

# Familia del sistema: macos | arch | debian | fedora | desconocida. En Linux, por ID e ID_LIKE de os-release (CachyOS o
# Manjaro dicen ID_LIKE=arch; Mint, ID_LIKE="ubuntu debian"; CentOS o Rocky, "rhel fedora")
familia_distro() {
  local so f linea id="" como="" p
  so="$(so_node 2>/dev/null)" || { echo desconocida; return; }
  [ "$so" = darwin ] && { echo macos; return; }
  f="${DOCTOR_RAIZ:-}/etc/os-release"; [ -r "$f" ] || f="${DOCTOR_RAIZ:-}/usr/lib/os-release"
  if [ -r "$f" ]; then
    while IFS= read -r linea || [ -n "$linea" ]; do
      case "$linea" in ID=*) id="${linea#ID=}" ;; ID_LIKE=*) como="${linea#ID_LIKE=}" ;; esac
    done < "$f"
  fi
  id="${id//\"/}"; id="${id//\'/}"; como="${como//\"/}"; como="${como//\'/}"
  for p in $id $como; do
    case "$p" in arch) echo arch; return ;; debian|ubuntu) echo debian; return ;; fedora|rhel) echo fedora; return ;; esac
  done
  echo desconocida
}

# Orden de instalación de una familia: orden_instalar <familia> <paquetes…>
orden_instalar() {
  local fam="$1"; shift
  case "$fam" in
    arch) echo "sudo pacman -S --needed $*" ;;
    debian) echo "sudo apt install $*" ;;
    fedora) echo "sudo dnf install $*" ;;
    *) return 1 ;;
  esac
}

# Paquete que da cada herramienta en cada familia: paquetes_de <herramienta> <familia>. Nombres comprobados en los
# índices oficiales (archlinux.org, packages.debian.org, packages.ubuntu.com, packages.fedoraproject.org)
paquetes_de() {
  case "$1:$2" in
    curl:*|git:*|tar:*) echo "$1" ;;
    xdg-open:*) echo xdg-utils ;;
    gio:debian) echo libglib2.0-bin ;; gio:*) echo glib2 ;;
    dbus-send:arch) echo dbus ;; dbus-send:debian) echo dbus-bin ;; dbus-send:fedora) echo dbus-tools ;;
    secret-tool:debian) echo libsecret-tools ;; secret-tool:*) echo libsecret ;;
    heif:arch) echo libheif ;; heif:debian) echo "libheif-examples libheif-plugin-libde265" ;; heif:fedora) echo libheif-tools ;;
    gh:arch) echo github-cli ;; gh:*) echo gh ;;
    *) return 1 ;;
  esac
}

# Cómo instalar una herramienta que falta: consejo_instalar <herramienta> <familia>
consejo_instalar() {
  local h="$1" fam="$2" p f
  case "$fam" in
    arch|debian|fedora) p="$(paquetes_de "$h" "$fam")" && detalle "Instálalo: $(orden_instalar "$fam" $p)" ;;
    macos)
      case "$h" in
        gh) detalle "Instálalo desde https://cli.github.com" ;;
        *) detalle "Instálalo con las herramientas de línea de órdenes de Apple: xcode-select --install" ;;
      esac ;;
    *)
      detalle "Instálalo con el gestor de paquetes de tu sistema; en las familias más comunes:"
      for f in arch debian fedora; do p="$(paquetes_de "$h" "$f")" && detalle "  $(orden_instalar "$f" $p)"; done ;;
  esac
  case "$h:$fam" in heif:fedora|heif:desconocida)
    detalle "En Fedora, las fotos de iPhone (HEVC) necesitan además libheif-freeworld, de RPM Fusion (https://rpmfusion.org)." ;;
  esac
}

hay() { command -v "$1" >/dev/null 2>&1; }

# Una herramienta obligatoria u opcional: herramienta <obligatoria|opcional> <nombre> <para qué> <familia>
herramienta() {
  if hay "$2"; then bien "$2: $3"; return 0; fi
  if [ "$1" = obligatoria ]; then mal "$2: $3"; else opcional "$2: $3"; fi
  consejo_instalar "$2" "$4"
}

# NODO_VERSION de ./shelter (la única fuente): la versión del Node portátil
version_node_shelter() {
  local linea
  while IFS= read -r linea || [ -n "$linea" ]; do
    case "$linea" in NODO_VERSION=*) linea="${linea#NODO_VERSION=}"; echo "${linea//\"/}"; return 0 ;; esac
  done < "$RAIZ_DOCTOR/shelter"
  return 1
}

# El Node mínimo de ./shelter (el de su NODO_VERSION) o superior, o poder descargar el portátil (sistema y arquitectura
# con suma conocida, y algo para comprobarla). Sin NODO_VERSION que leer no da por bueno ningún Node del sistema
comprobar_node() {
  local v="" ver="" min="" nodo so arq
  hay node && v="$(node -p 'process.versions.node' 2>/dev/null)"
  ver="$(version_node_shelter 2>/dev/null)" && min="$(nodo_minimo "$ver")" || min=""
  nodo="Node${min:+ $min}"
  if [ -n "$v" ] && [ "${v%%.*}" -ge "$min" ] 2>/dev/null; then bien "Node $v: ejecuta el juego"; return 0; fi
  if so="$(so_node 2>/dev/null)" && arq="$(arq_node "$ver" 2>/dev/null)" && suma_node "$ver" "$so" "$arq" >/dev/null 2>&1 \
    && { hay sha256sum || hay shasum; }; then
    bien "$nodo: ${v:+tienes el $v, que no llega; }./shelter descargará el oficial ($ver) solo para el juego, con su suma comprobada"
  else
    mal "$nodo o superior: ${v:+tienes el $v y }no hay un Node portátil que descargar para este sistema"
    detalle "Instala $nodo o superior desde https://nodejs.org"
  fi
}

comprobar_claude() {
  if hay claude || [ -x "$HOME/.local/bin/claude" ]; then bien "Claude Code (claude): hace trabajar a los habitantes"; return 0; fi
  mal "Claude Code (claude): hace trabajar a los habitantes"
  detalle "Instálalo (https://docs.claude.com/claude-code) y entra con tu cuenta: ejecuta 'claude' y luego '/login'."
}

# Un valor de /proc/sys (kernel/unprivileged_userns_clone…); falla si no existe
leer_sysctl() {
  local f="${DOCTOR_RAIZ:-}/proc/sys/$1" v=""
  [ -r "$f" ] || return 1
  read -r v < "$f" || [ -n "$v" ] || return 1
  echo "$v"
}

# «uid permisos» de un archivo (0 -rwsr-xr-x es de root con modo 4755), con ls -ln: igual en Linux y en macOS
dueno_y_modo() {
  set -- $(ls -ln "$1" 2>/dev/null)
  [ $# -ge 3 ] || return 1
  echo "$3 ${1:0:10}"
}

# El ayudante chrome-sandbox de root, la forma segura de devolverle el aislamiento: consejo_ayudante <entrada> <chrome-sandbox>
consejo_ayudante() {
  detalle "$1 el ayudante chrome-sandbox de Electron, de root y con modo 4755 (tras el primer ./shelter, que descarga Electron):"
  detalle "sudo chown root:root \"$2\" && sudo chmod 4755 \"$2\""
  detalle "Es la opción segura: tu usuario no puede crear un archivo SUID de root. Repítelo cada vez que se reinstale Electron."
}

# El aislamiento (sandbox) de Chromium dentro de Electron: o su ayudante chrome-sandbox es de root con modo 4755, o el
# sistema deja crear espacios de nombres de usuario sin privilegios. En Ubuntu 23.10 o posterior AppArmor lo restringe
# (kernel.apparmor_restrict_unprivileged_userns=1) salvo a los binarios con un perfil que lo permita. Un perfil que haya
# en /etc/apparmor.d no prueba nada (puede no estar cargado o no casar con esta ruta), así que no se busca: se da ✗ con
# el ayudante, que es lo único que se recomienda (un perfil `unconfined` + `userns` para un binario que tu usuario puede
# cambiar deja a cualquier programa tuyo saltarse la restricción), y se dice que, si ya hay perfil y la ventana abre, se
# puede ignorar. Nunca se propone abrir la ventana sin aislamiento: protege del contenido web.
comprobar_sandbox() {
  local dist="${DOCTOR_ELECTRON_DIST:-$RAIZ_DOCTOR/node_modules/electron/dist}" cs v bloqueo=""
  cs="$dist/chrome-sandbox"
  local que="Aislamiento de la ventana (sandbox de Electron, protege del contenido web)"
  if [ -f "$cs" ] && [ "$(dueno_y_modo "$cs")" = "0 -rwsr-xr-x" ]; then bien "$que: con su ayudante chrome-sandbox de root"; return 0; fi
  v="$(leer_sysctl kernel/unprivileged_userns_clone)" && [ "$v" = 0 ] && bloqueo=sistema
  v="$(leer_sysctl user/max_user_namespaces)" && [ "$v" = 0 ] && bloqueo=sistema
  if [ -z "$bloqueo" ] && v="$(leer_sysctl kernel/apparmor_restrict_unprivileged_userns)" && [ "$v" = 1 ]; then bloqueo=apparmor; fi
  if [ -z "$bloqueo" ]; then bien "$que: el sistema permite los espacios de nombres de usuario"; return 0; fi
  if [ "$bloqueo" = apparmor ]; then
    mal "$que: AppArmor no deja a Electron crear espacios de nombres de usuario (Ubuntu 23.10 o posterior)"
  else
    mal "$que: este sistema no permite crear espacios de nombres de usuario sin privilegios"
  fi
  consejo_ayudante "Solución:" "$cs"
  if [ "$bloqueo" = apparmor ]; then detalle "Si ya creaste un perfil de AppArmor para esta ventana y la ventana abre, puedes ignorar este punto."; fi
}

# Pista de gráfica: Electron dibuja con la GPU. WebGL2 lo comprueba la propia pantalla del juego
comprobar_gpu() {
  local f
  for f in "${DOCTOR_RAIZ:-}"/dev/dri/renderD*; do [ -e "$f" ] && { bien "Gráfica: ${f#"${DOCTOR_RAIZ:-}"}"; return 0; }; done
  opcional "Gráfica: no veo ninguna en /dev/dri (el juego dibuja con WebGL2; si no lo hay, su pantalla lo explica)"
}

# ¿Hay un servicio de secretos (org.freedesktop.secrets) en la sesión, en marcha o activable? 0 sí, 1 no, 2 no se sabe
servicio_secretos() {
  local n
  hay dbus-send || return 2
  n="$(dbus-send --session --print-reply --reply-timeout=3000 --dest=org.freedesktop.DBus /org/freedesktop/DBus org.freedesktop.DBus.ListNames 2>/dev/null)$(dbus-send --session --print-reply --reply-timeout=3000 --dest=org.freedesktop.DBus /org/freedesktop/DBus org.freedesktop.DBus.ListActivatableNames 2>/dev/null)"
  [ -n "$n" ] || return 2
  case "$n" in *'"org.freedesktop.secrets"'*) return 0 ;; esac
  return 1
}

comprobar_llavero() {
  local que="secret-tool: guarda las credenciales de las integraciones en el llavero (sin él no se guarda ninguna)"
  if ! hay secret-tool; then opcional "$que"; consejo_instalar secret-tool "$1"; return 0; fi
  servicio_secretos
  case $? in
    0) bien "$que; con un servicio de secretos en marcha" ;;
    1) opcional "$que; está, pero no hay ningún servicio de secretos (org.freedesktop.secrets) en la sesión"
       detalle "Abre o instala uno: KWallet, GNOME Keyring o KeePassXC con su integración de Secret Service activada." ;;
    *) opcional "$que; está, pero no puedo comprobar el servicio de secretos (hace falta dbus-send y una sesión de escritorio)" ;;
  esac
}

comprobar_heif() {
  local que="fotos HEIC/HEIF de iPhone en el intercomunicador (sin él, la foto va solo como ruta)"
  if hay heif-dec; then bien "heif-dec: $que"; elif hay heif-convert; then bien "heif-convert: $que"
  else opcional "heif-dec: $que"; consejo_instalar heif "$1"; fi
}

# Una terminal, en el orden de server/plataforma.ts: $TERMINAL, xdg-terminal-exec, konsole, gnome-terminal
comprobar_terminal() {
  local t
  for t in "${TERMINAL:-}" xdg-terminal-exec konsole gnome-terminal; do
    [ -n "$t" ] && hay "$t" && { bien "Terminal ($t): abrir una terminal en la carpeta de una sala"; return 0; }
  done
  opcional "Terminal: no encuentro ninguna para abrir las carpetas de las salas"
  detalle "Instala una (Konsole, GNOME Terminal…) o pon su nombre en la variable TERMINAL."
}

# ¿Es este `zed` el editor Zed? Las distribuciones lo llaman zeditor porque `zed` es también el demonio de eventos de ZFS:
# el de Zed tiene zed-editor en ../libexec junto a su ruta real (como en server/plataforma.ts)
es_zed_editor() {
  local r="$1" real
  real="$(readlink -f "$r" 2>/dev/null)" || real="$r"; [ -n "$real" ] || real="$r"
  [ -e "${real%/*}/../libexec/zed-editor" ]
}

# Un editor, en el orden de server/plataforma.ts: zeditor, zed (si es el de Zed), cursor, code
comprobar_editor() {
  local e r
  for e in zeditor zed cursor code; do
    r="$(command -v "$e" 2>/dev/null)" || continue
    [ "$e" = zed ] && ! es_zed_editor "$r" && continue
    bien "Editor ($e): abrir archivos y carpetas"; return 0
  done
  opcional "Editor: no encuentro Zed, Cursor ni VS Code (los archivos de texto se abren con la aplicación del sistema)"
}

doctor_principal() {
  local so fam
  so="$(so_node)" || return 1
  fam="$(familia_distro)"
  echo "== work-shelter: diagnóstico =="
  case "$fam" in
    macos) echo "Sistema: macOS" ;;
    arch) echo "Sistema: Linux de la familia Arch (pacman)" ;;
    debian) echo "Sistema: Linux de la familia Debian y Ubuntu (apt)" ;;
    fedora) echo "Sistema: Linux de la familia Fedora (dnf)" ;;
    *) echo "Sistema: Linux de una familia que no reconozco (doy los paquetes de pacman, apt y dnf)" ;;
  esac
  echo "Obligatorio:"
  bien "bash $BASH_VERSION: el lanzador"
  herramienta obligatoria curl "descargas (Node portátil, pnpm y material del juego)" "$fam"
  herramienta obligatoria git "las salas y su historial" "$fam"
  herramienta obligatoria tar "descomprimir el Node portátil y pnpm" "$fam"
  comprobar_node
  comprobar_claude
  [ "$so" = linux ] && comprobar_sandbox
  echo "Opcional:"
  if [ "$so" = linux ]; then
    comprobar_gpu
    comprobar_llavero "$fam"
    comprobar_heif "$fam"
    herramienta opcional xdg-open "abrir enlaces, archivos y carpetas" "$fam"
    herramienta opcional gio "mandar archivos a la papelera" "$fam"
    herramienta opcional dbus-send "revelar archivos en el gestor de archivos (y comprobar el llavero)" "$fam"
    comprobar_terminal
    comprobar_editor
  fi
  herramienta opcional gh "pull requests, contribuciones y notificaciones de GitHub" "$fam"
  echo
  if [ "$DOCTOR_FALTAN" -eq 0 ]; then echo "Todo listo."; else echo "Falta lo obligatorio marcado con ✗."; fi
  echo "Opcionales que faltan: $DOCTOR_OPCIONALES (marcados con ·; el juego funciona sin ellos)."
  [ "$DOCTOR_FALTAN" -eq 0 ]
}

if [ "${BASH_SOURCE[0]}" = "$0" ]; then doctor_principal; exit $?; fi
