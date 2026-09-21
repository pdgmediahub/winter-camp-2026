# Winter Camp V4 — notifiche, email, pagamento e camere

Questa versione aggiunge:

- email all'organizzazione ad ogni nuova prenotazione;
- centro notifiche persistente nel gestionale con badge non letti;
- notifica browser in tempo reale quando il gestionale è aperto;
- stato email PDF `Inviata / Non inviata`;
- pulsante `Reinvia PDF`;
- conferma manuale del pagamento con data e operatore;
- assegnazione Hotel e Camera dalla modifica prenotazione;
- Hotel/Camera visibili nel Check-in Hotel;
- esportazione Excel aggiornata con email, pagamento, hotel e camera.

## AGGIORNAMENTO DI UN'INSTALLAZIONE ESISTENTE

1. Supabase > SQL Editor > New query.
2. Incolla ed esegui `UPDATE_V4_GESTIONALE.sql`.
3. Sostituisci su GitHub almeno: `admin.html`, `admin.js`, `admin.css`. È consigliato caricare tutti i file della cartella.
4. Supabase > Edge Functions > `send-booking-confirmation` > editor: sostituisci il contenuto con `supabase/functions/send-booking-confirmation/index.ts` e fai Deploy.
5. Nei Secrets della Edge Function aggiungi:
   - `ADMIN_NOTIFICATION_EMAIL` = la/e email che devono ricevere ogni nuova prenotazione. Più indirizzi possono essere separati da virgola.
   - opzionale `ADMIN_PANEL_URL` = URL completo del tuo `admin.html` su GitHub Pages.
6. Mantieni i secret che già usi: `RESEND_API_KEY`, `EMAIL_FROM`, `REPLY_TO_EMAIL`.
7. Assicurati che `Verify JWT` della funzione resti OFF, come nella configurazione già funzionante.
8. Apri il gestionale e clicca la campanella per autorizzare le notifiche browser.

## NOTIFICHE

La notifica dentro il gestionale è persistente nel database e compare nel centro notifiche anche se non eri davanti alla pagina al momento dell'iscrizione. Se il gestionale è aperto, compare anche un toast e, se autorizzato dal browser, una notifica di sistema.

L'email amministrativa è indipendente dal centro notifiche e viene inviata una sola volta per ogni nuova prenotazione.

## REINVIO PDF

Il pulsante `Reinvia PDF` usa la sessione dell'amministratore e forza un nuovo invio del PDF al partecipante. Il numero totale di invii viene registrato in `confirmation_email_count` ed esportato nell'Excel.

## HOTEL / CAMERA

Apri `Modifica` su una prenotazione e compila i campi `Hotel` e `Camera`. L'assegnazione compare automaticamente anche nella sezione Check-in Hotel.
