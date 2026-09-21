# Hotfix conteggio persone

Correzione del 21/09/2026:

- `guest_count` rappresenta il totale delle persone prenotate.
- Nel gestionale il totale NON deve essere `guest_count + 1`.
- Esempio: `guest_count = 2` => Persone = 2, Acconto = €40, Check-in = 0/2.
- Aggiunto cache-busting agli asset (`?v=20260921-2035`) per evitare che GitHub Pages/browser continui a servire una vecchia versione di `admin.js`.

Per applicare il fix su GitHub è sufficiente sostituire almeno `admin.js` e `admin.html`. Non serve eseguire nuovamente lo schema SQL se il check-in mostra già `0/2` per una prenotazione da 2 persone.
