# Seguridad

## Antes de nada: úsalo bajo tu responsabilidad

work-shelter es una propuesta experimental que se publica **tal cual, sin garantía de ningún tipo** (ver
[`LICENSE`](LICENSE)). Nadie revisa ni certifica su seguridad, no hay compromiso de mantenimiento ni de corregir nada
en ningún plazo, y lo que describe este documento son las precauciones que el código **intenta** tomar, no promesas.

El juego maneja agentes que ejecutan órdenes en tu equipo (macOS o Linux) con tus permisos, guarda credenciales de tus
servicios y abre navegadores con tus sesiones. Si lo instalas, lo usas, lo modificas o lo distribuyes, **la
responsabilidad de lo que pase (con tu equipo, tus datos, tus cuentas o las de tu organización) es tuya**. Revisa el
código antes de usarlo con nada que te importe.

## Cómo avisar de un problema

Este repositorio es un fork independiente y no oficial del proyecto original. Si encuentras una vulnerabilidad **en
este fork**, avísala en privado desde la pestaña **Security** de este repositorio en GitHub, con **«Report a
vulnerability»** (aviso privado de vulnerabilidades). No la publiques en una issue ni la lleves al proyecto original:
su autor no mantiene este fork ni recibe sus avisos (ver [«Sin pull requests ni issues»](README.md#sin-pull-requests-ni-issues)
en el README). Lo de arriba sigue valiendo: no hay plazo ni compromiso de arreglarla.

## Precauciones que toma el código

Está pensado como aplicación local para una sola persona en su equipo:

- **El servidor del juego** escucha solo en `127.0.0.1:3778`, rechaza otros `Host` (contra DNS rebinding) y, en el
  WebSocket, exige el `Origin` del juego y un secreto aleatorio que se genera en cada arranque. El secreto no se pasa a
  las sesiones de Claude Code, a las terminales ni a los procesos que lanza el juego (git, `gh`, Chrome).
- **Una sola instancia**: una sola ventana del juego (otro arranque trae al frente la que ya hay) y un solo `./shelter`
  preparando a la vez (un cerrojo en `.runtime/`), para que dos arranques seguidos no instalen las dependencias a la
  vez.
- **El Node portátil**: si no tienes Node 24, `./shelter` descarga el oficial y comprueba su suma SHA-256, fijada en el
  repo para cada versión y sistema, antes de usarlo; sin suma conocida no descarga nada.
- **Archivos**: el explorador, el cliente de git y los adjuntos trabajan dentro de las carpetas de las salas. Borrar es
  mandar a la papelera del sistema (`gio trash` en Linux); sin papelera no se borra.
- **Imágenes adjuntas**: salen siempre sin metadatos ocultos (como la posición GPS de una foto) antes de llegar a
  Claude. sharp las decodifica con una lista cerrada de formatos, un tope de píxeles y otro de tiempo; las HEIC pasan
  antes por el decodificador del sistema (`sips` en macOS, `heif-dec` en Linux) y, sin él, van solo como ruta.
- **Órdenes**: se lanzan con `execFile`/`spawn`, con los argumentos separados. El git que el juego lanza solo (el estado
  de cada sala, cada 20 s) ignora el `core.fsmonitor` de la configuración local del repo, y los diffs van sin
  `textconv` ni diff externo.
- **Permisos de los habitantes**: se muestran como texto literal (el comando o el diff, con los caracteres invisibles a
  la vista) y los resuelves tú.
- **Confianza en las carpetas**: si un repo trae configuración de proyecto de Claude Code (`.claude/` con ajustes,
  hooks, reglas, comandos o agentes, `.mcp.json`, `CLAUDE.md`), el juego pregunta antes de cargarla, salvo que ya hayas
  aceptado esa carpeta en Claude Code o en el juego. Los repos de ejemplo también se preguntan: son de fuera.
- **Electron**: `contextIsolation`, sin `nodeIntegration`, la ventana principal confinada a su origen y los navegadores
  internos (`<webview>`) en su propia sesión, con `sandbox`, solo `https` y sin precarga. El aislamiento (sandbox) de
  Chromium **nunca se desactiva** (ni `--no-sandbox`): si el sistema no lo permite, `./shelter` abre el juego en tu
  navegador y lo avisa. En Linux, `./shelter doctor` lo comprueba y recomienda la solución segura: el ayudante
  `chrome-sandbox` de Electron, de root y con modo 4755 (tu usuario no puede crear un archivo SUID de root, así que nada
  tuyo puede aprovecharlo), y no un perfil de AppArmor que abra los espacios de nombres de usuario a una ruta que tu
  usuario puede escribir.
- **Secretos**: en el llavero del sistema (servicio `work-shelter-public`), no en el repo ni en `.data/`: en macOS, el
  llavero de macOS (`security`); en Linux, el servicio de secretos del escritorio (KWallet, GNOME Keyring,
  KeePassXC…) a través de `secret-tool`. El valor va por la entrada estándar, nunca en los argumentos. Sin llavero,
  falla cerrado: no se guarda en ningún otro sitio, ni en disco ni en variables de entorno. Las integraciones piden
  permisos de solo lectura.

## Riesgos conocidos

Lo que **no** cubre, por diseño o porque nadie lo ha resuelto:

- **Los habitantes son Claude Code con tus permisos**: lo que apruebes se ejecuta en tu equipo. Los modos «editar sin
  preguntar» y «saltar permisos» hacen exactamente eso.
- **Carpetas de fuera**: la pregunta de confianza solo cubre la configuración de Claude Code. Una carpeta ajena puede
  traer otras cosas que se ejecutan al tocarla, como filtros o ganchos en su `.git/config`, o tareas que abra tu editor.
  No vincules como sala una carpeta en la que no confíes.
- **El Puente de Mando** trabaja sobre el código del propio juego, y ese código se ejecuta al reiniciar o al abrir la
  app (incluido `npm ci` si cambia `package-lock.json`). Aprobar ediciones ahí equivale a aprobar que se ejecuten.
- **La instalación con `curl … | bash`** (solo macOS, y del proyecto original) ejecuta `instalar.sh` tal como esté en
  GitHub en ese momento y, después, el código del repo que descarga. Léelo antes si quieres, o clona el repo y usa
  `./shelter instalar-app`.
- **La app instalada** (`/Applications/work-shelter-public.app` en macOS; en Linux, la entrada del menú de
  `./shelter instalar-app`) carga el código de la carpeta del juego: quien pueda escribir en esa carpeta puede cambiar
  lo que hace la app. En macOS, volver a ejecutar el instalador trae y ejecuta lo último que haya en el repo.
- **Modo desarrollo** (`npm run dev`): Vite sirve los archivos de la carpeta del juego a cualquier proceso local, y entre
  ellos está `.data/token`, el secreto con el que se maneja el refugio (terminales incluidas). Úsalo solo en un equipo
  donde te fíes de todo lo que corre y, si quieres, con `SHELTER_DATOS` apuntando fuera del repo.
- **El Chrome de Spotify y el del inicio de sesión con Google** (de momento solo en macOS) se manejan por su protocolo
  de depuración, abierto en un puerto de `127.0.0.1` mientras están en marcha. Otro proceso o usuario del mismo equipo
  podría conectarse y llegar a esas sesiones.
- **Los navegadores internos** se confinan al dominio de cada web, pero los inicios de sesión de terceros
  (Microsoft, Google, Okta, Auth0…) y sus redirecciones pueden llevar a páginas que no son del sitio, sin barra de
  direcciones a la vista.
- **Otros procesos de tu usuario** pueden leer los secretos del llavero sin aviso: en macOS, porque los guarda
  `/usr/bin/security`; en Linux, porque cualquier programa de tu sesión puede pedírselos al servicio de secretos
  mientras esté desbloqueado.
- **La clave de Linear**, si la guardas, va en el entorno del habitante de Logística, cuyo MCP puede escribir en Linear
  (ver [`docs/integraciones-uso.md`](docs/integraciones-uso.md)).
- **Otras cuentas** en el mismo equipo no se han tenido en cuenta a fondo: si lo compartes, asume que pueden llegar a
  más de lo que deberían.
