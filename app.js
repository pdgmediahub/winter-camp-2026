const { SUPABASE_URL, SUPABASE_ANON_KEY } = window.APP_CONFIG || {};
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const form = document.getElementById('bookingForm');
const guestCount = document.getElementById('guestCount');
const guestDetailsWrap = document.getElementById('guestDetailsWrap');
const guestDetails = document.getElementById('guestDetails');
const amountBox = document.getElementById('amountBox');
const receipt = document.getElementById('receipt');
const fileName = document.getElementById('fileName');
const submitButton = document.getElementById('submitButton');
const formMessage = document.getElementById('formMessage');

function showMessage(type, text){
  formMessage.className = `message ${type}`;
  formMessage.textContent = text;
}

function updateGuests(){
  const n = Number(guestCount.value || 0);
  const people = n;
  amountBox.querySelector('strong').textContent = `€${(people * 20).toFixed(2).replace('.', ',')}`;
  if(n > 0){
    guestDetailsWrap.classList.remove('hidden');
    guestDetails.required = true;
  } else {
    guestDetailsWrap.classList.add('hidden');
    guestDetails.required = false;
    guestDetails.value = '';
  }
}

guestCount.addEventListener('change', updateGuests);
receipt.addEventListener('change', () => {
  fileName.textContent = receipt.files?.[0]?.name || 'Nessun file selezionato';
});

function sanitizeName(name){
  return name.normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-zA-Z0-9._-]/g,'_');
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  formMessage.className = 'message';

  if(!form.reportValidity()) return;
  if(!SUPABASE_URL || !SUPABASE_ANON_KEY || SUPABASE_URL.includes('YOUR_PROJECT')){
    showMessage('error','Configurazione Supabase non completata.');
    return;
  }

  const file = receipt.files[0];
  if(!file){
    showMessage('error','Allega la distinta di bonifico.');
    return;
  }
  const allowed = ['application/pdf','image/jpeg','image/png','image/webp'];
  if(!allowed.includes(file.type)){
    showMessage('error','Formato allegato non valido. Usa PDF, JPG, PNG o WEBP.');
    return;
  }
  if(file.size > 10 * 1024 * 1024){
    showMessage('error','Il file supera il limite di 10 MB.');
    return;
  }

  submitButton.disabled = true;
  submitButton.textContent = 'Invio in corso…';

  let uploadedPath = null;
  try{
    const id = crypto.randomUUID();
    const ext = file.name.split('.').pop()?.toLowerCase() || 'file';
    uploadedPath = `${new Date().getFullYear()}/${id}-${sanitizeName(file.name.replace(/\.[^.]+$/, ''))}.${ext}`;

    const { error: uploadError } = await supabaseClient.storage
      .from('payment-receipts')
      .upload(uploadedPath, file, { cacheControl: '3600', upsert: false, contentType: file.type });
    if(uploadError) throw uploadError;

    const nGuests = Number(guestCount.value);
    const payload = {
      first_name: document.getElementById('firstName').value.trim(),
      last_name: document.getElementById('lastName').value.trim(),
      email: document.getElementById('email').value.trim().toLowerCase(),
      phone: document.getElementById('phone').value.trim(),
      is_minister: document.getElementById('minister').value === 'si',
      church: document.getElementById('church').value.trim(),
      guest_count: nGuests,
      guest_details: nGuests > 0 ? guestDetails.value.trim() : null,
      receipt_path: uploadedPath,
      deposit_amount: nGuests * 20
    };

    const { data: inserted, error: insertError } = await supabaseClient
      .from('registrations')
      .insert(payload)
      .select('id')
      .single();
    if(insertError) throw insertError;

    // La prenotazione è già salvata. Ora chiediamo alla Edge Function di
    // generare il PDF riepilogativo e inviarlo all'indirizzo indicato.
    let emailSent = false;
    try{
      const response = await fetch(`${SUPABASE_URL}/functions/v1/send-booking-confirmation`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
        },
        body: JSON.stringify({ registration_id: inserted.id })
      });
      emailSent = response.ok;
      if(!response.ok){
        console.error('Invio email non riuscito:', await response.text());
      }
    }catch(emailError){
      console.error('Errore invio email:', emailError);
    }

    form.reset();
    updateGuests();
    fileName.textContent = 'Nessun file selezionato';
    showMessage('success', emailSent
      ? 'Prenotazione inviata correttamente. Ti abbiamo inviato anche il PDF riepilogativo via email.'
      : 'Prenotazione salvata correttamente. Il PDF via email non è partito automaticamente: contatta l’organizzazione indicando il tuo indirizzo email.');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }catch(err){
    console.error(err);
    if(uploadedPath){
      await supabaseClient.storage.from('payment-receipts').remove([uploadedPath]);
    }
    showMessage('error','Non è stato possibile completare la prenotazione. Riprova tra qualche istante.');
  }finally{
    submitButton.disabled = false;
    submitButton.textContent = 'Invia prenotazione';
  }
});

// Pulsanti COPIA per IBAN e intestazione.
document.querySelectorAll('[data-copy]').forEach(button => {
  button.addEventListener('click', async () => {
    const target = document.getElementById(button.dataset.copy);
    if(!target) return;
    const text = target.textContent.trim();
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const area = document.createElement('textarea');
      area.value = text; document.body.appendChild(area); area.select();
      document.execCommand('copy'); area.remove();
    }
    const old = button.textContent;
    button.textContent = 'Copiato ✓'; button.classList.add('copied');
    setTimeout(() => { button.textContent = old; button.classList.remove('copied'); }, 1600);
  });
});
