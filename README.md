# Viáticos Lucciano's

PWA para que los supervisores escaneen comprobantes desde el celular y se imputen
como viáticos del mes, con lectura por IA (Gemini) y panel de administración para
el cierre mensual.

## Estructura

```
index.html      Frontend PWA (supervisor mobile + admin desktop, todo en un archivo)
sw.js           Service worker versionado (CACHE = "viaticos-v27")
manifest.json   Manifest PWA (incluye icon-192.png / icon-512.png)
worker.js       Backend Cloudflare Worker (login, OCR, D1, Google Drive, mail)
schema.sql      Esquema D1 (instalación nueva desde cero)
migration_3.sql Migración: agrega percepciones e impuestos_internos a gastos
locales.sql     Deja en la tabla `locales` el listado oficial de 23 sucursales
gen-hash.mjs    Genera usuarios con hash PBKDF2 (para los admin)
wrangler.toml   Config del Worker
Guia_instalacion_Viaticos.pdf   Instructivo de 1 página para pasarle a los supervisores
```

## 1) Google Drive: cuenta de servicio (una sola vez)

Los comprobantes se guardan en una carpeta de Google Drive de la empresa. Para que
el Worker pueda subir archivos ahí sin que sea "tu" usuario, necesita una **cuenta
de servicio** (un usuario robot de Google Cloud).

1. Andá a **console.cloud.google.com** → creá un proyecto nuevo (ej. "viaticos-luccianos").
2. Menú → **APIs y servicios → Biblioteca** → buscá **Google Drive API** → **Habilitar**.
3. Menú → **APIs y servicios → Credenciales** → **Crear credenciales → Cuenta de servicio**.
   Ponele un nombre (ej. `viaticos-bot`) → Crear y continuar → Listo (sin roles adicionales).
4. Entrá a la cuenta de servicio recién creada → pestaña **Claves** → **Agregar clave
   → Crear clave nueva → JSON** → se descarga un archivo `service-account.json`.
5. Copiá el email de la cuenta de servicio (campo `client_email` del JSON,
   algo como `viaticos-bot@viaticos-luccianos.iam.gserviceaccount.com`).
6. En el Google Drive de la empresa, creá una carpeta, ej. **"Viáticos - Comprobantes"**.
7. Compartila con el email del paso 5, con rol **Editor**.
8. Copiá el ID de la carpeta de la URL:
   `drive.google.com/drive/folders/`**`ESTE-ID-LARGO`**

Guardá `service-account.json` en la carpeta del proyecto (al lado de `worker.js`).

> El nombre del archivo en Drive queda `DD-MM-YYYY Nombre Apellido - Razón social.jpg`.
> La hora ya la registra la fecha de modificación de Drive, no va en el nombre.

## 2) Mail de notificación (Resend)

Cada vez que un supervisor carga un gasto, sale un mail de aviso a administración.

1. Andá a **resend.com** → creá una cuenta.
2. Menú → **API Keys** → **Create API Key** → copiá la key (empieza con `re_`).

> **Límite del sandbox:** sin un dominio propio verificado, Resend solo deja mandar
> mails al mismo mail con el que se registró la cuenta, y con un rate limit bajo
> (por eso, si se cargan varios gastos muy seguidos, algún aviso puede rebotar).
> El Worker reintenta con backoff ante el 429, pero la solución de fondo es
> **verificar un dominio** en Resend (Domains → agregar `luccianos.com.ar` → cargar
> los registros DNS). Con el dominio verificado se puede mandar a cualquiera y desde
> `viaticos@luccianos.com.ar`, y desaparece el techo del sandbox.

## 3) Backend (Cloudflare)

```bash
# crear la base D1
wrangler d1 create viaticos-db          # copiá el database_id a wrangler.toml

# instalación NUEVA desde cero:
wrangler d1 execute viaticos-db --file=schema.sql --remote
wrangler d1 execute viaticos-db --file=locales.sql --remote

# base YA EXISTENTE (para sumar el desglose impositivo):
wrangler d1 execute viaticos-db --file=migration_3.sql --remote

# secrets
wrangler secret put WORKER_SECRET      # cualquier string largo y random
wrangler secret put GEMINI_KEY         # tu API key de Gemini (aistudio.google.com)
wrangler secret put RESEND_API_KEY     # la key de Resend (empieza con re_)
Get-Content service-account.json -Raw | wrangler secret put GOOGLE_SERVICE_ACCOUNT
```

El último comando es en PowerShell: toma el JSON completo y lo carga como secret
tal cual (respeta los saltos de línea de la clave privada).

En `wrangler.toml`, cargá también el **ID de la carpeta de Drive** y los
**destinatarios del mail** (uno o varios separados por coma):
```
GOOGLE_DRIVE_FOLDER_ID = "PONER-ACA-EL-ID-DE-LA-CARPETA"
NOTIFICAR_EMAILS = "claranigro@luccianos.com.ar"
RESEND_FROM = "Viáticos Lucciano's <onboarding@resend.dev>"
```

```bash
wrangler deploy
```

Anotá la URL que devuelve (`https://viaticos-api.TU-SUBDOMINIO.workers.dev`).

## 4) Usuarios

Hay dos roles: **supervisor** (carga viáticos) y **admin** (ve el panel, cierra el mes).

- **Supervisores:** se dan de alta **desde el panel** (botón "Usuarios" → nombre,
  usuario, contraseña, local habitual opcional). Desde ahí también se les puede
  **cambiar la contraseña**, **desactivar** (sus gastos quedan intactos) o
  **borrar** (solo si no tienen gastos cargados).
- **Admins:** son **pares entre sí** — ninguno gestiona a otro. No aparecen en la
  lista de Usuarios y el Worker rechaza cualquier acción de un admin sobre otro
  admin. Por eso los admins **se crean por base de datos**, no desde la UI:

```bash
node gen-hash.mjs "Nombre Apellido" usuario contraseña admin
```

Cada corrida imprime un `INSERT`. Ejecutalo:

```bash
wrangler d1 execute viaticos-db --remote --command="INSERT INTO usuarios (...) VALUES (...);"
```

## 5) Frontend (GitHub Pages)

1. En `index.html`, `API_BASE` apunta a la URL del Worker (o se setea en runtime
   con `localStorage.setItem('viaticos_api','https://...')`).
2. Subí **index.html + sw.js juntos**. Cada deploy, bumpeá `CACHE` en `sw.js`
   (`viaticos-v27` → `v28`…). El service worker sirve el HTML **red-primero**
   (network-first), así una versión nueva se ve enseguida sin quedar pegada al
   cache; los assets estáticos van cache-primero.
3. Para que los supervisores la instalen: pasales la `Guia_instalacion_Viaticos.pdf`.
   La app corre en `https://juanluccianos.github.io/viaticoslucciannos/`.

## Cómo funciona el escaneo

1. Se toca "Escanear factura" → se abre la **cámara nativa** del celular (no un
   visor web). En iPhone eso evita el permiso de cámara que Safari repite en cada
   uso, y captura en calidad completa. También deja elegir de la fototeca.
2. El supervisor ajusta las 4 esquinas del comprobante.
3. Se aplica **corrección de perspectiva** (homografía con muestreo bilineal) → el
   papel queda derecho y las letras limpias.
4. Filtro **Gris** fijo (realza el contraste sin ennegrecer sombras).
5. Para **leer**, se manda a Gemini una versión liviana (~1600px) — un ticket se
   lee perfecto a esa resolución y el envío es rápido. La imagen en **alta
   resolución** se guarda igual en **Google Drive** como respaldo contable.
6. Gemini devuelve fecha, CUIT, razón social, tipo, y el **desglose impositivo**
   (ver abajo). El supervisor revisa/corrige, elige el **local donde se rinde** y
   la **fecha de rendición**, y guarda.

## Desglose impositivo y comprobación de suma

Cada gasto guarda **neto, IVA, percepciones e impuestos internos** (percepciones
de IVA/IIBB/retenciones; e impuestos internos, ITC de combustibles, tasas y otros
tributos que no son IVA). La app **verifica que cuadre**:

```
neto + IVA + percepciones + impuestos_internos = total
```

En el formulario, una línea de control se pone **verde** si cuadra y **roja** si
no, con la diferencia y un botón "Ajustar neto" (completa el neto como residual).
**No deja guardar si no cuadra** (tolerancia de 1 peso por redondeos). En
comprobantes sin discriminar (ticket a consumidor final), Gemini pone `neto = total`
para que la suma cierre igual.

## El cierre mensual se basa en la fecha de rendición

El período (mes) se calcula a partir de **la fecha de rendición**, no de la del
ticket. Si un supervisor rinde en agosto un ticket de julio, entra en el cierre
de agosto.

## Panel de administración

- **Detalle:** tabla de todos los comprobantes del período, con **filtros**
  (buscar por razón social/CUIT, por local, por rango de total) y
  **ordenamiento por columna** (tocás el encabezado; la flecha muestra asc/desc).
- **Cierre por supervisor:** total a liquidar por persona, con botón **PDF** que
  genera el cierre individual (diseño con la marca, aperturado por categoría con
  subtotales y total).
- **Exportar Excel:** `.xlsx` con formato (encabezado con la marca, moneda, fila
  de totales) incluyendo el desglose impositivo.
- El **CUIT** se normaliza siempre a `XX-XXXXXXXX-X`, aunque la factura lo traiga
  sin guiones.
- Refresco automático: los gastos que cargan los supervisores aparecen solos.

## Categorías (fijas)

Combustible · Comida · Peajes · Alojamiento · Estacionamiento · Transporte · Insumos · Otros

Para agregar una: sumala al array `CATEGORIAS` en `index.html` **y** a la constante
`CATEGORIAS` en `worker.js` (así Gemini también la puede elegir).

## Locales (fijos)

El listado oficial son 23 sucursales (ver `locales.sql`). El desplegable de la app
se llena desde la tabla `locales`. Para actualizarlo, editá y corré `locales.sql`
(es idempotente: agrega los que falten y saca los que no estén en la lista y no
tengan gastos asociados).

## Sin flujo de aprobación

Los viáticos son solo un registro: el supervisor carga, administración recibe el
mail, y a fin de mes el admin cierra el período y liquida contra el local. No hay
estados de "aprobado" o "rechazado".

## Recuperar datos (D1 Time Travel)

Cloudflare guarda el historial de la base 30 días. Ante un borrado accidental:
```bash
wrangler d1 time-travel info viaticos-db                       # ver el punto actual
wrangler d1 time-travel restore viaticos-db --bookmark=<BOOKMARK>
```
Cada operación destructiva de wrangler imprime un bookmark de "antes" al que se
puede volver.
