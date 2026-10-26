# Totem Video Manager — TVM Server v0.2

**Base funcional del servidor web con identidad visual GyA Digital.** Independiente de las aplicaciones ya instaladas en el VPS; no modifica ni reemplaza `totem-ecommerce`, `preguntados`, Nginx ni la Raspberry. El motor local **TVM Player v1.4** sigue intacto.

## Cambios visuales de la v0.2

- Colores oficiales GyA Digital, del Manual de marca GyA, versión 3 (2026), páginas 14–15: celeste `#00AEEF`, azul `#2F88E4`, gris `#545454` y blanco.
- Logotipo horizontal e isotipo **extraídos del manual entregado** (página 11), sin modificar sus formas ni colores.
- Onda corporativa derivada del gráfico del manual (página 25), como textura decorativa.
- Tipografía de lectura `Readex Pro` y complementaria `Exo 2`. El manual propone `Spartakus` para títulos; el CSS la utiliza **solo si está instalada por cuenta del usuario**, con `Exo 2` como alternativa. No se adjuntan ni redistribuyen archivos de fuentes.
- Se conserva la distribución aprobada del dashboard, las rutas, las acciones y toda la lógica backend v0.1.
- **Atención:** fuentes web cargadas desde Google Fonts requieren conexión. Si faltan, se aplica la fuente local alternativa automáticamente.

## Vista previa inmediata (sin instalar nada)

Abrí `VISTA_PREVIA.html` con Chrome o Edge para cambiar entre el login y una **maqueta visual del panel administrador**. Esta maqueta trae datos ficticios y **no** se conecta a la API: sirve exclusivamente para aprobar el aspecto de marca.

Podés iniciar el frontend real con `INICIAR_FRONT_WINDOWS.bat` desde Windows (necesita Node.js e Internet la primera vez para instalar dependencias).

## Prueba rápida SOLO del frontend en Windows

```powershell
cd frontend
npm install
npm run dev
```

Abrí `http://127.0.0.1:5173`. El diseño de login se puede revisar sin base de datos; para **iniciar sesión y usar los paneles** hace falta arrancar backend + PostgreSQL según esta guía. No hay cuentas demo ni credenciales predeterminadas.

## Qué incluye hoy

- Acceso al panel mediante correo y contraseña (contraseñas hash bcrypt, sesiones HTTP-only).
- Panel de administrador y panel aislado para cada cliente.
- Creación de clientes y usuarios de clientes.
- Registro de tótems y asociación a su cliente.
- Subida de MP4 con nombres originales libres y almacenamiento por UUID (no se pisan nombres repetidos).
- Cola de aprobación/rechazo y previsualización autorizada del archivo.
- Editor de playlists por tótem (agregar, retirar, ordenar y publicar una versión nueva).
- API Express que escucha **solo en 127.0.0.1:3184**; compilación React/Vite servida por el mismo proceso.

## Aún NO implementado

- Comunicación de tótems Raspberry con el VPS; la v1.4 del reproductor todavía NO descarga publicaciones remotas.
- Conversión/normalización con FFmpeg, validación exhaustiva de códecs y procesamiento en cola.
- Notificaciones por correo, invitaciones/autorecuperación de contraseñas, métricas y estado en línea real.
- Publicación externa con HTTPS/Nginx: esto se configurará después de elegir el dominio.

**Importante:** para producción con clientes reales debemos completar la validación/transcodificación, HTTPS, copias de seguridad, cuotas y pruebas de seguridad. No enviar archivos confidenciales antes de activar esas medidas.

## Requisitos

VPS Debian 12 con Node.js 22+, npm, PostgreSQL 15+ y 44 GB libres para pruebas. **No hace falta FFmpeg todavía** para esta primera etapa. Port 3184 libre. Una cuenta PostgreSQL dedicada `tvm` y base de datos `tvm`.

## Instalación paso a paso (VPS)

1. Instalar PostgreSQL únicamente (el paquete estándar no cambia PM2 ni los sitios Nginx):

   ```bash
   sudo apt update
   sudo apt install -y postgresql postgresql-client
   sudo systemctl status postgresql --no-pager
   ```

2. Crear una contraseña larga de PostgreSQL. Para evitar que quede escrita en el historial del shell, ejecutar `sudo -u postgres psql` y dentro de `psql`:

   ```sql
   CREATE ROLE tvm LOGIN;
   \password tvm
   CREATE DATABASE tvm OWNER tvm;
   \q
   ```

   El paso `\password tvm` solicita la contraseña interactivamente.

3. Copiar este proyecto a `/opt/tvm-server` y preparar variables del backend:

   ```bash
   sudo mkdir -p /opt/tvm-server
   # Copiar el contenido descomprimido (backend, frontend y README.md) aquí.
   cd /opt/tvm-server/backend
   cp .env.example .env
   nano .env
   chmod 600 .env
   ```

   Cambiar `DATABASE_URL` por el usuario/clave de PostgreSQL. Si la contraseña contiene `@`, `:`, `#`, `/` o similares, **codificarla para una URL**. Para un usuario principiante conviene generar una contraseña de caracteres alfanuméricos largos. Mantener `COOKIE_SECURE=false` solamente en pruebas locales sin HTTPS; activar `true` antes de publicar con Nginx/HTTPS.

4. Instalar dependencias e inicializar datos:

   ```bash
   cd /opt/tvm-server/backend
   npm install --omit=dev
   npm run db:init
   npm run admin:create
   ```

   El creador de admin pide correo y contraseña (12+ caracteres), sin dejarlos escritos en los archivos.

5. Compilar el panel:

   ```bash
   cd /opt/tvm-server/frontend
   npm install
   npm run build
   ```

6. Probar backend (sin exponerlo a Internet):

   ```bash
   cd /opt/tvm-server/backend
   npm start
   ```

   En otra terminal: `curl http://127.0.0.1:3184/api/health` debe responder JSON `{"ok":true,...}`.

7. Para abrir el panel desde tu Windows, usar un **túnel SSH** mientras seguimos en modo de prueba, por ejemplo:

   ```bash
   ssh -L 3184:127.0.0.1:3184 root@IP_DE_TU_VPS
   ```

   Sin cerrar esa terminal, abrir `http://localhost:3184` en el navegador. En esta etapa no configurar todavía Nginx, ni abrir el puerto 3184 en el firewall.

8. Cuando la prueba esté aprobada, detendremos `npm start` y configuraremos un proceso **PM2 dedicado** y un subdominio HTTPS aparte. **No ejecutar comandos que borren o reinicien otros procesos de PM2.**

## Carpetas

```
TVM_Server_v0.2/
  backend/
    .env.example
    package.json
    src/          # API + sesiones + autorización
    sql/schema.sql
    scripts/      # inicializar PostgreSQL y crear administrador
    storage/uploads/  # privado, NO público
  frontend/
    src/          # React + CSS
    package.json
  README.md
```

## Flujo de prueba

1. Iniciar sesión como administrador.
2. Crear `Cliente Demo`.
3. Crear un usuario cliente, darle correo y contraseña de prueba.
4. Registrar `TOTEM-001` para ese cliente.
5. Iniciar sesión como cliente en una ventana privada y subir un MP4.
6. Administrador aprueba el archivo.
7. En **Publicaciones**, seleccionar `TOTEM-001`, agregar el video y presionar **Publicar cambios**.
8. Ver que la versión de la playlist aumentó. Por ahora el tótem Raspberry no descarga esa lista: integración pendiente.

## Consideraciones de seguridad

- El servidor escucha solo en loopback para no exponer HTTP plano al público.
- Las sesiones se guardan como hash en PostgreSQL; cookie `HttpOnly`, `SameSite=Lax`.
- Hay limitación de intentos de login, límite configurable de subida y comprobación básica de firma MP4 (`ftyp`).
- La comprobación de MP4 **no garantiza** códecs compatibles o contenido seguro: falta FFmpeg/ffprobe.
- La carpeta `backend/storage/uploads` se mantiene fuera del directorio público y descarga solo tras autorización.
- Las contraseñas deben ser únicas y `.env` no debe publicarse.
- **No ejecutar como root en producción**; preparar usuario Linux dedicado y privilegios restringidos antes del despliegue final.
