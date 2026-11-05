// pro.js — stato dell'acquisto "Pro" nell'app Android (window.PalcoApp la mette a disposizione l'app).
// Sul sito e nell'app per computer non c'è l'app Android: tutto è sbloccato.

const app = typeof window !== 'undefined' ? window.PalcoApp : undefined;

/** Vero solo dentro l'app Android. */
export const inApp = !!(app && typeof app.isPro === 'function');

function call(name, fallback) {
  try { return inApp && typeof app[name] === 'function' ? app[name]() : fallback; } catch { return fallback; }
}

export const isPro = () => (inApp ? !!call('isPro', false) : true);
export const price = () => String(call('price', '') || '');
export const isDebug = () => !!call('isDebug', false);
export const buy = () => { call('buy'); };
export const restore = () => { call('restore'); };
export const debugSetPro = (value) => { try { if (inApp) app.debugSetPro(!!value); } catch { /* nessun effetto */ } };

/** L'app avvisa la pagina quando l'acquisto cambia. */
export const onProChange = (fn) => window.addEventListener('palco-pro', fn);
