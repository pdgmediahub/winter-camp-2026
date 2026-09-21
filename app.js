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
  amountBox.querySelector('strong').textContent = `€${(n * 20).toFixed(2).replace('.', ',')}`;

  if(n > 1){
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
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g,'')
    .replace(/[^a-zA-Z0-9._-]/g,'_');
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
    const fileId = crypto.randomUUID();
    const ext = file.name.split('.').pop()?.toLowerCase() || 'file';

    uploadedPath =
      `${new Date().getFullYear()}/${fileId}-${sanitizeName(
        file.name.replace(/\.[^.]+$/, '')
      )}.${ext}`;

    const { error: uploadError } = await supabaseClient.storage
      .from('payment-receipts')
      .upload(
        uploadedPath,
        file,
        {
          cacheControl: '3600',
          upsert: false,
          contentType: file.type
        }
      );

    if(uploadError) throw uploadError;

    const nGuests = Number(guestCount.value);

    /*
      IMPORTANTE:
      Non facciamo più INSERT diretto su registrations.
      Chiamiamo una funzione RPC sicura lato database.
      In questo modo RLS può restare chiusa al pubblico.
    */
    const { data: registrationId, error: rpcError } = await supabaseClient
      .rpc('create_public_registration', {
        p_first_name: document.getElementById('firstName').value.trim(),
        p_last_name: document.getElementById('lastName').value.trim(),
        p_email: document.getElementById('email').value.trim().toLowerCase(),
        p_phone: document.getElementById('phone').value.trim(),
        p_is_minister: document.getElementById('minister').value === 'si',
        p_church: document.getElementById('church').value.trim(),
        p_guest_count: nGuests,
        p_guest_details: nGuests > 1 ? guestDetails.value.trim() : null,
        p_receipt_path: uploadedPath,
        p_deposit_amount: nGuests * 20
      });

    if(rpcError) throw rpcError;
    if(!registrationId) throw new Error('ID prenotazione non restituito dal server.');

    let emailSent = false;

    try{
      const response = await fetch(
        `${SUPABASE_URL}/functions/v1/send-booking-confirmation`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': SUPABASE_ANON_KEY,
            'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
          },
          body: JSON.stringify({
            registration_id: registrationId
          })
        }
      );

      emailSent = response.ok;

      if(!response.ok){
        console.error(
          'Invio email/notifiche non riuscito:',
          await response.text()
        );
      }

    }catch(emailError){
      console.error('Errore invio email/notifiche:', emailError);
    }

    form.reset();
    updateGuests();
    fileName.textContent = 'Nessun file selezionato';

    showMessage(
      'success',
      emailSent
        ? 'Prenotazione inviata correttamente. Ti abbiamo inviato anche il PDF riepilogativo via email.'
        : 'Prenotazione salvata correttamente. Il PDF via email non è partito automaticamente: contatta l’organizzazione indicando il tuo indirizzo email.'
    );

    window.scrollTo({ top: 0, behavior: 'smooth' });

  }catch(err){
    console.error('Errore prenotazione:', err);

    if(uploadedPath){
      try{
        await supabaseClient.storage
          .from('payment-receipts')
          .remove([uploadedPath]);
      }catch(cleanupError){
        console.error('Errore durante la pulizia della distinta:', cleanupError);
      }
    }

    showMessage(
      'error',
      'Non è stato possibile completare la prenotazione. Riprova tra qualche istante.'
    );

  }finally{
    submitButton.disabled = false;
    submitButton.textContent = 'Invia prenotazione';
  }
});

document.querySelectorAll('[data-copy]').forEach(button => {
  button.addEventListener('click', async () => {
    const target = document.getElementById(button.dataset.copy);
    if(!target) return;

    const text = target.textContent.trim();

    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const area = document.createElement('textarea');
      area.value = text;
      document.body.appendChild(area);
      area.select();
      document.execCommand('copy');
      area.remove();
    }

    const old = button.textContent;
    button.textContent = 'Copiato ✓';
    button.classList.add('copied');

    setTimeout(() => {
      button.textContent = old;
      button.classList.remove('copied');
    }, 1600);
  });
});
