# Palco Timer

Timer per eventi, pensato per agenzie, relatori e moderatori. *(Nome provvisorio.)*

Chi gestisce l'evento comanda da un dispositivo. I relatori vedono il tempo su uno schermo davanti a loro, il moderatore manda messaggi dal telefono. Funziona **in rete locale, senza internet**.

## Avvio

```bash
npm install
npm start
```

Il server stampa due indirizzi: quello locale e quello di rete (es. `http://192.168.1.20:3000`). Apri la home, crea un evento, poi da "Collega schermi" inquadra i QR con gli altri dispositivi, che devono stare sulla stessa rete Wi-Fi o hotspot.

Porta diversa: `PORT=3100 npm start`.

## Pagine e ruoli

| Pagina | Ruolo | Cosa può fare |
|---|---|---|
| `controller.html` | Controller | Tutto: avvio, pausa, scaletta, messaggi, impostazioni |
| `viewer.html` | Schermo relatore | Solo guardare: tempo, barra, prossimo intervento, messaggi |
| `moderator.html` | Moderatore | Vede il tempo e manda/nasconde messaggi |

Il ruolo oggi è nell'indirizzo (parametro dell'URL), senza PIN: va bene per una rete di fiducia.

## Scorciatoie (controller)

- Barra spaziatrice: avvia / pausa
- Frecce destra e sinistra: intervento successivo / precedente
- `+` e `−`: aggiunge o toglie un minuto

Sullo schermo relatore: `F` o doppio clic per lo schermo intero.

## Importare ed esportare la scaletta

**Da PDF.** In "Importa" scegli il programma in PDF: l'app legge il testo sul dispositivo (senza internet), riconosce le righe con l'orario (`10:05  Titolo`, relatori sulla riga sotto), calcola le durate dall'orario successivo e imposta l'ora di inizio. Prima di confermare vedi un'anteprima modificabile. Funziona con PDF che contengono testo; le scansioni e le foto no. Una riga finale tipo "Chiusura dei lavori" dà la fine all'ultimo intervento e non diventa un intervento.

**Da CSV o testo.**

CSV o TSV, una riga per intervento: `titolo;relatore;durata;note`. La durata accetta `5`, `5:30`, `1:05:00`, `90s`, `5m`. L'intestazione è facoltativa. L'esportazione usa `;` ed è aperta correttamente da Excel.

## Come funziona

- `public/js/core.js`: logica pura e condivisa (stato, azioni, display). Il timer usa un istante di fine assoluto, quindi ogni schermo calcola il tempo da solo e non si sfasa se la rete cade un attimo.
- `server.js`: file statici, WebSocket, stanze, salvataggio in `data/rooms.json`.
- `public/js/sync.js`: modalità server, oppure modalità locale (più schede dello stesso browser, via BroadcastChannel) se la pagina è aperta senza server.
- Nessuna dipendenza esterna a runtime: font, QR e lettore PDF (Mozilla pdf.js, Apache-2.0) sono inclusi.

## Test

```bash
npm test
```

## Limiti noti

- Ruoli senza PIN o token.
- Il blocco dello standby richiede HTTPS o localhost; nell'app Android si userà quello nativo.
- In modalità locale c'è una sola scheda controller per stanza.
- Il lettore PDF non fa il riconoscimento dei caratteri: scansioni e foto vanno incollate a mano.
- Manca l'indicatore di anticipo/ritardo rispetto all'orario previsto.

## Prossimi passi

1. Pacchetto Android: server incorporato nell'app, che fa da host; gli altri dispositivi si collegano da browser.
2. Schermo sempre acceso in modo nativo.
3. PIN o token per i ruoli.
4. Indicatore di anticipo/ritardo.
5. Versione Pro a pagamento (una tantum).
