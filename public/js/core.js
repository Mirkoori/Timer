// core.js — logica pura del timer, condivisa da server, controller e schermi.
// Nessun accesso a DOM, rete o orologio: l'ora arriva sempre come parametro `now` (ms).
// Così lo stesso codice gira nel browser, in Node e (in futuro) dentro l'app Android.

export const MODERATOR_ACTIONS = new Set(['message_show', 'message_hide']);
export const MESSAGE_COLORS = ['info', 'warn', 'alert'];
export const MAX_SEGMENTS = 500;
export const MAX_SECONDS = 24 * 3600;

/** Chi può inviare quale azione. Il controller può tutto, il moderatore solo i messaggi. */
export function canSend(role, type) {
  return role === 'controller' || (role === 'moderator' && MODERATOR_ACTIONS.has(type));
}

export function newId() {
  return Math.random().toString(36).slice(2, 9);
}

// ---------- sanitizzazione ----------

const str = (v, max) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
const int = (v, min, max, fallback) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

export function makeSegment(input = {}, id = newId()) {
  return {
    id: str(input.id, 24) || id,
    title: str(input.title, 80) || 'Nuovo intervento',
    speaker: str(input.speaker, 80),
    duration: int(input.duration, 0, MAX_SECONDS, 300),
    notes: str(input.notes, 300),
  };
}

// ---------- stato ----------

export function defaultState() {
  const rundown = [
    makeSegment({ title: 'Apertura e saluti', speaker: 'Moderatore', duration: 300 }),
    makeSegment({ title: 'Keynote', speaker: 'Relatore ospite', duration: 1200 }),
    makeSegment({ title: 'Tavola rotonda', speaker: 'Panel', duration: 1800 }),
    makeSegment({ title: 'Domande dal pubblico', speaker: 'Moderatore', duration: 600 }),
  ];
  return {
    rev: 0,
    name: 'Nuovo evento',
    startTime: '', // 'HH:MM' oppure vuoto
    rundown,
    index: 0,
    timer: { status: 'idle', endsAt: null, remainingMs: rundown[0].duration * 1000 },
    message: { id: 0, text: '', color: 'info', visible: false },
    settings: {
      warnSec: 120,
      critSec: 30,
      autoAdvance: false,
      showClock: true,
      showNext: true,
      showSpeaker: true,
    },
  };
}

const segMs = (s, i = s.index) => (s.rundown[i] ? s.rundown[i].duration * 1000 : 0);

/** Millisecondi rimanenti (negativi = overtime). */
export function remaining(state, now) {
  const t = state.timer;
  return t.status === 'running' ? t.endsAt - now : t.remainingMs;
}

function loadSegment(s, index, run, now) {
  s.index = index;
  const d = segMs(s);
  s.timer = run
    ? { status: 'running', endsAt: now + d, remainingMs: d }
    : { status: 'idle', endsAt: null, remainingMs: d };
}

/**
 * Applica un'azione e restituisce il nuovo stato.
 * Se l'azione non cambia nulla (o è sconosciuta) restituisce lo STESSO oggetto `state`.
 */
export function reduce(state, action, now) {
  if (!action || typeof action.type !== 'string') return state;
  const s = structuredClone(state);
  const t = s.timer;
  const last = s.rundown.length - 1;

  switch (action.type) {
    case 'start': {
      if (t.status === 'running' || s.rundown.length === 0) return state;
      s.timer = { status: 'running', endsAt: now + t.remainingMs, remainingMs: t.remainingMs };
      break;
    }
    case 'pause': {
      if (t.status !== 'running') return state;
      s.timer = { status: 'paused', endsAt: null, remainingMs: t.endsAt - now };
      break;
    }
    case 'toggle':
      return reduce(state, { type: t.status === 'running' ? 'pause' : 'start' }, now);
    case 'reset': {
      if (s.rundown.length === 0) return state;
      loadSegment(s, s.index, false, now);
      break;
    }
    case 'next': {
      if (s.index >= last) return state;
      loadSegment(s, s.index + 1, t.status === 'running', now);
      break;
    }
    case 'prev': {
      if (s.index <= 0) return state;
      loadSegment(s, s.index - 1, t.status === 'running', now);
      break;
    }
    case 'goto': {
      const i = int(action.index, 0, Math.max(0, last), -1);
      if (i < 0 || !s.rundown[i]) return state;
      loadSegment(s, i, false, now); // selezionare non avvia mai: evita partenze accidentali
      break;
    }
    case 'adjust': {
      const ms = int(action.ms, -3600000, 3600000, 0);
      if (ms === 0 || s.rundown.length === 0) return state;
      if (t.status === 'running') t.endsAt += ms;
      else t.remainingMs += ms;
      break;
    }
    case 'segment_add': {
      if (s.rundown.length >= MAX_SEGMENTS) return state;
      s.rundown.push(makeSegment(action.segment || {}));
      if (s.rundown.length === 1) loadSegment(s, 0, false, now);
      break;
    }
    case 'segment_update': {
      const i = s.rundown.findIndex((x) => x.id === action.id);
      if (i < 0 || typeof action.patch !== 'object' || !action.patch) return state;
      const seg = s.rundown[i];
      const before = seg.duration;
      const p = action.patch;
      if ('title' in p) seg.title = str(p.title, 80) || seg.title;
      if ('speaker' in p) seg.speaker = str(p.speaker, 80);
      if ('notes' in p) seg.notes = str(p.notes, 300);
      if ('duration' in p) seg.duration = int(p.duration, 0, MAX_SECONDS, seg.duration);
      // Cambiare la durata del segmento in corso aggiunge/toglie tempo.
      if (i === s.index && seg.duration !== before) {
        const delta = (seg.duration - before) * 1000;
        if (t.status === 'running') t.endsAt += delta;
        else t.remainingMs += delta;
      }
      break;
    }
    case 'segment_remove': {
      const i = s.rundown.findIndex((x) => x.id === action.id);
      if (i < 0) return state;
      s.rundown.splice(i, 1);
      if (s.rundown.length === 0) {
        s.index = 0;
        s.timer = { status: 'idle', endsAt: null, remainingMs: 0 };
      } else if (i < s.index) {
        s.index -= 1;
      } else if (i === s.index) {
        loadSegment(s, Math.min(s.index, s.rundown.length - 1), false, now);
      }
      break;
    }
    case 'segment_move': {
      const i = s.rundown.findIndex((x) => x.id === action.id);
      const j = i + (action.dir < 0 ? -1 : 1);
      if (i < 0 || j < 0 || j >= s.rundown.length) return state;
      const currentId = s.rundown[s.index]?.id;
      [s.rundown[i], s.rundown[j]] = [s.rundown[j], s.rundown[i]];
      s.index = Math.max(0, s.rundown.findIndex((x) => x.id === currentId)); // il segmento in onda resta lo stesso
      break;
    }
    case 'rundown_replace': {
      if (!Array.isArray(action.segments)) return state;
      const seen = new Set();
      s.rundown = action.segments.slice(0, MAX_SEGMENTS).map((x) => {
        const seg = makeSegment(x);
        if (seen.has(seg.id)) seg.id = newId();
        seen.add(seg.id);
        return seg;
      });
      loadSegment(s, 0, false, now);
      break;
    }
    case 'meta': {
      if ('name' in action) s.name = str(action.name, 80) || s.name;
      if ('startTime' in action) s.startTime = /^([01]\d|2[0-3]):[0-5]\d$/.test(action.startTime) ? action.startTime : '';
      break;
    }
    case 'message_show': {
      const text = str(action.text, 160);
      if (!text) return state;
      const color = MESSAGE_COLORS.includes(action.color) ? action.color : 'info';
      s.message = { id: s.message.id + 1, text, color, visible: true };
      break;
    }
    case 'message_hide': {
      if (!s.message.visible) return state;
      s.message.visible = false;
      break;
    }
    case 'settings': {
      const p = action.patch || {};
      const st = s.settings;
      if ('warnSec' in p) st.warnSec = int(p.warnSec, 0, 3600, st.warnSec);
      if ('critSec' in p) st.critSec = int(p.critSec, 0, 3600, st.critSec);
      for (const k of ['autoAdvance', 'showClock', 'showNext', 'showSpeaker']) {
        if (k in p) st[k] = !!p[k];
      }
      break;
    }
    default:
      return state;
  }
  s.rev = state.rev + 1;
  return s;
}

/**
 * Avanzamento automatico: se è attivo e il tempo è scaduto, passa al segmento successivo
 * partendo dall'istante esatto di scadenza (la scaletta non accumula ritardo).
 */
export function tick(state, now) {
  if (state.timer.status !== 'running' || !state.settings.autoAdvance) return state;
  let s = state;
  let guard = s.rundown.length;
  while (guard-- > 0 && s.timer.status === 'running' && s.timer.endsAt - now <= 0 && s.index < s.rundown.length - 1) {
    s = reduce(s, { type: 'next' }, s.timer.endsAt);
  }
  return s;
}

// ---------- visualizzazione ----------

/** Tutto ciò che serve a uno schermo per disegnare il tempo. */
export function computeDisplay(state, now) {
  const seg = state.rundown[state.index] || null;
  const total = (seg ? seg.duration : 0) * 1000;
  const ms = remaining(state, now);
  const status = state.timer.status;
  // Le soglie non possono superare metà (avviso) e un quarto (critico) della durata.
  const warnMs = Math.min(state.settings.warnSec * 1000, total * 0.5);
  const critMs = Math.min(state.settings.critSec * 1000, warnMs, total * 0.25);

  let level = 'ok';
  if (status === 'idle') level = 'idle';
  else if (ms < 0) level = 'over';
  else if (ms <= critMs) level = 'crit';
  else if (ms <= warnMs) level = 'warn';

  const elapsed = total > 0 ? Math.min(1, Math.max(0, 1 - ms / total)) : 0;
  return {
    ms,
    status,
    level,
    elapsed,
    warnAt: total > 0 ? 1 - warnMs / total : 1,
    critAt: total > 0 ? 1 - critMs / total : 1,
    segment: seg,
    next: state.rundown[state.index + 1] || null,
    index: state.index,
    count: state.rundown.length,
  };
}

/** m:ss oppure h:mm:ss. Il countdown arrotonda per eccesso; in overtime tronca e mette il segno meno. */
export function formatClock(ms) {
  const n = ms >= 0 ? Math.ceil(ms / 1000) : Math.trunc(ms / 1000);
  const neg = n < 0;
  const a = Math.abs(n);
  const h = Math.floor(a / 3600);
  const m = Math.floor((a % 3600) / 60);
  const sec = a % 60;
  const body = h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
  return (neg ? '−' : '') + body;
}

export function formatDuration(totalSec) {
  const a = Math.max(0, Math.round(totalSec));
  const h = Math.floor(a / 3600);
  const m = Math.floor((a % 3600) / 60);
  const s = a % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

/** "5" = 5 minuti, "5:30" = 5 min 30 s, "1:05:00" = 1 h 5 min, "90s", "5m". Restituisce secondi o null. */
export function parseDuration(input) {
  const v = String(input ?? '').trim().toLowerCase().replace(',', '.').replace(/['’]/g, 'm');
  if (!v) return null;
  let sec = null;
  if (/^\d+(\.\d+)?$/.test(v)) sec = parseFloat(v) * 60;
  else if (/^\d+(\.\d+)?m$/.test(v)) sec = parseFloat(v) * 60;
  else if (/^\d+s$/.test(v)) sec = parseInt(v, 10);
  else if (/^\d+:\d{1,2}$/.test(v)) {
    const [m, s] = v.split(':').map(Number);
    if (s < 60) sec = m * 60 + s;
  } else if (/^\d+:\d{1,2}:\d{1,2}$/.test(v)) {
    const [h, m, s] = v.split(':').map(Number);
    if (m < 60 && s < 60) sec = h * 3600 + m * 60 + s;
  }
  if (sec === null || !Number.isFinite(sec)) return null;
  sec = Math.round(sec);
  return sec >= 0 && sec <= MAX_SECONDS ? sec : null;
}

/** Secondi di inizio previsto di ogni segmento, dall'inizio dell'evento. */
export function plannedOffsets(rundown) {
  let acc = 0;
  return rundown.map((seg) => {
    const start = acc;
    acc += seg.duration;
    return start;
  });
}

export function totalSeconds(rundown) {
  return rundown.reduce((a, s) => a + s.duration, 0);
}

/** 'HH:MM' + secondi → 'HH:MM' (oltre la mezzanotte riparte da 00:00). */
export function addToClock(hhmm, seconds) {
  const [h, m] = hhmm.split(':').map(Number);
  const mins = (h * 60 + m + Math.floor(seconds / 60)) % (24 * 60);
  return `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
}

// ---------- CSV ----------

function splitRows(text, delim) {
  const rows = [];
  let row = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') quoted = false;
      else cur += c;
    } else if (c === '"' && cur === '') quoted = true;
    else if (c === delim) { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cur); cur = '';
      rows.push(row); row = [];
    } else cur += c;
  }
  row.push(cur);
  rows.push(row);
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

/**
 * Legge una scaletta da CSV/TSV (anche incollata da Excel).
 * Colonne: titolo, relatore, durata, note. Con due colonne: titolo, durata.
 * Restituisce { segments, skipped } dove skipped sono le righe senza durata valida.
 */
export function parseRundownText(text) {
  const clean = String(text ?? '').replace(/^﻿/, '');
  const firstLine = clean.split(/\r?\n/).find((l) => l.trim()) || '';
  const counts = { '\t': 0, ';': 0, ',': 0 };
  for (const ch of firstLine) if (ch in counts) counts[ch]++;
  const delim = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][1] > 0
    ? Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0]
    : ';';
  const rows = splitRows(clean, delim);
  const segments = [];
  const skipped = [];
  rows.forEach((r, n) => {
    const cells = r.map((c) => c.trim());
    let title, speaker = '', dur, notes = '';
    if (cells.length >= 3) [title, speaker, dur, notes = ''] = cells;
    else [title, dur] = cells;
    const seconds = parseDuration(dur);
    if (seconds === null) {
      if (n > 0) skipped.push(n + 1); // la prima riga senza durata valida è l'intestazione
      return;
    }
    segments.push({ title, speaker, duration: seconds, notes });
  });
  return { segments, skipped };
}

export function rundownToCsv(rundown) {
  const q = (v) => (/[;"\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const lines = ['titolo;relatore;durata;note'];
  for (const s of rundown) lines.push([q(s.title), q(s.speaker), formatDuration(s.duration), q(s.notes)].join(';'));
  return lines.join('\r\n') + '\r\n';
}
