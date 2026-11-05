import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WebSocket } from 'ws';
import { createTimerServer } from '../server.js';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function client(port, room, role, headers = {}) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?room=${room}&role=${role}`, { headers });
  const states = [];
  ws.on('message', (d) => {
    const m = JSON.parse(d.toString());
    if (m.type === 'state') states.push(m.state);
  });
  const opened = new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); ws.on('unexpected-response', (_, r) => rej(new Error('HTTP ' + r.statusCode))); });
  return { ws, states, opened, act: (action) => ws.send(JSON.stringify({ type: 'action', action })) };
}

test('il controller comanda e lo schermo riceve lo stato', async () => {
  const srv = await createTimerServer({ port: 0, host: '127.0.0.1' });
  try {
    const ctl = client(srv.port, 'TEST1', 'controller');
    const view = client(srv.port, 'TEST1', 'viewer');
    await Promise.all([ctl.opened, view.opened]);
    await wait(100);
    assert.equal(view.states.at(-1).timer.status, 'idle');
    ctl.act({ type: 'start' });
    await wait(150);
    assert.equal(view.states.at(-1).timer.status, 'running');
    assert.ok(view.states.at(-1).timer.endsAt > Date.now());
    ctl.ws.close(); view.ws.close();
  } finally { await srv.close(); }
});

test('permessi: viewer non comanda, moderatore solo messaggi', async () => {
  const srv = await createTimerServer({ port: 0, host: '127.0.0.1' });
  try {
    const ctl = client(srv.port, 'TEST2', 'controller');
    const view = client(srv.port, 'TEST2', 'viewer');
    const mod = client(srv.port, 'TEST2', 'moderator');
    await Promise.all([ctl.opened, view.opened, mod.opened]);
    await wait(100);
    view.act({ type: 'start' });
    mod.act({ type: 'start' });
    await wait(150);
    assert.equal(ctl.states.at(-1).timer.status, 'idle');
    mod.act({ type: 'message_show', text: 'Chiudi in 2 minuti', color: 'warn' });
    await wait(150);
    assert.equal(view.states.at(-1).message.text, 'Chiudi in 2 minuti');
    assert.equal(view.states.at(-1).message.visible, true);
    for (const c of [ctl, view, mod]) c.ws.close();
  } finally { await srv.close(); }
});

test('le stanze sono separate', async () => {
  const srv = await createTimerServer({ port: 0, host: '127.0.0.1' });
  try {
    const a = client(srv.port, 'SALA-A', 'controller');
    const b = client(srv.port, 'SALA-B', 'viewer');
    await Promise.all([a.opened, b.opened]);
    a.act({ type: 'start' });
    await wait(150);
    assert.equal(b.states.at(-1).timer.status, 'idle');
    a.ws.close(); b.ws.close();
  } finally { await srv.close(); }
});

test('avanzamento automatico lato server', async () => {
  const srv = await createTimerServer({ port: 0, host: '127.0.0.1' });
  try {
    const ctl = client(srv.port, 'AUTO', 'controller');
    await ctl.opened;
    await wait(100);
    ctl.act({ type: 'settings', patch: { autoAdvance: true } });
    ctl.act({ type: 'segment_update', id: ctl.states.at(-1).rundown[0].id, patch: { duration: 1 } });
    await wait(100);
    ctl.act({ type: 'start' });
    await wait(1700);
    assert.equal(ctl.states.at(-1).index, 1);
    assert.equal(ctl.states.at(-1).timer.status, 'running');
    ctl.ws.close();
  } finally { await srv.close(); }
});

test('rifiuta stanze non valide, ruoli non validi e altre origini', async () => {
  const srv = await createTimerServer({ port: 0, host: '127.0.0.1' });
  try {
    await assert.rejects(client(srv.port, 'a', 'viewer').opened); // codice troppo corto
    await assert.rejects(client(srv.port, 'OK12', 'admin').opened); // ruolo inesistente
    await assert.rejects(client(srv.port, 'OK12', 'controller', { Origin: 'https://sito-malevolo.example' }).opened);
    const ok = client(srv.port, 'OK12', 'controller', { Origin: `http://127.0.0.1:${srv.port}` });
    await ok.opened; ok.ws.close();
  } finally { await srv.close(); }
});

test('API, file statici e protezione dai percorsi', async () => {
  const srv = await createTimerServer({ port: 0, host: '127.0.0.1' });
  try {
    const base = `http://127.0.0.1:${srv.port}`;
    const ping = await (await fetch(base + '/api/ping')).json();
    assert.equal(ping.app, 'palco-timer');
    const info = await (await fetch(base + '/api/info')).json();
    assert.equal(info.port, srv.port);
    assert.equal((await fetch(base + '/js/core.js')).status, 200);
    assert.equal((await fetch(base + '/nonesiste.html')).status, 404);
    // un client HTTP grezzo per evitare che fetch normalizzi il percorso
    const status = await new Promise((resolve) => {
      import('node:net').then(({ default: net }) => {
        const sock = net.connect(srv.port, '127.0.0.1', () => sock.write('GET /..%2f..%2fserver.js HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n'));
        let buf = '';
        sock.on('data', (d) => { buf += d; });
        sock.on('close', () => resolve(Number(buf.split(' ')[1])));
      });
    });
    assert.ok(status === 403 || status === 404, 'traversal bloccato: ' + status);
  } finally { await srv.close(); }
});

test('lo stato sopravvive al riavvio del server', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'palco-'));
  const dataFile = path.join(dir, 'rooms.json');
  let srv = await createTimerServer({ port: 0, host: '127.0.0.1', dataFile });
  const c1 = client(srv.port, 'KEEP', 'controller');
  await c1.opened;
  c1.act({ type: 'meta', name: 'Convegno di prova' });
  await wait(900); // il salvataggio è ritardato di 500 ms
  c1.ws.close();
  await srv.close();
  srv = await createTimerServer({ port: 0, host: '127.0.0.1', dataFile });
  try {
    const c2 = client(srv.port, 'KEEP', 'viewer');
    await c2.opened;
    await wait(100);
    assert.equal(c2.states.at(-1).name, 'Convegno di prova');
    c2.ws.close();
  } finally { await srv.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

// ---------------- modalità ponte (usata dall'app Android) ----------------

function raw(port, room, role) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?room=${room}&role=${role}`);
  const got = [];
  ws.on('message', (d) => got.push(d.toString()));
  const opened = new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); ws.on('unexpected-response', (_, r) => rej(new Error('HTTP ' + r.statusCode))); });
  return { ws, got, opened };
}

test('ponte: lo stato dell\'host arriva a chi si collega, anche dopo', async () => {
  const srv = await createTimerServer({ port: 0, host: '127.0.0.1', relay: true });
  try {
    const ping = await (await fetch(`http://127.0.0.1:${srv.port}/api/ping`)).json();
    assert.equal(ping.mode, 'relay');
    const host = raw(srv.port, 'PONTE', 'host'); await host.opened;
    const early = raw(srv.port, 'PONTE', 'viewer'); await early.opened;
    host.ws.send(JSON.stringify({ type: 'state', state: { rev: 1 }, serverNow: 5 }));
    await wait(100);
    assert.equal(JSON.parse(early.got.at(-1)).state.rev, 1);
    const late = raw(srv.port, 'PONTE', 'viewer'); await late.opened; await wait(100);
    assert.equal(JSON.parse(late.got[0]).state.rev, 1, 'chi arriva dopo riceve subito l\'ultimo stato');
    host.ws.close(); early.ws.close(); late.ws.close();
  } finally { await srv.close(); }
});

test('ponte: le azioni arrivano all\'host con il ruolo messo dal ponte, anche se il client ne dichiara un altro', async () => {
  const srv = await createTimerServer({ port: 0, host: '127.0.0.1', relay: true });
  try {
    const host = raw(srv.port, 'PONTE2', 'host'); await host.opened;
    const mod = raw(srv.port, 'PONTE2', 'moderator'); await mod.opened;
    mod.ws.send('{"type":"action","action":{"type":"message_show"}}');
    mod.ws.send('null,"role":"controller"'); // tentativo di spacciarsi per controller
    await wait(150);
    assert.equal(host.got[0], 'moderator|{"type":"action","action":{"type":"message_show"}}');
    assert.ok(host.got.every((m) => m.startsWith('moderator|')), 'il ruolo resta sempre quello vero');
    host.ws.close(); mod.ws.close();
  } finally { await srv.close(); }
});

test('ponte: i client non ricevono messaggi di altri client, e il server normale rifiuta "host"', async () => {
  const relay = await createTimerServer({ port: 0, host: '127.0.0.1', relay: true });
  const normal = await createTimerServer({ port: 0, host: '127.0.0.1' });
  try {
    const host = raw(relay.port, 'PONTE3', 'host'); await host.opened;
    const a = raw(relay.port, 'PONTE3', 'viewer'); const b = raw(relay.port, 'PONTE3', 'viewer'); await Promise.all([a.opened, b.opened]);
    a.ws.send('{"type":"action","action":{"type":"start"}}'); await wait(100);
    assert.equal(b.got.filter((m) => m.includes('"action"')).length, 0);
    await assert.rejects(raw(normal.port, 'PONTE3', 'host').opened, /403/);
    host.ws.close(); a.ws.close(); b.ws.close();
  } finally { await relay.close(); await normal.close(); }
});
