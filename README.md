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

## 1) Backend (Cloudflare)

```bash
# crear la base D1 y el bucket R2
wrangler d1 create viaticos-db          # copiá el database_id a wrangler.toml
wrangler r2 bucket create viaticos-fotos

# cargar el esquema
wrangler d1 execute viaticos-db --file=schema.sql

# secrets
wrangler secret put WORKER_SECRET       # cualquier string largo y random
wrangler secret put GEMINI_KEY          # tu API key de Gemini (aistudio.google.com)

# desplegar
wrangler deploy
```

Anotá la URL que devuelve (`https://viaticos-api.TU-SUBDOMINIO.workers.dev`).

## 2) Crear usuarios

```bash
# admin (vos)
node gen-hash.mjs "Juan Crespi" jcrespi "TU-CLAVE" admin
# supervisor con local (local_id 2 = Sucursal Güemes en el seed)
node gen-hash.mjs "Pedro Gómez" pgomez "clave-pedro" supervisor 2
```

Cada corrida imprime un `INSERT`. Ejecutalo:

```bash
wrangler d1 execute viaticos-db --command="INSERT INTO usuarios (...) VALUES (...);"
```

## 3) Frontend (GitHub Pages)

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
   neto, IVA, total y categoría. El supervisor revisa/corrige y guarda.

La imagen procesada se guarda en R2 como respaldo contable; el admin la ve en el panel.

## Categorías (fijas)

Combustible · Comida · Peajes · Alojamiento · Estacionamiento · Transporte · Insumos · Otros

Para agregar una: sumala al array `CATEGORIAS` en `index.html` **y** a la constante
`CATEGORIAS` en `worker.js` (así Gemini también la puede elegir).

## Estados de un gasto

`pendiente` → `aprobado` / `rechazado` (desde el panel admin, botones ✓ / ✕).
`observado` queda disponible en el backend por si querés sumar el botón.
