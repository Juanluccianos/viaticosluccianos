/*
 * Relevamientos Lucciano's — app (vanilla JS, sin dependencias)
 */

// ↓↓↓ CAMBIAR por la URL de tu Worker (sin barra final)
const API = 'https://relevamientos-api.lucciano-viaticos.workers.dev';
const VERSION = '1.1.0';
const DISTANCIA_MAX = 300; // metros: más lejos que esto, se marca como "cargado fuera del local"

/* ================================================================ utilidades */

const ESCALAS = {
  aprobado: 'Aprobado',
  observado: 'Observado',
  urgente: 'Atención urgente',
  critico: 'Crítico',
  sd: 'Sin dato'
};
const ORDEN_ESCALAS = ['critico', 'urgente', 'observado', 'aprobado', 'sd'];

const escala = s => s == null ? 'sd' : s >= 90 ? 'aprobado' : s >= 80 ? 'observado' : s >= 51 ? 'urgente' : 'critico';
const fmt = s => s == null ? 'S/D' : Number(s).toLocaleString('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const periodoDe = iso => new Date(new Date(iso).getTime() - 3 * 3600e3).toISOString().slice(0, 7);
const periodoActual = () => periodoDe(new Date().toISOString());
const fecha = iso => iso ? new Date(iso).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '';
const mesLabel = p => {
  const [y, m] = p.split('-').map(Number);
  const t = new Date(y, m - 1, 1).toLocaleDateString('es-AR', { month: 'long', year: 'numeric' });
  return t.charAt(0).toUpperCase() + t.slice(1);
};
const mesCorto = p => {
  const [y, m] = p.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('es-AR', { month: 'short' }).replace('.', '');
};
const primerNombre = n => String(n || '').split(' ')[0];
const esJefe = () => ['admin', 'jefe'].includes(S.user?.role);

function distancia(lat1, lng1, lat2, lng2) {
  const R = 6371000, r = Math.PI / 180;
  const a = Math.sin((lat2 - lat1) * r / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin((lng2 - lng1) * r / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
/* ---- logo: negro sobre fondo claro, blanco sobre la barra oscura; si no carga, muestra el nombre en texto */
function logo(clase, variante = 'negro') {
  return `<span class="logo-wrap ${clase}"><img src="logo-${variante}.png" alt="Lucciano's" onerror="this.hidden=true;this.nextElementSibling.hidden=false"><span class="logo-txt" hidden>Lucciano's</span></span>`;
}

/* ---- campo de clave con ojito para mostrar u ocultar */
const OJO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/></svg>';
const OJO_TACHADO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.9 17.9A10.1 10.1 0 0 1 12 19c-7 0-11-7-11-7a18.5 18.5 0 0 1 5.1-5.9"/><path d="M9.9 4.2A9.4 9.4 0 0 1 12 4c7 0 11 7 11 7a18.6 18.6 0 0 1-2.2 3.2"/><path d="M14.1 14.1a3 3 0 1 1-4.2-4.2"/><path d="M1 1l22 22"/></svg>';
function campoClave(etiqueta, name, attrs = '') {
  return `<label>${etiqueta}<span class="clave-wrap"><input name="${name}" type="password" ${attrs}><button type="button" class="ojo" aria-label="Mostrar clave" aria-pressed="false">${OJO}</button></span></label>`;
}
document.addEventListener('click', e => {
  const b = e.target.closest('.ojo');
  if (!b) return;
  e.preventDefault();
  const inp = b.previousElementSibling;
  const ver = inp.type === 'password';
  inp.type = ver ? 'text' : 'password';
  b.innerHTML = ver ? OJO_TACHADO : OJO;
  b.setAttribute('aria-label', ver ? 'Ocultar clave' : 'Mostrar clave');
  b.setAttribute('aria-pressed', ver);
  inp.focus();
});

/* ---- validación de formularios con mensajes claros */
const emailValido = v => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v).trim());
function validar(form) {
  for (const inp of form.querySelectorAll('input, select, textarea')) {
    const nombre = (inp.closest('label')?.childNodes[0]?.textContent || 'este campo').trim().replace(/\s*\(.*\)$/, '');
    const v = inp.value.trim();
    if (inp.required && !v) return `Completá el campo "${nombre}"`;
    if (inp.dataset.email !== undefined && v && !emailValido(v)) return 'El email tiene que tener un @ y un dominio, por ejemplo nombre@luccianos.com.ar';
    if (inp.minLength > 0 && v && v.length < inp.minLength) return `"${nombre}" tiene que tener al menos ${inp.minLength} caracteres`;
  }
  return null;
}
function errorForm(msg) {
  const el = $('#err');
  if (!el) return toast(msg);
  el.textContent = msg;
  el.hidden = !msg;
}

const fmtDist = m => m >= 1000 ? `${(m / 1000).toLocaleString('es-AR', { maximumFractionDigits: 1 })} km` : `${Math.round(m)} m`;

// Mismo cálculo que el Worker: pesos que cumplen / pesos evaluados, tope 100, crítico fallado tope 79
function calcularPuntaje(resp, items) {
  let tot = 0, ok = 0, crit = false;
  for (const it of items) {
    const r = resp[it.id];
    if (!r || !r.valor || r.valor === 'na') continue;
    tot += it.weight;
    if (r.valor === 'ok') ok += it.weight;
    else if (it.critical) crit = true;
  }
  if (!tot) return null;
  let s = Math.min(100, Math.round(ok / tot * 10000) / 100);
  if (crit) s = Math.min(s, 79);
  return s;
}

const ICON = {
  inicio: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10.5 12 3l9 7.5V21h-6v-6H9v6H3z"/></svg>',
  locales: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l1.5-5h15L21 9"/><path d="M4 9v11h16V9"/><path d="M3 9h18"/><path d="M10 20v-6h4v6"/></svg>',
  resumen: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20V10M10 20V4M16 20v-8M22 20H2"/></svg>',
  admin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2V21a2 2 0 1 1-4 0v-.1A1.7 1.7 0 0 0 7 19.4a1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 1.2 14H1a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 2.6 7a1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.7 1.7 0 0 0 7 2.6 1.7 1.7 0 0 0 8 1.1V1a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 2.9 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V7a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
  cuenta: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/></svg>',
  sync: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 0 1-15.4 6.4L3 16"/><path d="M3 12a9 9 0 0 1 15.4-6.4L21 8"/><path d="M21 3v5h-5M3 21v-5h5"/></svg>',
  camara: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h3l2-3h6l2 3h3v13H4z"/><circle cx="12" cy="13" r="4"/></svg>'
};

/* ================================================================ estado */

const S = {
  token: localStorage.getItem('rl_token'),
  user: JSON.parse(localStorage.getItem('rl_user') || 'null'),
  cat: JSON.parse(localStorage.getItem('rl_cat') || 'null'),
  syncing: false,
  rid: 0,
  adminTab: 'usuarios'
};

/* ================================================================ API */

async function api(path, opts = {}) {
  let res;
  try {
    res = await fetch(API + path, {
      ...opts,
      headers: {
        'Content-Type': 'application/json',
        ...(S.token ? { Authorization: 'Bearer ' + S.token } : {}),
        ...(opts.headers || {})
      }
    });
  } catch {
    throw new Error('No hay conexión con el servidor. Revisá tu internet.');
  }
  let data = null;
  try { data = await res.json(); } catch { /* sin cuerpo */ }
  if (res.status === 401 && S.token) {
    salir();
    throw new Error(data?.error || 'Tu sesión venció. Volvé a ingresar.');
  }
  if (!res.ok) throw new Error(data?.error || `El servidor respondió con error ${res.status}`);
  return data;
}
const post = (path, data, method = 'POST') => api(path, { method, body: JSON.stringify(data) });

async function cargarCatalogo() {
  const d = await api('/api/catalogo');
  S.cat = d;
  localStorage.setItem('rl_cat', JSON.stringify(d));
  return d;
}

function entrar(d) {
  S.token = d.token;
  S.user = d.user;
  localStorage.setItem('rl_token', d.token);
  localStorage.setItem('rl_user', JSON.stringify(d.user));
  cargarCatalogo().catch(() => {}).finally(() => {
    location.hash = '#/';
    render();
    sincronizar();
  });
}

function salir() {
  S.token = null;
  S.user = null;
  localStorage.removeItem('rl_token');
  localStorage.removeItem('rl_user');
  location.hash = '#/login';
}

/* ================================================================ IndexedDB */

const idb = {
  db: null,
  open() {
    if (this.db) return Promise.resolve(this.db);
    return new Promise((res, rej) => {
      const r = indexedDB.open('relevamientos', 1);
      r.onupgradeneeded = () => {
        r.result.createObjectStore('cola', { keyPath: 'id' });
        r.result.createObjectStore('borradores', { keyPath: 'store_id' });
      };
      r.onsuccess = () => res(this.db = r.result);
      r.onerror = () => rej(r.error);
    });
  },
  async tx(store, mode, fn) {
    const db = await this.open();
    return new Promise((res, rej) => {
      const t = db.transaction(store, mode);
      const req = fn(t.objectStore(store));
      t.oncomplete = () => res(req?.result);
      t.onerror = () => rej(t.error);
    });
  },
  get(store, key) { return this.tx(store, 'readonly', s => s.get(key)); },
  all(store) { return this.tx(store, 'readonly', s => s.getAll()); },
  put(store, val) { return this.tx(store, 'readwrite', s => s.put(val)); },
  del(store, key) { return this.tx(store, 'readwrite', s => s.delete(key)); }
};

/* ================================================================ fotos */

async function comprimir(file) {
  let img;
  try {
    img = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    img = await new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => rej(new Error('No se pudo leer la foto'));
      i.src = URL.createObjectURL(file);
    });
  }
  const max = 1280;
  const w = img.width, h = img.height;
  const r = Math.min(1, max / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.round(w * r);
  c.height = Math.round(h * r);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return new Promise(res => c.toBlob(res, 'image/jpeg', 0.72));
}

function blobA64(blob) {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(String(fr.result).split(',')[1]);
    fr.onerror = () => rej(fr.error);
    fr.readAsDataURL(blob);
  });
}

const fotoUrl = driveId => `${API}/api/foto/${encodeURIComponent(driveId)}?t=${encodeURIComponent(S.token)}`;

/* ================================================================ sincronización */

const nombreLocal = id => S.cat?.stores.find(s => s.id === id)?.name || `Local ${id}`;

async function sincronizar() {
  if (S.syncing || !navigator.onLine || !S.token) return;
  S.syncing = true;
  actualizarBadge();
  try {
    const cola = await idb.all('cola');
    for (const r of cola) {
      try {
        if (!r.subido) {
          const out = await post('/api/relevamientos', {
            id: r.id, store_id: r.store_id, periodo: r.periodo, respuestas: r.respuestas,
            notas: r.notas, lat: r.lat, lng: r.lng, creado_cliente: r.creado
          });
          r.subido = true;
          r.score = out.score;
          r.error = null;
          await idb.put('cola', r);
        }
        for (const f of r.fotos) {
          if (f.subida) continue;
          await post(`/api/relevamientos/${r.id}/fotos`, {
            pid: f.pid, item_id: f.item_id, mime: f.blob.type || 'image/jpeg', data: await blobA64(f.blob)
          });
          f.subida = true;
          await idb.put('cola', r);
        }
        await idb.del('cola', r.id);
        toast(`${nombreLocal(r.store_id)}: relevamiento sincronizado`);
      } catch (e) {
        r.error = e.message;
        await idb.put('cola', r);
      }
    }
  } finally {
    S.syncing = false;
    actualizarBadge();
    if (location.hash.startsWith('#/pendientes')) render();
  }
}

async function actualizarBadge() {
  const el = $('#sync-badge');
  if (!el) return;
  const n = (await idb.all('cola')).length;
  el.hidden = n === 0;
  el.textContent = n;
}

/* ================================================================ UI base */

function toast(msg) {
  let t = $('.toast');
  if (!t) {
    t = document.createElement('div');
    t.className = 'toast';
    t.setAttribute('role', 'status');
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.classList.add('ver');
  clearTimeout(t._h);
  t._h = setTimeout(() => t.classList.remove('ver'), 3200);
}

function nav() {
  const h = location.hash || '#/';
  const links = [
    ['#/', 'Inicio', ICON.inicio, h === '#/' || h === '#'],
    ['#/locales', 'Locales', ICON.locales, h.startsWith('#/locales') || h.startsWith('#/local/')],
    ...(esJefe() ? [['#/resumen', 'Resumen', ICON.resumen, h.startsWith('#/resumen')]] : []),
    ...(S.user?.role === 'admin' ? [['#/admin', 'Admin', ICON.admin, h.startsWith('#/admin')]] : []),
    ['#/cuenta', 'Cuenta', ICON.cuenta, h.startsWith('#/cuenta')]
  ];
  return `<nav class="nav">${links.map(([href, txt, ico, act]) =>
    `<a href="${href}" class="${act ? 'activo' : ''}" ${act ? 'aria-current="page"' : ''}>${ico}<span>${txt}</span></a>`).join('')}</nav>`;
}

function pintar(v) {
  const app = $('#app');
  if (v.sinNav) {
    app.innerHTML = v.html;
  } else {
    app.innerHTML = `
      <header class="top">
        ${v.atras
          ? `<a class="top-btn" href="${v.atras}" aria-label="Volver">‹</a>`
          : logo('marca', 'blanco')}
        <h1>${esc(v.titulo)}</h1>
        <a class="top-btn" href="#/pendientes" aria-label="Relevamientos pendientes de enviar">${ICON.sync}<span class="badge" id="sync-badge" hidden></span></a>
      </header>
      <main class="vista">${v.html}</main>
      ${nav()}`;
  }
  window.scrollTo(0, 0);
  v.montar?.(app);
  actualizarBadge();
}

const cargando = () => $('#app .vista') ? ($('#app .vista').innerHTML = '<div class="cargando">Cargando…</div>') : null;

/* ================================================================ router */

const RUTAS = [
  [/^#\/login$/, vLogin, true],
  [/^#\/instalar$/, vInstalar, true],
  [/^#\/?$/, vInicio],
  [/^#\/locales$/, vLocales],
  [/^#\/local\/(\d+)$/, vLocal],
  [/^#\/relevar\/(\d+)$/, vRelevar],
  [/^#\/rel\/([0-9a-f-]{36})$/i, vRelevamiento],
  [/^#\/resumen$/, vResumen],
  [/^#\/pendientes$/, vPendientes],
  [/^#\/admin$/, vAdmin],
  [/^#\/cuenta$/, vCuenta]
];

async function render() {
  const id = ++S.rid;
  const h = location.hash || '#/';
  for (const [re, fn, publica] of RUTAS) {
    const m = h.match(re);
    if (!m) continue;
    if (!publica && !S.token) { location.hash = '#/login'; return; }
    cargando();
    let v;
    try {
      v = await fn(...m.slice(1));
    } catch (e) {
      v = {
        titulo: 'No se pudo cargar',
        atras: '#/',
        html: `<div class="vacio"><p>${esc(e.message)}</p><button class="btn" onclick="render()">Reintentar</button></div>`
      };
    }
    if (id !== S.rid || !v) return;
    pintar(v);
    return;
  }
  location.hash = '#/';
}

/* ================================================================ vistas: acceso */

function vLogin() {
  if (S.token) { location.hash = '#/'; return null; }
  return {
    sinNav: true,
    html: `
      <div class="login">
        <div class="login-marca">${logo('logo-grande')}<p>Relevamientos de locales</p></div>
        <form id="f-login" class="card form" novalidate>
          <label>Email<input name="email" type="email" inputmode="email" autocomplete="username" required data-email></label>
          ${campoClave('Clave', 'clave', 'autocomplete="current-password" required')}
          <p class="error" id="err" hidden></p>
          <button class="btn primario" type="submit">Ingresar</button>
        </form>
        <a class="link-sutil" href="#/instalar">¿Primera vez? Configurar la app</a>
      </div>`,
    montar() {
      $('#f-login').onsubmit = async e => {
        e.preventDefault();
        const malo = validar(e.target);
        if (malo) return errorForm(malo);
        const f = new FormData(e.target);
        const btn = e.target.querySelector('button[type=submit]');
        btn.disabled = true;
        errorForm('');
        try {
          entrar(await post('/api/login', { email: f.get('email'), clave: f.get('clave') }));
        } catch (err) {
          $('#err').textContent = err.message;
          $('#err').hidden = false;
          btn.disabled = false;
        }
      };
    }
  };
}

function vInstalar() {
  return {
    sinNav: true,
    html: `
      <div class="login">
        <div class="login-marca">${logo('logo-grande')}<p>Crear el primer administrador</p></div>
        <form id="f-setup" class="card form" novalidate>
          ${campoClave('Clave de instalación', 'ci', 'autocomplete="off" required')}
          <label>Tu nombre<input name="nombre" autocomplete="name" required></label>
          <label>Email<input name="email" type="email" inputmode="email" autocomplete="username" required data-email></label>
          ${campoClave('Clave (mínimo 8 caracteres)', 'clave', 'autocomplete="new-password" minlength="8" required')}
          <p class="error" id="err" hidden></p>
          <button class="btn primario" type="submit">Crear administrador</button>
        </form>
        <a class="link-sutil" href="#/login">Ya tengo usuario</a>
      </div>`,
    montar() {
      $('#f-setup').onsubmit = async e => {
        e.preventDefault();
        const malo = validar(e.target);
        if (malo) return errorForm(malo);
        const f = new FormData(e.target);
        try {
          entrar(await post('/api/setup', {
            clave_instalacion: f.get('ci'), nombre: f.get('nombre'), email: f.get('email'), clave: f.get('clave')
          }));
        } catch (err) {
          $('#err').textContent = err.message;
          $('#err').hidden = false;
        }
      };
    }
  };
}

/* ================================================================ vistas: inicio */

function filaLocal(l, conBoton = false) {
  const e = l.escala || escala(l.score);
  const delta = (l.score != null && l.prev_score != null) ? Math.round((l.score - l.prev_score) * 10) / 10 : null;
  const deltaHtml = delta ? `<span class="delta ${delta > 0 ? 'sube' : 'baja'}">${delta > 0 ? '▲' : '▼'} ${fmt(Math.abs(delta))}</span>` : '';
  const detalle = l.score == null && l.prev_score != null
    ? `Anterior ${fmt(l.prev_score)}`
    : (l.supervisor_name || l.code);
  return `
    <div class="fila">
      <a href="#/local/${l.id}" style="display:contents">
        <span class="nota ${e}">${fmt(l.score)}</span>
        <span class="fila-txt"><strong>${esc(l.name)}</strong><small>${esc(l.code)} · ${esc(detalle)}</small></span>
      </a>
      ${conBoton
        ? `<a class="btn chico ${l.score == null ? 'dulce' : ''}" href="#/relevar/${l.id}">${l.score == null ? 'Relevar' : 'Volver a relevar'}</a>`
        : `<span class="fila-der">${deltaHtml}</span>`}
    </div>`;
}

async function avisosBorradores() {
  const b = await idb.all('borradores');
  if (!b.length) return '';
  return b.map(x => {
    const n = Object.values(x.resp).filter(r => r.valor).length;
    return `<a class="aviso" href="#/relevar/${x.store_id}">
      <div><strong>${esc(nombreLocal(x.store_id))}</strong><span class="sub">Relevamiento sin terminar, ${n} ítems respondidos</span></div>
      <span class="btn chico">Continuar</span></a>`;
  }).join('');
}

async function vInicio() {
  if (esJefe()) return vResumen();

  const periodo = periodoActual();
  let locales, offline = false;
  try {
    locales = (await api(`/api/locales?periodo=${periodo}`)).locales;
  } catch {
    offline = true;
    locales = (S.cat?.stores || []).filter(s => s.supervisor_id === S.user.id).map(s => ({ ...s, score: null }));
  }
  const hechos = locales.filter(l => l.score != null).length;
  const pend = locales.filter(l => l.score == null);
  const listos = locales.filter(l => l.score != null);
  const pct = locales.length ? Math.round(hechos / locales.length * 100) : 0;

  return {
    titulo: 'Inicio',
    html: `
      <div class="saludo">
        <h2>Hola, ${esc(primerNombre(S.user.name))}</h2>
        <p class="sub">${mesLabel(periodo)}${offline ? '. Sin conexión: mostrando tus locales guardados.' : ''}</p>
      </div>
      ${offline ? '' : `
      <div class="card avance">
        <div class="avance-num">${hechos}<small> de ${locales.length} locales relevados</small></div>
        <div class="barra"><span style="width:${pct}%"></span></div>
      </div>`}
      ${await avisosBorradores()}
      ${locales.length === 0 ? `
        <div class="vacio"><p>Todavía no tenés locales asignados. Pedile al administrador que te los asigne, o buscá cualquier local en la pestaña Locales.</p>
        <a class="btn" href="#/locales">Ver todos los locales</a></div>` : ''}
      ${pend.length ? `<div class="bloque"><h2>Para relevar este mes</h2><div class="lista">${pend.map(l => filaLocal(l, true)).join('')}</div></div>` : ''}
      ${listos.length ? `<div class="bloque"><h2>Ya relevados</h2><div class="lista">${listos.map(l => filaLocal(l, true)).join('')}</div></div>` : ''}`
  };
}

/* ================================================================ vistas: locales */

async function vLocales() {
  const periodo = periodoActual();
  let locales, offline = false;
  try {
    locales = (await api(`/api/locales?periodo=${periodo}`)).locales;
    if (S.user.role === 'supervisor') {
      // el supervisor ve sus locales con puntaje y el resto del catálogo para poder cubrir otros
      const mios = new Set(locales.map(l => l.id));
      const otros = (S.cat?.stores || []).filter(s => !mios.has(s.id)).map(s => ({ ...s, score: null, escala: 'sd', ajeno: true }));
      locales = locales.concat(otros);
    }
  } catch {
    offline = true;
    locales = (S.cat?.stores || []).map(s => ({ ...s, score: null }));
  }

  const estado = { q: '', filtro: 'todos', orden: 'peor' };

  const dibujar = () => {
    const q = estado.q.toLowerCase();
    let l = locales.filter(x =>
      (!q || x.name.toLowerCase().includes(q) || x.code.toLowerCase().includes(q) || (x.supervisor_name || '').toLowerCase().includes(q)) &&
      (estado.filtro === 'todos' || (x.escala || escala(x.score)) === estado.filtro));
    if (estado.orden === 'peor') {
      l.sort((a, b) => (a.score ?? 999) - (b.score ?? 999) || (a.prev_score ?? 999) - (b.prev_score ?? 999));
    } else {
      l.sort((a, b) => a.name.localeCompare(b.name, 'es'));
    }
    $('#lista-locales').innerHTML = l.length
      ? `<div class="lista">${l.map(x => filaLocal(x, x.ajeno)).join('')}</div>`
      : '<div class="vacio"><p>Ningún local coincide con la búsqueda.</p></div>';
    $('#cuenta-locales').textContent = `${l.length} locales`;
  };

  const cuenta = k => locales.filter(x => (x.escala || escala(x.score)) === k).length;

  return {
    titulo: 'Locales',
    html: `
      ${offline ? '<p class="sub">Sin conexión: mostrando el catálogo guardado, sin puntajes.</p>' : ''}
      <div class="buscador">
        <input type="search" id="q" placeholder="Buscar por nombre, código o supervisor" autocomplete="off">
        <div class="chips" id="chips">
          <button class="chip activo" data-f="todos">Todos</button>
          ${ORDEN_ESCALAS.map(k => `<button class="chip" data-f="${k}">${ESCALAS[k]} ${cuenta(k)}</button>`).join('')}
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center">
          <span class="sub" id="cuenta-locales"></span>
          <select id="orden" style="width:auto;min-height:36px">
            <option value="peor">Peor puntaje primero</option>
            <option value="az">Alfabético</option>
          </select>
        </div>
      </div>
      <div id="lista-locales"></div>`,
    montar() {
      $('#q').oninput = e => { estado.q = e.target.value; dibujar(); };
      $('#orden').onchange = e => { estado.orden = e.target.value; dibujar(); };
      $('#chips').onclick = e => {
        const b = e.target.closest('.chip');
        if (!b) return;
        estado.filtro = b.dataset.f;
        $$('.chip').forEach(c => c.classList.toggle('activo', c === b));
        dibujar();
      };
      dibujar();
    }
  };
}

async function vLocal(id) {
  const d = await api(`/api/locales/${id}`);
  const l = d.local;
  const ult = d.historial[0];
  const e = ult ? ult.escala : 'sd';
  const deEsteMes = ult && ult.period === periodoActual();

  return {
    titulo: l.code,
    atras: '#/locales',
    html: `
      <div class="card">
        <div class="ficha">
          <div>
            <h2>${esc(l.name)}</h2>
            <p class="sub">${esc(l.supervisor_name || 'Sin supervisor asignado')}</p>
            <p class="sub">${ult ? `Último relevamiento: ${fecha(ult.fecha)}${deEsteMes ? '' : ' (mes anterior)'}` : 'Nunca relevado'}</p>
          </div>
          <div class="puntaje-grande">
            <div class="n txt-${e}">${fmt(ult?.score)}</div>
            <div class="l txt-${e}">${ESCALAS[e]}</div>
          </div>
        </div>
        <a class="btn dulce ancho" style="margin-top:16px" href="#/relevar/${l.id}">Relevar ahora</a>
      </div>

      ${d.capitulos.length ? `
      <div class="bloque">
        <h2>Por capítulo</h2>
        <div class="card">
          ${d.capitulos.map(c => `
            <div class="cap-fila">
              <span>${esc(c.nombre)}${c.fallas ? ` <small class="sub">(${c.fallas} ${c.fallas === 1 ? 'falla' : 'fallas'})</small>` : ''}</span>
              <b class="txt-${c.escala}">${fmt(c.score)}</b>
              <div class="barra"><span class="${c.escala}" style="width:${c.score ?? 0}%"></span></div>
            </div>`).join('')}
        </div>
      </div>` : ''}

      <div class="bloque">
        <h2>Historial</h2>
        ${d.historial.length ? `<div class="lista">${d.historial.map(h => `
          <a class="fila" href="#/rel/${h.id}">
            <span class="nota ${h.escala}">${fmt(h.score)}</span>
            <span class="fila-txt"><strong>${mesLabel(h.period)}</strong><small>${fecha(h.fecha)} · ${esc(h.usuario)}${h.distance_m > DISTANCIA_MAX ? ` · a ${fmtDist(h.distance_m)} del local` : ''}</small></span>
          </a>`).join('')}</div>` : '<div class="vacio"><p>Este local todavía no tiene relevamientos.</p></div>'}
      </div>`
  };
}

/* ================================================================ vistas: relevar */

async function vRelevar(storeId) {
  storeId = Number(storeId);
  if (!S.cat) await cargarCatalogo();
  const local = S.cat.stores.find(s => s.id === storeId);
  if (!local) throw new Error('Ese local no está en el catálogo guardado. Entrá a Cuenta y tocá "Actualizar datos".');
  if (!S.cat.items.length) throw new Error('El checklist está vacío. El administrador tiene que cargarlo desde Admin.');

  let b = await idb.get('borradores', storeId);
  if (!b) {
    b = { store_id: storeId, id: crypto.randomUUID(), creado: new Date().toISOString(), resp: {}, fotos: [], notas: '', lat: null, lng: null };
  }
  const items = S.cat.items;
  const caps = S.cat.chapters
    .map(c => ({ ...c, items: items.filter(i => i.chapter_id === c.id) }))
    .filter(c => c.items.length);

  const itemHtml = i => {
    const r = b.resp[i.id] || {};
    return `
      <div class="item" data-item="${i.id}">
        <p>${esc(i.text)}${i.critical ? '<span class="tag-crit">Crítico</span>' : ''}</p>
        <div class="opciones" role="group" aria-label="Respuesta">
          <button type="button" data-v="ok" class="op ok ${r.valor === 'ok' ? 'sel' : ''}" aria-pressed="${r.valor === 'ok'}">Cumple</button>
          <button type="button" data-v="fail" class="op fail ${r.valor === 'fail' ? 'sel' : ''}" aria-pressed="${r.valor === 'fail'}">No cumple</button>
          <button type="button" data-v="na" class="op na ${r.valor === 'na' ? 'sel' : ''}" aria-pressed="${r.valor === 'na'}">N/A</button>
        </div>
        <div class="item-extra">
          <input type="text" class="coment" placeholder="Comentario (opcional)" value="${esc(r.comentario || '')}">
          <label class="foto-btn">${ICON.camara}Foto<input type="file" accept="image/*" capture="environment" hidden></label>
        </div>
        <div class="thumbs"></div>
      </div>`;
  };

  let tGuardar;
  const guardarBorrador = () => {
    clearTimeout(tGuardar);
    tGuardar = setTimeout(() => idb.put('borradores', b), 400);
  };

  const actualizarPuntaje = () => {
    const s = calcularPuntaje(b.resp, items);
    const n = items.filter(i => b.resp[i.id]?.valor).length;
    const el = $('#live-score');
    if (!el) return;
    el.textContent = fmt(s);
    el.className = 'nota ' + escala(s);
    $('#live-prog').textContent = `${n} de ${items.length}`;
    $('#live-bar').style.width = `${Math.round(n / items.length * 100)}%`;
    for (const c of caps) {
      const cs = calcularPuntaje(b.resp, c.items);
      const cn = c.items.filter(i => b.resp[i.id]?.valor).length;
      const el2 = $(`[data-capscore="${c.id}"]`);
      if (el2) el2.textContent = cn ? `${fmt(cs)}` : `${cn}/${c.items.length}`;
    }
  };

  const dibujarThumbs = itemId => {
    const cont = $(`[data-item="${itemId}"] .thumbs`);
    if (!cont) return;
    cont.innerHTML = '';
    b.fotos.filter(f => f.item_id === itemId).forEach(f => {
      const d = document.createElement('div');
      d.className = 'thumb';
      const url = URL.createObjectURL(f.blob);
      d.innerHTML = `<img src="${url}" alt="Foto del ítem"><button type="button" aria-label="Quitar foto">×</button>`;
      d.querySelector('button').onclick = () => {
        b.fotos = b.fotos.filter(x => x.pid !== f.pid);
        guardarBorrador();
        dibujarThumbs(itemId);
      };
      cont.appendChild(d);
    });
  };

  return {
    titulo: 'Relevamiento',
    atras: `#/local/${storeId}`,
    html: `
      <div class="rel-head">
        <div class="rel-head-row">
          <div><strong>${esc(local.name)}</strong><small id="geo">Buscando ubicación…</small></div>
          <div class="rel-score"><span id="live-score" class="nota sd">S/D</span><small class="sub num" id="live-prog"></small></div>
        </div>
        <div class="barra" style="height:4px;margin-top:8px"><span id="live-bar"></span></div>
      </div>
      ${caps.map(c => `
        <section class="cap">
          <h2>${esc(c.name)}<span data-capscore="${c.id}"></span></h2>
          ${c.items.map(itemHtml).join('')}
        </section>`).join('')}
      <div class="pie-rel">
        <label class="form"><span style="font-weight:600">Observaciones generales</span>
          <textarea id="notas" placeholder="Algo que el local tenga que saber o corregir">${esc(b.notas)}</textarea>
        </label>
        <button class="btn primario ancho" id="guardar">Guardar relevamiento</button>
        <button class="btn ancho" id="descartar">Descartar este relevamiento</button>
      </div>`,
    montar(app) {
      // los eventos van sobre .vista (se recrea en cada pantalla) para no acumular listeners
      const vista = $('.vista', app);
      items.forEach(i => dibujarThumbs(i.id));
      actualizarPuntaje();

      vista.addEventListener('click', e => {
        const op = e.target.closest('.op');
        if (!op) return;
        const itemEl = op.closest('.item');
        const id = Number(itemEl.dataset.item);
        b.resp[id] = { ...(b.resp[id] || {}), valor: op.dataset.v };
        $$('.op', itemEl).forEach(x => {
          const sel = x === op;
          x.classList.toggle('sel', sel);
          x.setAttribute('aria-pressed', sel);
        });
        itemEl.classList.remove('falta');
        actualizarPuntaje();
        guardarBorrador();
      });

      vista.addEventListener('input', e => {
        if (e.target.classList.contains('coment')) {
          const id = Number(e.target.closest('.item').dataset.item);
          b.resp[id] = { ...(b.resp[id] || {}), comentario: e.target.value };
          guardarBorrador();
        } else if (e.target.id === 'notas') {
          b.notas = e.target.value;
          guardarBorrador();
        }
      });

      vista.addEventListener('change', async e => {
        if (e.target.type !== 'file' || !e.target.files[0]) return;
        const id = Number(e.target.closest('.item').dataset.item);
        const file = e.target.files[0];
        e.target.value = '';
        try {
          const blob = await comprimir(file);
          b.fotos.push({ pid: crypto.randomUUID(), item_id: id, blob });
          await idb.put('borradores', b);
          dibujarThumbs(id);
        } catch (err) {
          toast(err.message);
        }
      });

      // Ubicación
      const geo = $('#geo');
      if (!navigator.geolocation) {
        geo.textContent = 'Este dispositivo no da ubicación';
      } else {
        navigator.geolocation.getCurrentPosition(pos => {
          b.lat = pos.coords.latitude;
          b.lng = pos.coords.longitude;
          guardarBorrador();
          if (local.lat != null && local.lng != null) {
            const d = distancia(b.lat, b.lng, local.lat, local.lng);
            geo.textContent = d > DISTANCIA_MAX ? `Estás a ${fmtDist(d)} del local` : 'Estás en el local';
            geo.classList.toggle('lejos', d > DISTANCIA_MAX);
          } else {
            geo.textContent = 'Ubicación registrada';
          }
        }, () => {
          geo.textContent = 'Sin ubicación: el permiso está bloqueado';
          geo.classList.add('lejos');
        }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 });
      }

      $('#guardar').onclick = async () => {
        const faltan = items.filter(i => !b.resp[i.id]?.valor);
        if (faltan.length) {
          faltan.forEach(i => $(`[data-item="${i.id}"]`)?.classList.add('falta'));
          $(`[data-item="${faltan[0].id}"]`).scrollIntoView({ behavior: 'smooth', block: 'center' });
          toast(`Faltan responder ${faltan.length} ${faltan.length === 1 ? 'ítem' : 'ítems'}`);
          return;
        }
        clearTimeout(tGuardar);
        const reg = {
          id: b.id,
          store_id: storeId,
          periodo: periodoDe(b.creado),
          creado: b.creado,
          respuestas: Object.entries(b.resp)
            .filter(([, r]) => r.valor)
            .map(([item_id, r]) => ({ item_id: Number(item_id), valor: r.valor, comentario: r.comentario || '' })),
          notas: b.notas,
          lat: b.lat,
          lng: b.lng,
          fotos: b.fotos.map(f => ({ ...f, subida: false })),
          subido: false,
          score: calcularPuntaje(b.resp, items)
        };
        await idb.put('cola', reg);
        await idb.del('borradores', storeId);
        toast(navigator.onLine ? 'Relevamiento guardado. Enviando…' : 'Guardado en el celular. Se envía cuando vuelva la señal.');
        location.hash = '#/pendientes';
        sincronizar();
      };

      $('#descartar').onclick = async () => {
        if (!confirm('¿Descartar este relevamiento? Se pierden las respuestas y las fotos cargadas.')) return;
        clearTimeout(tGuardar);
        await idb.del('borradores', storeId);
        location.hash = `#/local/${storeId}`;
      };
    }
  };
}

/* ================================================================ vistas: pendientes */

async function vPendientes() {
  const cola = await idb.all('cola');
  const borr = await idb.all('borradores');
  return {
    titulo: 'Pendientes de enviar',
    atras: '#/',
    html: `
      ${!cola.length && !borr.length ? '<div class="vacio"><p>Está todo enviado.</p><a class="btn" href="#/">Ir al inicio</a></div>' : ''}
      ${cola.length ? `
        <div class="lista">${cola.map(r => {
          const subidas = r.fotos.filter(f => f.subida).length;
          return `<div class="fila">
            <span class="nota ${escala(r.score)}">${fmt(r.score)}</span>
            <span class="fila-txt"><strong>${esc(nombreLocal(r.store_id))}</strong>
              <small>${fecha(r.creado)} · ${r.subido ? 'Respuestas enviadas' : 'Respuestas sin enviar'} · Fotos ${subidas} de ${r.fotos.length}</small>
              ${r.error ? `<small class="error">${esc(r.error)}</small>` : ''}
            </span>
          </div>`;
        }).join('')}</div>
        <button class="btn primario ancho" style="margin-top:14px" id="sync" ${navigator.onLine ? '' : 'disabled'}>
          ${S.syncing ? 'Enviando…' : navigator.onLine ? 'Enviar ahora' : 'Sin conexión'}</button>` : ''}
      ${borr.length ? `
        <div class="bloque"><h2>Sin terminar</h2>
          <div class="lista">${borr.map(x => `
            <div class="fila">
              <span class="fila-txt"><strong>${esc(nombreLocal(x.store_id))}</strong><small>Empezado el ${fecha(x.creado)}</small></span>
              <a class="btn chico" href="#/relevar/${x.store_id}">Continuar</a>
            </div>`).join('')}</div>
        </div>` : ''}`,
    montar() {
      const b = $('#sync');
      if (b) b.onclick = () => { b.disabled = true; b.textContent = 'Enviando…'; sincronizar(); };
    }
  };
}

/* ================================================================ vistas: detalle de relevamiento */

async function vRelevamiento(id) {
  const d = await api(`/api/relevamientos/${id}`);
  const r = d.relevamiento;
  const fotosDe = itemId => d.fotos.filter(f => f.item_id === itemId);
  const fallas = d.respuestas.filter(x => x.value === 'fail');
  const respHtml = x => `
    <div class="resp">
      <div class="resp-top"><span class="ico ${x.value}">${x.value === 'ok' ? '✓' : x.value === 'fail' ? '✕' : '–'}</span>
        <p>${esc(x.text)}${x.critical ? '<span class="tag-crit">Crítico</span>' : ''}</p></div>
      ${x.comment ? `<p class="coment">${esc(x.comment)}</p>` : ''}
      ${fotosDe(x.item_id).length ? `<div class="thumbs">${fotosDe(x.item_id).map(f =>
        `<div class="thumb"><a href="${fotoUrl(f.drive_id)}" target="_blank" rel="noopener"><img loading="lazy" src="${fotoUrl(f.drive_id)}" alt="Foto"></a></div>`).join('')}</div>` : ''}
    </div>`;
  const porCap = {};
  d.respuestas.forEach(x => (porCap[x.capitulo] ||= []).push(x));

  return {
    titulo: mesLabel(r.period),
    atras: `#/local/${r.store_id}`,
    html: `
      <div class="card">
        <div class="ficha">
          <div>
            <h2>${esc(r.store_name)}</h2>
            <p class="sub">${fecha(r.client_created_at)} por ${esc(r.usuario)}</p>
            ${r.distance_m > DISTANCIA_MAX ? `<p class="sub txt-urgente"><b>Cargado a ${fmtDist(r.distance_m)} del local</b></p>` : ''}
          </div>
          <div class="puntaje-grande"><div class="n txt-${r.escala}">${fmt(r.score)}</div><div class="l txt-${r.escala}">${ESCALAS[r.escala]}</div></div>
        </div>
        ${r.notes ? `<p style="margin:14px 0 0">${esc(r.notes)}</p>` : ''}
      </div>
      <div class="bloque"><h2>Por capítulo</h2><div class="card">
        ${d.capitulos.map(c => `<div class="cap-fila"><span>${esc(c.nombre)}</span><b class="txt-${c.escala}">${fmt(c.score)}</b>
          <div class="barra"><span class="${c.escala}" style="width:${c.score ?? 0}%"></span></div></div>`).join('')}
      </div></div>
      <div class="bloque"><h2>No cumple (${fallas.length})</h2>
        ${fallas.length ? `<div class="card">${fallas.map(respHtml).join('')}</div>` : '<div class="card sub">Sin incumplimientos.</div>'}
      </div>
      <div class="bloque"><h2>Relevamiento completo</h2>
        ${Object.entries(porCap).map(([cap, xs]) => `<details class="card" style="margin-bottom:10px"><summary>${esc(cap)}</summary>${xs.map(respHtml).join('')}</details>`).join('')}
      </div>`
  };
}

/* ================================================================ vistas: resumen */

async function vResumen() {
  S.periodoResumen ||= periodoActual();
  const p = S.periodoResumen;
  const d = await api(`/api/resumen?periodo=${p}`);
  const tot = d.total || 1;
  const maxTend = Math.max(1, ...d.tendencia.map(t => t.relevados));

  const listaCorta = arr => arr.length ? `<div class="lista">${arr.map(l => `
    <a class="fila" href="#/local/${l.id}">
      <span class="nota ${l.escala}">${fmt(l.score)}</span>
      <span class="fila-txt"><strong>${esc(l.name)}</strong><small>${esc(l.code)} · ${esc(l.supervisor_name || 'Sin supervisor')}</small></span>
      ${l.delta != null ? `<span class="delta baja">▼ ${fmt(Math.abs(l.delta))}</span>` : ''}
    </a>`).join('')}</div>` : '<div class="card sub">Sin datos para este mes.</div>';

  return {
    titulo: 'Resumen',
    html: `
      <div class="periodo">
        <input type="month" id="periodo" value="${p}" max="${periodoActual()}" aria-label="Mes">
        <a class="btn chico" href="${API}/api/exportar?periodo=${p}&t=${encodeURIComponent(S.token)}" download>Exportar a Excel</a>
      </div>

      <div class="titular">
        <div>
          <div class="n txt-${escala(d.promedio)}">${fmt(d.promedio)}</div>
          <div class="l">Promedio</div>
          <div class="s">De los locales relevados</div>
        </div>
        <div>
          <div class="n">${d.relevados}<small> de ${d.total}</small></div>
          <div class="l">Relevados</div>
          <div class="s">${fmt(d.cobertura)}% de cobertura</div>
        </div>
        ${d.cobertura < 80 && d.total ? `<div class="advertencia">El promedio solo refleja ${d.relevados} locales. ${d.total - d.relevados} todavía no se relevaron en ${mesLabel(p).toLowerCase()}.</div>` : ''}
      </div>

      <div class="bloque">
        <h2>Cómo están los locales</h2>
        <div class="card">
          <div class="dist">${ORDEN_ESCALAS.map(k => d.escalas[k] ? `<span class="${k}" style="width:${d.escalas[k] / tot * 100}%" title="${ESCALAS[k]}: ${d.escalas[k]}"></span>` : '').join('')}</div>
          <div class="leyenda">${ORDEN_ESCALAS.map(k => `<div><i style="background:var(--${k === 'sd' ? 'linea' : k})"></i>${ESCALAS[k]}<b>${d.escalas[k]}</b></div>`).join('')}</div>
        </div>
      </div>

      <div class="bloque">
        <h2>Últimos 6 meses</h2>
        <div class="card">
          <div class="tend">${d.tendencia.map(t => `
            <div class="tend-col"><div class="tend-bar" style="height:${t.relevados / maxTend * 100}%">
              ${['aprobado', 'observado', 'urgente', 'critico'].map(k => t[k] ? `<span style="flex:${t[k]};background:var(--${k})"></span>` : '').join('')}
            </div></div>`).join('')}</div>
          <div class="tend-lbl">${d.tendencia.map(t => `<div>${mesCorto(t.periodo)}<b>${t.promedio == null ? '–' : fmt(t.promedio)}</b>${t.relevados} loc.</div>`).join('')}</div>
        </div>
      </div>

      <div class="bloque">
        <h2>Supervisores</h2>
        <div class="card scroll-x">
          <table class="tabla">
            <thead><tr><th>Supervisor</th><th class="der">Relevados</th><th>Cumplimiento</th><th class="der">Promedio</th></tr></thead>
            <tbody>${d.supervisores.map(s => `
              <tr>
                <td>${esc(s.nombre)}</td>
                <td class="der">${s.relevados} de ${s.asignados}</td>
                <td><span class="mini-barra"><span style="width:${s.cumplimiento}%"></span></span><span class="num">${Math.round(s.cumplimiento)}%</span></td>
                <td class="der txt-${escala(s.promedio)}"><b>${fmt(s.promedio)}</b></td>
              </tr>`).join('')}</tbody>
          </table>
        </div>
      </div>

      ${d.atrasados.length ? `
      <div class="bloque">
        <h2>Sin relevar hace más de un mes (${d.atrasados.length})</h2>
        <div class="lista">${d.atrasados.map(l => `
          <a class="fila" href="#/local/${l.id}">
            <span class="nota sd">S/D</span>
            <span class="fila-txt"><strong>${esc(l.name)}</strong><small>${esc(l.supervisor_name || 'Sin supervisor')} · ${l.prev_period ? `Último: ${mesLabel(l.prev_period)}` : 'Nunca relevado'}</small></span>
          </a>`).join('')}</div>
      </div>` : ''}

      ${d.bajaron.length ? `<div class="bloque"><h2>Bajaron respecto del relevamiento anterior</h2>${listaCorta(d.bajaron)}</div>` : ''}

      <div class="dos-col bloque" style="margin-top:24px">
        <div><h2 style="font-size:1.05rem;margin:0 0 10px">Peores 10</h2>${listaCorta(d.peores)}</div>
        <div><h2 style="font-size:1.05rem;margin:0 0 10px">Mejores 10</h2>${listaCorta(d.mejores)}</div>
      </div>

      <div class="bloque">
        <h2>Ítems más incumplidos</h2>
        ${d.items.length ? `<div class="card">${d.items.map(i => `
          <div class="item-fail"><b>${i.n}</b><div>${esc(i.text)}<small>${esc(i.capitulo)}</small></div></div>`).join('')}</div>`
          : '<div class="card sub">Sin incumplimientos este mes.</div>'}
      </div>`,
    montar() {
      $('#periodo').onchange = e => {
        if (!e.target.value) return;
        S.periodoResumen = e.target.value;
        render();
      };
    }
  };
}

/* ================================================================ vistas: admin */

async function vAdmin() {
  if (S.user.role !== 'admin') { location.hash = '#/'; return null; }
  const tab = S.adminTab;
  let html = '';
  let montar = () => {};

  if (tab === 'usuarios') {
    const { usuarios } = await api('/api/admin/usuarios');
    const rol = { admin: 'Administrador', jefe: 'Jefe', supervisor: 'Supervisor' };
    html = `
      <form id="f-user" class="card form" novalidate>
        <strong>Nuevo usuario</strong>
        <label>Nombre y apellido<input name="nombre" required></label>
        <label>Email<input name="email" type="email" inputmode="email" required data-email></label>
        <label>Rol<select name="rol">
          <option value="supervisor">Supervisor: releva sus locales</option>
          <option value="jefe">Jefe: ve todo y el resumen</option>
          <option value="admin">Administrador: además configura la app</option>
        </select></label>
        <label>Clave inicial (mínimo 8 caracteres)<input name="clave" type="text" minlength="8" required></label>
        <p class="error" id="err" hidden></p>
        <button class="btn primario" type="submit">Crear usuario</button>
      </form>
      <div class="bloque"><h2>Usuarios (${usuarios.length})</h2>
        <div class="lista">${usuarios.map(u => `
          <div class="fila ${u.active ? '' : 'inactivo'}">
            <span class="fila-txt"><strong>${esc(u.name)}</strong><small>${esc(u.email)} · ${rol[u.role]}${u.active ? '' : ' · Inactivo'}</small></span>
            <button class="btn chico" data-clave="${u.id}">Clave</button>
            ${u.id !== S.user.id ? `<button class="btn chico" data-activo="${u.id}" data-v="${u.active ? 0 : 1}">${u.active ? 'Desactivar' : 'Activar'}</button>` : ''}
          </div>`).join('')}</div>
      </div>`;
    montar = () => {
      $('#f-user').onsubmit = async e => {
        e.preventDefault();
        const malo = validar(e.target);
        if (malo) return errorForm(malo);
        const f = new FormData(e.target);
        try {
          await post('/api/admin/usuarios', Object.fromEntries(f));
          toast('Usuario creado');
          render();
        } catch (err) {
          $('#err').textContent = err.message;
          $('#err').hidden = false;
        }
      };
      $$('[data-clave]').forEach(b => b.onclick = async () => {
        const c = prompt('Nueva clave para este usuario (mínimo 8 caracteres):');
        if (!c) return;
        try { await post(`/api/admin/usuarios/${b.dataset.clave}`, { clave: c }, 'PUT'); toast('Clave cambiada'); }
        catch (err) { toast(err.message); }
      });
      $$('[data-activo]').forEach(b => b.onclick = async () => {
        try { await post(`/api/admin/usuarios/${b.dataset.activo}`, { activo: b.dataset.v === '1' }, 'PUT'); render(); }
        catch (err) { toast(err.message); }
      });
    };
  }

  if (tab === 'locales') {
    await cargarCatalogo();
    html = `
      <div class="card form">
        <strong>Importar o actualizar locales</strong>
        <p class="sub" style="margin:0">Pegá desde Excel o escribí una fila por local. Si el código ya existe, se actualiza. La columna de supervisor va con el email de un usuario ya creado.</p>
        <pre class="plantilla">codigo;nombre;region;tipo;pais;email_supervisor;lat;lng
PMALE;Lucciano's Alem;Mar del Plata;Propio;Argentina;supervisor@luccianos.com.ar;-38,0105;-57,5364</pre>
        <textarea id="csv" placeholder="Pegá acá las filas"></textarea>
        <button class="btn primario" id="imp">Importar locales</button>
        <div class="resultado" id="res"></div>
      </div>
      <div class="bloque"><h2>Locales cargados (${S.cat.stores.length})</h2>
        <div class="lista">${S.cat.stores.map(s => `
          <div class="fila"><span class="fila-txt"><strong>${esc(s.code)} ${esc(s.name)}</strong>
            <small>${esc(s.supervisor_name || 'Sin supervisor')}${s.lat == null ? ' · Sin coordenadas' : ''}</small></span></div>`).join('')}</div>
      </div>`;
    montar = () => {
      $('#imp').onclick = async () => {
        try {
          const r = await post('/api/admin/locales/importar', { csv: $('#csv').value });
          $('#res').innerHTML = `<b>${r.importados} locales importados.</b>${r.errores.length ? `<ul>${r.errores.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}`;
          await cargarCatalogo();
          if (!r.errores.length) setTimeout(render, 1200);
        } catch (err) { $('#res').innerHTML = `<p class="error">${esc(err.message)}</p>`; }
      };
    };
  }

  if (tab === 'checklist') {
    const { items } = await api('/api/admin/checklist');
    const porCap = {};
    items.forEach(i => (porCap[i.capitulo] ||= []).push(i));
    html = `
      <div class="card form">
        <strong>Importar o actualizar el checklist</strong>
        <p class="sub" style="margin:0">Una fila por ítem. El peso define cuánto vale el ítem dentro del puntaje (1 es lo normal). Si un ítem marcado como crítico no se cumple, el local no puede pasar de 79.</p>
        <pre class="plantilla">capitulo;item;peso;critico
Camara helados;Cortinas, techo y piso limpios y sin hielo;1;no
Colaboradores;Uniforme completo;2;si</pre>
        <textarea id="csv" placeholder="Pegá acá las filas"></textarea>
        <label class="check"><input type="checkbox" id="reemp"> Reemplazar el checklist entero (los ítems que no estén en la lista se desactivan; los relevamientos viejos no cambian)</label>
        <button class="btn primario" id="imp">Importar checklist</button>
        <div class="resultado" id="res"></div>
      </div>
      <div class="bloque"><h2>Checklist actual (${items.filter(i => i.active).length} ítems activos)</h2>
        ${Object.entries(porCap).map(([cap, xs]) => `
          <details class="card" style="margin-bottom:10px"><summary>${esc(cap)} (${xs.filter(x => x.active).length})</summary>
            ${xs.map(i => `<div class="resp ${i.active ? '' : 'inactivo'}"><div class="resp-top"><p>${esc(i.text)}${i.critical ? '<span class="tag-crit">Crítico</span>' : ''}</p>
              <span class="sub num">Peso ${String(i.weight).replace('.', ',')}${i.active ? '' : ' · Inactivo'}</span></div></div>`).join('')}
          </details>`).join('') || '<div class="card sub">Todavía no hay ítems cargados.</div>'}
      </div>`;
    montar = () => {
      $('#imp').onclick = async () => {
        const reemp = $('#reemp').checked;
        if (reemp && !confirm('¿Reemplazar el checklist entero? Los ítems que no estén en la lista dejan de aparecer en los relevamientos nuevos.')) return;
        try {
          const r = await post('/api/admin/checklist/importar', { csv: $('#csv').value, reemplazar: reemp });
          $('#res').innerHTML = `<b>${r.importados} ítems importados.</b>${r.errores.length ? `<ul>${r.errores.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}`;
          await cargarCatalogo();
          if (!r.errores.length) setTimeout(render, 1200);
        } catch (err) { $('#res').innerHTML = `<p class="error">${esc(err.message)}</p>`; }
      };
    };
  }

  return {
    titulo: 'Administración',
    html: `
      <div class="tabs" role="tablist">
        ${[['usuarios', 'Usuarios'], ['locales', 'Locales'], ['checklist', 'Checklist']].map(([k, t]) =>
          `<button role="tab" data-tab="${k}" class="${tab === k ? 'activo' : ''}" aria-selected="${tab === k}">${t}</button>`).join('')}
      </div>
      ${html}`,
    montar(app) {
      $$('[data-tab]', app).forEach(b => b.onclick = () => { S.adminTab = b.dataset.tab; render(); });
      montar();
    }
  };
}

/* ================================================================ vistas: cuenta */

function vCuenta() {
  const rol = { admin: 'Administrador', jefe: 'Jefe', supervisor: 'Supervisor' };
  return {
    titulo: 'Cuenta',
    html: `
      <div class="card">
        <strong style="font-size:1.2rem">${esc(S.user.name)}</strong>
        <p class="sub">${esc(S.user.email)} · ${rol[S.user.role]}</p>
      </div>
      <div class="bloque"><h2>Datos guardados en el celular</h2>
        <div class="card">
          <p class="sub" style="margin:0 0 12px">${S.cat ? `${S.cat.stores.length} locales y ${S.cat.items.length} ítems. Actualizado el ${fecha(S.cat.at)}.` : 'Todavía no se descargaron.'}</p>
          <button class="btn ancho" id="act">Actualizar datos</button>
        </div>
      </div>
      <div class="bloque"><h2>Cambiar clave</h2>
        <form id="f-clave" class="card form" novalidate>
          ${campoClave('Clave actual', 'actual', 'autocomplete="current-password" required')}
          ${campoClave('Clave nueva (mínimo 8 caracteres)', 'nueva', 'autocomplete="new-password" minlength="8" required')}
          <p class="error" id="err" hidden></p>
          <button class="btn primario" type="submit">Cambiar clave</button>
        </form>
      </div>
      <div class="bloque">
        <button class="btn ancho" id="salir">Cerrar sesión</button>
        <p class="sub" style="text-align:center;margin-top:16px">Versión ${VERSION}</p>
      </div>`,
    montar() {
      $('#act').onclick = async () => {
        try { await cargarCatalogo(); toast('Datos actualizados'); render(); }
        catch (e) { toast(e.message); }
      };
      $('#f-clave').onsubmit = async e => {
        e.preventDefault();
        const malo = validar(e.target);
        if (malo) return errorForm(malo);
        const f = new FormData(e.target);
        try {
          await post('/api/cambiar-clave', { actual: f.get('actual'), nueva: f.get('nueva') });
          toast('Clave cambiada');
          e.target.reset();
        } catch (err) {
          $('#err').textContent = err.message;
          $('#err').hidden = false;
        }
      };
      $('#salir').onclick = async () => {
        const n = (await idb.all('cola')).length;
        if (n && !confirm(`Tenés ${n} relevamiento(s) sin enviar. Si cerrás sesión no se van a poder enviar hasta que vuelvas a ingresar. ¿Salir igual?`)) return;
        salir();
      };
    }
  };
}

/* ================================================================ arranque */

window.addEventListener('hashchange', render);
window.addEventListener('online', () => { toast('Volvió la conexión'); sincronizar(); });
setInterval(sincronizar, 60000);

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

render();
if (S.token && navigator.onLine) {
  cargarCatalogo().catch(() => {});
  sincronizar();
}
