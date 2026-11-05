// messages.js — pannello per scrivere sullo schermo del relatore.
// Usato sia dal controller sia dalla pagina del moderatore.
import { el, icon } from './ui.js';

export const PRESETS = [
  { text: 'Chiudi in 2 minuti', color: 'warn' },
  { text: 'Ultimo minuto', color: 'warn' },
  { text: 'Concludi ora', color: 'alert' },
  { text: 'Avvicinati al microfono', color: 'info' },
  { text: 'Domande dal pubblico', color: 'info' },
  { text: 'Pausa di 5 minuti', color: 'info' },
];

const COLOR_LABEL = { info: 'Informazione', warn: 'Attenzione', alert: 'Urgente' };

/** Costruisce il pannello dentro `root` e restituisce `update(state)`. `send(action)` invia le azioni. */
export function mountMessages(root, send) {
  const presetButtons = PRESETS.map((p) =>
    el('button', {
      class: 'preset', type: 'button', 'data-color': p.color, 'aria-pressed': 'false',
      onclick: () => send({ type: 'message_show', text: p.text, color: p.color }),
    }, p.text));

  const input = el('input', {
    class: 'input', type: 'text', maxlength: '160', autocomplete: 'off',
    placeholder: 'Scrivi un messaggio per il palco', 'aria-label': 'Testo del messaggio',
  });
  let color = 'info';
  const chips = Object.entries(COLOR_LABEL).map(([key, label]) => {
    const radio = el('input', { type: 'radio', name: 'msg-color-' + root.id, value: key, checked: key === color, onchange: () => { color = key; } });
    return el('label', { class: 'chip', 'data-color': key }, radio, el('span', {}, label));
  });

  const form = el('form', {
    class: 'custom',
    onsubmit: (e) => {
      e.preventDefault();
      const text = input.value.trim();
      if (!text) { input.focus(); return; }
      send({ type: 'message_show', text, color });
      input.value = '';
    },
  },
  el('div', { class: 'field' }, el('label', {}, 'Messaggio libero'), input),
  el('div', { class: 'custom-row' },
    el('div', { class: 'chips', role: 'radiogroup', 'aria-label': 'Urgenza' }, chips),
    el('button', { class: 'btn btn-go', type: 'submit' }, icon('send'), 'Mostra sul palco')));

  const liveText = el('strong', {});
  const live = el('div', { class: 'live', hidden: true },
    el('p', {}, 'Sul palco ora: ', liveText),
    el('button', { class: 'btn', type: 'button', onclick: () => send({ type: 'message_hide' }) }, icon('eyeoff'), 'Nascondi'));

  root.replaceChildren(
    live,
    el('div', { class: 'presets' }, presetButtons),
    form);

  return function update(state) {
    const m = state.message;
    live.hidden = !m.visible;
    live.dataset.color = m.color;
    liveText.textContent = m.text;
    presetButtons.forEach((b, i) => b.setAttribute('aria-pressed', String(m.visible && m.text === PRESETS[i].text)));
  };
}
