const { SUPABASE_URL, SUPABASE_ANON_KEY } = window.APP_CONFIG || {};
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let registrations = [];
let participants = [];
let adminNotifications = [];
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
function parseMoneyInput(v){
  const raw=String(v??'').trim().replace(/\s/g,'').replace(/€/g,'');
  if(!raw)return NaN;
  let normalized=raw;
  if(raw.includes(',')&&raw.includes('.')) normalized=raw.lastIndexOf(',')>raw.lastIndexOf('.')?raw.replace(/\./g,'').replace(',','.'):raw.replace(/,/g,'');
  else if(raw.includes(',')) normalized=raw.replace(',','.');
  return Number(normalized);
}
const NIGHTS=2,ADULT_NIGHTLY=50,CHILD_REDUCED_NIGHTLY=30,DEPOSIT_PER_PAYING_PERSON=20;
function childNightlyRate(age){age=Number(age);return age<=2?0:age<=10?CHILD_REDUCED_NIGHTLY:ADULT_NIGHTLY}
function childPrice(age){return childNightlyRate(age)*NIGHTS}
function adultPrice(){return ADULT_NIGHTLY*NIGHTS}
function parseParticipantData(r){
  let data=r?.participants_data||[]; if(typeof data==='string'){try{data=JSON.parse(data)}catch{data=[]}}
  if(Array.isArray(data)&&data.length)return data;
  const ps=participants.filter(p=>p.registration_id===r?.id).sort((a,b)=>(a.participant_order||0)-(b.participant_order||0));
  return ps.map((p,i)=>({key:p.participant_key||`legacy-${i}`,type:p.participant_type||'adult',name:p.participant_name,first_name:'',last_name:'',birth_date:p.birth_date||null,age_years:p.age_years??null,age_label:p.age_band||'Adulto',nightly_rate:Number(p.nightly_rate??(p.participant_type==='child'?childNightlyRate(p.age_years):ADULT_NIGHTLY)),price:Number(p.price_amount??(p.participant_type==='child'?childPrice(p.age_years):adultPrice()))}));
}
function registrationTotal(r){const v=Number(r.total_amount);return Number.isFinite(v)?v:parseParticipantData(r).reduce((s,p)=>s+Number(p.price||0),0)}
function registrationBalance(r){const v=Number(r.balance_amount);return Number.isFinite(v)?v:Math.max(registrationTotal(r)-Number(r.deposit_amount||0),0)}
function registrationAdults(r){const v=Number(r.adult_count);return Number.isFinite(v)&&v>=1?v:parseParticipantData(r).filter(p=>p.type!=='child').length||registrationPeople(r)}
function registrationChildren(r){const v=Number(r.child_count);return Number.isFinite(v)&&v>=0?v:parseParticipantData(r).filter(p=>p.type==='child').length}
function pricingFromData(adultsData,childrenData){const adults=1+adultsData.length;const free=childrenData.filter(c=>Number(c.age_years)<=2).length;const reduced=childrenData.filter(c=>Number(c.age_years)>=3&&Number(c.age_years)<=10).length;const full=childrenData.filter(c=>Number(c.age_years)>=11).length;return{adults,children:childrenData.length,people:adults+childrenData.length,total:adults*adultPrice()+reduced*(CHILD_REDUCED_NIGHTLY*NIGHTS)+full*adultPrice(),deposit:(adults+reduced+full)*DEPOSIT_PER_PAYING_PERSON,free,reduced,full}}

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
  $('viewTitle').textContent = view==='dashboard'?'Dashboard':view==='bookings'?'Prenotazioni':view==='rooms'?'Room List':'Check-in Hotel';
  $('sidebar').classList.remove('open');
  if(view==='bookings')renderBookings();
  if(view==='rooms')renderRoomList();
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
  const [{data:r,error:re},{data:p,error:pe},{data:n,error:ne}] = await Promise.all([
    sb.from('registrations').select('*').order('created_at',{ascending:false}),
    sb.from('registration_participants').select('*').order('participant_order',{ascending:true}),
    sb.from('admin_notifications').select('*').order('created_at',{ascending:false}).limit(100)
  ]);
  if(re){alert('Errore nel caricamento prenotazioni: '+re.message);return}
  if(pe){console.warn('Partecipanti non caricati:',pe.message)}
  if(ne){console.warn('Notifiche non caricate:',ne.message)}
  registrations=r||[];
  participants=p||[];
  adminNotifications=n||[];
  populateChurchFilters();
  renderDashboard();
  renderBookings();
  renderRoomList();
  renderCheckin();
  renderNotifications();
}

function registrationPeople(r){
  const stored=Number(r.guest_count); if(Number.isFinite(stored)&&stored>=0)return stored;
  return registrationAdults(r)+registrationChildren(r);
}
function activeRegistrations(){return registrations.filter(r=>r.status!=='cancelled')}
function activeParticipants(){
  const activeIds=new Set(activeRegistrations().map(r=>r.id));
  return participants.filter(p=>activeIds.has(p.registration_id));
}
function renderDashboard(){
  const regs=activeRegistrations();
  const people=regs.reduce((s,r)=>s+registrationPeople(r),0);
  // V7.3 — separazione acconti per origine:
  // - prenotazioni online/con distinta = bonifico
  // - prenotazioni inserite manualmente = contanti
  const onlineRegs=regs.filter(r=>r.source!=='manual' && Boolean(r.receipt_path));
  const manualRegs=regs.filter(r=>r.source==='manual');
  const depositsOnline=onlineRegs.reduce((s,r)=>s+Number(r.deposit_amount||0),0);
  const depositsCash=manualRegs.reduce((s,r)=>s+Number(r.deposit_amount||0),0);
  const deposits=depositsOnline+depositsCash;
  const campTotal=regs.reduce((s,r)=>s+registrationTotal(r),0);
  const balanceTotal=regs.reduce((s,r)=>s+registrationBalance(r),0);
  const parts=activeParticipants();
  const present=parts.filter(p=>p.checked_in).length;
  const pct=parts.length?Math.round(present/parts.length*100):0;
  $('statBookings').textContent=regs.length;
  $('statPeople').textContent=people;
  $('statCheckedIn').textContent=present;
  $('statCheckinPct').textContent=`${pct}% arrivati`;
  $('statCampTotal').textContent=euros(campTotal);
  if($('statDepositOnline'))$('statDepositOnline').textContent=euros(depositsOnline);
  if($('statDepositCash'))$('statDepositCash').textContent=euros(depositsCash);
  if($('statDepositOnlineMeta'))$('statDepositOnlineMeta').textContent=`${onlineRegs.length} ${onlineRegs.length===1?'prenotazione online':'prenotazioni online'} con distinta`;
  if($('statDepositCashMeta'))$('statDepositCashMeta').textContent=`${manualRegs.length} ${manualRegs.length===1?'inserimento manuale':'inserimenti manuali'} · contanti`;
  if($('statBalance'))$('statBalance').textContent=euros(balanceTotal);
  $('progressRing').style.setProperty('--pct',`${pct*3.6}deg`);
  $('progressRingText').textContent=`${pct}%`;
  $('dashPresent').textContent=`${present} presenti`;
  $('dashAbsent').textContent=`${Math.max(parts.length-present,0)} ancora da arrivare`;

  $('recentBookings').innerHTML=registrations.slice(0,6).map(r=>`
    <div class="compact-row">
      <div><strong>${esc(r.first_name)} ${esc(r.last_name)}</strong><span>${esc(r.church)} · ${registrationPeople(r)} ${registrationPeople(r)===1?'persona':'persone'}</span></div>
      <div class="compact-meta"><strong>${euros(registrationTotal(r))}</strong><span>${fmtDate(r.created_at)}</span></div>
    </div>`).join('') || '<p class="muted">Nessuna prenotazione.</p>';
}

function populateChurchFilters(){
  const churches=[...new Set(registrations.map(r=>r.church).filter(Boolean).map(s=>s.trim()))].sort((a,b)=>a.localeCompare(b,'it'));
  for(const id of ['bookingChurchFilter','roomChurchFilter','checkinChurchFilter']){
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
function paymentLabel(s){return s==='confirmed'?'Confermato':'Da verificare'}
function roomLabel(r){return [r.hotel_name,r.room_type,r.room_number].filter(Boolean).join(' · ')||'Non assegnata'}
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
      <td><strong>${registrationPeople(r)}</strong><br><span class="muted">${registrationAdults(r)} adulti · ${registrationChildren(r)} bambini · Check-in ${groupProgress(r)}</span></td>
      <td><strong>${euros(registrationTotal(r))}</strong></td>
      <td>${euros(r.deposit_amount)}</td>
      <td><strong>${euros(registrationBalance(r))}</strong></td>
      <td><span class="payment-pill ${r.payment_status==='confirmed'?'confirmed':'pending'}">${paymentLabel(r.payment_status)}</span><br><button class="mini-btn ${r.payment_status==='confirmed'?'':'success'}" onclick="togglePayment('${r.id}')">${r.payment_status==='confirmed'?'Annulla conferma':'Conferma'}</button></td>
      <td><span class="email-pill ${r.confirmation_email_sent_at?'sent':'pending'}">${r.confirmation_email_sent_at?'Inviata':'Non inviata'}</span><br><button class="mini-btn" onclick="resendConfirmation('${r.id}')">Reinvia PDF</button></td>
      <td><span class="room-pill">${esc(roomLabel(r))}</span></td>
      <td><span class="status-pill ${esc(r.status||'')}">${statusLabel(r.status)}</span></td>
      <td>${r.receipt_path?`<button class="mini-btn" onclick="openReceipt('${String(r.receipt_path).replace(/'/g,"\\'")}')">Apri</button>`:'<span class="muted">—</span>'}</td>
      <td><div class="row-actions"><button class="mini-btn" onclick="editBooking('${r.id}')">Modifica</button><button class="mini-btn danger" onclick="deleteBooking('${r.id}')">Elimina</button></div></td>
    </tr>`).join('');

  $('bookingsCards').innerHTML=rows.map(r=>`
    <article class="booking-mobile-card">
      <div class="booking-mobile-top"><div><h4>${esc(r.first_name)} ${esc(r.last_name)}</h4><p>${esc(r.church)} · ${esc(r.phone)}</p></div><span class="status-pill ${esc(r.status||'')}">${statusLabel(r.status)}</span></div>
      <div class="booking-mobile-grid"><div><span>Persone</span><strong>${registrationPeople(r)} (${registrationAdults(r)}A / ${registrationChildren(r)}B)</strong></div><div><span>Check-in</span><strong>${groupProgress(r)}</strong></div><div><span>Totale</span><strong>${euros(registrationTotal(r))}</strong></div><div><span>Acconto</span><strong>${euros(r.deposit_amount)}</strong></div><div><span>Saldo</span><strong>${euros(registrationBalance(r))}</strong></div><div><span>Pagamento</span><strong>${paymentLabel(r.payment_status)}</strong></div><div><span>Email</span><strong>${r.confirmation_email_sent_at?'Inviata':'Non inviata'}</strong></div><div><span>Hotel / Camera</span><strong>${esc(roomLabel(r))}</strong></div></div>
      <div class="booking-mobile-actions">${r.receipt_path?`<button class="mini-btn" onclick="openReceipt('${String(r.receipt_path).replace(/'/g,"\\'")}')">Distinta</button>`:''}<button class="mini-btn" onclick="resendConfirmation('${r.id}')">Reinvia PDF</button><button class="mini-btn ${r.payment_status==='confirmed'?'':'success'}" onclick="togglePayment('${r.id}')">${r.payment_status==='confirmed'?'Pagamento ✓':'Conferma pagamento'}</button><button class="mini-btn" onclick="editBooking('${r.id}')">Modifica</button><button class="mini-btn danger" onclick="deleteBooking('${r.id}')">Elimina</button></div>
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

function roomParticipantsLabel(r){
  const pdata=parseParticipantData(r);
  if(pdata.length)return pdata.map(p=>p.name).filter(Boolean).join(', ');
  return `${r.first_name||''} ${r.last_name||''}`.trim();
}
function roomAssigned(r){return Boolean((r.room_number||'').trim()||(r.room_type||'').trim())}
function filteredRoomRegistrations(){
  const q=($('roomSearch')?.value||'').trim().toLowerCase();
  const church=$('roomChurchFilter')?.value||'';
  const assignment=$('roomAssignmentFilter')?.value||'';
  return activeRegistrations().filter(r=>{
    const hay=[r.first_name,r.last_name,r.church,r.room_number,r.room_type,roomParticipantsLabel(r)].filter(Boolean).join(' ').toLowerCase();
    const assigned=roomAssigned(r);
    return (!q||hay.includes(q))&&(!church||r.church===church)&&(!assignment||(assignment==='assigned'?assigned:!assigned));
  });
}
function renderRoomList(){
  if(!$('roomList'))return;
  const all=activeRegistrations();
  const rows=filteredRoomRegistrations();
  const assigned=all.filter(roomAssigned).length;
  $('roomStatBookings').textContent=all.length;
  $('roomStatAssigned').textContent=assigned;
  $('roomStatUnassigned').textContent=Math.max(all.length-assigned,0);
  $('roomStatPeople').textContent=all.reduce((s,r)=>s+registrationPeople(r),0);

  $('roomList').innerHTML=rows.map(r=>{
    const pdata=parseParticipantData(r);
    const participantHtml=pdata.map(p=>`<span>${esc(p.name||'Partecipante')}${p.type==='child'?` · ${esc(p.age_label||'Bambino')}`:''}</span>`).join('');
    return `<article class="room-card ${roomAssigned(r)?'assigned':'unassigned'}">
      <div class="room-card-main">
        <div class="room-card-title">
          <div>
            <span class="section-kicker">${roomAssigned(r)?'CAMERA ASSEGNATA':'DA ASSEGNARE'}</span>
            <h4>${esc(r.first_name)} ${esc(r.last_name)}</h4>
            <p>${esc(r.church||'—')} · ${registrationPeople(r)} ${registrationPeople(r)===1?'persona':'persone'} · ${registrationAdults(r)} adulti / ${registrationChildren(r)} bambini</p>
          </div>
          <span class="room-state ${roomAssigned(r)?'ok':'pending'}">${roomAssigned(r)?'Assegnata':'Da assegnare'}</span>
        </div>
        <div class="room-participants">${participantHtml||`<span>${esc(r.first_name)} ${esc(r.last_name)}</span>`}</div>
      </div>
      <div class="room-fields">
        <label>Tipologia / esigenza camera
          <input class="room-type-input" data-id="${r.id}" value="${esc(r.room_type||'')}" placeholder="Es. Matrimoniale, Tripla, 2 matrimoniali…" />
        </label>
        <label>Numero camera
          <input class="room-number-input" data-id="${r.id}" value="${esc(r.room_number||'')}" placeholder="Es. 204 oppure 204 + 205" />
        </label>
        <button class="accent-button room-save-button" type="button" onclick="saveRoomAssignment('${r.id}')">Salva camera</button>
      </div>
    </article>`;
  }).join('')||'<div class="panel-card"><p class="muted">Nessuna prenotazione corrisponde ai filtri.</p></div>';
}
async function saveRoomAssignment(id){
  const card=[...document.querySelectorAll('.room-card')].find(x=>x.querySelector(`.room-type-input[data-id="${id}"]`));
  if(!card)return;
  const roomType=card.querySelector('.room-type-input')?.value.trim()||null;
  const roomNumber=card.querySelector('.room-number-input')?.value.trim()||null;
  const btn=card.querySelector('.room-save-button');
  if(btn){btn.disabled=true;btn.textContent='Salvataggio…'}
  const {error}=await sb.from('registrations').update({hotel_name:'Hotel dei Pini',room_type:roomType,room_number:roomNumber,updated_at:new Date().toISOString()}).eq('id',id);
  if(btn){btn.disabled=false;btn.textContent='Salva camera'}
  if(error){alert('Errore Room List: '+error.message);return}
  showToast('Room List aggiornata.');
  await loadAll();
}
window.saveRoomAssignment=saveRoomAssignment;
if($('roomSearch'))$('roomSearch').addEventListener('input',renderRoomList);
if($('roomChurchFilter'))$('roomChurchFilter').addEventListener('change',renderRoomList);
if($('roomAssignmentFilter'))$('roomAssignmentFilter').addEventListener('change',renderRoomList);

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
      <div class="group-head"><div><strong>${esc(r.first_name)} ${esc(r.last_name)}</strong><span>${esc(r.church)} · ${registrationPeople(r)} ${registrationPeople(r)===1?'persona':'persone'} · ${esc(roomLabel(r))}</span></div><div class="group-progress">${done}/${allPs.length||registrationPeople(r)} presenti</div></div>
      ${ps.map(p=>participantHtml(p)).join('')||'<div style="padding:15px 17px" class="muted">Nessun partecipante corrisponde al filtro.</div>'}
    </article>`;
  }).join('') || '<div class="panel-card"><p class="muted">Nessun gruppo trovato.</p></div>';
}
function participantHtml(p){
  const cls=p.issue?'issue':p.checked_in?'present':'';
  const status=p.checked_in?`Arrivato alle ${fmtTime(p.checked_in_at)}${p.checked_in_by?` · ${esc(p.checked_in_by)}`:''}`:'Non ancora arrivato';
  const age=p.participant_type==='child'?(Number(p.age_years)>=11?'11+ anni':`${p.age_years} ${Number(p.age_years)===1?'anno':'anni'}`):'Adulto';
  const nightly=Number(p.nightly_rate??(p.participant_type==='child'?childNightlyRate(p.age_years):ADULT_NIGHTLY));const stay=Number(p.price_amount??(p.participant_type==='child'?childPrice(p.age_years):adultPrice()));
  const meta=[age,nightly===0?'Gratuito':`${euros(nightly)}/notte`,`${euros(stay)} soggiorno`,p.birth_date?`Nato/a il ${new Date(p.birth_date+'T00:00:00').toLocaleDateString('it-IT')}`:''].filter(Boolean).join(' · ');
  return `<div class="participant-row ${cls}">
    <div class="participant-main"><strong>${esc(p.participant_name)}</strong><span>${esc(meta)}</span></div>
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

for(let i=1;i<=10;i++) $('mAdultCount').insertAdjacentHTML('beforeend',`<option value="${i}">${i}</option>`);
for(let i=0;i<=10;i++) $('mChildCount').insertAdjacentHTML('beforeend',`<option value="${i}">${i}</option>`);
function adminAgeOptions(selected=''){let h='<option value="" disabled '+(selected===''?'selected':'')+'>Età</option>';for(let i=0;i<=10;i++)h+=`<option value="${i}" ${String(selected)===String(i)?'selected':''}>${i} ${i===1?'anno':'anni'}</option>`;h+=`<option value="11" ${String(selected)==='11'?'selected':''}>11+ anni</option>`;return h}
function adminParticipantDataFor(r){return parseParticipantData(r).filter(p=>p.key!=='main')}
function renderAdminParticipantEditor(data=[]){
  const adults=Math.max(1,Number($('mAdultCount').value||1)), children=Math.max(0,Number($('mChildCount').value||0));
  const oldAdults=data.filter(p=>p.type!=='child'), oldChildren=data.filter(p=>p.type==='child');
  let html='';
  if(adults>1){html+='<div class="admin-participant-title"><strong>Altri adulti</strong><span>€50/notte · €100 soggiorno</span></div>';for(let i=0;i<adults-1;i++){const p=oldAdults[i]||{};html+=`<div class="admin-participant-card" data-type="adult"><strong>Adulto ${i+2}</strong><div class="form-grid two"><div class="field"><label>Nome *</label><input class="ap-first" value="${esc(p.first_name||'')}" required></div><div class="field"><label>Cognome *</label><input class="ap-last" value="${esc(p.last_name||'')}" required></div><div class="field"><label>Data di nascita *</label><input class="ap-birth" type="date" value="${esc(p.birth_date||'')}" required></div></div></div>`}}
  if(children){html+='<div class="admin-participant-title"><strong>Bambini</strong><span>Tariffa automatica per età</span></div>';for(let i=0;i<children;i++){const p=oldChildren[i]||{};html+=`<div class="admin-participant-card" data-type="child"><strong>Bambino ${i+1}</strong><div class="form-grid two"><div class="field"><label>Nome *</label><input class="ap-first" value="${esc(p.first_name||'')}" required></div><div class="field"><label>Cognome *</label><input class="ap-last" value="${esc(p.last_name||'')}" required></div><div class="field"><label>Età *</label><select class="ap-age" required>${adminAgeOptions(p.age_years??'')}</select></div><div class="field"><label>Data di nascita</label><input class="ap-birth" type="date" value="${esc(p.birth_date||'')}"></div></div></div>`}}
  $('mParticipantsEditor').innerHTML=html; updateModalSummary();
}
function collectAdminExtraParticipants(){
  const adults=[],children=[];
  $('mParticipantsEditor').querySelectorAll('.admin-participant-card').forEach(card=>{const obj={first_name:card.querySelector('.ap-first').value.trim(),last_name:card.querySelector('.ap-last').value.trim(),birth_date:card.querySelector('.ap-birth')?.value||null};if(card.dataset.type==='child'){obj.age_years=Number(card.querySelector('.ap-age').value);children.push(obj)}else adults.push(obj)});
  return{adults,children};
}
function adminFullParticipantData(){
  const x=collectAdminExtraParticipants(); const first=$('mFirstName').value.trim(),last=$('mLastName').value.trim();
  const arr=[{key:'main',type:'adult',first_name:first,last_name:last,name:`${first} ${last}`.trim(),birth_date:null,age_years:null,age_label:'Adulto',nightly_rate:ADULT_NIGHTLY,price:adultPrice()}];
  x.adults.forEach((p,i)=>arr.push({key:`adult-${i+1}`,type:'adult',...p,name:`${p.first_name} ${p.last_name}`.trim(),age_years:null,age_label:'Adulto',nightly_rate:ADULT_NIGHTLY,price:adultPrice()}));
  x.children.forEach((p,i)=>arr.push({key:`child-${i+1}`,type:'child',...p,name:`${p.first_name} ${p.last_name}`.trim(),age_label:Number(p.age_years)>=11?'11+ anni':`${p.age_years} anni`,nightly_rate:childNightlyRate(p.age_years),price:childPrice(p.age_years)}));
  return arr;
}
let manualDepositTouched=false;
function updateModalSummary(){
  const adults=Math.max(1,Number($('mAdultCount').value||1)), children=Math.max(0,Number($('mChildCount').value||0));
  const childAges=[...$('mParticipantsEditor').querySelectorAll('[data-type="child"] .ap-age')].map(x=>Number(x.value)).filter(Number.isFinite);
  const reduced=childAges.filter(a=>a>=3&&a<=10).length,full=childAges.filter(a=>a>=11).length;
  const total=adults*adultPrice()+reduced*(CHILD_REDUCED_NIGHTLY*NIGHTS)+full*adultPrice();
  const suggestedDeposit=(adults+reduced+full)*DEPOSIT_PER_PAYING_PERSON;
  if(!manualDepositTouched || $('mManualDeposit').value==='') $('mManualDeposit').value=suggestedDeposit.toFixed(2).replace('.',',');
  let deposit=parseMoneyInput($('mManualDeposit').value);
  if(!Number.isFinite(deposit)||deposit<0) deposit=0;
  $('mPeopleTotal').textContent=adults+children;
  $('mCampTotal').textContent=euros(total);
  $('mDeposit').textContent=euros(deposit);
  if($('mBalance')) $('mBalance').textContent=euros(Math.max(total-deposit,0));
}
$('mAdultCount').addEventListener('change',()=>renderAdminParticipantEditor(collectAdminExtraParticipants().adults.map((x,i)=>({...x,type:'adult',key:`adult-${i+1}`})).concat(collectAdminExtraParticipants().children.map((x,i)=>({...x,type:'child',key:`child-${i+1}`})))));
$('mChildCount').addEventListener('change',()=>renderAdminParticipantEditor(collectAdminExtraParticipants().adults.map((x,i)=>({...x,type:'adult',key:`adult-${i+1}`})).concat(collectAdminExtraParticipants().children.map((x,i)=>({...x,type:'child',key:`child-${i+1}`})))));
$('mParticipantsEditor').addEventListener('input',updateModalSummary);$('mParticipantsEditor').addEventListener('change',updateModalSummary);
$('mManualDeposit').addEventListener('input',()=>{manualDepositTouched=true;updateModalSummary()});
$('mManualDeposit').addEventListener('blur',()=>{const v=parseMoneyInput($('mManualDeposit').value);if(Number.isFinite(v))$('mManualDeposit').value=v.toFixed(2).replace('.',',')});

function openBookingModal(mode='new',r=null){
  $('adminBookingForm').reset();clearMsg($('modalMessage'));$('editRegistrationId').value=r?.id||'';$('modalTitle').textContent=mode==='edit'?'Modifica prenotazione':'Nuova prenotazione';$('sendEmailRow').classList.toggle('hidden2',mode==='edit');
  manualDepositTouched=!!r;
  if(r){$('mFirstName').value=r.first_name||'';$('mLastName').value=r.last_name||'';$('mEmail').value=r.email||'';$('mPhone').value=r.phone||'';$('mMinister').value=r.is_minister?'si':'no';$('mChurch').value=r.church||'';$('mAdultCount').value=String(registrationAdults(r));$('mChildCount').value=String(registrationChildren(r));$('mStatus').value=r.status||'ricevuta';$('mPaymentStatus').value=r.payment_status||'pending';$('mManualDeposit').value=Number(r.deposit_amount||0).toFixed(2).replace('.',',');$('mHotelName').value=r.hotel_name||'Hotel dei Pini';$('mRoomType').value=r.room_type||'';$('mRoomNumber').value=r.room_number||'';renderAdminParticipantEditor(adminParticipantDataFor(r));}
  else{$('mAdultCount').value='1';$('mChildCount').value='0';$('mStatus').value='ricevuta';$('mPaymentStatus').value='pending';$('mManualDeposit').value='';$('mHotelName').value='Hotel dei Pini';$('mRoomType').value='';$('mRoomNumber').value='';renderAdminParticipantEditor([])}
  updateModalSummary();$('bookingModal').classList.remove('hidden2');setTimeout(()=>$('mFirstName').focus(),50);
}
function closeBookingModal(){$('bookingModal').classList.add('hidden2')}
$('newBookingButton').addEventListener('click',()=>openBookingModal('new'));$('closeModal').addEventListener('click',closeBookingModal);$('cancelModal').addEventListener('click',closeBookingModal);$('bookingModal').addEventListener('click',e=>{if(e.target===$('bookingModal'))closeBookingModal()});
function editBooking(id){const r=registrations.find(x=>x.id===id);if(r)openBookingModal('edit',r)}
window.editBooking=editBooking;

$('adminBookingForm').addEventListener('submit',async e=>{
  e.preventDefault();clearMsg($('modalMessage'));if(!$('adminBookingForm').reportValidity())return;
  const id=$('editRegistrationId').value;const original=id?registrations.find(x=>x.id===id):null;const paymentStatus=$('mPaymentStatus').value;
  const pdata=adminFullParticipantData();const adultCount=Number($('mAdultCount').value),childCount=Number($('mChildCount').value);
  if(pdata.filter(p=>p.type==='adult').length!==adultCount||pdata.filter(p=>p.type==='child').length!==childCount){setMsg($('modalMessage'),'error','Controlla il numero dei partecipanti.');return}
  const total=pdata.reduce((s,p)=>s+Number(p.price||0),0);
  const deposit=parseMoneyInput($('mManualDeposit').value);
  if(!Number.isFinite(deposit)||deposit<0){setMsg($('modalMessage'),'error','Inserisci un acconto valido.');return}
  if(deposit>total){setMsg($('modalMessage'),'error','L’acconto non può superare il totale del soggiorno.');return}
  const balance=Math.max(total-deposit,0);
  const details=pdata.slice(1).map(p=>`${p.name}${p.birth_date?`, ${new Date(p.birth_date+'T00:00:00').toLocaleDateString('it-IT')}`:''}${p.type==='child'?` · ${p.age_label}`:''}`).join('\n')||null;
  const payload={first_name:$('mFirstName').value.trim(),last_name:$('mLastName').value.trim(),email:$('mEmail').value.trim().toLowerCase(),phone:$('mPhone').value.trim(),is_minister:$('mMinister').value==='si',church:$('mChurch').value.trim(),guest_count:pdata.length,adult_count:adultCount,child_count:childCount,participants_data:pdata,guest_details:details,total_amount:total,deposit_amount:deposit,balance_amount:balance,status:$('mStatus').value,payment_status:paymentStatus,payment_confirmed_at:paymentStatus==='confirmed'?(original?.payment_confirmed_at||new Date().toISOString()):null,payment_confirmed_by:paymentStatus==='confirmed'?(original?.payment_confirmed_by||currentAdminEmail):null,hotel_name:$('mHotelName').value.trim()||null,room_type:$('mRoomType').value.trim()||null,room_number:$('mRoomNumber').value.trim()||null,updated_at:new Date().toISOString()};
  $('saveBookingButton').disabled=true;$('saveBookingButton').textContent='Salvataggio…';let savedId=id,error;
  if(id){({error}=await sb.from('registrations').update(payload).eq('id',id));}
  else{payload.source='manual';const result=await sb.from('registrations').insert(payload).select('id').single();error=result.error;savedId=result.data?.id;}
  if(error){setMsg($('modalMessage'),'error','Errore: '+error.message);$('saveBookingButton').disabled=false;$('saveBookingButton').textContent='Salva prenotazione';return}
  if(!id&&savedId){
    try{
      const notifyResult=await invokeConfirmationFunction(savedId,{sendUser:$('mSendEmail').checked,notifyAdmin:true});
      if(notifyResult?.telegram_sent) showToast('Prenotazione salvata · notifica Telegram inviata ad Admin e Pastori.');
      else showToast('Prenotazione salvata · attenzione: notifica Telegram non confermata.');
    }catch(notifyError){
      console.error('Notifica nuova prenotazione manuale non riuscita:',notifyError);
      showToast('Prenotazione salvata, ma la notifica Telegram non è partita.');
    }
  }
  $('saveBookingButton').disabled=false;$('saveBookingButton').textContent='Salva prenotazione';closeBookingModal();await loadAll();
});

async function invokeConfirmationFunction(registrationId,{force=false,sendUser=true,notifyAdmin=true}={}){
  try{
    const {data:{session}}=await sb.auth.getSession();
    const token=session?.access_token||SUPABASE_ANON_KEY;
    const response=await fetch(`${SUPABASE_URL}/functions/v1/send-booking-confirmation`,{method:'POST',headers:{'Content-Type':'application/json','apikey':SUPABASE_ANON_KEY,'Authorization':`Bearer ${token}`},body:JSON.stringify({registration_id:registrationId,force,send_user:sendUser,notify_admin:notifyAdmin})});
    const data=await response.json().catch(()=>({}));
    if(!response.ok) throw new Error(data.error||'Invio non riuscito');
    return data;
  }catch(e){console.error(e);throw e}
}
async function resendConfirmation(id){
  const r=registrations.find(x=>x.id===id); if(!r)return;
  if(!confirm(`Reinviare il PDF di prenotazione a ${r.email}?`))return;
  try{await invokeConfirmationFunction(id,{force:true,sendUser:true,notifyAdmin:false});showToast('PDF reinviato via email.');await loadAll();}
  catch(e){alert('Invio non riuscito: '+e.message)}
}
window.resendConfirmation=resendConfirmation;

async function togglePayment(id){
  const r=registrations.find(x=>x.id===id);if(!r)return;
  const confirmPayment=r.payment_status!=='confirmed';
  const patch=confirmPayment?{payment_status:'confirmed',payment_confirmed_at:new Date().toISOString(),payment_confirmed_by:currentAdminEmail}:{payment_status:'pending',payment_confirmed_at:null,payment_confirmed_by:null};
  const {error}=await sb.from('registrations').update(patch).eq('id',id);
  if(error){alert('Errore pagamento: '+error.message);return}
  showToast(confirmPayment?'Pagamento confermato.':'Conferma pagamento annullata.');
  await loadAll();
}
window.togglePayment=togglePayment;

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
    'Data prenotazione':fmtDate(r.created_at),'Nome':r.first_name,'Cognome':r.last_name,'Email':r.email,'Cellulare':r.phone,'Ministro':r.is_minister?'Sì':'No','Chiesa di appartenenza':r.church,'Adulti':registrationAdults(r),'Bambini':registrationChildren(r),'Persone totali':registrationPeople(r),'Bambini 0-2':parseParticipantData(r).filter(p=>p.type==='child'&&Number(p.age_years)<=2).length,'Bambini 3-10':parseParticipantData(r).filter(p=>p.type==='child'&&Number(p.age_years)>=3&&Number(p.age_years)<=10).length,'Bambini 11+':parseParticipantData(r).filter(p=>p.type==='child'&&Number(p.age_years)>=11).length,'Altri partecipanti':r.guest_details||'','Notti':2,'Totale soggiorno €':registrationTotal(r),'Acconto €':Number(r.deposit_amount||0),'Saldo residuo €':registrationBalance(r),'Stato':statusLabel(r.status),'Origine':r.source==='manual'?'Manuale':'Online','Tipo acconto':r.source==='manual'?'Contanti':'Bonifico / Distinta','Email PDF inviata':r.confirmation_email_sent_at?fmtDate(r.confirmation_email_sent_at):'No','N. invii email':Number(r.confirmation_email_count||0),'Pagamento':paymentLabel(r.payment_status),'Pagamento confermato il':r.payment_confirmed_at?fmtDate(r.payment_confirmed_at):'','Confermato da':r.payment_confirmed_by||'','Hotel':r.hotel_name||'','Tipologia camera':r.room_type||'','Camera':r.room_number||'','Distinta':r.receipt_path||''
  }));
  const participantRows=participants.map(p=>{
    const r=registrations.find(x=>x.id===p.registration_id);
    return {'Famiglia / Referente':r?`${r.first_name} ${r.last_name}`:'','Partecipante':p.participant_name,'Tipo':p.participant_type==='child'?'Bambino':'Adulto','Età':p.participant_type==='child'?(Number(p.age_years)>=11?'11+':Number(p.age_years)):'Adulto','Tariffa/notte €':Number(p.nightly_rate??(p.participant_type==='child'?childNightlyRate(p.age_years):ADULT_NIGHTLY)),'Tariffa soggiorno (2 notti) €':Number(p.price_amount||0),'Data di nascita':p.birth_date?new Date(p.birth_date+'T00:00:00').toLocaleDateString('it-IT'):'','Chiesa':r?.church||'','Hotel':r?.hotel_name||'','Tipologia camera':r?.room_type||'','Camera':r?.room_number||'','Check-in':p.checked_in?'PRESENTE':'ASSENTE','Orario arrivo':p.checked_in_at?fmtDate(p.checked_in_at):'','Operatore':p.checked_in_by||'','Da verificare':p.issue?'Sì':'No','Note':p.notes||''};
  });
  const roomRows=activeRegistrations().map(r=>({
    'Referente':`${r.first_name||''} ${r.last_name||''}`.trim(),
    'Chiesa':r.church||'',
    'Persone':registrationPeople(r),
    'Adulti':registrationAdults(r),
    'Bambini':registrationChildren(r),
    'Partecipanti':roomParticipantsLabel(r),
    'Hotel':r.hotel_name||'Hotel dei Pini',
    'Tipologia / esigenza camera':r.room_type||'',
    'Numero camera':r.room_number||'',
    'Stato assegnazione':roomAssigned(r)?'ASSEGNATA':'DA ASSEGNARE'
  }));
  const wb=XLSX.utils.book_new();
  const ws1=XLSX.utils.json_to_sheet(bookingRows);ws1['!cols']=Array(34).fill({wch:20});XLSX.utils.book_append_sheet(wb,ws1,'Prenotazioni');
  const ws2=XLSX.utils.json_to_sheet(participantRows);ws2['!cols']=Array(18).fill({wch:20});XLSX.utils.book_append_sheet(wb,ws2,'Check-in Hotel');
  const ws3=XLSX.utils.json_to_sheet(roomRows);ws3['!cols']=Array(10).fill({wch:24});XLSX.utils.book_append_sheet(wb,ws3,'Room List');
  XLSX.writeFile(wb,`Winter_Camp_Gestionale_${new Date().toISOString().slice(0,10)}.xlsx`);
});

// ============================================================
// V7.4 - ESPORTAZIONE PDF
// Genera un unico report stampabile con:
// 1) Riepilogo gestionale
// 2) Prenotazioni
// 3) Room List
// 4) Check-in Hotel
// ============================================================

function pdfMoney(v){
  return new Intl.NumberFormat('it-IT',{style:'currency',currency:'EUR'}).format(Number(v)||0);
}

function pdfSafe(v){
  return String(v??'').replace(/\s+/g,' ').trim();
}

function addPdfPageFooter(doc){
  const pages=doc.getNumberOfPages();
  const generated=new Date().toLocaleString('it-IT');
  for(let i=1;i<=pages;i++){
    doc.setPage(i);
    const w=doc.internal.pageSize.getWidth();
    const h=doc.internal.pageSize.getHeight();
    doc.setDrawColor(225,228,233);
    doc.line(12,h-10,w-12,h-10);
    doc.setFontSize(7);
    doc.setTextColor(110,118,130);
    doc.text(`Winter Camp 2026 · Generato il ${generated}`,12,h-5);
    doc.text(`Pagina ${i} di ${pages}`,w-12,h-5,{align:'right'});
  }
}

function pdfSectionTitle(doc,title,subtitle,y=16){
  doc.setTextColor(23,32,51);
  doc.setFont('helvetica','bold');
  doc.setFontSize(16);
  doc.text(title,12,y);
  if(subtitle){
    doc.setFont('helvetica','normal');
    doc.setFontSize(8);
    doc.setTextColor(105,113,126);
    doc.text(subtitle,12,y+5);
  }
}

function pdfNewSection(doc,title,subtitle){
  doc.addPage('a4','landscape');
  pdfSectionTitle(doc,title,subtitle,16);
  return subtitle?26:22;
}

function buildPdfSummary(doc){
  const regs=activeRegistrations();
  const totalPeople=regs.reduce((s,r)=>s+registrationPeople(r),0);
  const totalCamp=regs.reduce((s,r)=>s+registrationTotal(r),0);
  const onlineRegs=regs.filter(r=>r.source!=='manual' && Boolean(r.receipt_path));
  const manualRegs=regs.filter(r=>r.source==='manual');
  const bank=onlineRegs.reduce((s,r)=>s+Number(r.deposit_amount||0),0);
  const cash=manualRegs.reduce((s,r)=>s+Number(r.deposit_amount||0),0);
  const balance=regs.reduce((s,r)=>s+registrationBalance(r),0);
  const checked=participants.filter(p=>p.checked_in).length;
  const assignedRooms=regs.filter(roomAssigned).length;

  doc.setFont('helvetica','bold');
  doc.setFontSize(23);
  doc.setTextColor(17,29,48);
  doc.text('Winter Camp 2026',12,18);
  doc.setFontSize(10);
  doc.setFont('helvetica','normal');
  doc.setTextColor(100,108,120);
  doc.text('Report gestionale completo · Hotel dei Pini · 6-8 dicembre 2026',12,25);

  const cards=[
    ['Prenotazioni',String(regs.length)],
    ['Persone',String(totalPeople)],
    ['Totale soggiorno',pdfMoney(totalCamp)],
    ['Acconti bonifico',pdfMoney(bank)],
    ['Acconti contanti',pdfMoney(cash)],
    ['Saldo residuo',pdfMoney(balance)],
    ['Check-in',`${checked}/${participants.length}`],
    ['Camere assegnate',`${assignedRooms}/${regs.length}`]
  ];

  const startX=12,startY=35,cardW=65,cardH=22,gap=5;
  cards.forEach((c,i)=>{
    const col=i%4,row=Math.floor(i/4);
    const x=startX+col*(cardW+gap), y=startY+row*(cardH+gap);
    doc.setFillColor(248,249,251);
    doc.setDrawColor(226,229,234);
    doc.roundedRect(x,y,cardW,cardH,3,3,'FD');
    doc.setFont('helvetica','normal');
    doc.setFontSize(7);
    doc.setTextColor(108,116,128);
    doc.text(c[0].toUpperCase(),x+4,y+7);
    doc.setFont('helvetica','bold');
    doc.setFontSize(13);
    doc.setTextColor(24,32,51);
    doc.text(c[1],x+4,y+16);
  });

  doc.setFont('helvetica','bold');
  doc.setFontSize(10);
  doc.setTextColor(24,32,51);
  doc.text('Soggiorno',12,96);
  doc.setFont('helvetica','normal');
  doc.setFontSize(9);
  doc.setTextColor(75,84,98);
  doc.text('Check-in: 6 dicembre 2026 dalle ore 15:00',12,103);
  doc.text('Check-out: 8 dicembre 2026 · pranzo incluso',12,109);
  doc.text('Hotel dei Pini · Porto Empedocle',12,115);
}

function pdfBookings(doc){
  let y=pdfNewSection(doc,'Prenotazioni','Anagrafica, situazione economica e provenienza dell’acconto');
  const rows=registrations.map(r=>[
    fmtDate(r.created_at),
    `${pdfSafe(r.first_name)} ${pdfSafe(r.last_name)}`,
    pdfSafe(r.phone),
    pdfSafe(r.email),
    pdfSafe(r.church),
    String(registrationPeople(r)),
    String(registrationAdults(r)),
    String(registrationChildren(r)),
    pdfMoney(registrationTotal(r)),
    pdfMoney(r.deposit_amount),
    pdfMoney(registrationBalance(r)),
    r.source==='manual'?'Contanti':'Bonifico',
    paymentLabel(r.payment_status),
    statusLabel(r.status)
  ]);

  doc.autoTable({
    startY:y,
    head:[['Data','Referente','Cellulare','Email','Chiesa','Pers.','Ad.','Bamb.','Totale','Acconto','Saldo','Acconto','Pagamento','Stato']],
    body:rows,
    theme:'grid',
    styles:{font:'helvetica',fontSize:5.9,cellPadding:1.6,overflow:'linebreak',valign:'middle'},
    headStyles:{fillColor:[23,36,60],textColor:255,fontStyle:'bold'},
    alternateRowStyles:{fillColor:[248,249,251]},
    columnStyles:{
      0:{cellWidth:20},1:{cellWidth:28},2:{cellWidth:24},3:{cellWidth:36},
      4:{cellWidth:30},5:{cellWidth:11},6:{cellWidth:9},7:{cellWidth:11},
      8:{cellWidth:20},9:{cellWidth:20},10:{cellWidth:20},11:{cellWidth:18},
      12:{cellWidth:22},13:{cellWidth:18}
    },
    margin:{left:8,right:8,bottom:15}
  });
}

function pdfRoomList(doc){
  let y=pdfNewSection(doc,'Room List','Assegnazione camere e composizione dei nuclei');
  const rows=activeRegistrations().map(r=>[
    `${pdfSafe(r.first_name)} ${pdfSafe(r.last_name)}`,
    pdfSafe(r.church),
    String(registrationPeople(r)),
    pdfSafe(roomParticipantsLabel(r)),
    pdfSafe(r.room_type||''),
    pdfSafe(r.room_number||''),
    roomAssigned(r)?'ASSEGNATA':'DA ASSEGNARE'
  ]);

  doc.autoTable({
    startY:y,
    head:[['Referente','Chiesa','Persone','Partecipanti','Tipologia / esigenza camera','Numero camera','Stato']],
    body:rows,
    theme:'grid',
    styles:{font:'helvetica',fontSize:7,cellPadding:2,overflow:'linebreak',valign:'middle'},
    headStyles:{fillColor:[23,36,60],textColor:255,fontStyle:'bold'},
    alternateRowStyles:{fillColor:[248,249,251]},
    columnStyles:{
      0:{cellWidth:36},1:{cellWidth:38},2:{cellWidth:14},3:{cellWidth:72},
      4:{cellWidth:52},5:{cellWidth:32},6:{cellWidth:28}
    },
    margin:{left:10,right:10,bottom:15}
  });
}

function pdfCheckin(doc){
  let y=pdfNewSection(doc,'Check-in Hotel','Elenco individuale dei partecipanti');
  const rows=participants.map(p=>{
    const r=registrations.find(x=>x.id===p.registration_id);
    return [
      r?`${pdfSafe(r.first_name)} ${pdfSafe(r.last_name)}`:'',
      pdfSafe(p.participant_name),
      p.participant_type==='child'?'Bambino':'Adulto',
      p.participant_type==='child'?(Number(p.age_years)>=11?'11+':String(Number(p.age_years))):'Adulto',
      pdfSafe(r?.church||''),
      pdfSafe(r?.room_type||''),
      pdfSafe(r?.room_number||''),
      p.checked_in?'PRESENTE':'ASSENTE',
      p.checked_in_at?fmtDate(p.checked_in_at):'',
      p.issue?'DA VERIFICARE':'',
      pdfSafe(p.notes||'')
    ];
  });

  doc.autoTable({
    startY:y,
    head:[['Referente','Partecipante','Tipo','Età','Chiesa','Tipologia camera','Camera','Check-in','Arrivo','Problema','Note']],
    body:rows,
    theme:'grid',
    styles:{font:'helvetica',fontSize:6.4,cellPadding:1.8,overflow:'linebreak',valign:'middle'},
    headStyles:{fillColor:[23,36,60],textColor:255,fontStyle:'bold'},
    alternateRowStyles:{fillColor:[248,249,251]},
    columnStyles:{
      0:{cellWidth:32},1:{cellWidth:34},2:{cellWidth:18},3:{cellWidth:15},
      4:{cellWidth:32},5:{cellWidth:38},6:{cellWidth:25},7:{cellWidth:22},
      8:{cellWidth:28},9:{cellWidth:24},10:{cellWidth:42}
    },
    margin:{left:8,right:8,bottom:15}
  });
}

function exportManagementPdf(){
  if(!window.jspdf?.jsPDF){
    alert('Modulo PDF non disponibile. Ricarica la pagina e riprova.');
    return;
  }
  if(typeof window.jspdf.jsPDF.API.autoTable!=='function'){
    alert('Modulo tabella PDF non disponibile. Ricarica la pagina e riprova.');
    return;
  }

  const {jsPDF}=window.jspdf;
  const doc=new jsPDF({orientation:'landscape',unit:'mm',format:'a4',compress:true});

  buildPdfSummary(doc);
  pdfBookings(doc);
  pdfRoomList(doc);
  pdfCheckin(doc);
  addPdfPageFooter(doc);

  doc.save(`Winter_Camp_Gestionale_${new Date().toISOString().slice(0,10)}.pdf`);
}

$('exportPdfButton').addEventListener('click',exportManagementPdf);

function showToast(text){
  const el=$('adminToast'); if(!el)return;
  el.textContent=text;el.classList.remove('hidden2');
  clearTimeout(showToast._t);showToast._t=setTimeout(()=>el.classList.add('hidden2'),4200);
}
function renderNotifications(){
  const unread=adminNotifications.filter(n=>!n.read_at).length;
  $('notificationBadge').textContent=unread>99?'99+':String(unread);
  $('notificationBadge').classList.toggle('hidden2',unread===0);
  $('notificationList').innerHTML=adminNotifications.map(n=>`<article class="notification-item ${n.read_at?'':'unread'}" onclick="openNotification('${n.id}','${n.registration_id||''}')"><strong>${esc(n.title)}</strong><p>${esc(n.body)}</p><time>${fmtDate(n.created_at)}</time></article>`).join('')||'<p class="muted">Nessuna notifica.</p>';
}
async function openNotification(id,registrationId){
  await sb.from('admin_notifications').update({read_at:new Date().toISOString()}).eq('id',id);
  if(registrationId){switchView('bookings');const r=registrations.find(x=>x.id===registrationId);if(r)setTimeout(()=>editBooking(registrationId),80)}
  $('notificationDrawer').classList.add('hidden2');
  await loadAll();
}
window.openNotification=openNotification;
$('notificationButton').addEventListener('click',async()=>{
  $('notificationDrawer').classList.toggle('hidden2');
  if('Notification' in window && Notification.permission==='default'){try{await Notification.requestPermission()}catch{}}
});
$('closeNotifications').addEventListener('click',()=>$('notificationDrawer').classList.add('hidden2'));
$('enableBrowserNotifications').addEventListener('click',async()=>{
  if(!('Notification' in window)){alert('Il browser non supporta le notifiche desktop.');return}
  const result=await Notification.requestPermission();
  showToast(result==='granted'?'Notifiche browser attivate.':'Permesso notifiche non concesso.');
});
$('markAllRead').addEventListener('click',async()=>{
  const ids=adminNotifications.filter(n=>!n.read_at).map(n=>n.id);
  if(!ids.length)return;
  await sb.from('admin_notifications').update({read_at:new Date().toISOString()}).in('id',ids);
  await loadAll();
});
function notifyNewRegistration(n){
  showToast(`${n.title}: ${n.body}`);
  if('Notification' in window && Notification.permission==='granted'){
    try{new Notification(n.title,{body:n.body,tag:n.registration_id||n.id})}catch{}
  }
}

sb.channel('wintercamp-live-v4')
  .on('postgres_changes',{event:'*',schema:'public',table:'registrations'},()=>loadAll())
  .on('postgres_changes',{event:'*',schema:'public',table:'registration_participants'},()=>loadAll())
  .on('postgres_changes',{event:'INSERT',schema:'public',table:'admin_notifications'},payload=>{notifyNewRegistration(payload.new);loadAll()})
  .on('postgres_changes',{event:'UPDATE',schema:'public',table:'admin_notifications'},()=>loadAll())
  .subscribe();

checkAdmin();
