// server.js — server in rete locale: serve l'app, tiene lo stato di ogni stanza e lo sincronizza.
// Funziona senza internet: basta che i dispositivi siano sulla stessa rete (Wi-Fi o hotspot).
// Nell'app Android questo ruolo lo svolgerà il telefono/tablet "host".
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { reduce, tick, defaultState, canSend } from './public/js/core.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(here, 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

const ROOM_RE = /^[A-Z0-9_-]{2,24}$/;
const ROLES = new Set(['controller', 'moderator', 'viewer']);
const MAX_PAYLOAD = 256 * 1024;
const MAX_MSGS_PER_SEC = 60;

export function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const i of list || []) if (i.family === 'IPv4' && !i.internal) out.push(i.address);
  }
  return out;
}

/**
 * Due modi:
 *  - normale: il server tiene lo stato di ogni stanza (computer, `npm start`).
 *  - ponte (`relay: true`): il server non tiene lo stato. Fa solo da ponte tra il controller "host"
 *    (la pagina dentro l'app, collegata da questo stesso dispositivo) e gli altri dispositivi.
 *    È lo stesso comportamento del server nativo dell'app Android: qui è la versione di riferimento, provata dai test.
 */
export function createTimerServer({ port = 3000, host = '0.0.0.0', dataFile = null, relay = false } = {}) {
  const rooms = new Map(); // id -> { state, clients:Set<ws> }
  const relayRooms = new Map(); // id -> { host:ws|null, last:string|null, clients:Set<ws> }

  // --- persistenza semplice su file (così un riavvio non perde le scalette) ---
  let saveTimer = null;
  const persisted = (() => {
    if (!dataFile) return {};
    try { return JSON.parse(fs.readFileSync(dataFile, 'utf8')).rooms || {}; } catch { return {}; }
  })();
  function scheduleSave() {
    if (!dataFile || saveTimer) return;
    saveTimer = setTimeout(() => {
      saveTimer = null;
      const obj = {};
      for (const [id, r] of rooms) obj[id] = r.state;
      try {
        fs.mkdirSync(path.dirname(dataFile), { recursive: true });
        fs.writeFileSync(dataFile, JSON.stringify({ rooms: obj }));
      } catch (e) { console.error('salvataggio non riuscito:', e.message); }
    }, 500);
  }

  function getRoom(id) {
    let r = rooms.get(id);
    if (!r) {
      r = { state: persisted[id] || defaultState(), clients: new Set() };
      rooms.set(id, r);
    }
    return r;
  }

  const send = (ws, msg) => { if (ws.readyState === 1) ws.send(JSON.stringify(msg)); };
  function broadcast(room) {
    const msg = { type: 'state', state: room.state, serverNow: Date.now() };
    for (const ws of room.clients) send(ws, msg);
  }

  // --- HTTP: file statici e due piccole API ---
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');

    if (url.pathname === '/api/ping') {
      res.writeHead(200, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' });
      return res.end(JSON.stringify({ app: 'palco-timer', ok: true, mode: relay ? 'relay' : 'server' }));
    }
    if (url.pathname === '/api/info') {
      res.writeHead(200, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' });
      return res.end(JSON.stringify({ app: 'palco-timer', ips: lanAddresses(), port: server.address()?.port ?? port }));
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405); return res.end();
    }

    let rel;
    try { rel = decodeURIComponent(url.pathname); } catch { res.writeHead(400); return res.end(); }
    if (rel.endsWith('/')) rel += 'index.html';
    const file = path.normalize(path.join(PUBLIC_DIR, rel));
    if (file !== PUBLIC_DIR && !file.startsWith(PUBLIC_DIR + path.sep)) { res.writeHead(403); return res.end(); }
    fs.readFile(file, (err, buf) => {
      if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Non trovato'); }
      const ext = path.extname(file).toLowerCase();
      res.writeHead(200, {
        'Content-Type': MIME[ext] || 'application/octet-stream',
        'Cache-Control': ext === '.woff2' ? 'public, max-age=86400' : 'no-cache',
      });
      res.end(req.method === 'HEAD' ? undefined : buf);
    });
  });

  // --- WebSocket ---
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD });

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, 'http://x');
    // Blocca pagine di altri siti che tentano di collegarsi al timer dal browser dell'utente.
    const origin = req.headers.origin;
    let sameOrigin = true;
    if (origin) { try { sameOrigin = new URL(origin).host === req.headers.host; } catch { sameOrigin = false; } }
    const roomId = (url.searchParams.get('room') || '').toUpperCase();
    const role = url.searchParams.get('role') || 'viewer';
    const loopback = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
    const roleOk = ROLES.has(role) || (relay && role === 'host' && loopback); // "host" solo da questo stesso dispositivo
    if (url.pathname !== '/ws' || !sameOrigin || !ROOM_RE.test(roomId) || !roleOk) {
      socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      return socket.destroy();
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, { roomId, role }));
  });

  // --- modalità ponte: il controller "host" ha lo stato, qui si inoltrano solo i messaggi ---
  function relayConnection(ws, roomId, role) {
    let room = relayRooms.get(roomId);
    if (!room) { room = { host: null, last: null, clients: new Set() }; relayRooms.set(roomId, room); }
    let count = 0;
    const rate = setInterval(() => { count = 0; }, 1000);

    if (role === 'host') {
      if (room.host && room.host !== ws) room.host.close(4000, 'sostituito');
      room.host = ws;
      ws.on('message', (data) => {
        const raw = data.toString();
        if (++count > MAX_MSGS_PER_SEC * 4 || !raw.startsWith('{"type":"state"')) return;
        room.last = raw;
        for (const c of room.clients) if (c.readyState === 1) c.send(raw);
      });
    } else {
      room.clients.add(ws);
      if (room.last) ws.send(room.last);
      ws.on('message', (data) => {
        if (++count > MAX_MSGS_PER_SEC) return ws.close(1008, 'troppi messaggi');
        // "ruolo|messaggio": il ruolo lo mette il ponte, il testo del client resta intatto dopo la prima barra
        if (room.host && room.host.readyState === 1) room.host.send(`${role}|${data.toString()}`);
      });
    }
    ws.on('close', () => {
      clearInterval(rate);
      room.clients.delete(ws);
      if (room.host === ws) room.host = null;
    });
    ws.on('error', () => ws.close());
  }

  wss.on('connection', (ws, { roomId, role }) => {
    if (relay) return relayConnection(ws, roomId, role);
    const room = getRoom(roomId);
    room.clients.add(ws);
    send(ws, { type: 'state', state: room.state, serverNow: Date.now() });

    let count = 0;
    const rate = setInterval(() => { count = 0; }, 1000);

    ws.on('message', (data) => {
      if (++count > MAX_MSGS_PER_SEC) return ws.close(1008, 'troppi messaggi');
      let msg;
      try { msg = JSON.parse(data.toString()); } catch { return; }
      if (msg?.type !== 'action' || !msg.action || !canSend(role, msg.action.type)) return;
      const next = reduce(room.state, msg.action, Date.now());
      if (next !== room.state) {
        room.state = next;
        broadcast(room);
        scheduleSave();
      }
    });
    ws.on('close', () => { clearInterval(rate); room.clients.delete(ws); });
    ws.on('error', () => ws.close());
  });

  // Avanzamento automatico e orologio condiviso.
  const tickTimer = setInterval(() => {
    if (relay) return;
    for (const room of rooms.values()) {
      const next = tick(room.state, Date.now());
      if (next !== room.state) { room.state = next; broadcast(room); scheduleSave(); }
    }
  }, 250);
  const beat = setInterval(() => {
    const msg = { type: 'time', serverNow: Date.now() };
    for (const room of rooms.values()) for (const ws of room.clients) send(ws, msg);
    for (const room of relayRooms.values()) for (const ws of room.clients) send(ws, msg);
  }, 5000);

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      resolve({
        server,
        port: server.address().port,
        rooms,
        close() {
          clearInterval(tickTimer); clearInterval(beat);
          if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
          for (const ws of wss.clients) ws.terminate();
          return new Promise((r) => server.close(() => r()));
        },
      });
    });
  });
}

// Avvio da riga di comando: `npm start`
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT) || 3000;
  const handle = await createTimerServer({ port, dataFile: path.join(here, 'data', 'rooms.json') }).catch((e) => {
    console.error(e.code === 'EADDRINUSE' ? `La porta ${port} è già in uso. Prova: PORT=3001 npm start` : e);
    process.exit(1);
  });
  console.log('\nPalco Timer in esecuzione\n');
  console.log(`  Su questo computer:  http://localhost:${handle.port}`);
  for (const ip of lanAddresses()) console.log(`  Sugli altri schermi: http://${ip}:${handle.port}`);
  console.log('\nTutti i dispositivi devono essere sulla stessa rete. Ctrl+C per fermare.\n');
  const stop = () => handle.close().then(() => process.exit(0));
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
