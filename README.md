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

## App per computer (Windows, Mac, Linux)

È la stessa app con il server incorporato: si installa, si apre, e fa da controller principale.
- Gli schermi (relatore, moderatore) si aprono su altri dispositivi con il QR, sulla stessa rete Wi-Fi o hotspot, oppure su questo stesso computer con i pulsanti "Apri lo schermo relatore" (finestra a parte, da trascinare sul proiettore).
- Lo schermo del computer non va in standby mentre l'app è aperta.
- Gli eventi si salvano nella cartella dati dell'app.
- Al primo avvio Windows chiede di consentire l'accesso alla rete: va consentito, altrimenti gli altri dispositivi non si collegano.

Provarla dal codice: `npm install && npm run desktop`.
Creare gli installer: su GitHub, scheda **Actions → App per computer → Run workflow** (oppure creando un tag `v0.2.0`, che li allega anche alla Release). Scarichi i file `.exe`, `.dmg` e `.AppImage` da quella pagina.

## App Android

Il telefono o il tablet fa da controller principale e da host: l'app contiene un piccolo server (Java, `android/`) che serve le pagine e fa da ponte. Lo stato e il timer li tiene il controller dentro l'app; schermo relatore e moderatore si aprono nel browser, sullo stesso telefono oppure su altri dispositivi collegati alla stessa Wi-Fi o all'hotspot del telefono, con il QR.

- Una notifica fissa tiene attivo il server anche a schermo spento; da lì si ferma ("Ferma").
- Lo schermo resta acceso mentre il controller è aperto.
- "Esporta" salva il CSV nella cartella Download.
- Versione di prova: scarica `palco-timer.apk` da https://github.com/Mirkoori/Timer/releases/tag/android-test (si crea da **Actions → App Android → Run workflow**).
- L'APK è firmato con una chiave di prova inclusa nel repository: va bene per i test; per il Play Store servirà una chiave privata vera.

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

1. Provare l'app Android su telefoni diversi e rifinirla (le versioni per computer e Android ci sono già).
2. Schermo sempre acceso in modo nativo.
3. PIN o token per i ruoli.
4. Indicatore di anticipo/ritardo.
5. Versione Pro a pagamento (una tantum).
