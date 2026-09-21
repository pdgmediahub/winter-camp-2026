# Winter Camp 2026 — Booking + Control Room

Sistema statico compatibile con **GitHub Pages** con backend **Supabase**.

## Modulo pubblico

- Prenotazione responsive da PC e smartphone.
- Campi obbligatori con asterisco rosso.
- Calcolo automatico acconto: €20 per persona.
- Upload distinta PDF/JPG/PNG/WEBP max 10 MB.
- Pulsante **Copia** su IBAN e Intestazione.
- Salvataggio live su Supabase.
- PDF riepilogativo via email tramite Edge Function + Resend.

## Mini gestionale / Control Room

URL: `admin.html`

### Prenotazioni

- Login amministratore.
- Elenco live di tutte le prenotazioni.
- Ricerca per nome, email, telefono e chiesa.
- Filtri per chiesa e stato.
- **Inserimento manuale** di una prenotazione.
- **Modifica** di una prenotazione.
- **Eliminazione** definitiva con cancellazione automatica dei partecipanti check-in collegati.
- Apertura distinta di bonifico privata.
- Stato prenotazione: Ricevuta / Confermata / Annullata.
- Origine: Online / Manuale.
- Dashboard con prenotazioni, persone, check-in e acconti.

### Check-in Hotel

Il database crea automaticamente una riga check-in per il referente e una per ogni ospite.

- Ricerca istantanea.
- Filtro per chiesa.
- Filtro Presenti / Assenti / Da verificare.
- Check-in singolo con un click.
- Annullamento check-in.
- Registrazione automatica di **orario e operatore**.
- Stato visivo: verde presente, neutro assente, giallo problema.
- Avanzamento gruppo/famiglia, es. `2/4 presenti`.
- Statistiche live presenti / assenti / problemi.
- Sincronizzazione Supabase Realtime, quindi più operatori possono lavorare contemporaneamente.
- Interfaccia responsive PC / Mac / tablet / smartphone.

### Excel

`Scarica Excel` genera un unico file `.xlsx` con due fogli:

1. **Prenotazioni**
2. **Check-in Hotel**

Il file viene generato con i dati presenti nel database in quel momento.

---

## 1. Database Supabase

Apri **Supabase > SQL Editor** ed esegui `schema.sql`.

Lo script è pensato anche come aggiornamento della versione precedente: aggiunge le nuove colonne, la tabella `registration_participants`, le policy admin e la sincronizzazione automatica referente/ospiti.

> Prima di applicarlo su un database già in produzione è comunque consigliato esportare un backup.

## 2. Utente amministratore

Crea l'utente in **Authentication > Users**, poi esegui:

```sql
insert into public.admin_users(email)
values ('LA_TUA_EMAIL_ADMIN')
on conflict do nothing;
```

Puoi aggiungere più operatori creando più utenti Auth e più email in `admin_users`.

## 3. Configurazione frontend

In `config.js` inserisci solo:

```js
window.APP_CONFIG = {
  SUPABASE_URL: "https://TUO-PROGETTO.supabase.co",
  SUPABASE_ANON_KEY: "LA_TUA_ANON_KEY"
};
```

Non inserire mai la `service_role` su GitHub.

## 4. PDF email

La funzione è in:

`supabase/functions/send-booking-confirmation/index.ts`

Secrets richiesti:

```bash
supabase secrets set RESEND_API_KEY="re_xxxxxxxxx"
supabase secrets set EMAIL_FROM="Winter Camp <prenotazioni@tuodominio.it>"
supabase secrets set REPLY_TO_EMAIL="tuaemail@tuodominio.it"
```

Deploy:

```bash
supabase functions deploy send-booking-confirmation --no-verify-jwt
```

## 5. GitHub Pages

Carica il contenuto della cartella nella root del repository e abilita:

**Settings > Pages > Deploy from a branch > main > /(root)**

- Modulo pubblico: `https://...github.io/.../`
- Gestionale: `https://...github.io/.../admin.html`

## Nota importante sui dati ospiti

Per il check-in individuale il campo ospiti deve contenere **una persona per riga**, preferibilmente nel formato:

```text
Mario Rossi, 01/01/2000
Luisa Bianchi, 15/05/2010
```

Il gestionale usa queste righe per creare automaticamente i singoli partecipanti del gruppo.

## Correzione conteggio acconto
In questa versione `guest_count` è il numero di persone prenotate ai fini dell'acconto: 2 persone = €40,00. Il referente che compila il modulo non viene aggiunto automaticamente al totale o al check-in.
