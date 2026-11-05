import { $, el, makeRoomCode, pageUrl, recentRooms } from './ui.js';

$('#new').addEventListener('click', () => { location.href = pageUrl('controller.html', makeRoomCode()); });

const form = $('#join');
const input = $('#code');
let page = 'controller.html';
form.querySelectorAll('button[data-page]').forEach((b) => b.addEventListener('click', () => { page = b.dataset.page; }));
input.addEventListener('input', () => { input.value = input.value.toUpperCase().replace(/[^A-Z0-9_-]/g, ''); });
form.addEventListener('submit', (e) => {
  e.preventDefault();
  const code = input.value.trim();
  if (code.length < 2) {
    $('#joinError').textContent = 'Scrivi il codice dell\'evento: almeno due caratteri, lettere e numeri.';
    input.focus();
    return;
  }
  location.href = pageUrl(page, code);
});

const recent = recentRooms();
if (recent.length) {
  $('#recentBlock').hidden = false;
  $('#recent').replaceChildren(...recent.map((r) =>
    el('li', {}, el('a', { href: pageUrl('controller.html', r.room) }, el('span', { class: 'rname' }, r.name || 'Evento senza nome'), el('span', { class: 'rcode' }, r.room)))));
}

// Se la pagina è servita dal server in rete locale, mostra l'indirizzo da aprire dagli altri dispositivi.
try {
  const info = await (await fetch('/api/info', { cache: 'no-store' })).json();
  if (info.app === 'palco-timer' && info.ips && info.ips.length) {
    const lan = $('#lan');
    lan.hidden = false;
    lan.replaceChildren('Dagli altri dispositivi sulla stessa rete apri ', el('strong', {}, `http://${info.ips[0]}:${info.port}`), '. Non serve internet.');
  }
} catch { /* pagina aperta senza server */ }
