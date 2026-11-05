// ui.js — piccoli aiuti per costruire l'interfaccia, condivisi tra le pagine.

export const $ = (sel, root = document) => root.querySelector(sel);

/** Crea un elemento. Testo sempre come nodo di testo (mai HTML): i nomi inseriti dagli utenti non possono iniettare codice. */
export function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'class') n.className = v;
    else if (k === 'value') n.value = v;
    else if (v === true) n.setAttribute(k, '');
    else n.setAttribute(k, v);
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    n.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return n;
}

// ---- icone (tracciati fissi, nessun dato esterno) ----
const ICONS = {
  play: '<path d="M8 5v14l11-7z" fill="currentColor" stroke="none"/>',
  pause: '<path d="M7 5h4v14H7zM13 5h4v14h-4z" fill="currentColor" stroke="none"/>',
  next: '<path d="M6 5v14l9-7zM17 5h2v14h-2z" fill="currentColor" stroke="none"/>',
  prev: '<path d="M18 5v14l-9-7zM5 5h2v14H5z" fill="currentColor" stroke="none"/>',
  reset: '<path d="M4 12a8 8 0 1 0 2.6-5.9M4 4v5h5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  up: '<path d="m6 15 6-6 6 6"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
  trash: '<path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/>',
  screen: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
  sliders: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  upload: '<path d="M12 16V4m-5 5 5-5 5 5M5 20h14"/>',
  download: '<path d="M12 4v12m-5-5 5 5 5-5M5 20h14"/>',
  expand: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  send: '<path d="M4 12 20 4l-4 16-4-6z"/>',
  eyeoff: '<path d="M3 3l18 18M10.6 6.2A9 9 0 0 1 12 6c5 0 8 6 8 6a14 14 0 0 1-3 3.6M6.5 7.8A14 14 0 0 0 4 12s3 6 8 6a8 8 0 0 0 3-.6"/>',
};
export function icon(name) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('fill', 'none');
  s.setAttribute('stroke', 'currentColor');
  s.setAttribute('stroke-width', '2');
  s.setAttribute('stroke-linecap', 'round');
  s.setAttribute('stroke-linejoin', 'round');
  s.setAttribute('aria-hidden', 'true');
  s.innerHTML = ICONS[name] || ''; // contenuto statico definito sopra
  return s;
}

// ---- stanza ----
export function roomFromUrl() {
  const r = new URLSearchParams(location.search).get('room') || '';
  return r.toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 24);
}

/** Codice di 5 caratteri, senza lettere e cifre facili da confondere (0/O, 1/I). */
export function makeRoomCode() {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(5));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}

export function pageUrl(file, room, base = location.href) {
  const u = new URL(file, base);
  u.searchParams.set('room', room);
  return u.href;
}

export function rememberRoom(room, name) {
  try {
    const list = JSON.parse(localStorage.getItem('palco:recent') || '[]').filter((r) => r.room !== room);
    list.unshift({ room, name: name || '', at: Date.now() });
    localStorage.setItem('palco:recent', JSON.stringify(list.slice(0, 6)));
  } catch { /* privato o pieno: si ignora */ }
}
export function recentRooms() {
  try { return JSON.parse(localStorage.getItem('palco:recent') || '[]'); } catch { return []; }
}

// ---- stato di connessione ----
const STATUS_TEXT = {
  online: 'Collegato',
  offline: 'Connessione persa',
  connecting: 'Connessione in corso',
  waiting: 'In attesa del controller',
  replaced: 'Un altro controller ha preso il comando',
};
export function showConn(node, status) {
  node.dataset.status = status;
  node.textContent = STATUS_TEXT[status] || '';
}

// ---- cifre e barra ----
export function renderDigits(node, text) {
  if (node.dataset.text === text) return;
  node.dataset.text = text;
  node.textContent = '';
  let w = 0;
  for (const ch of text) {
    const kind = ch === ':' ? 'c' : ch === '−' ? 'm' : 'd';
    w += kind === 'c' ? 0.24 : kind === 'm' ? 0.34 : 0.5;
    node.append(el('span', { class: kind }, ch));
  }
  node.style.setProperty('--w', w.toFixed(2)); // larghezza in "em": serve per adattare la dimensione allo spazio
}

export function makeRail() {
  return el('div', { class: 'rail', 'aria-hidden': 'true' }, el('div', { class: 'rail-fill' }), el('div', { class: 'rail-thumb' }));
}
export function applyRail(rail, d) {
  rail.style.setProperty('--elapsed', d.elapsed.toFixed(4));
  rail.style.setProperty('--warn-at', d.warnAt.toFixed(4));
  rail.style.setProperty('--crit-at', d.critAt.toFixed(4));
  rail.dataset.full = String(d.elapsed >= 1);
}

export function stateLabel(d) {
  if (d.status === 'idle') return 'Pronto';
  if (d.level === 'over') return d.status === 'paused' ? 'Scaduto, in pausa' : 'Tempo scaduto';
  return d.status === 'paused' ? 'In pausa' : 'In onda';
}

// ---- avviso ----
let toastTimer;
export function toast(text) {
  document.querySelectorAll('.toast').forEach((t) => t.remove());
  const t = el('div', { class: 'toast', role: 'status' }, text);
  document.body.append(t);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.remove(), 2400);
}

export async function copyText(text, okMessage = 'Copiato') {
  try {
    await navigator.clipboard.writeText(text);
    toast(okMessage);
  } catch {
    // Su http in rete locale la clipboard può essere bloccata: si seleziona il testo per la copia manuale.
    toast('Copia non riuscita, seleziona il testo e copialo');
  }
}

// ---- schermo sempre acceso e schermo intero ----
export function keepAwake() {
  let lock = null;
  const request = async () => {
    try {
      if ('wakeLock' in navigator && document.visibilityState === 'visible' && !lock) {
        lock = await navigator.wakeLock.request('screen');
        lock.addEventListener('release', () => { lock = null; });
      }
    } catch { /* non disponibile (richiede https o localhost) */ }
  };
  request();
  document.addEventListener('visibilitychange', request);
  addEventListener('pointerdown', request, { passive: true });
  addEventListener('keydown', request, { passive: true });
}

export function toggleFullscreen() {
  if (!document.fullscreenEnabled) return;
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen().catch(() => {});
}

/** Esegue `fn` circa 10 volte al secondo, anche con la scheda in secondo piano. */
export function every100ms(fn) {
  fn();
  return setInterval(fn, 100);
}
