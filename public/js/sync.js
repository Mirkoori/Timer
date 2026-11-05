// sync.js — collega una pagina alla stanza dell'evento.
//
// Modalità "server": la pagina è servita da server.js (rete locale). Lo stato sta sul server,
//   funziona tra dispositivi diversi, si riconnette da sola.
// Modalità "locale": nessun server (es. pagina aperta da hosting statico). Le schede dello STESSO
//   browser si parlano via BroadcastChannel; la scheda controller tiene lo stato.
//
// In entrambi i casi la pagina riceve lo stato completo e calcola da sola il tempo mostrato
// (scadenza assoluta meno ora corrente): se la connessione cade il timer continua a scorrere giusto.
import { reduce, tick, defaultState, canSend } from './core.js';

/** @returns {Promise<{mode:'server'|'local', state:object|null, now:()=>number, send:(a:object)=>void, close:()=>void}>} */
export async function connect({ room, role, onState, onStatus }) {
  const mode = await probeServer();
  if (!mode) return connectLocal({ room, role, onState, onStatus });
  // Nell'app il server è un "ponte": lo stato lo tiene il controller aperto su questo stesso dispositivo.
  if (mode === 'relay' && role === 'controller' && isLoopback()) return connectHost({ room, onState, onStatus });
  return connectServer({ room, role, onState, onStatus });
}

function isLoopback() {
  return ['localhost', '127.0.0.1', '[::1]', '::1'].includes(location.hostname);
}

/** @returns {Promise<'server'|'relay'|null>} */
async function probeServer() {
  if (!/^https?:$/.test(location.protocol)) return null;
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 1200);
    const r = await fetch('/api/ping', { signal: ctl.signal, cache: 'no-store' });
    clearTimeout(t);
    if (!r.ok) return null;
    const info = await r.json();
    return info.app === 'palco-timer' ? (info.mode === 'relay' ? 'relay' : 'server') : null;
  } catch {
    return null;
  }
}

// ---------------- modalità server ----------------

function connectServer({ room, role, onState, onStatus }) {
  let ws;
  let offset = 0; // ora del server meno ora locale
  let closed = false;
  let retry = 0;

  const link = {
    mode: 'server',
    state: null,
    now: () => Date.now() + offset,
    send(action) {
      if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: 'action', action }));
    },
    close() { closed = true; if (ws) ws.close(); },
  };

  function open() {
    onStatus('connecting');
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${proto}//${location.host}/ws?room=${encodeURIComponent(room)}&role=${role}`);
    ws.onopen = () => { retry = 0; onStatus('online'); };
    ws.onmessage = (ev) => {
      let m;
      try { m = JSON.parse(ev.data); } catch { return; }
      if (typeof m.serverNow === 'number') offset = m.serverNow - Date.now();
      if (m.type === 'state') { link.state = m.state; onState(m.state); }
    };
    ws.onclose = () => {
      onStatus('offline');
      if (!closed) setTimeout(open, Math.min(4000, 400 * ++retry));
    };
    ws.onerror = () => ws.close();
  }
  open();
  return link;
}

// ---------------- modalità host (app Android) ----------------

/**
 * Il controller dell'app tiene lo stato e fa partire il timer (come la scheda controller in modalità locale),
 * e lo passa al server-ponte, che lo inoltra agli altri dispositivi. Le azioni degli altri arrivano come "ruolo|messaggio".
 */
function connectHost({ room, onState, onStatus }) {
  const key = `palco:state:${room}`;
  let state;
  try { state = JSON.parse(localStorage.getItem(key)); } catch { state = null; }
  if (!state || !Array.isArray(state.rundown)) state = defaultState();

  let ws = null;
  let retry = 0;
  let closed = false;
  const link = { mode: 'host', state, now: () => Date.now(), send: (a) => apply(a), close() { closed = true; clearInterval(timer); if (ws) ws.close(); } };

  const push = () => { if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: 'state', state, serverNow: Date.now() })); };
  const commit = (next) => {
    state = next;
    link.state = next;
    try { localStorage.setItem(key, JSON.stringify(next)); } catch { /* spazio finito: si continua */ }
    push();
    onState(next);
  };
  const apply = (action, role = 'controller') => {
    if (!action || !canSend(role, action.type)) return;
    const next = reduce(state, action, Date.now());
    if (next !== state) commit(next);
  };
  const timer = setInterval(() => {
    const next = tick(state, Date.now());
    if (next !== state) commit(next);
  }, 250);

  function open() {
    ws = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws?room=${encodeURIComponent(room)}&role=host`);
    ws.onopen = () => { retry = 0; push(); };
    ws.onmessage = (ev) => {
      const text = String(ev.data);
      const bar = text.indexOf('|');
      if (bar < 1) return;
      let m;
      try { m = JSON.parse(text.slice(bar + 1)); } catch { return; }
      if (m && m.type === 'action') apply(m.action, text.slice(0, bar));
    };
    ws.onclose = (ev) => {
      if (ev.code === 4000) { // un altro controller su questo dispositivo ha preso il comando: ci si ferma, niente tira e molla
        closed = true; clearInterval(timer); onStatus('replaced'); return;
      }
      if (!closed) setTimeout(open, Math.min(4000, 400 * ++retry));
    };
    ws.onerror = () => ws.close();
  }
  open();
  setTimeout(() => { onStatus('online'); onState(state); }, 0);
  return link;
}

// ---------------- modalità locale ----------------

/** Una sola scheda per stanza fa da "autorità"; le altre le inoltrano le azioni. */
function acquireAuthority(room) {
  if (!navigator.locks) return Promise.resolve(true);
  return new Promise((resolve) => {
    navigator.locks.request(`palco:${room}`, { ifAvailable: true }, (lock) => {
      resolve(!!lock);
      return lock ? new Promise(() => {}) : undefined; // tiene il blocco finché la scheda resta aperta
    });
  });
}

async function connectLocal({ room, role, onState, onStatus }) {
  const channel = new BroadcastChannel(`palco:${room}`);
  const key = `palco:state:${room}`;
  const isAuthority = role === 'controller' && (await acquireAuthority(room));

  const link = { mode: 'local', state: null, now: () => Date.now(), send() {}, close() { channel.close(); } };

  if (isAuthority) {
    let state;
    try { state = JSON.parse(localStorage.getItem(key)); } catch { state = null; }
    if (!state || !Array.isArray(state.rundown)) state = defaultState();
    const commit = (next) => {
      state = next;
      link.state = next;
      try { localStorage.setItem(key, JSON.stringify(next)); } catch { /* spazio finito: si continua */ }
      channel.postMessage({ type: 'state', state: next });
      onState(next);
    };
    const apply = (action) => {
      const next = reduce(state, action, Date.now());
      if (next !== state) commit(next);
    };
    channel.onmessage = (ev) => {
      const m = ev.data;
      if (m.type === 'hello') channel.postMessage({ type: 'state', state });
      else if (m.type === 'action' && canSend(m.role, m.action && m.action.type)) apply(m.action);
    };
    link.send = apply;
    setInterval(() => {
      const next = tick(state, Date.now());
      if (next !== state) commit(next);
    }, 250);
    link.state = state;
    // Lo stato iniziale arriva dopo che la pagina ha finito di prepararsi (con il server arriva comunque in ritardo).
    setTimeout(() => { onStatus('online'); onState(state); }, 0);
    return link;
  }

  // Scheda non autorevole: riceve lo stato e inoltra le azioni alla scheda controller.
  onStatus('waiting');
  channel.onmessage = (ev) => {
    if (ev.data.type !== 'state') return;
    link.state = ev.data.state;
    onStatus('online');
    onState(ev.data.state);
  };
  link.send = (action) => channel.postMessage({ type: 'action', role, action });
  const hello = () => { if (!link.state) channel.postMessage({ type: 'hello' }); };
  hello();
  setInterval(hello, 1500);
  return link;
}
