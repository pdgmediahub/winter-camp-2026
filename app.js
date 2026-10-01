const { SUPABASE_URL, SUPABASE_ANON_KEY } = window.APP_CONFIG || {};
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const NIGHTS = 2;
const ADULT_NIGHTLY = 50;
const CHILD_REDUCED_NIGHTLY = 30;
const DEPOSIT_PER_PAYING_PERSON = 20;

const form = document.getElementById('bookingForm');
const adultCount = document.getElementById('adultCount');
const childCount = document.getElementById('childCount');
const otherAdultsWrap = document.getElementById('otherAdultsWrap');
const otherAdultsList = document.getElementById('otherAdultsList');
const childrenWrap = document.getElementById('childrenWrap');
const childrenList = document.getElementById('childrenList');
const receipt = document.getElementById('receipt');
const fileName = document.getElementById('fileName');
const submitButton = document.getElementById('submitButton');
const formMessage = document.getElementById('formMessage');

function showMessage(type,text){ formMessage.className=`message ${type}`; formMessage.textContent=text; }
function euro(v){ return new Intl.NumberFormat('it-IT',{style:'currency',currency:'EUR'}).format(Number(v)||0); }
function childNightlyRate(age){ return age<=2?0:age<=10?CHILD_REDUCED_NIGHTLY:ADULT_NIGHTLY; }
function childStayPrice(age){ return childNightlyRate(age)*NIGHTS; }
function adultStayPrice(){ return ADULT_NIGHTLY*NIGHTS; }
function sanitizeName(name){ return name.normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-zA-Z0-9._-]/g,'_'); }

function ageOptions(selected=''){
  let html='<option value="" disabled '+(selected===''?'selected':'')+'>Seleziona età</option>';
  for(let i=0;i<=10;i++) html+=`<option value="${i}" ${String(selected)===String(i)?'selected':''}>${i} ${i===1?'anno':'anni'}</option>`;
  html+=`<option value="11" ${String(selected)==='11'?'selected':''}>11+ anni</option>`;
  return html;
}

function buildAdultCard(i,data={}){
  return `<article class="participant-card" data-adult-index="${i}">
    <div class="participant-card-head"><strong>Adulto ${i+1}</strong><span>${euro(ADULT_NIGHTLY)}/notte · ${euro(adultStayPrice())} soggiorno</span></div>
    <div class="grid two">
      <div class="field"><label>Nome <span class="required">*</span></label><input class="adult-first" value="${data.first_name||''}" required></div>
      <div class="field"><label>Cognome <span class="required">*</span></label><input class="adult-last" value="${data.last_name||''}" required></div>
    </div>
    <div class="field"><label>Data di nascita <span class="required">*</span></label><input class="adult-birth" type="date" value="${data.birth_date||''}" required></div>
  </article>`;
}
function buildChildCard(i,data={}){
  return `<article class="participant-card child-card" data-child-index="${i}">
    <div class="participant-card-head"><strong>Bambino ${i+1}</strong><span class="child-rate">Tariffa da definire</span></div>
    <div class="grid two">
      <div class="field"><label>Nome <span class="required">*</span></label><input class="child-first" value="${data.first_name||''}" required></div>
      <div class="field"><label>Cognome <span class="required">*</span></label><input class="child-last" value="${data.last_name||''}" required></div>
    </div>
    <div class="grid two">
      <div class="field"><label>Età al Winter Camp <span class="required">*</span></label><select class="child-age" required>${ageOptions(data.age_years??'')}</select><small>0–2 anni: gratis · 3–10: €30/notte · 11+: €50/notte</small></div>
      <div class="field"><label>Data di nascita</label><input class="child-birth" type="date" value="${data.birth_date||''}"><small>Facoltativa, utile per il check-in.</small></div>
    </div>
  </article>`;
}

function rebuildParticipants(){
  const adults=Math.max(1,Number(adultCount.value||1));
  const children=Math.max(0,Number(childCount.value||0));
  const oldAdults=[...otherAdultsList.querySelectorAll('.participant-card')].map(card=>({first_name:card.querySelector('.adult-first')?.value||'',last_name:card.querySelector('.adult-last')?.value||'',birth_date:card.querySelector('.adult-birth')?.value||''}));
  const oldChildren=[...childrenList.querySelectorAll('.participant-card')].map(card=>({first_name:card.querySelector('.child-first')?.value||'',last_name:card.querySelector('.child-last')?.value||'',age_years:card.querySelector('.child-age')?.value||'',birth_date:card.querySelector('.child-birth')?.value||''}));
  const extraAdults=adults-1;
  otherAdultsList.innerHTML=Array.from({length:extraAdults},(_,i)=>buildAdultCard(i,oldAdults[i]||{})).join('');
  otherAdultsWrap.classList.toggle('hidden',extraAdults===0);
  childrenList.innerHTML=Array.from({length:children},(_,i)=>buildChildCard(i,oldChildren[i]||{})).join('');
  childrenWrap.classList.toggle('hidden',children===0);
  updatePricing();
}

function collectParticipants(){
  const first=document.getElementById('firstName').value.trim();
  const last=document.getElementById('lastName').value.trim();
  const participants=[{key:'main',type:'adult',first_name:first,last_name:last,name:`${first} ${last}`.trim(),birth_date:null,age_years:null,age_label:'Adulto',nightly_rate:ADULT_NIGHTLY,price:adultStayPrice()}];
  [...otherAdultsList.querySelectorAll('.participant-card')].forEach((card,i)=>{
    const f=card.querySelector('.adult-first').value.trim(),l=card.querySelector('.adult-last').value.trim();
    participants.push({key:`adult-${i+1}`,type:'adult',first_name:f,last_name:l,name:`${f} ${l}`.trim(),birth_date:card.querySelector('.adult-birth').value||null,age_years:null,age_label:'Adulto',nightly_rate:ADULT_NIGHTLY,price:adultStayPrice()});
  });
  [...childrenList.querySelectorAll('.participant-card')].forEach((card,i)=>{
    const age=Number(card.querySelector('.child-age').value),f=card.querySelector('.child-first').value.trim(),l=card.querySelector('.child-last').value.trim();
    participants.push({key:`child-${i+1}`,type:'child',first_name:f,last_name:l,name:`${f} ${l}`.trim(),birth_date:card.querySelector('.child-birth').value||null,age_years:age,age_label:age>=11?'11+ anni':`${age} ${age===1?'anno':'anni'}`,nightly_rate:childNightlyRate(age),price:childStayPrice(age)});
  });
  return participants;
}

function updatePricing(){
  const adults=Math.max(1,Number(adultCount.value||1));
  const childCards=[...childrenList.querySelectorAll('.participant-card')];
  const ages=childCards.map(c=>Number(c.querySelector('.child-age')?.value)).filter(Number.isFinite);
  const free=ages.filter(a=>a<=2).length,reduced=ages.filter(a=>a>=3&&a<=10).length,full=ages.filter(a=>a>=11).length;
  const totalPeople=adults+Number(childCount.value||0);
  const total=adults*adultStayPrice()+reduced*(CHILD_REDUCED_NIGHTLY*NIGHTS)+full*adultStayPrice();
  const paying=adults+reduced+full;
  const deposit=paying*DEPOSIT_PER_PAYING_PERSON;
  const balance=Math.max(total-deposit,0);
  document.getElementById('totalPeopleValue').textContent=`${totalPeople} ${totalPeople===1?'partecipante':'partecipanti'}`;
  document.getElementById('adultPriceLine').textContent=`${adults} × ${euro(adultStayPrice())}`;
  const lines=[['childrenFreeLine',free,0],['childrenReducedLine',reduced,CHILD_REDUCED_NIGHTLY*NIGHTS],['childrenFullLine',full,adultStayPrice()]];
  for(const [id,count,price] of lines){const el=document.getElementById(id);el.classList.toggle('hidden',count===0);el.querySelector('strong').textContent=`${count} × ${euro(price)}`;}
  document.getElementById('campTotal').textContent=euro(total);
  document.getElementById('amountValue').textContent=euro(deposit);
  document.getElementById('balanceValue').textContent=euro(balance);
  childCards.forEach(card=>{const age=Number(card.querySelector('.child-age')?.value);const rate=card.querySelector('.child-rate');rate.textContent=Number.isFinite(age)?(childNightlyRate(age)===0?'GRATUITO · soggiorno €0':`${euro(childNightlyRate(age))}/notte · ${euro(childStayPrice(age))} soggiorno`):'Tariffa da definire';});
  return {adults,children:Number(childCount.value||0),totalPeople,total,deposit,balance};
}

adultCount.addEventListener('change',rebuildParticipants);
childCount.addEventListener('change',rebuildParticipants);
otherAdultsList.addEventListener('input',updatePricing);
childrenList.addEventListener('input',updatePricing);
childrenList.addEventListener('change',updatePricing);
receipt.addEventListener('change',()=>{fileName.textContent=receipt.files?.[0]?.name||'Nessun file selezionato';});
rebuildParticipants();

form.addEventListener('submit',async(e)=>{
  e.preventDefault();formMessage.className='message';
  if(!form.reportValidity())return;
  if(!SUPABASE_URL||!SUPABASE_ANON_KEY||SUPABASE_URL.includes('YOUR_PROJECT')){showMessage('error','Configurazione Supabase non completata.');return;}
  const file=receipt.files[0];
  if(!file){showMessage('error','Allega la distinta di bonifico.');return;}
  const allowed=['application/pdf','image/jpeg','image/png','image/webp'];
  if(!allowed.includes(file.type)){showMessage('error','Formato allegato non valido. Usa PDF, JPG, PNG o WEBP.');return;}
  if(file.size>10*1024*1024){showMessage('error','Il file supera il limite di 10 MB.');return;}

  const participants=collectParticipants();
  const expectedAdults=Number(adultCount.value||1),expectedChildren=Number(childCount.value||0);
  if(participants.filter(p=>p.type==='adult').length!==expectedAdults||participants.filter(p=>p.type==='child').length!==expectedChildren){showMessage('error','Controlla il numero dei partecipanti.');return;}
  if(participants.some(p=>!p.first_name||!p.last_name)){showMessage('error','Inserisci nome e cognome di tutti i partecipanti.');return;}

  submitButton.disabled=true;submitButton.textContent='Invio in corso…';
  let uploadedPath=null;
  try{
    const fileId=crypto.randomUUID();const ext=file.name.split('.').pop()?.toLowerCase()||'file';
    uploadedPath=`${new Date().getFullYear()}/${fileId}-${sanitizeName(file.name.replace(/\.[^.]+$/,''))}.${ext}`;
    const {error:uploadError}=await supabaseClient.storage.from('payment-receipts').upload(uploadedPath,file,{cacheControl:'3600',upsert:false,contentType:file.type});
    if(uploadError)throw uploadError;

    const otherAdults=participants.filter(p=>p.type==='adult'&&p.key!=='main').map(p=>({first_name:p.first_name,last_name:p.last_name,birth_date:p.birth_date}));
    const children=participants.filter(p=>p.type==='child').map(p=>({first_name:p.first_name,last_name:p.last_name,birth_date:p.birth_date,age_years:p.age_years}));
    const {data:registrationId,error:rpcError}=await supabaseClient.rpc('create_public_registration_v7',{
      p_first_name:document.getElementById('firstName').value.trim(),p_last_name:document.getElementById('lastName').value.trim(),p_email:document.getElementById('email').value.trim().toLowerCase(),p_phone:document.getElementById('phone').value.trim(),p_is_minister:document.getElementById('minister').value==='si',p_church:document.getElementById('church').value.trim(),p_adult_count:expectedAdults,p_other_adults:otherAdults,p_children:children,p_receipt_path:uploadedPath
    });
    if(rpcError)throw rpcError;if(!registrationId)throw new Error('ID prenotazione non restituito dal server.');

    let emailSent=false;
    try{const response=await fetch(`${SUPABASE_URL}/functions/v1/send-booking-confirmation`,{method:'POST',headers:{'Content-Type':'application/json','apikey':SUPABASE_ANON_KEY,'Authorization':`Bearer ${SUPABASE_ANON_KEY}`},body:JSON.stringify({registration_id:registrationId})});emailSent=response.ok;if(!response.ok)console.error('Invio email/notifiche non riuscito:',await response.text());}catch(emailError){console.error('Errore invio email/notifiche:',emailError);}

    form.reset();adultCount.value='1';childCount.value='0';rebuildParticipants();fileName.textContent='Nessun file selezionato';
    showMessage('success',emailSent?'Prenotazione inviata correttamente. Ti abbiamo inviato anche il PDF riepilogativo via email.':'Prenotazione salvata correttamente. Il PDF via email non è partito automaticamente: contatta l’organizzazione.');
    window.scrollTo({top:0,behavior:'smooth'});
  }catch(err){
    console.error('Errore prenotazione:',err);
    if(uploadedPath){try{await supabaseClient.storage.from('payment-receipts').remove([uploadedPath]);}catch(cleanupError){console.error(cleanupError);}}
    showMessage('error','Non è stato possibile completare la prenotazione. Riprova tra qualche istante.');
  }finally{submitButton.disabled=false;submitButton.textContent='Invia prenotazione';}
});

document.querySelectorAll('[data-copy]').forEach(button=>button.addEventListener('click',async()=>{const target=document.getElementById(button.dataset.copy);if(!target)return;const text=target.textContent.trim();try{await navigator.clipboard.writeText(text);}catch{const area=document.createElement('textarea');area.value=text;document.body.appendChild(area);area.select();document.execCommand('copy');area.remove();}const old=button.textContent;button.textContent='Copiato ✓';button.classList.add('copied');setTimeout(()=>{button.textContent=old;button.classList.remove('copied')},1600);}));
