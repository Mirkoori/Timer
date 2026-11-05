import {
  computeDisplay, formatClock, formatDuration, parseDuration, plannedOffsets, totalSeconds, addToClock,
  parseRundownText, parseProgramLines, rundownToCsv, newId,
} from './core.js';
import { connect } from './sync.js';
import { mountMessages } from './messages.js';
import { pdfLines } from './pdf.js';
import {
  $, el, icon, roomFromUrl, pageUrl, rememberRoom, showConn, renderDigits, makeRail, applyRail,
  stateLabel, toast, copyText, every100ms,
} from './ui.js';

const room = roomFromUrl();
if (!room) location.replace('index.html');

const dom = {
  name: $('#name'), code: $('#code'), conn: $('#conn'),
  onair: $('#onair'), nowTitle: $('#nowTitle'), nowSpeaker: $('#nowSpeaker'), digits: $('#digits'), nowState: $('#nowState'),
  tPrev: $('#tPrev'), tToggle: $('#tToggle'), tNext: $('#tNext'), tMinus: $('#tMinus'), tPlus: $('#tPlus'), tReset: $('#tReset'),
  strips: $('#strips'), summary: $('#summary'), btnAdd: $('#btnAdd'), btnImport: $('#btnImport'), btnExport: $('#btnExport'),
  btnLinks: $('#btnLinks'), btnSettings: $('#btnSettings'),
};

// ---- testi e icone dei pulsanti ----
const label = (btn, iconName, text, after = false) => btn.replaceChildren(...(after ? [text, icon(iconName)] : [icon(iconName), text]));
label(dom.btnLinks, 'screen', 'Collega schermi');
label(dom.btnSettings, 'sliders', 'Impostazioni');
label(dom.btnImport, 'upload', 'Importa');
label(dom.btnExport, 'download', 'Esporta');
label(dom.btnAdd, 'plus', 'Aggiungi intervento');
label(dom.tPrev, 'prev', 'Precedente');
label(dom.tNext, 'next', 'Prossimo', true);
label(dom.tMinus, 'minus', '1 minuto');
label(dom.tPlus, 'plus', '1 minuto');
label(dom.tReset, 'reset', 'Azzera');
label($('#copyViewer'), 'copy', 'Copia');
label($('#copyModerator'), 'copy', 'Copia');
label($('#importFileLabel'), 'upload', 'Scegli un file');
document.querySelectorAll('[data-close]').forEach((b) => { if (b.classList.contains('btn-icon')) b.replaceChildren(icon('close')); });
dom.code.replaceChildren(`Codice ${room}`);
dom.code.title = 'Copia il codice dell\'evento';

const rail = makeRail();
$('#railSlot').append(rail);

// ---- stato ----
let link = null;
let state = null;
let signature = '';
let lastName = null;
let editing = null; // { id, draft:{title,speaker,duration,notes}, error, focus }

const send = (action) => { if (link) link.send(action); };
const updateMessages = mountMessages($('#messages'), send);

link = await connect({
  room,
  role: 'controller',
  onStatus: (s) => showConn(dom.conn, s),
  onState: (s) => { state = s; onStateChange(); },
});

function onStateChange() {
  updateMessages(state);
  if (document.activeElement !== dom.name) dom.name.value = state.name;
  if (state.name !== lastName) { lastName = state.name; rememberRoom(room, state.name); }
  syncSettings();
  const sig = JSON.stringify([state.rundown, state.index, state.startTime]);
  if (sig !== signature) { signature = sig; renderRundown(); }
  paint();
}

// ---- scaletta ----
function renderRundown() {
  const s = state;
  if (editing && !s.rundown.some((x) => x.id === editing.id)) editing = null;
  const offsets = plannedOffsets(s.rundown);
  dom.strips.replaceChildren(
    ...(s.rundown.length
      ? s.rundown.map((seg, i) => (editing && editing.id === seg.id ? editorItem(seg, i) : stripItem(seg, i, offsets[i])))
      : [el('li', { class: 'empty' }, 'La scaletta è vuota. Aggiungi un intervento o importa le righe da Excel.')]));

  const n = s.rundown.length;
  const total = totalSeconds(s.rundown);
  dom.summary.textContent = n === 0
    ? 'Nessun intervento'
    : `${n} ${n === 1 ? 'intervento' : 'interventi'}, durata totale ${formatDuration(total)}${s.startTime ? `, fine prevista alle ${addToClock(s.startTime, total)}` : ''}`;

  if (editing && editing.focus) {
    editing.focus = false;
    const first = dom.strips.querySelector('.strip-edit input');
    if (first) { first.focus(); first.select(); }
  }
}

function stripItem(seg, i, offset) {
  const current = i === state.index;
  const li = el('li', { class: `strip${current ? ' is-current' : ''}${i < state.index ? ' is-past' : ''}`, 'data-id': seg.id });
  const main = el('button', {
    class: 'strip-main', type: 'button', 'aria-current': current ? 'true' : null,
    title: current ? 'In onda' : 'Prepara questo intervento (non parte da solo)',
    onclick: () => send({ type: 'goto', index: i }),
  },
  el('span', { class: 'strip-index' }, i + 1),
  el('span', { class: 'strip-text' }, el('span', { class: 'strip-title' }, seg.title), el('span', { class: 'strip-sub' }, [seg.speaker, seg.notes].filter(Boolean).join(', '))),
  el('span', { class: 'strip-at', title: 'Inizio previsto' }, state.startTime ? addToClock(state.startTime, offset) : ''),
  el('span', { class: 'strip-dur' }, formatDuration(seg.duration)));

  const tool = (name, text, fn, disabled) => el('button', { class: 'btn btn-quiet', type: 'button', 'aria-label': text, title: text, disabled, onclick: fn }, icon(name));
  const tools = el('div', { class: 'strip-tools' },
    tool('up', `Sposta in su ${seg.title}`, () => send({ type: 'segment_move', id: seg.id, dir: -1 }), i === 0),
    tool('down', `Sposta in giù ${seg.title}`, () => send({ type: 'segment_move', id: seg.id, dir: 1 }), i === state.rundown.length - 1),
    tool('edit', `Modifica ${seg.title}`, () => { editing = { id: seg.id, draft: { title: seg.title, speaker: seg.speaker, duration: formatDuration(seg.duration), notes: seg.notes }, error: '', focus: true }; renderRundown(); }));
  li.append(main, tools);
  return li;
}

function editorItem(seg, i) {
  const d = editing.draft;
  const field = (labelText, key, attrs = {}) => {
    const id = `ed-${key}`;
    return el('div', { class: 'field' }, el('label', { for: id }, labelText), el('input', { class: 'input', id, value: d[key], autocomplete: 'off', oninput: (e) => { d[key] = e.target.value; }, ...attrs }));
  };
  const error = el('p', { class: 'error', role: 'alert' }, editing.error);
  const save = (e) => {
    e.preventDefault();
    const seconds = parseDuration(d.duration);
    if (seconds === null) {
      editing.error = 'Durata non valida: scrivi 5 (minuti), 5:30 oppure 1:05:00';
      error.textContent = editing.error;
      document.getElementById('ed-duration').focus();
      return;
    }
    send({ type: 'segment_update', id: seg.id, patch: { title: d.title.trim() || seg.title, speaker: d.speaker, duration: seconds, notes: d.notes } });
    editing = null;
    renderRundown();
  };
  const remove = () => {
    if (!confirm(`Eliminare "${seg.title}" dalla scaletta?`)) return;
    send({ type: 'segment_remove', id: seg.id });
    editing = null;
    renderRundown();
  };
  const form = el('form', { class: 'strip-edit', onsubmit: save, novalidate: true },
    field('Titolo', 'title', { maxlength: '80' }),
    el('div', { class: 'two' }, field('Relatore', 'speaker', { maxlength: '80' }), field('Durata', 'duration', { inputmode: 'text', placeholder: '5:00' })),
    field('Note per chi chiama i tempi', 'notes', { maxlength: '300' }),
    error,
    el('div', { class: 'edit-actions' },
      el('button', { class: 'btn btn-danger btn-small', type: 'button', onclick: remove }, icon('trash'), 'Elimina'),
      el('div', { class: 'right' },
        el('button', { class: 'btn btn-quiet', type: 'button', onclick: () => { editing = null; renderRundown(); } }, 'Annulla'),
        el('button', { class: 'btn btn-go', type: 'submit' }, 'Salva'))));
  const li = el('li', { class: `strip${i === state.index ? ' is-current' : ''}`, 'data-id': seg.id }, form);
  return li;
}

dom.btnAdd.addEventListener('click', () => {
  const id = newId();
  editing = { id, draft: { title: 'Nuovo intervento', speaker: '', duration: '5:00', notes: '' }, error: '', focus: true };
  send({ type: 'segment_add', segment: { id, title: 'Nuovo intervento', duration: 300 } });
});

// ---- comandi ----
dom.tToggle.addEventListener('click', () => send({ type: 'toggle' }));
dom.tNext.addEventListener('click', () => send({ type: 'next' }));
dom.tPrev.addEventListener('click', () => send({ type: 'prev' }));
dom.tMinus.addEventListener('click', () => send({ type: 'adjust', ms: -60000 }));
dom.tPlus.addEventListener('click', () => send({ type: 'adjust', ms: 60000 }));
dom.tReset.addEventListener('click', () => send({ type: 'reset' }));
dom.name.addEventListener('change', () => send({ type: 'meta', name: dom.name.value }));
dom.code.addEventListener('click', () => copyText(room, 'Codice copiato'));

addEventListener('keydown', (e) => {
  if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.target.closest && e.target.closest('input, textarea, select, button, [contenteditable]') && e.key === ' ') return;
  if (e.target.closest && e.target.closest('input, textarea, select, [contenteditable]')) return;
  if (document.querySelector('dialog[open]')) return;
  const keys = {
    ' ': { type: 'toggle' }, ArrowRight: { type: 'next' }, ArrowLeft: { type: 'prev' },
    '+': { type: 'adjust', ms: 60000 }, '=': { type: 'adjust', ms: 60000 }, '-': { type: 'adjust', ms: -60000 },
  };
  if (keys[e.key]) { e.preventDefault(); send(keys[e.key]); }
});

// ---- aggiornamento continuo di cifre, barra e pulsanti ----
let lastToggle = '';
function paint() {
  if (!state || !link) return;
  const d = computeDisplay(state, link.now());
  dom.onair.dataset.level = d.level;
  dom.onair.dataset.status = d.status;
  renderDigits(dom.digits, formatClock(d.ms));
  applyRail(rail, d);

  dom.nowTitle.textContent = d.segment ? d.segment.title : 'Nessun intervento in scaletta';
  dom.nowSpeaker.textContent = d.segment ? d.segment.speaker : '';
  dom.nowState.textContent = d.count ? `${stateLabel(d)}, intervento ${d.index + 1} di ${d.count}` : 'Aggiungi un intervento per iniziare';

  const running = d.status === 'running';
  const toggleText = running ? 'Pausa' : d.status === 'paused' ? 'Riprendi' : 'Avvia';
  if (toggleText !== lastToggle) {
    lastToggle = toggleText;
    label(dom.tToggle, running ? 'pause' : 'play', toggleText);
    dom.tToggle.classList.toggle('btn-go', !running);
    dom.tToggle.classList.toggle('btn-stop', running);
  }
  dom.tToggle.disabled = d.count === 0;
  dom.tPrev.disabled = d.index <= 0;
  dom.tNext.disabled = d.index >= d.count - 1;
  dom.tMinus.disabled = dom.tPlus.disabled = dom.tReset.disabled = d.count === 0;

  const cur = dom.strips.querySelector('.strip.is-current');
  if (cur) {
    cur.style.setProperty('--p', d.elapsed.toFixed(4));
    cur.dataset.status = d.status;
    cur.dataset.level = d.level;
  }
  const title = `${state.name} · Controller`;
  if (document.title !== title) document.title = title;
}
every100ms(paint);

// ---- finestre ----
document.querySelectorAll('dialog').forEach((dlg) => {
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); }); // clic sullo sfondo
  dlg.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => dlg.close()));
});

// collegamento schermi
const dlgLinks = $('#dlgLinks');
async function baseUrl() {
  if (link.mode === 'local') return { base: location.href, ips: [] };
  const local = ['localhost', '127.0.0.1', '[::1]', '::1'].includes(location.hostname);
  if (!local) return { base: location.href, ips: [] };
  try {
    const info = await (await fetch('/api/info', { cache: 'no-store' })).json();
    if (info.ips && info.ips.length) return { base: `${location.protocol}//${info.ips[0]}:${location.port || (location.protocol === 'https:' ? 443 : 80)}/`, ips: info.ips };
  } catch { /* si usa l'indirizzo corrente */ }
  return { base: location.href, ips: [] };
}
function qr(text) {
  const q = qrcode(0, 'M');
  q.addData(text);
  q.make();
  return q.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
}
dom.btnLinks.addEventListener('click', async () => {
  const { base, ips } = await baseUrl();
  const viewer = pageUrl('viewer.html', room, base);
  const moderator = pageUrl('moderator.html', room, base);
  const local = link.mode === 'local';
  dlgLinks.dataset.mode = local ? 'local' : 'server';
  $('#openViewer').href = viewer;
  $('#openModerator').href = moderator;
  $('#urlViewer').value = viewer;
  $('#urlModerator').value = moderator;
  if (!local) {
    $('#qrViewer').innerHTML = qr(viewer);
    $('#qrModerator').innerHTML = qr(moderator);
  }
  $('#linksNote').textContent = !local
    ? `Per usare altri dispositivi: devono essere sulla stessa rete Wi-Fi o hotspot di questo, non serve internet. Per usarli su questo stesso dispositivo, usa i pulsanti.${ips.length > 1 ? ` Se un indirizzo non si apre, prova con un altro di questo dispositivo: ${ips.join(', ')}.` : ''}`
    : 'Senza server gli schermi si aprono in un\'altra finestra o scheda di questo stesso browser: il codice e il QR non funzionerebbero da un altro dispositivo. Per collegare più dispositivi avvia il server con npm start.';
  dlgLinks.showModal();
});
$('#copyViewer').addEventListener('click', () => copyText($('#urlViewer').value, 'Indirizzo copiato'));
$('#copyModerator').addEventListener('click', () => copyText($('#urlModerator').value, 'Indirizzo copiato'));
for (const id of ['urlViewer', 'urlModerator']) $('#' + id).addEventListener('focus', (e) => e.target.select());

// impostazioni
const dlgSettings = $('#dlgSettings');
const set = {
  start: $('#setStart'), warn: $('#setWarn'), crit: $('#setCrit'),
  auto: $('#setAuto'), clock: $('#setClock'), speaker: $('#setSpeaker'), next: $('#setNext'),
};
function syncSettings() {
  const st = state.settings;
  const put = (input, v) => { if (document.activeElement !== input) input[input.type === 'checkbox' ? 'checked' : 'value'] = v; };
  put(set.start, state.startTime);
  put(set.warn, st.warnSec); put(set.crit, st.critSec);
  put(set.auto, st.autoAdvance); put(set.clock, st.showClock); put(set.speaker, st.showSpeaker); put(set.next, st.showNext);
}
dom.btnSettings.addEventListener('click', () => dlgSettings.showModal());
set.start.addEventListener('change', () => send({ type: 'meta', startTime: set.start.value }));
set.warn.addEventListener('change', () => send({ type: 'settings', patch: { warnSec: set.warn.value } }));
set.crit.addEventListener('change', () => send({ type: 'settings', patch: { critSec: set.crit.value } }));
set.auto.addEventListener('change', () => send({ type: 'settings', patch: { autoAdvance: set.auto.checked } }));
set.clock.addEventListener('change', () => send({ type: 'settings', patch: { showClock: set.clock.checked } }));
set.speaker.addEventListener('change', () => send({ type: 'settings', patch: { showSpeaker: set.speaker.checked } }));
set.next.addEventListener('change', () => send({ type: 'settings', patch: { showNext: set.next.checked } }));

// importazione ed esportazione
const dlgImport = $('#dlgImport');
const importText = $('#importText');
const importGo = $('#importGo');
let parsed = { segments: [], skipped: [] };
let importStart = ''; // orario di inizio letto da un PDF
function parseImport() {
  parsed = parseRundownText(importText.value);
  const n = parsed.segments.length;
  const k = parsed.skipped.length;
  $('#importSummary').textContent = !importText.value.trim() ? ''
    : n === 0 ? 'Nessun intervento riconosciuto. Controlla che ogni riga abbia una durata, per esempio 5 oppure 5:30.'
      : `Trovati ${n} ${n === 1 ? 'intervento' : 'interventi'}${k ? `. ${k === 1 ? 'Una riga ignorata' : `${k} righe ignorate`} perché senza durata valida (riga ${parsed.skipped.slice(0, 5).join(', ')}${k > 5 ? '…' : ''})` : ''}.`;
  importGo.disabled = n === 0;
  importGo.textContent = n ? `Sostituisci la scaletta con ${n} ${n === 1 ? 'intervento' : 'interventi'}` : 'Sostituisci la scaletta';
}
dom.btnImport.addEventListener('click', () => { importText.value = ''; importStart = ''; parseImport(); dlgImport.showModal(); importText.focus(); });
importText.addEventListener('input', parseImport);
$('#importFile').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
  if (file.size > (isPdf ? 15 : 1) * 1024 * 1024) { toast(`File troppo grande (massimo ${isPdf ? 15 : 1} MB)`); return; }
  if (!isPdf) { importStart = ''; importText.value = await file.text(); parseImport(); return; }
  const note = $('#importSummary');
  note.textContent = 'Leggo il PDF…';
  try {
    const prog = parseProgramLines(await pdfLines(file));
    if (!prog.segments.length) {
      importStart = ''; importText.value = ''; parseImport();
      note.textContent = 'Nel PDF non trovo un programma con gli orari. Se è una scansione o una foto non ha testo da leggere: incolla le righe a mano.';
      return;
    }
    importStart = prog.startTime;
    importText.value = rundownToCsv(prog.segments.map((x) => ({ ...x }))).replace(/^[^\n]*\n/, '');
    parseImport();
    note.textContent += ` Inizio alle ${prog.startTime}, ricavato dal PDF.${prog.guessed ? ` Per ${prog.guessed === 1 ? 'un intervento' : `${prog.guessed} interventi`} manca l'orario di fine: ho messo 10 minuti, controlla.` : ''} Puoi correggere le righe qui sopra prima di confermare.`;
  } catch {
    note.textContent = 'Non riesco a leggere questo PDF. Prova a incollare le righe a mano.';
  }
});
importGo.addEventListener('click', () => {
  if (!parsed.segments.length) return;
  send({ type: 'rundown_replace', segments: parsed.segments });
  if (importStart) send({ type: 'meta', startTime: importStart });
  editing = null;
  dlgImport.close();
  toast(`Scaletta importata: ${parsed.segments.length} ${parsed.segments.length === 1 ? 'intervento' : 'interventi'}`);
});
dom.btnExport.addEventListener('click', () => {
  const blob = new Blob(['﻿', rundownToCsv(state.rundown)], { type: 'text/csv;charset=utf-8' });
  const slug = state.name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'evento';
  // Nell'app Android i download da blob non funzionano: il salvataggio lo fa l'app (cartella Download).
  if (window.PalcoApp && typeof window.PalcoApp.saveText === 'function') {
    window.PalcoApp.saveText(`${slug}-scaletta.csv`, '\ufeff' + rundownToCsv(state.rundown));
    return;
  }
  const a = el('a', { href: URL.createObjectURL(blob), download: `${slug}-scaletta.csv` });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});
