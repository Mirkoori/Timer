import { computeDisplay, formatClock } from './core.js';
import { connect } from './sync.js';
import {
  $, roomFromUrl, renderDigits, makeRail, applyRail, stateLabel, showConn,
  keepAwake, toggleFullscreen, every100ms,
} from './ui.js';

const room = roomFromUrl();
if (!room) location.replace('index.html');

const body = document.body;
const dom = {
  title: $('#title'), speaker: $('#speaker'), clock: $('#clock'), digits: $('#digits'),
  next: $('#next'), state: $('#state'), msg: $('#msg'), msgText: $('#msgText'), conn: $('#conn'),
};
const rail = makeRail();
$('#railSlot').append(rail);

let state = null;
let lastMsgId = -1;
let lastMsgVisible = false;

const link = await connect({
  room,
  role: 'viewer',
  onStatus: (s) => showConn(dom.conn, s),
  onState: (s) => { state = s; showMessage(s); },
});

function showMessage(s) {
  const m = s.message;
  dom.msg.hidden = !m.visible;
  if (!m.visible) { lastMsgVisible = false; return; }
  dom.msgText.textContent = m.text;
  dom.msg.dataset.color = m.color;
  if (!lastMsgVisible || m.id !== lastMsgId) { // l'animazione di ingresso risponde a un nuovo messaggio
    dom.msg.classList.remove('in');
    void dom.msg.offsetWidth;
    dom.msg.classList.add('in');
  }
  lastMsgId = m.id;
  lastMsgVisible = true;
}

function paint() {
  if (!state) return;
  const now = link.now();
  const d = computeDisplay(state, now);

  body.dataset.level = d.level;
  body.dataset.status = d.status;
  renderDigits(dom.digits, formatClock(d.ms));
  applyRail(rail, d);

  dom.title.textContent = d.segment ? d.segment.title : 'Nessun intervento in scaletta';
  dom.speaker.textContent = state.settings.showSpeaker && d.segment ? d.segment.speaker : '';
  dom.state.textContent = stateLabel(d);
  dom.next.textContent = !state.settings.showNext ? '' : d.next ? `Prossimo: ${d.next.title}${d.next.speaker ? `, ${d.next.speaker}` : ''}` : d.segment ? 'Ultimo intervento' : '';
  dom.clock.textContent = state.settings.showClock ? new Date().toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }) : '';
  const title = `${state.name} · Schermo relatore`;
  if (document.title !== title) document.title = title;
}
every100ms(paint);

// comandi di servizio: si nascondono dopo tre secondi senza movimento
let hideTimer;
function showChrome() {
  body.classList.remove('idle-ui');
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => body.classList.add('idle-ui'), 3000);
}
for (const ev of ['pointermove', 'pointerdown', 'keydown']) addEventListener(ev, showChrome, { passive: true });
showChrome();

const fsBtn = $('#fs');
if (!document.fullscreenEnabled) fsBtn.hidden = true;
fsBtn.addEventListener('click', toggleFullscreen);
document.addEventListener('fullscreenchange', () => { fsBtn.textContent = document.fullscreenElement ? 'Esci da schermo intero' : 'Schermo intero'; });
addEventListener('keydown', (e) => { if (e.key === 'f' || e.key === 'F') toggleFullscreen(); });
addEventListener('dblclick', toggleFullscreen);

keepAwake();
