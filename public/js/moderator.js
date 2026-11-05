import { computeDisplay, formatClock } from './core.js';
import { connect } from './sync.js';
import { mountMessages } from './messages.js';
import { $, roomFromUrl, showConn, renderDigits, makeRail, applyRail, stateLabel, every100ms } from './ui.js';

const room = roomFromUrl();
if (!room) location.replace('index.html');

const glance = $('#glance');
const rail = makeRail();
$('#railSlot').append(rail);

let link = null;
let state = null;
const updateMessages = mountMessages($('#messages'), (action) => { if (link) link.send(action); });

link = await connect({
  room,
  role: 'moderator',
  onStatus: (s) => showConn($('#conn'), s),
  onState: (s) => { state = s; updateMessages(s); $('#evName').textContent = s.name; paint(); },
});

function paint() {
  if (!state || !link) return;
  const d = computeDisplay(state, link.now());
  glance.dataset.level = d.level;
  glance.dataset.status = d.status;
  renderDigits($('#gDigits'), formatClock(d.ms));
  applyRail(rail, d);
  $('#gTitle').textContent = d.segment ? d.segment.title : 'Nessun intervento in scaletta';
  $('#gSpeaker').textContent = d.segment ? d.segment.speaker : '';
  $('#gState').textContent = d.count ? `${stateLabel(d)}, intervento ${d.index + 1} di ${d.count}` : '';
  const title = `${state.name} · Moderatore`;
  if (document.title !== title) document.title = title;
}
every100ms(paint);
