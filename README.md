# Viáticos Lucciano's

PWA para que los supervisores escaneen comprobantes desde el celular y se imputen
como viáticos del mes, con lectura por IA (Gemini) y panel de administración para
el cierre mensual.

## Estructura

```
index.html      Frontend PWA (supervisor mobile + admin desktop, todo en un archivo)
sw.js           Service worker versionado (CACHE = "viaticos-v01")
manifest.json   Manifest PWA  (falta agregar icon-192.png / icon-512.png)
worker.js       Backend Cloudflare Worker (login, OCR, D1, R2)
schema.sql      Esquema D1
gen-hash.mjs    Genera usuarios con hash PBKDF2
wrangler.toml   Config del Worker
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
5. Copiá el email de la cuenta de servicio (adentro del JSON, campo `client_email`,
   algo como `viaticos-bot@viaticos-luccianos.iam.gserviceaccount.com`).
6. En tu Google Drive (el de la empresa), creá una carpeta, ej. **"Viáticos - Comprobantes"**.
7. Compartila con el email del paso 5, dándole rol **Editor**.
8. Abrí la carpeta y copiá el ID de la URL:
   `drive.google.com/drive/folders/`**`ESTE-ID-LARGO`**

Guardá el archivo `service-account.json` en la misma carpeta `Viaticos` de tu compu
(al lado de `worker.js`).

## 2) Mail de notificación (Resend)

Cada vez que un supervisor carga un gasto, le llega un mail a Clari.

1. Andá a **resend.com** → creá una cuenta usando **el mail de Clari** (importante:
   sin verificar un dominio propio, el nivel gratis solo permite mandar mails al
   mismo mail con el que te registraste — por eso tiene que ser el de ella).
2. Menú → **API Keys** → **Create API Key** → copiá la key (empieza con `re_`).
3. Guardala, la vamos a cargar como secret en el paso siguiente.

Si más adelante querés mandar desde un mail propio de la empresa (ej.
`viaticos@luccianos.com.ar`), Resend permite verificar un dominio — pero para
arrancar no hace falta.

## 3) Backend (Cloudflare)

```bash
# crear la base D1
wrangler d1 create viaticos-db          # copiá el database_id a wrangler.toml

# cargar el esquema (instalación nueva) o la migración (base ya existente)
wrangler d1 execute viaticos-db --file=schema.sql --remote
wrangler d1 execute viaticos-db --file=migration_2.sql --remote   # solo si la base ya existía antes

# secrets
wrangler secret put WORKER_SECRET                     # cualquier string largo y random
wrangler secret put GEMINI_KEY                        # tu API key de Gemini (aistudio.google.com)
wrangler secret put RESEND_API_KEY                    # la key de Resend (empieza con re_)
Get-Content service-account.json -Raw | wrangler secret put GOOGLE_SERVICE_ACCOUNT
```

El último comando es en PowerShell: toma el contenido completo del JSON descargado
en el paso 1 y lo carga como secret tal cual (respeta los saltos de línea de la
clave privada, por eso no se puede tipear a mano).

En `wrangler.toml`, pegá también el **ID de la carpeta de Drive** y el **mail de
Clari**:
```
GOOGLE_DRIVE_FOLDER_ID = "PONER-ACA-EL-ID-DE-LA-CARPETA-DE-DRIVE"
CLARI_EMAIL = "clari@luccianos.com.ar"
```

```bash
# desplegar
wrangler deploy
```

Anotá la URL que devuelve (`https://viaticos-api.TU-SUBDOMINIO.workers.dev`).

## 4) Crear usuarios

El primer usuario admin se crea a mano con `gen-hash.mjs`. Los **supervisores**,
de ahí en más, se agregan **desde el panel de administración** (botón "👤
Usuarios" → alta con nombre, usuario y contraseña inicial). También podés
desactivarlos ahí mismo cuando alguien deja de trabajar en la empresa — sus
gastos históricos quedan intactos.

```bash
# solo para el primer admin
node gen-hash.mjs "Nombre Apellido" usuario contraseña admin
```

Cada corrida imprime un `INSERT`. Ejecutalo:

```bash
wrangler d1 execute viaticos-db --remote --command="INSERT INTO usuarios (...) VALUES (...);"
```

## 5) Frontend (GitHub Pages)

1. En `index.html`, cambiá `API_BASE` por la URL de tu Worker (o dejala y setéala
   en runtime con `localStorage.setItem('viaticos_api','https://...')`).
2. Subí **index.html + sw.js juntos** (mismo patrón de siempre). Cada deploy,
   bumpeá `CACHE` en `sw.js` (`viaticos-v01` → `v02`…).
3. Agregá los íconos `icon-192.png` y `icon-512.png`.

## Cómo funciona el escaneo

Todo pasa en el celular antes de subir nada:
1. La cámara captura la foto.
2. El supervisor ajusta las 4 esquinas del comprobante.
3. Se aplica **corrección de perspectiva** (homografía) → el papel queda derecho.
4. Filtro **Gris** (contraste, default y más seguro para el OCR), **B/N** (umbral
   adaptativo, look scanner) o **Color**.
5. La imagen limpia va a Gemini, que devuelve fecha, CUIT, razón social, tipo,
   neto, IVA, total y categoría. El supervisor revisa/corrige, elige el **local
   donde se rinde** (buscador) y la **fecha de rendición**, y guarda.

La imagen procesada se guarda en la carpeta de **Google Drive** como respaldo
contable; el admin la ve en el panel (el Worker la sirve autenticándose con la
cuenta de servicio, así que ni el supervisor ni el admin necesitan permisos
propios sobre esa carpeta).

## El cierre mensual se basa en la fecha de rendición

El período (mes) de un gasto se calcula siempre a partir de **la fecha de
rendición**, no de la fecha del ticket. Si un supervisor rinde en agosto un
ticket de julio, ese gasto entra en el cierre de agosto.

## Categorías (fijas)

Combustible · Comida · Peajes · Alojamiento · Estacionamiento · Transporte · Insumos · Otros

Para agregar una: sumala al array `CATEGORIAS` en `index.html` **y** a la constante
`CATEGORIAS` en `worker.js` (así Gemini también la puede elegir).

## Sin flujo de aprobación

Los viáticos son solo un registro: el supervisor carga, Clari recibe el mail,
y a fin de mes el admin cierra el período y liquida directamente contra el
local (los locales le pagan al supervisor). No hay estados de "aprobado" o
"rechazado" que gestionar.
