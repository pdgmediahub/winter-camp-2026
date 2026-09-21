const { SUPABASE_URL, SUPABASE_ANON_KEY } = window.APP_CONFIG || {};
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let registrations = [];
let participants = [];
let currentAdminEmail = '';
let currentView = 'dashboard';

const $ = (id) => document.getElementById(id);
const loginView = $('loginView');
const adminView = $('adminView');
const loginMessage = $('loginMessage');
const tableBody = $('tableBody');
const searchInput = $('searchInput');

function esc(s=''){return String(s).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#039;','"':'&quot;'}[c]))}
function fmtDate(v){if(!v)return '—';return new Intl.DateTimeFormat('it-IT',{dateStyle:'short',timeStyle:'short'}).format(new Date(v))}
function fmtTime(v){if(!v)return '—';return new Intl.DateTimeFormat('it-IT',{hour:'2-digit',minute:'2-digit'}).format(new Date(v))}
function euros(v){return new Intl.NumberFormat('it-IT',{style:'currency',currency:'EUR'}).format(Number(v)||0)}
function setMsg(el,type,text){el.className=`message ${type}`;el.textContent=text}
function clearMsg(el){el.className='message';el.textContent=''}

async function checkAdmin(){
  const { data:{session} } = await sb.auth.getSession();
  if(!session){showLogin();return false}
  const email = session.user.email || '';
  const { data, error } = await sb.from('admin_users').select('email').ilike('email',email).maybeSingle();
  if(error || !data){await sb.auth.signOut();showLogin();setMsg(loginMessage,'error','Utente non autorizzato.');return false}
  currentAdminEmail = email;
  showAdmin();
  await loadAll();
  return true;
}
function showLogin(){loginView.classList.remove('hidden2');adminView.classList.add('hidden2')}
function showAdmin(){loginView.classList.add('hidden2');adminView.classList.remove('hidden2')}

$('loginButton').addEventListener('click',async()=>{
  clearMsg(loginMessage);
  const email=$('adminEmail').value.trim();
  const password=$('adminPassword').value;
  if(!email||!password){setMsg(loginMessage,'error','Inserisci email e password.');return}
  $('loginButton').disabled=true;
  const { error }=await sb.auth.signInWithPassword({email,password});
  $('loginButton').disabled=false;
  if(error){setMsg(loginMessage,'error','Credenziali non valide.');return}
  await checkAdmin();
});
$('adminPassword').addEventListener('keydown',e=>{if(e.key==='Enter')$('loginButton').click()});
$('logoutButton').addEventListener('click',async()=>{await sb.auth.signOut();showLogin()});
$('refreshButton').addEventListener('click',loadAll);

function switchView(view){
  currentView=view;
  document.querySelectorAll('.view-panel').forEach(v=>v.classList.remove('active'));
  $(`${view}View`).classList.add('active');
  document.querySelectorAll('.nav-item[data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===view));
  $('viewTitle').textContent = view==='dashboard'?'Dashboard':view==='bookings'?'Prenotazioni':'Check-in Hotel';
  $('sidebar').classList.remove('open');
  if(view==='bookings')renderBookings();
  if(view==='checkin')renderCheckin();
}
document.querySelectorAll('[data-view]').forEach(btn=>btn.addEventListener('click',()=>switchView(btn.dataset.view)));
document.querySelectorAll('[data-go]').forEach(btn=>btn.addEventListener('click',()=>switchView(btn.dataset.go)));
$('menuButton').addEventListener('click',()=> $('sidebar').classList.toggle('open'));

document.addEventListener('click',e=>{
  if(window.innerWidth>760)return;
  if(!$('sidebar').classList.contains('open'))return;
  if(e.target.closest('#sidebar')||e.target.closest('#menuButton'))return;
  $('sidebar').classList.remove('open');
});

async function loadAll(){
  const [{data:r,error:re},{data:p,error:pe}] = await Promise.all([
    sb.from('registrations').select('*').order('created_at',{ascending:false}),
    sb.from('registration_participants').select('*').order('participant_order',{ascending:true})
  ]);
  if(re){alert('Errore nel caricamento prenotazioni: '+re.message);return}
  if(pe){console.warn('Partecipanti non caricati:',pe.message)}
  registrations=r||[];
  participants=p||[];
  populateChurchFilters();
  renderDashboard();
  renderBookings();
  renderCheckin();
}

function registrationPeople(r){
  // guest_count è il TOTALE delle persone prenotate, non va mai sommato il referente.
  const stored = Number(r.guest_count);
  if (Number.isFinite(stored) && stored >= 0) return stored;

  // Fallback per eventuali righe storiche: ricava il totale dall'acconto (€20/persona).
  const deposit = Number(r.deposit_amount);
  if (Number.isFinite(deposit) && deposit >= 0) return Math.round(deposit / 20);

  // Ultimo fallback: usa le righe effettivamente presenti nel check-in.
  return participants.filter(p => p.registration_id === r.id).length;
}
function activeRegistrations(){return registrations.filter(r=>r.status!=='cancelled')}
function activeParticipants(){
  const activeIds=new Set(activeRegistrations().map(r=>r.id));
  return participants.filter(p=>activeIds.has(p.registration_id));
}
function renderDashboard(){
  const regs=activeRegistrations();
  const people=regs.reduce((s,r)=>s+registrationPeople(r),0);
  const deposits=regs.reduce((s,r)=>s+Number(r.deposit_amount||0),0);
  const parts=activeParticipants();
  const present=parts.filter(p=>p.checked_in).length;
  const pct=parts.length?Math.round(present/parts.length*100):0;
  $('statBookings').textContent=regs.length;
  $('statPeople').textContent=people;
  $('statCheckedIn').textContent=present;
  $('statCheckinPct').textContent=`${pct}% arrivati`;
  $('statDeposit').textContent=euros(deposits);
  $('progressRing').style.setProperty('--pct',`${pct*3.6}deg`);
  $('progressRingText').textContent=`${pct}%`;
  $('dashPresent').textContent=`${present} presenti`;
  $('dashAbsent').textContent=`${Math.max(parts.length-present,0)} ancora da arrivare`;

  $('recentBookings').innerHTML=registrations.slice(0,6).map(r=>`
    <div class="compact-row">
      <div><strong>${esc(r.first_name)} ${esc(r.last_name)}</strong><span>${esc(r.church)} · ${registrationPeople(r)} ${registrationPeople(r)===1?'persona':'persone'}</span></div>
      <div class="compact-meta"><strong>${euros(r.deposit_amount)}</strong><span>${fmtDate(r.created_at)}</span></div>
    </div>`).join('') || '<p class="muted">Nessuna prenotazione.</p>';
}

function populateChurchFilters(){
  const churches=[...new Set(registrations.map(r=>r.church).filter(Boolean).map(s=>s.trim()))].sort((a,b)=>a.localeCompare(b,'it'));
  for(const id of ['bookingChurchFilter','checkinChurchFilter']){
    const el=$(id); const current=el.value;
    el.innerHTML=`<option value="">Tutte le chiese</option>`+churches.map(c=>`<option value="${esc(c)}">${esc(c)}</option>`).join('');
    if(churches.includes(current))el.value=current;
  }
}

function filteredBookings(){
  const q=(searchInput.value||'').trim().toLowerCase();
  const church=$('bookingChurchFilter').value;
  const status=$('bookingStatusFilter').value;
  return registrations.filter(r=>{
    const hay=[r.first_name,r.last_name,r.email,r.phone,r.church,r.guest_details].filter(Boolean).join(' ').toLowerCase();
    return (!q||hay.includes(q))&&(!church||r.church===church)&&(!status||r.status===status);
  });
}
function statusLabel(s){return s==='confirmed'?'Confermata':s==='cancelled'?'Annullata':'Ricevuta'}
function groupProgress(r){
  const ps=participants.filter(p=>p.registration_id===r.id);
  const done=ps.filter(p=>p.checked_in).length;
  return `${done}/${ps.length||registrationPeople(r)}`;
}
function renderBookings(){
  const rows=filteredBookings();
  tableBody.innerHTML=rows.map(r=>`
    <tr>
      <td><strong>${esc(r.first_name)} ${esc(r.last_name)}</strong><br><span class="muted">${fmtDate(r.created_at)} · ${r.source==='manual'?'Manuale':'Online'}</span></td>
      <td>${esc(r.email)}<br><span class="muted">${esc(r.phone)}</span></td>
      <td>${esc(r.church)}</td>
      <td><strong>${registrationPeople(r)}</strong><br><span class="muted">Check-in ${groupProgress(r)}</span></td>
      <td>${euros(r.deposit_amount)}</td>
      <td><span class="status-pill ${esc(r.status||'')}">${statusLabel(r.status)}</span></td>
      <td>${r.receipt_path?`<button class="mini-btn" onclick="openReceipt('${String(r.receipt_path).replace(/'/g,"\\'")}')">Apri</button>`:'<span class="muted">—</span>'}</td>
      <td><div class="row-actions"><button class="mini-btn" onclick="editBooking('${r.id}')">Modifica</button><button class="mini-btn danger" onclick="deleteBooking('${r.id}')">Elimina</button></div></td>
    </tr>`).join('');

  $('bookingsCards').innerHTML=rows.map(r=>`
    <article class="booking-mobile-card">
      <div class="booking-mobile-top"><div><h4>${esc(r.first_name)} ${esc(r.last_name)}</h4><p>${esc(r.church)} · ${esc(r.phone)}</p></div><span class="status-pill ${esc(r.status||'')}">${statusLabel(r.status)}</span></div>
      <div class="booking-mobile-grid"><div><span>Persone</span><strong>${registrationPeople(r)}</strong></div><div><span>Check-in</span><strong>${groupProgress(r)}</strong></div><div><span>Acconto</span><strong>${euros(r.deposit_amount)}</strong></div><div><span>Data</span><strong>${fmtDate(r.created_at)}</strong></div></div>
      <div class="booking-mobile-actions">${r.receipt_path?`<button class="mini-btn" onclick="openReceipt('${String(r.receipt_path).replace(/'/g,"\\'")}')">Distinta</button>`:''}<button class="mini-btn" onclick="editBooking('${r.id}')">Modifica</button><button class="mini-btn danger" onclick="deleteBooking('${r.id}')">Elimina</button></div>
    </article>`).join('');
}
[searchInput,$('bookingChurchFilter'),$('bookingStatusFilter')].forEach(el=>el.addEventListener(el.tagName==='INPUT'?'input':'change',renderBookings));

async function openReceipt(path){
  const {data,error}=await sb.storage.from('payment-receipts').createSignedUrl(path,90);
  if(error){alert('Impossibile aprire la distinta.');return}
  window.open(data.signedUrl,'_blank','noopener');
}
window.openReceipt=openReceipt;

function filteredCheckinRegistrations(){
  const q=$('checkinSearch').value.trim().toLowerCase();
  const church=$('checkinChurchFilter').value;
  const state=$('checkinStateFilter').value;
  return activeRegistrations().filter(r=>{
    const ps=participants.filter(p=>p.registration_id===r.id);
    const hay=[r.first_name,r.last_name,r.church,...ps.map(p=>p.participant_name)].join(' ').toLowerCase();
    const stateMatch=!state || (state==='present'&&ps.some(p=>p.checked_in)) || (state==='absent'&&ps.some(p=>!p.checked_in)) || (state==='issue'&&ps.some(p=>p.issue));
    return (!q||hay.includes(q))&&(!church||r.church===church)&&stateMatch;
  });
}
function renderCheckin(){
  const all=activeParticipants();
  $('checkinPresent').textContent=all.filter(p=>p.checked_in).length;
  $('checkinAbsent').textContent=all.filter(p=>!p.checked_in).length;
  $('checkinIssues').textContent=all.filter(p=>p.issue).length;
  const regs=filteredCheckinRegistrations();
  $('checkinGroups').innerHTML=regs.map(r=>{
    let ps=participants.filter(p=>p.registration_id===r.id).sort((a,b)=>(a.participant_order||0)-(b.participant_order||0));
    const state=$('checkinStateFilter').value;
    if(state==='present')ps=ps.filter(p=>p.checked_in);
    if(state==='absent')ps=ps.filter(p=>!p.checked_in);
    if(state==='issue')ps=ps.filter(p=>p.issue);
    const allPs=participants.filter(p=>p.registration_id===r.id);
    const done=allPs.filter(p=>p.checked_in).length;
    return `<article class="group-card">
      <div class="group-head"><div><strong>${esc(r.first_name)} ${esc(r.last_name)}</strong><span>${esc(r.church)} · ${registrationPeople(r)} ${registrationPeople(r)===1?'persona':'persone'}</span></div><div class="group-progress">${done}/${allPs.length||registrationPeople(r)} presenti</div></div>
      ${ps.map(p=>participantHtml(p)).join('')||'<div style="padding:15px 17px" class="muted">Nessun partecipante corrisponde al filtro.</div>'}
    </article>`;
  }).join('') || '<div class="panel-card"><p class="muted">Nessun gruppo trovato.</p></div>';
}
function participantHtml(p){
  const cls=p.issue?'issue':p.checked_in?'present':'';
  const status=p.checked_in?`Arrivato alle ${fmtTime(p.checked_in_at)}${p.checked_in_by?` · ${esc(p.checked_in_by)}`:''}`:'Non ancora arrivato';
  return `<div class="participant-row ${cls}">
    <div class="participant-main"><strong>${esc(p.participant_name)}</strong><span>${p.birth_date?`Nato/a il ${new Date(p.birth_date+'T00:00:00').toLocaleDateString('it-IT')}`:(p.participant_key==='main'?'Referente prenotazione':'Ospite')}</span></div>
    <div class="participant-status">${status}</div>
    <button class="check-btn ${p.checked_in?'undo':''}" onclick="toggleCheckin('${p.id}',${p.checked_in?'false':'true'})">${p.checked_in?'ANNULLA':'CHECK-IN'}</button>
    <div class="participant-actions"><button class="issue-btn ${p.issue?'active':''}" onclick="toggleIssue('${p.id}',${p.issue?'false':'true'})">${p.issue?'PROBLEMA ✓':'PROBLEMA'}</button></div>
  </div>`;
}
[$('checkinSearch'),$('checkinChurchFilter'),$('checkinStateFilter')].forEach(el=>el.addEventListener(el.tagName==='INPUT'?'input':'change',renderCheckin));

async function toggleCheckin(id,value){
  const patch=value?{checked_in:true,checked_in_at:new Date().toISOString(),checked_in_by:currentAdminEmail,issue:false}:{checked_in:false,checked_in_at:null,checked_in_by:null};
  const {error}=await sb.from('registration_participants').update(patch).eq('id',id);
  if(error){alert('Errore check-in: '+error.message);return}
  await loadAll();
}
async function toggleIssue(id,value){
  const {error}=await sb.from('registration_participants').update({issue:value}).eq('id',id);
  if(error){alert('Errore aggiornamento: '+error.message);return}
  await loadAll();
}
window.toggleCheckin=toggleCheckin;window.toggleIssue=toggleIssue;

for(let i=0;i<=10;i++) $('mGuestCount').insertAdjacentHTML('beforeend',`<option value="${i}">${i}</option>`);
function updateModalSummary(){
  const n=Number($('mGuestCount').value||0);
  $('mPeopleTotal').textContent=n;
  $('mDeposit').textContent=euros(n*20);
  $('mGuestDetails').required=n>0;
}
$('mGuestCount').addEventListener('change',updateModalSummary);

function openBookingModal(mode='new',r=null){
  $('adminBookingForm').reset();clearMsg($('modalMessage'));
  $('editRegistrationId').value=r?.id||'';
  $('modalTitle').textContent=mode==='edit'?'Modifica prenotazione':'Nuova prenotazione';
  $('sendEmailRow').classList.toggle('hidden2',mode==='edit');
  if(r){
    $('mFirstName').value=r.first_name||'';$('mLastName').value=r.last_name||'';$('mEmail').value=r.email||'';$('mPhone').value=r.phone||'';$('mMinister').value=r.is_minister?'si':'no';$('mChurch').value=r.church||'';$('mGuestCount').value=String(r.guest_count||0);$('mStatus').value=r.status||'ricevuta';$('mGuestDetails').value=r.guest_details||'';
  }else{$('mGuestCount').value='0';$('mStatus').value='ricevuta';}
  updateModalSummary();
  $('bookingModal').classList.remove('hidden2');
  setTimeout(()=>$('mFirstName').focus(),50);
}
function closeBookingModal(){$('bookingModal').classList.add('hidden2')}
$('newBookingButton').addEventListener('click',()=>openBookingModal('new'));
$('closeModal').addEventListener('click',closeBookingModal);$('cancelModal').addEventListener('click',closeBookingModal);
$('bookingModal').addEventListener('click',e=>{if(e.target===$('bookingModal'))closeBookingModal()});
function editBooking(id){const r=registrations.find(x=>x.id===id);if(r)openBookingModal('edit',r)}
window.editBooking=editBooking;

$('adminBookingForm').addEventListener('submit',async e=>{
  e.preventDefault();clearMsg($('modalMessage'));
  if(!$('adminBookingForm').reportValidity())return;
  const id=$('editRegistrationId').value;
  const guestCount=Number($('mGuestCount').value||0);
  const details=$('mGuestDetails').value.trim();
  if(guestCount>0 && !details){setMsg($('modalMessage'),'error','Inserisci i dati degli ospiti, uno per riga.');return}
  const payload={
    first_name:$('mFirstName').value.trim(),last_name:$('mLastName').value.trim(),email:$('mEmail').value.trim().toLowerCase(),phone:$('mPhone').value.trim(),is_minister:$('mMinister').value==='si',church:$('mChurch').value.trim(),guest_count:guestCount,guest_details:guestCount?details:null,deposit_amount:guestCount*20,status:$('mStatus').value,updated_at:new Date().toISOString()
  };
  $('saveBookingButton').disabled=true;$('saveBookingButton').textContent='Salvataggio…';
  let savedId=id;
  let error;
  if(id){({error}=await sb.from('registrations').update(payload).eq('id',id));}
  else{
    payload.source='manual';
    const result=await sb.from('registrations').insert(payload).select('id').single();error=result.error;savedId=result.data?.id;
  }
  if(error){setMsg($('modalMessage'),'error','Errore: '+error.message);$('saveBookingButton').disabled=false;$('saveBookingButton').textContent='Salva prenotazione';return}
  if(!id && $('mSendEmail').checked && savedId){await sendConfirmationEmail(savedId);}
  $('saveBookingButton').disabled=false;$('saveBookingButton').textContent='Salva prenotazione';
  closeBookingModal();await loadAll();
});

async function sendConfirmationEmail(registrationId){
  try{await fetch(`${SUPABASE_URL}/functions/v1/send-booking-confirmation`,{method:'POST',headers:{'Content-Type':'application/json','apikey':SUPABASE_ANON_KEY,'Authorization':`Bearer ${SUPABASE_ANON_KEY}`},body:JSON.stringify({registration_id:registrationId})});}catch(e){console.error(e)}
}

async function deleteBooking(id){
  const r=registrations.find(x=>x.id===id);if(!r)return;
  if(!confirm(`Eliminare definitivamente la prenotazione di ${r.first_name} ${r.last_name}?\n\nVerranno eliminati anche i relativi dati di check-in.`))return;
  if(r.receipt_path){await sb.storage.from('payment-receipts').remove([r.receipt_path]);}
  const {error}=await sb.from('registrations').delete().eq('id',id);
  if(error){alert('Errore eliminazione: '+error.message);return}
  await loadAll();
}
window.deleteBooking=deleteBooking;

$('exportButton').addEventListener('click',()=>{
  const bookingRows=registrations.map(r=>({
    'Data prenotazione':fmtDate(r.created_at),'Nome':r.first_name,'Cognome':r.last_name,'Email':r.email,'Cellulare':r.phone,'Ministro':r.is_minister?'Sì':'No','Chiesa di appartenenza':r.church,'Numero ospiti':r.guest_count,'Dati ospiti':r.guest_details||'','Persone totali':registrationPeople(r),'Acconto €':Number(r.deposit_amount||0),'Stato':statusLabel(r.status),'Origine':r.source==='manual'?'Manuale':'Online','Email PDF inviata':r.confirmation_email_sent_at?fmtDate(r.confirmation_email_sent_at):'No','Distinta':r.receipt_path||''
  }));
  const participantRows=participants.map(p=>{
    const r=registrations.find(x=>x.id===p.registration_id);
    return {'Famiglia / Referente':r?`${r.first_name} ${r.last_name}`:'','Partecipante':p.participant_name,'Data di nascita':p.birth_date?new Date(p.birth_date+'T00:00:00').toLocaleDateString('it-IT'):'','Chiesa':r?.church||'','Check-in':p.checked_in?'PRESENTE':'ASSENTE','Orario arrivo':p.checked_in_at?fmtDate(p.checked_in_at):'','Operatore':p.checked_in_by||'','Da verificare':p.issue?'Sì':'No','Note':p.notes||''};
  });
  const wb=XLSX.utils.book_new();
  const ws1=XLSX.utils.json_to_sheet(bookingRows);ws1['!cols']=[{wch:18},{wch:18},{wch:18},{wch:28},{wch:18},{wch:10},{wch:28},{wch:12},{wch:45},{wch:14},{wch:14},{wch:14},{wch:12},{wch:20},{wch:35}];XLSX.utils.book_append_sheet(wb,ws1,'Prenotazioni');
  const ws2=XLSX.utils.json_to_sheet(participantRows);ws2['!cols']=[{wch:25},{wch:28},{wch:16},{wch:28},{wch:12},{wch:20},{wch:28},{wch:14},{wch:12},{wch:30}];XLSX.utils.book_append_sheet(wb,ws2,'Check-in Hotel');
  XLSX.writeFile(wb,`Winter_Camp_Gestionale_${new Date().toISOString().slice(0,10)}.xlsx`);
});

sb.channel('wintercamp-live')
  .on('postgres_changes',{event:'*',schema:'public',table:'registrations'},()=>loadAll())
  .on('postgres_changes',{event:'*',schema:'public',table:'registration_participants'},()=>loadAll())
  .subscribe();

checkAdmin();
