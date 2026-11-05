import test from 'node:test';
import assert from 'node:assert/strict';
import {
  defaultState, reduce, tick, remaining, computeDisplay, formatClock, formatDuration,
  parseDuration, parseRundownText, rundownToCsv, canSend, addToClock, plannedOffsets,
} from '../public/js/core.js';

const T0 = 1_000_000;

test('start, pausa e ripresa mantengono il tempo rimanente', () => {
  let s = defaultState();
  const total = s.rundown[0].duration * 1000;
  s = reduce(s, { type: 'start' }, T0);
  assert.equal(s.timer.status, 'running');
  assert.equal(remaining(s, T0 + 60_000), total - 60_000);
  s = reduce(s, { type: 'pause' }, T0 + 60_000);
  assert.equal(s.timer.status, 'paused');
  assert.equal(remaining(s, T0 + 999_999), total - 60_000); // in pausa non scorre
  s = reduce(s, { type: 'start' }, T0 + 120_000);
  assert.equal(remaining(s, T0 + 120_000), total - 60_000);
});

test('azioni senza effetto restituiscono lo stesso oggetto', () => {
  const s = defaultState();
  assert.equal(reduce(s, { type: 'pause' }, T0), s);
  assert.equal(reduce(s, { type: 'prev' }, T0), s);
  assert.equal(reduce(s, { type: 'boh' }, T0), s);
  assert.equal(reduce(s, { type: 'message_show', text: '   ' }, T0), s);
  assert.equal(reduce(s, null, T0), s);
});

test('rev aumenta a ogni modifica e lo stato originale non viene mutato', () => {
  const s = defaultState();
  const snapshot = JSON.stringify(s);
  const n = reduce(s, { type: 'start' }, T0);
  assert.equal(n.rev, s.rev + 1);
  assert.equal(JSON.stringify(s), snapshot);
});

test('overtime: il tempo diventa negativo e il livello è "over"', () => {
  let s = reduce(defaultState(), { type: 'start' }, T0);
  const end = T0 + s.rundown[0].duration * 1000;
  assert.equal(computeDisplay(s, end - 1).level, 'crit');
  assert.equal(computeDisplay(s, end + 5000).level, 'over');
  assert.equal(remaining(s, end + 5000), -5000);
});

test('soglie avviso e critico, anche su segmenti brevi', () => {
  let s = reduce(defaultState(), { type: 'segment_add', segment: { title: 'Lampo', duration: 60 } }, T0);
  s = reduce(s, { type: 'goto', index: 4 }, T0);
  s = reduce(s, { type: 'start' }, T0);
  // 60 s: avviso a 30 s (metà), critico a 15 s (un quarto)
  assert.equal(computeDisplay(s, T0 + 20_000).level, 'ok');
  assert.equal(computeDisplay(s, T0 + 35_000).level, 'warn');
  assert.equal(computeDisplay(s, T0 + 50_000).level, 'crit');
});

test('goto seleziona senza avviare; next mantiene lo stato di avvio', () => {
  let s = reduce(defaultState(), { type: 'goto', index: 2 }, T0);
  assert.equal(s.index, 2);
  assert.equal(s.timer.status, 'idle');
  s = reduce(s, { type: 'start' }, T0);
  s = reduce(s, { type: 'next' }, T0 + 1000);
  assert.equal(s.index, 3);
  assert.equal(s.timer.status, 'running');
  assert.equal(remaining(s, T0 + 1000), s.rundown[3].duration * 1000);
  assert.equal(reduce(s, { type: 'next' }, T0 + 2000), s); // ultimo segmento
});

test('adjust aggiunge o toglie tempo, sia in corsa che fermo', () => {
  let s = defaultState();
  const total = s.rundown[0].duration * 1000;
  s = reduce(s, { type: 'adjust', ms: 60_000 }, T0);
  assert.equal(remaining(s, T0), total + 60_000);
  s = reduce(s, { type: 'start' }, T0);
  s = reduce(s, { type: 'adjust', ms: -30_000 }, T0);
  assert.equal(remaining(s, T0), total + 30_000);
});

test('modificare la durata del segmento in onda sposta la scadenza', () => {
  let s = reduce(defaultState(), { type: 'start' }, T0);
  const id = s.rundown[0].id;
  const before = remaining(s, T0);
  s = reduce(s, { type: 'segment_update', id, patch: { duration: s.rundown[0].duration + 120 } }, T0);
  assert.equal(remaining(s, T0), before + 120_000);
});

test('rimuovere e spostare segmenti mantiene coerente il segmento in onda', () => {
  let s = defaultState();
  const [a, b, c] = s.rundown;
  s = reduce(s, { type: 'goto', index: 1 }, T0);
  s = reduce(s, { type: 'segment_move', id: b.id, dir: -1 }, T0);
  assert.equal(s.rundown[0].id, b.id);
  assert.equal(s.index, 0); // segue "b"
  s = reduce(s, { type: 'segment_remove', id: a.id }, T0); // era prima del corrente? ora è dopo
  assert.equal(s.rundown[s.index].id, b.id);
  s = reduce(s, { type: 'segment_remove', id: b.id }, T0); // rimuovo quello in onda
  assert.equal(s.timer.status, 'idle');
  assert.equal(s.rundown[s.index].id, c.id);
  for (const seg of [...s.rundown]) s = reduce(s, { type: 'segment_remove', id: seg.id }, T0);
  assert.equal(s.rundown.length, 0);
  assert.equal(reduce(s, { type: 'start' }, T0), s);
});

test('avanzamento automatico parte dall\'istante esatto di scadenza', () => {
  let s = reduce(defaultState(), { type: 'settings', patch: { autoAdvance: true } }, T0);
  s = reduce(s, { type: 'start' }, T0);
  const d0 = s.rundown[0].duration * 1000;
  assert.equal(tick(s, T0 + d0 - 1), s); // non ancora
  const n = tick(s, T0 + d0 + 7000);
  assert.equal(n.index, 1);
  assert.equal(n.timer.status, 'running');
  assert.equal(n.timer.endsAt, T0 + d0 + s.rundown[1].duration * 1000); // nessun ritardo accumulato
  // dopo molto tempo salta più segmenti e si ferma sull'ultimo (in overtime)
  const far = tick(s, T0 + 10 * 3600 * 1000);
  assert.equal(far.index, far.rundown.length - 1);
  assert.ok(remaining(far, T0 + 10 * 3600 * 1000) < 0);
  // disattivato: nessun effetto
  const off = reduce(s, { type: 'settings', patch: { autoAdvance: false } }, T0);
  assert.equal(tick(off, T0 + 10 * 3600 * 1000), off);
});

test('messaggi: mostra, nascondi, colore non valido torna a info', () => {
  let s = reduce(defaultState(), { type: 'message_show', text: ' Chiudi in 2 minuti ', color: 'warn' }, T0);
  assert.deepEqual(s.message, { id: 1, text: 'Chiudi in 2 minuti', color: 'warn', visible: true });
  s = reduce(s, { type: 'message_show', text: 'Ciao', color: 'rosa' }, T0);
  assert.equal(s.message.color, 'info');
  assert.equal(s.message.id, 2);
  s = reduce(s, { type: 'message_hide' }, T0);
  assert.equal(s.message.visible, false);
});

test('input malevoli o fuori scala vengono limitati', () => {
  let s = reduce(defaultState(), { type: 'segment_add', segment: { title: 'x'.repeat(500), duration: 1e12 } }, T0);
  const seg = s.rundown.at(-1);
  assert.equal(seg.title.length, 80);
  assert.equal(seg.duration, 24 * 3600);
  s = reduce(s, { type: 'adjust', ms: 1e15 }, T0);
  assert.ok(Math.abs(s.timer.remainingMs) < 1e9);
  s = reduce(s, { type: 'meta', startTime: '25:99' }, T0);
  assert.equal(s.startTime, '');
  s = reduce(s, { type: 'meta', startTime: '09:30' }, T0);
  assert.equal(s.startTime, '09:30');
});

test('permessi: il moderatore può solo gestire i messaggi', () => {
  assert.ok(canSend('controller', 'start'));
  assert.ok(canSend('moderator', 'message_show'));
  assert.ok(!canSend('moderator', 'start'));
  assert.ok(!canSend('viewer', 'message_show'));
});

test('formatClock: arrotondamento e segno', () => {
  assert.equal(formatClock(300_000), '5:00');
  assert.equal(formatClock(299_001), '5:00'); // per eccesso
  assert.equal(formatClock(1), '0:01');
  assert.equal(formatClock(0), '0:00');
  assert.equal(formatClock(-500), '0:00'); // ancora nel primo secondo di overtime
  assert.equal(formatClock(-1000), '−0:01');
  assert.equal(formatClock(3_600_000), '1:00:00');
  assert.equal(formatClock(-65_000), '−1:05');
});

test('parseDuration accetta i formati comuni e rifiuta il resto', () => {
  assert.equal(parseDuration('5'), 300);
  assert.equal(parseDuration('2,5'), 150);
  assert.equal(parseDuration('5:30'), 330);
  assert.equal(parseDuration('1:05:00'), 3900);
  assert.equal(parseDuration('90s'), 90);
  assert.equal(parseDuration("7'"), 420);
  assert.equal(parseDuration('abc'), null);
  assert.equal(parseDuration('5:75'), null);
  assert.equal(parseDuration(''), null);
  assert.equal(parseDuration('99999'), null);
  assert.equal(formatDuration(3900), '1:05:00');
});

test('import: CSV con ; , tab, virgolette e intestazione', () => {
  const csv = 'titolo;relatore;durata;note\r\nApertura;Anna;5:00;\r\n"Keynote; parte 1";Bruno;20;"con slide"\r\nSenza durata;Carla;boh;\r\n';
  const { segments, skipped } = parseRundownText(csv);
  assert.equal(segments.length, 2);
  assert.equal(segments[1].title, 'Keynote; parte 1');
  assert.equal(segments[1].duration, 1200);
  assert.equal(segments[1].notes, 'con slide');
  assert.deepEqual(skipped, [4]);
  // incollato da Excel (tab) con sole due colonne
  const tsv = 'Pausa caffè\t15\nChiusura\t5:00';
  const r2 = parseRundownText(tsv);
  assert.deepEqual(r2.segments.map((x) => x.duration), [900, 300]);
  // andata e ritorno
  const back = parseRundownText(rundownToCsv(defaultState().rundown));
  assert.equal(back.segments.length, 4);
  assert.equal(back.segments[1].duration, 1200);
});

test('orari previsti', () => {
  const s = defaultState();
  assert.deepEqual(plannedOffsets(s.rundown), [0, 300, 1500, 3300]);
  assert.equal(addToClock('09:30', 1500), '09:55');
  assert.equal(addToClock('23:50', 1200), '00:10');
});

test('programma: durate dall\'orario successivo, relatori sulla riga sotto, chiusura finale esclusa', async () => {
  const { parseProgramLines } = await import('../public/js/core.js');
  const r = parseProgramLines([
    'Bologna, Sabato 31 ottobre 2026', '', 'PROGRAMMA',
    '10:00  Saluto di apertura', '       Anna Rossi, Luca Bianchi',
    '10:05  Il sonno come specchio', '       Mario Verdi',
    '10:45  Pausa',
    '11:00  Chiusura dei lavori',
    'INFORMAZIONI', '12:30 Segreteria',
  ]);
  assert.equal(r.startTime, '10:00');
  assert.deepEqual(r.segments.map((s) => s.duration), [300, 2400, 900]);
  assert.equal(r.segments[0].speaker, 'Anna Rossi, Luca Bianchi');
  assert.equal(r.segments[2].title, 'Pausa');
  assert.equal(r.guessed, 0);
});

test('programma: intervalli "9.30 - 10.15", ultimo senza fine = 10 minuti stimati, testo senza orari = vuoto', async () => {
  const { parseProgramLines } = await import('../public/js/core.js');
  const a = parseProgramLines(['9.30 - 10.15 Apertura', '10:15 Keynote']);
  assert.deepEqual(a.segments.map((s) => s.duration), [2700, 600]);
  assert.equal(a.guessed, 1);
  assert.equal(a.startTime, '09:30');
  assert.deepEqual(parseProgramLines(['Solo una locandina', '31.10.2026']).segments, []);
});

test('programma: titolo "I N F O R M A Z I O N I" e contorno dopo la chiusura non diventano interventi', async () => {
  const { parseProgramLines } = await import('../public/js/core.js');
  const r = parseProgramLines(['10:00 Apertura', 'Anna', '10:30 Chiusura dei lavori', 'Sala Rossa', '', 'I N F O R M A Z I O N I', 'Tel. 051 263703']);
  assert.deepEqual(r.segments.map((s) => [s.title, s.duration]), [['Apertura', 1800]]);
});

test('versione gratuita: limite di 3 interventi, moderatore bloccato, il resto libero', async () => {
  const { proRequired, FREE_MAX_SEGMENTS, defaultState: ds } = await import('../public/js/core.js');
  assert.equal(FREE_MAX_SEGMENTS, 5);
  const st = ds(); // 4 interventi di esempio: un nuovo evento gratuito deve poterne aggiungere ancora uno
  assert.ok(st.rundown.length < FREE_MAX_SEGMENTS);
  assert.equal(proRequired(st, { type: 'segment_add' }), null);
  const full = { ...st, rundown: Array.from({ length: FREE_MAX_SEGMENTS }, (_, i) => ({ ...st.rundown[0], id: 'x' + i })) };
  assert.equal(proRequired(full, { type: 'segment_add' }), 'segments');
  assert.equal(proRequired(st, { type: 'rundown_replace', segments: new Array(FREE_MAX_SEGMENTS + 1).fill(1) }), 'segments');
  assert.equal(proRequired(st, { type: 'rundown_replace', segments: new Array(FREE_MAX_SEGMENTS).fill(1) }), null);
  assert.equal(proRequired(st, { type: 'message_show' }, 'moderator'), 'moderator');
  for (const type of ['start', 'pause', 'next', 'adjust', 'message_show', 'segment_update', 'segment_remove']) {
    assert.equal(proRequired(st, { type }), null, type);
  }
});
