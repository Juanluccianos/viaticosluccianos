# Viáticos Lucciano's

PWA para que los supervisores escaneen comprobantes desde el celular y se imputen
como viáticos del mes, con lectura por IA (Gemini) y un panel de administración
para el cierre mensual.

## Qué es

Una app web instalable (PWA) con dos caras según el rol:

- **Supervisor (celular):** saca una foto del comprobante, la IA extrae los datos,
  elige dónde rinde y guarda. Nada más.
- **Admin (escritorio):** ve todos los gastos del período, filtra, ordena, exporta
  y arma el cierre por supervisor.

Corre sobre un frontend estático en GitHub Pages y un backend en Cloudflare Workers
+ D1, con los comprobantes archivados en Google Drive.

## El escaneo

1. "Escanear factura" abre la **cámara nativa** del celular (no un visor web): en
   iPhone evita el permiso de cámara que Safari repite en cada uso y captura en
   calidad completa. También permite elegir una foto de la fototeca.
2. El supervisor ajusta las 4 esquinas del comprobante.
3. Se corrige la **perspectiva** (homografía con muestreo bilineal) y se aplica un
   filtro **gris** que realza el contraste sin ennegrecer sombras.
4. Para leer, a Gemini le llega una versión liviana (~1600px) — rápida y suficiente
   para el texto de un ticket. La imagen en **alta resolución** se archiva en
   **Google Drive** como respaldo contable.
5. Gemini devuelve fecha, CUIT, razón social, tipo de comprobante y el desglose
   impositivo. El supervisor revisa, elige el **local donde se rinde** y la **fecha
   de rendición**, y guarda. Al guardar, sale un mail de aviso a administración.

## Desglose impositivo y comprobación de suma

Cada gasto guarda **neto, IVA, percepciones e impuestos internos** (percepciones de
IVA/IIBB/retenciones; e impuestos internos, ITC de combustibles, tasas y otros
tributos que no son IVA). La app verifica que cuadre:

```
neto + IVA + percepciones + impuestos_internos = total
```

En el formulario, una línea de control se pone **verde** si cierra y **roja** si no,
con la diferencia y un botón "Ajustar neto" (completa el neto como residual). **No
deja guardar si no cuadra** (con 1 peso de tolerancia por redondeos). En
comprobantes sin discriminar (ticket a consumidor final), el neto toma el valor del
total para que la suma cierre igual.

## El cierre se basa en la fecha de rendición

El período (mes) de un gasto se calcula por **la fecha de rendición**, no por la del
ticket. Si un supervisor rinde en agosto un comprobante de julio, entra en el cierre
de agosto.

## Panel de administración

- **Detalle:** todos los comprobantes del período, con filtros (buscar por razón
  social o CUIT, por local, por rango de total) y ordenamiento por columna (se toca
  el encabezado; la flecha indica ascendente o descendente).
- **Cierre por supervisor:** total a liquidar por persona, con un **PDF** de cierre
  individual con la marca, aperturado por categoría con subtotales y total.
- **Exportar Excel:** `.xlsx` formateado (encabezado con la marca, moneda, fila de
  totales) con el desglose impositivo completo.
- El **CUIT** se muestra y guarda siempre como `XX-XXXXXXXX-X`, aunque la factura lo
  traiga sin guiones.
- Refresco automático: los gastos que cargan los supervisores aparecen solos.

## Roles y usuarios

- **Supervisores:** se administran desde el panel (alta, cambio de contraseña,
  desactivar, borrar). Al desactivar, sus gastos históricos quedan intactos; el
  borrado solo procede si no tienen gastos cargados.
- **Admins:** son pares entre sí — ninguno gestiona a otro. No aparecen en la lista
  de usuarios y el backend rechaza cualquier acción de un admin sobre otro admin.

## Categorías

Combustible · Comida · Peajes · Alojamiento · Estacionamiento · Transporte · Insumos · Otros

## Locales

Listado fijo de 23 sucursales. El desplegable de la app se llena desde la tabla
`locales` de la base.

## Sin flujo de aprobación

Los viáticos son solo un registro: el supervisor carga, administración recibe el
aviso, y a fin de mes el admin cierra el período y liquida contra el local. No hay
estados de "aprobado" o "rechazado".

## Stack

- **Frontend:** `index.html` — un solo archivo, vanilla JS, PWA con service worker
  (`sw.js`, versionado; sirve el HTML red-primero para que las actualizaciones se
  vean enseguida). GitHub Pages.
- **Backend:** `worker.js` — Cloudflare Worker (login con PBKDF2, OCR vía Gemini,
  base D1, subida a Google Drive con cuenta de servicio, aviso por mail con Resend).
- **Base:** D1 (SQLite). `schema.sql` es el esquema completo.
