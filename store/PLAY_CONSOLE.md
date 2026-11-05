# Guida per il Play Console

Elenco di cosa fare e cosa rispondere. Le risposte sono quelle corrette per l'app com'è oggi: se aggiungiamo pubblicità, acquisti o account, cambiano.

## 0. Prima di iniziare
- [ ] Account sviluppatore Google Play (pagamento una tantum, verifica dell'identità).
- [ ] Nome dell'app definitivo e controllo che sia libero (su Google Play e come marchio).
- [ ] App provata su almeno due telefoni diversi.

## 1. Il pacchetto (.aab)
1. Si genera la chiave di caricamento e si salvano nel repository i quattro segreti: `UPLOAD_KEYSTORE_BASE64`, `UPLOAD_KEYSTORE_PASSWORD`, `UPLOAD_KEY_ALIAS`, `UPLOAD_KEY_PASSWORD`. (Da fare insieme quando l'account è pronto.)
2. Su GitHub: **Actions → App Android per il Play Store → Run workflow**.
3. Si scarica `palco-timer-playstore` (contiene `app-release.aab`).
4. Conserva una copia della chiave di caricamento e della sua password in un posto sicuro. Con "Play App Signing" Google tiene la chiave vera dell'app e la chiave di caricamento si può sostituire, ma è meglio non perderla.

## 1b. Prodotto in-app "Pro" (da creare prima del test)
Play Console → Monetizza → Prodotti → **Prodotti in-app** → Crea prodotto:
- ID prodotto: **`pro_unlock`** (deve essere identico, è scritto nell'app).
- Nome: *Palco Timer Pro*. Descrizione: *Scaletta senza limiti, importazione da PDF/CSV/Excel, esportazione e pagina del moderatore. Acquisto unico.*
- Prezzo: lo decidi tu (idea: tra 4,99 e 9,99 euro). Stato: **Attivo**.
- Per provare l'acquisto senza pagare: Impostazioni → **Test delle licenze** → aggiungi il tuo account Google come tester, poi installa l'app da un test chiuso.
- Nelle versioni di prova (APK) scaricate da GitHub l'acquisto non funziona: c'è un pulsante "Sblocca per prova" che serve solo a verificare le funzioni. Nei pacchetti per il Play Store quel pulsante non compare.

**Cosa è gratis e cosa è Pro (App Android):**
| | Gratis | Pro |
|---|---|---|
| Interventi in scaletta | fino a 5 | illimitati |
| Schermo relatore e messaggi predefiniti | sì | sì |
| Importa da PDF/CSV/Excel | no | sì |
| Esporta CSV | no | sì |
| Pagina del moderatore | no | sì |

L'app per computer e il sito non hanno limiti.

## 2. Test chiuso (obbligatorio per gli account personali nuovi)
- Servono almeno **12 tester** che restino iscritti **14 giorni consecutivi**, poi si chiede l'accesso alla produzione.
- Test → Test chiuso → crea la release con il `.aab` → aggiungi i tester con un elenco di email o un gruppo Google.
- I tester devono accettare l'invito e installare l'app dal Play Store.

## 3. Scheda dello store
Testi e immagini: `it-IT.md`, `icon-512.png`, `feature-1024x500.png`, `screenshots/`.
Indirizzo dell'informativa privacy: https://mirkoori.github.io/Timer/public/privacy.html

## 4. Moduli e risposte
**Contenuti dell'app**
- Accesso all'app: nessun accesso richiesto, tutte le funzioni sono disponibili.
- Annunci pubblicitari: **No**, l'app non contiene annunci.
- Acquisti in-app: **Sì** (un prodotto, acquisto unico).
- Pubblico di destinazione: **18 anni e oltre** (non rivolta ai minori).
- App di notizie / governativa / finanziaria / salute: **No**.
- Classificazione dei contenuti (questionario IARC): categoria Utility, tutte le risposte "No" (nessuna violenza, contenuti sessuali, giochi d'azzardo, acquisti, interazione tra utenti).

**Sicurezza dei dati**
- Raccoglie o condivide dati utente? **No.** Tutto resta sul dispositivo; la comunicazione avviene solo nella rete locale dell'utente, senza passare da server dello sviluppatore.
- Informativa sulla privacy: indirizzo qui sopra.
- Eliminazione dei dati: non applicabile (nessun account); si cancellano disinstallando l'app.

**Servizio in primo piano (Dichiarazione per le autorizzazioni)**
- Tipo: *special use* (uso speciale). Permesso: `FOREGROUND_SERVICE_SPECIAL_USE`.
- Perché serve: «L'app avvia sul dispositivo un server in rete locale che collega lo schermo del relatore e il moderatore al timer dell'evento. Deve restare attivo anche con lo schermo spento o con un'altra app in primo piano, altrimenti gli schermi collegati smettono di aggiornarsi durante un evento dal vivo. L'utente lo avvia aprendo l'app e lo ferma dalla notifica.»
- Video dimostrativo (da registrare, 30–60 secondi): aprire l'app e creare un evento → mostrare la notifica fissa → collegare un secondo dispositivo con il QR → avviare il timer e spegnere lo schermo del telefono → mostrare che il secondo dispositivo continua ad aggiornarsi → fermare il servizio dalla notifica.

**Permessi dichiarati nel manifest**
| Permesso | Motivo |
|---|---|
| INTERNET | Server locale e comunicazione tra la finestra dell'app e il server dell'app (su questo dispositivo). L'app non contatta server esterni. |
| ACCESS_NETWORK_STATE, ACCESS_WIFI_STATE | Trovare l'indirizzo di rete da mostrare nei QR. |
| WAKE_LOCK | Impedire che il dispositivo si addormenti durante un evento. |
| FOREGROUND_SERVICE, FOREGROUND_SERVICE_SPECIAL_USE | Tenere attivo il server (vedi sopra). |
| POST_NOTIFICATIONS | Mostrare la notifica fissa del servizio. |

## 5. Dopo il test chiuso
- [ ] Richiesta di accesso alla produzione.
- [ ] Release in produzione, con distribuzione graduale se vuoi.

## Decisioni ancora aperte
- Nome definitivo.
- Prezzo dell'acquisto Pro.
- Se i limiti gratuiti (5 interventi; niente importa/esporta/moderatore) sono quelli giusti: si cambiano in `FREE_MAX_SEGMENTS` e nei controlli di `controller.js`.
- Versione per iPhone e App Store: non prevista per ora.
