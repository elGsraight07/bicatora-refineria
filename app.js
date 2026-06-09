// app.js — Bitácora de Refinería

const TYPE_LABELS = {shutdown:'Paro de planta',repair:'Reparación',catalyst:'Catalizador',material:'Materiales',maintenance:'Mantenimiento',other:'Otro'};
const TYPE_COLORS = {shutdown:'#E24B4A',repair:'#EF9F27',catalyst:'#1D9E75',material:'#185FA5',maintenance:'#7F77DD',other:'#888780'};
const TYPE_RGB    = {shutdown:[226,75,74],repair:[239,159,39],catalyst:[29,158,117],material:[55,138,221],maintenance:[127,119,221],other:[136,135,128]};
const GANTT_COLORS = ['#378ADD','#1D9E75','#EF9F27','#7F77DD','#E24B4A','#0F6E56','#854F0B','#534AB7'];
const GANTT_RGB    = [[55,138,221],[29,158,117],[239,159,39],[127,119,221],[226,75,74],[15,110,86],[133,79,11],[83,74,183]];
const MONTHS_ES    = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];

let events = [];
let activeFilter = 'all';
let currentDetailTab = 'info';
let fileContents = {};

// ─── Import Firebase directly (no event needed) ───────────────────────────────
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getFirestore, collection, addDoc, updateDoc, deleteDoc, doc, onSnapshot, serverTimestamp, query, orderBy } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { getStorage, ref, uploadBytes, getDownloadURL, deleteObject } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js";

const firebaseConfig = {
  apiKey:            "AIzaSyBBdJn3w57czqeaeb75LfOo-unc8P2y-FE",
  authDomain:        "bitacora-refineria.firebaseapp.com",
  projectId:         "bitacora-refineria",
  storageBucket:     "bitacora-refineria.firebasestorage.app",
  messagingSenderId: "1096551197586",
  appId:             "1:1096551197586:web:02900d4f7b0d1d497bef4b"
};

const app     = initializeApp(firebaseConfig);
const db      = getFirestore(app);
const storage = getStorage(app);


// ─── Firestore listener ───────────────────────────────────────────────────────
function subscribeToEvents() {
  setSyncStatus('saving');
  const q = query(collection(db,'events'), orderBy('date','desc'));
  onSnapshot(q, snap => {
    events = snap.docs.map(d => ({id:d.id,...d.data()}));
    renderDashboard(); renderEvents(); populateGanttSelect(); setSyncStatus('ok');
  }, err => { console.error(err); setSyncStatus('error'); });
}

function setSyncStatus(s) {
  const el = document.getElementById('sync-status'); if(!el) return;
  const m = {
    ok:     ['sync-ok',      '<i class="ti ti-cloud-check"></i> Sincronizado'],
    saving: ['sync-saving',  '<i class="ti ti-cloud-upload"></i> Guardando...'],
    error:  ['sync-error',   '<i class="ti ti-cloud-x"></i> Error'],
  };
  el.className='sync-badge '+m[s][0]; el.innerHTML=m[s][1];
}

function showToast(msg) {
  const t=document.getElementById('toast'); t.textContent=msg; t.classList.add('show');
  setTimeout(()=>t.classList.remove('show'),2800);
}
function parseDate(s) { const[y,m,d]=s.split('-').map(Number); return new Date(y,m-1,d); }
function addDays(date,n) { const d=new Date(date); d.setDate(d.getDate()+n); return d; }
function fmtSize(b) { return b<1024*1024?Math.round(b/1024)+' KB':(b/1024/1024).toFixed(1)+' MB'; }
window.closeModal = () => document.getElementById('modal-root').innerHTML='';

// ─── Tab switch ───────────────────────────────────────────────────────────────
window.switchTab = function(tab) {
  document.querySelectorAll('.nav-tab').forEach((t,i)=>t.classList.toggle('active',['dashboard','events','gantt','ai'][i]===tab));
  document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
  document.getElementById('view-'+tab).classList.add('active');
  if(tab==='gantt'){populateGanttSelect();loadGanttTab();}
};

// ─── Dashboard ────────────────────────────────────────────────────────────────
function renderDashboard() {
  const total=events.length, wg=events.filter(e=>e.gantt&&e.gantt.length).length, tf=events.reduce((s,e)=>s+(e.files||[]).length,0);
  document.getElementById('stats-grid').innerHTML=`
    <div class="stat-card"><div class="stat-label">Total eventos</div><div class="stat-value" style="color:#185FA5">${total}</div></div>
    <div class="stat-card"><div class="stat-label">Con Gantt</div><div class="stat-value" style="color:#1D9E75">${wg}</div></div>
    <div class="stat-card"><div class="stat-label">Archivos en la nube</div><div class="stat-value" style="color:#854F0B">${tf}</div></div>`;
  document.getElementById('recent-list').innerHTML=[...events].sort((a,b)=>new Date(b.date)-new Date(a.date)).slice(0,3).map(eventCardHTML).join('');
}

// ─── Events ───────────────────────────────────────────────────────────────────
function eventCardHTML(e) {
  const d=new Date(e.date+'T00:00:00').toLocaleDateString('es-MX',{year:'numeric',month:'short',day:'numeric'});
  const color=TYPE_COLORS[e.type]||'#888780';
  const chips=[
    e.responsible?`<div class="event-chip"><i class="ti ti-user" style="font-size:13px"></i> ${e.responsible}</div>`:'',
    e.duration?`<div class="event-chip"><i class="ti ti-clock" style="font-size:13px"></i> ${e.duration} días</div>`:'',
    e.files&&e.files.length?`<div class="event-chip"><i class="ti ti-paperclip" style="font-size:13px"></i> ${e.files.length} archivo${e.files.length>1?'s':''}</div>`:'',
    e.gantt&&e.gantt.length?`<div class="event-chip"><i class="ti ti-calendar-event" style="font-size:13px"></i> Gantt (${e.gantt.length} tareas)</div>`:'',
  ].filter(Boolean).join('');
  return `<div class="event-card ${e.type}" style="border-left-color:${color}">
    <div onclick="openDetail('${e.id}')" style="cursor:pointer">
      <div class="event-title">${e.title}</div>
      <div class="event-meta">${d} · ${e.equipment||'Sin equipo'}</div>
      <div class="event-chips">${chips}</div>
    </div>
    <div style="display:flex;gap:6px;margin-top:8px">
      <button class="btn-edit btn-sm" onclick="openEditModal('${e.id}')"><i class="ti ti-pencil" style="font-size:12px"></i> Editar</button>
      <button class="btn-danger btn-sm" onclick="deleteEvent('${e.id}','${e.title.replace(/'/g,'')}')"><i class="ti ti-trash" style="font-size:12px"></i> Eliminar</button>
    </div>
  </div>`;
}

window.renderEvents = function() {
  const allTypes=['all','shutdown','repair','catalyst','material','maintenance','other'];
  const labels=['Todos','Paros','Reparaciones','Catalizador','Materiales','Mantenimiento','Otros'];
  document.getElementById('filter-bar').innerHTML=allTypes.map((t,i)=>`<button class="filter-btn${activeFilter===t?' active':''}" onclick="setFilter('${t}')">${labels[i]}</button>`).join('');
  const q=(document.getElementById('search-input')||{}).value||'';
  const filtered=events.filter(e=>(activeFilter==='all'||e.type===activeFilter)&&(!q||JSON.stringify(e).toLowerCase().includes(q.toLowerCase())));
  document.getElementById('events-list').innerHTML=filtered.length?filtered.map(eventCardHTML).join(''):'<div class="empty"><i class="ti ti-search"></i>Sin resultados</div>';
};
window.setFilter = t => { activeFilter=t; renderEvents(); };

// ─── New event ────────────────────────────────────────────────────────────────
let pendingFiles = [];

window.openNewModal = function() {
  const today=new Date().toISOString().split('T')[0];
  document.getElementById('modal-root').innerHTML=`
    <div class="modal-overlay" onclick="if(event.target===this)closeModal()">
      <div class="modal">
        <div class="modal-header">
          <span class="modal-header-title">Registrar nuevo evento</span>
          <button class="btn-secondary btn-sm" onclick="closeModal()"><i class="ti ti-x"></i></button>
        </div>
        <div class="modal-body">
          <div class="form-grid">
            <div class="form-group"><label>Tipo de evento *</label>
              <select id="f-type" onchange="toggleNewFields()">
                <option value="">Seleccionar...</option>
                <option value="shutdown">Paro de planta</option>
                <option value="repair">Reparación de equipo</option>
                <option value="catalyst">Cambio de catalizador</option>
                <option value="material">Orden de materiales</option>
                <option value="maintenance">Intervención / Mantenimiento</option>
                <option value="other">Otro evento relevante</option>
              </select>
            </div>
            <div class="form-group"><label>Fecha inicio *</label><input type="date" id="f-date" value="${today}" /></div>
          </div>
          <div class="form-group"><label>Título *</label><input type="text" id="f-title" placeholder="Descripción breve del evento" /></div>
          <div class="form-grid">
            <div class="form-group"><label>Equipo / área</label><input type="text" id="f-equipment" /></div>
            <div class="form-group"><label>Responsable</label><input type="text" id="f-responsible" /></div>
          </div>
          <div id="f-extra-fields"></div>
          <div class="form-group"><label>Notas / observaciones</label><textarea id="f-notes"></textarea></div>
          <div class="form-group"><label>Etiquetas (separadas por coma)</label><input type="text" id="f-tags" /></div>
          <div class="form-group">
            <label>Archivos adjuntos</label>
            <div class="file-drop" onclick="document.getElementById('nfi').click()">
              <i class="ti ti-upload" style="font-size:20px;display:block;margin-bottom:6px"></i>
              Seleccionar archivos (PDF, Excel, Word, imágenes, TXT...)
              <input type="file" id="nfi" multiple style="display:none" onchange="previewNewFiles(this)" />
            </div>
            <div id="nfp" class="file-list"></div>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn-secondary" onclick="closeModal()">Cancelar</button>
          <button class="btn-primary" onclick="saveNewEvent()"><i class="ti ti-device-floppy"></i> Guardar</button>
        </div>
      </div>
    </div>`;
  pendingFiles=[];
};

window.toggleNewFields = function() {
  const t=(document.getElementById('f-type')||{}).value;
  const el=document.getElementById('f-extra-fields'); if(!el) return;
  if(['shutdown','repair','maintenance'].includes(t)){
    el.innerHTML=`<div class="form-grid"><div class="form-group"><label>Duración estimada (días)</label><input type="number" id="f-duration" min="1" /></div><div class="form-group"><label>Materiales / órdenes</label><input type="text" id="f-materials" /></div></div>`;
  } else if(t==='catalyst'){
    el.innerHTML=`<div class="form-grid"><div class="form-group"><label>Catalizador (tipo y cantidad)</label><input type="text" id="f-catalyst" /></div><div class="form-group"><label>Materiales</label><input type="text" id="f-materials" /></div></div>`;
  } else { el.innerHTML=''; }
};

window.previewNewFiles = function(input) {
  pendingFiles=Array.from(input.files);
  document.getElementById('nfp').innerHTML=pendingFiles.map(f=>`
    <div class="file-item"><i class="ti ti-file" style="font-size:16px;color:#185FA5"></i>
    <span class="file-item-name">${f.name}</span><span class="file-size">${fmtSize(f.size)}</span></div>`).join('');
};

window.saveNewEvent = async function() {
  const type=(document.getElementById('f-type')||{}).value;
  const title=((document.getElementById('f-title')||{}).value||'').trim();
  const date=(document.getElementById('f-date')||{}).value;
  if(!type||!title||!date){alert('Completa los campos obligatorios');return;}
  setSyncStatus('saving');
  const newEv={
    type,title,date,
    equipment:(document.getElementById('f-equipment')||{}).value||'',
    responsible:(document.getElementById('f-responsible')||{}).value||'',
    notes:(document.getElementById('f-notes')||{}).value||'',
    tags:((document.getElementById('f-tags')||{}).value||'').split(',').map(s=>s.trim()).filter(Boolean),
    materials:(document.getElementById('f-materials')||{}).value||'',
    catalyst:(document.getElementById('f-catalyst')||{}).value||'',
    duration:parseInt((document.getElementById('f-duration')||{}).value)||null,
    files:[],gantt:[],
    createdAt: serverTimestamp(),
  };
  try {
    const docRef=await addDoc(collection(db,'events'),newEv);
    if(pendingFiles.length){
      const uploaded=await uploadFiles(docRef.id,pendingFiles);
      await updateDoc(doc(db,'events',docRef.id),{files:uploaded});
      for(const f of pendingFiles){
        const ext=f.name.split('.').pop().toLowerCase();
        if(['txt','md','csv'].includes(ext)){
          const text=await f.text();
          if(!fileContents[docRef.id])fileContents[docRef.id]=[];
          fileContents[docRef.id].push({name:f.name,content:text.slice(0,8000)});
        }
      }
    }
    pendingFiles=[];
    closeModal();
    showToast('✓ Evento guardado en Firebase');
  } catch(err){
    console.error(err);
    setSyncStatus('error');
    showToast('Error: '+err.message);
  }
};

// ─── Storage upload ───────────────────────────────────────────────────────────
async function uploadFiles(eventId, files) {
  const uploaded=[];
  for(const file of files){
    try {
      const path=`events/${eventId}/${Date.now()}_${file.name}`;
      const storRef=ref(storage,path);
      await uploadBytes(storRef,file);
      const url=await getDownloadURL(storRef);
      uploaded.push({name:file.name,size:fmtSize(file.size),type:file.name.split('.').pop().toLowerCase(),url,path});
    } catch(err){ console.error('Error subiendo '+file.name,err); }
  }
  return uploaded;
}

// ─── Detail modal ─────────────────────────────────────────────────────────────
window.openDetail = function(id) {
  const e=events.find(ev=>ev.id===id); if(!e) return;
  currentDetailTab='info'; renderDetailModal(e);
};

function renderDetailModal(e) {
  const d=new Date(e.date+'T00:00:00').toLocaleDateString('es-MX',{year:'numeric',month:'long',day:'numeric'});
  const color=TYPE_COLORS[e.type]||'#888780';
  const infoHTML=`
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:.75rem">
      <span style="width:10px;height:10px;border-radius:50%;background:${color};display:inline-block"></span>
      <span style="font-size:13px;color:var(--text-muted)">${TYPE_LABELS[e.type]} · ${d}</span>
    </div>
    <div class="detail-section"><h3>Datos generales</h3>
      <div class="detail-row"><span class="detail-label">Equipo / Área</span><span>${e.equipment||'—'}</span></div>
      <div class="detail-row"><span class="detail-label">Responsable</span><span>${e.responsible||'—'}</span></div>
      ${e.duration?`<div class="detail-row"><span class="detail-label">Duración</span><span>${e.duration} días</span></div>`:''}
      ${e.catalyst?`<div class="detail-row"><span class="detail-label">Catalizador</span><span>${e.catalyst}</span></div>`:''}
    </div>
    ${e.materials?`<div class="detail-section"><h3>Materiales</h3><div style="font-size:13px;line-height:1.7;color:var(--text-muted)">${e.materials}</div></div>`:''}
    ${e.notes?`<div class="detail-section"><h3>Notas</h3><div style="font-size:13px;line-height:1.7;color:var(--text-muted)">${e.notes}</div></div>`:''}
    ${e.tags&&e.tags.length?`<div class="detail-section"><h3>Etiquetas</h3><div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:4px">${e.tags.map(t=>`<span class="tag">${t}</span>`).join('')}</div></div>`:''}`;
  const ganttHTML=buildGanttHTML(e.gantt,e.date,true,e.id);
  const filesHTML=`
    <div class="file-drop" onclick="document.getElementById('fi-${e.id}').click()">
      <i class="ti ti-upload" style="font-size:20px;display:block;margin-bottom:6px"></i>
      Adjuntar archivos — se suben a Firebase Storage
      <input type="file" id="fi-${e.id}" multiple style="display:none" onchange="attachFilesToEvent('${e.id}',this)" />
    </div>
    <div class="file-list" id="fl-${e.id}">${(e.files||[]).map(f=>fileItemHTML(f,e.id)).join('')}</div>
    ${!(e.files&&e.files.length)?'<div style="font-size:12px;color:var(--text-muted);text-align:center;padding:.5rem">Sin archivos adjuntos</div>':''}`;
  const tabs=[['info','Información','ti-info-circle'],['gantt','Programa Gantt','ti-calendar-event'],['files','Archivos','ti-paperclip']];
  document.getElementById('modal-root').innerHTML=`
    <div class="modal-overlay" onclick="if(event.target===this)closeModal()">
      <div class="modal" style="max-width:720px">
        <div class="modal-header">
          <span class="modal-header-title">${e.title}</span>
          <div class="modal-header-actions">
            <button class="btn-pdf" onclick="exportEventPDF('${e.id}')"><i class="ti ti-file-type-pdf"></i> PDF</button>
            <button class="btn-secondary btn-sm" onclick="closeModal()"><i class="ti ti-x"></i></button>
          </div>
        </div>
        <div class="modal-body" style="padding-bottom:0">
          <div class="inner-tabs">
            ${tabs.map(([t,l,ic])=>`<div class="inner-tab${currentDetailTab===t?' active':''}" onclick="switchDetailTab('${t}','${e.id}')">
              <i class="ti ${ic}" style="font-size:14px"></i> ${l}${t==='files'&&e.files&&e.files.length?` (${e.files.length})`:''}</div>`).join('')}
          </div>
          <div id="dt-info"  style="display:${currentDetailTab==='info'?'block':'none'}">${infoHTML}</div>
          <div id="dt-gantt" style="display:${currentDetailTab==='gantt'?'block':'none'}">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:.75rem">
              <span style="font-size:12px;color:var(--text-muted)">${e.gantt&&e.gantt.length?e.gantt.length+' tareas':'Sin tareas aún'}</span>
              <div style="display:flex;gap:6px">
                ${e.gantt&&e.gantt.length?`<button class="btn-pdf" onclick="exportGanttPDF('${e.id}')"><i class="ti ti-file-type-pdf"></i> Exportar Gantt</button>`:''}
                <button class="btn-primary btn-sm" onclick="openAddTaskInDetail('${e.id}')"><i class="ti ti-plus"></i> Agregar tarea</button>
              </div>
            </div>
            <div id="dt-gantt-content">${ganttHTML}</div>
            <div id="dt-add-form" style="display:none;margin-top:1rem;background:var(--bg);padding:1rem;border-radius:var(--radius-md);border:1px solid var(--border)">
              <div style="display:grid;grid-template-columns:1fr 120px 80px 1fr auto;gap:8px;align-items:flex-end">
                <div class="form-group"><label>Actividad</label><input type="text" id="dgt-name" /></div>
                <div class="form-group"><label>Fecha inicio</label><input type="date" id="dgt-sd" value="${e.date}" /></div>
                <div class="form-group"><label>Días</label><input type="number" id="dgt-dur" min="1" value="3" /></div>
                <div class="form-group"><label>Responsable</label><input type="text" id="dgt-resp" /></div>
                <div class="form-group form-end"><button class="btn-primary btn-sm" onclick="saveDetailTask('${e.id}')">Agregar</button></div>
              </div>
            </div>
          </div>
          <div id="dt-files" style="display:${currentDetailTab==='files'?'block':'none'}">${filesHTML}</div>
        </div>
        <div class="modal-footer"><button class="btn-secondary" onclick="closeModal()">Cerrar</button></div>
      </div>
    </div>`;
}

window.switchDetailTab = function(tab,id) {
  currentDetailTab=tab;
  document.querySelectorAll('.inner-tab').forEach((t,i)=>t.classList.toggle('active',['info','gantt','files'][i]===tab));
  document.getElementById('dt-info').style.display=tab==='info'?'block':'none';
  document.getElementById('dt-gantt').style.display=tab==='gantt'?'block':'none';
  document.getElementById('dt-files').style.display=tab==='files'?'block':'none';
};
window.openAddTaskInDetail = eid => { const f=document.getElementById('dt-add-form'); if(f)f.style.display=f.style.display==='none'?'block':'none'; };

window.saveDetailTask = async function(eid) {
  const ev=events.find(e=>e.id===eid); if(!ev) return;
  const name=(document.getElementById('dgt-name')||{}).value.trim();
  const startDate=(document.getElementById('dgt-sd')||{}).value;
  const dur=parseInt((document.getElementById('dgt-dur')||{}).value)||1;
  const resp=(document.getElementById('dgt-resp')||{}).value.trim();
  if(!name) return;
  const gantt=[...(ev.gantt||[]),{id:'g'+Date.now(),name,startDate,dur,resp,color:(ev.gantt||[]).length%GANTT_COLORS.length}];
  await updateDoc(doc(db,'events',eid),{gantt});
  document.getElementById('dt-gantt-content').innerHTML=buildGanttHTML(gantt,ev.date,true,eid);
  document.getElementById('dt-add-form').style.display='none';
  if(document.getElementById('dgt-name'))document.getElementById('dgt-name').value='';
};

window.deleteTask = async function(tid,eid) {
  const ev=events.find(e=>e.id===eid); if(!ev) return;
  const gantt=(ev.gantt||[]).filter(t=>t.id!==tid);
  await updateDoc(doc(db,'events',eid),{gantt});
  const dtc=document.getElementById('dt-gantt-content');
  if(dtc)dtc.innerHTML=buildGanttHTML(gantt,ev.date,true,eid); else loadGanttTab();
};
window.startEditTask = function(tid,eid) {
  const ev=events.find(e=>e.id===eid); if(!ev) return;
  const t=(ev.gantt||[]).find(g=>g.id===tid); if(!t) return;
  const row=document.getElementById('task-row-'+tid); if(!row) return;
  const cells=row.querySelectorAll('td');
  cells[0].innerHTML=`<input type="text" value="${t.name}" id="edit-name-${tid}" style="font-size:12px;padding:3px 6px;width:100%" />`;
  cells[1].innerHTML=`<input type="text" value="${t.resp||''}" id="edit-resp-${tid}" style="font-size:12px;padding:3px 6px;width:100%" />`;
  cells[2].innerHTML=`<div style="display:flex;flex-direction:column;gap:3px">
    <input type="date" value="${t.startDate}" id="edit-sd-${tid}" style="font-size:11px;padding:2px 4px" />
    <div style="display:flex;gap:3px;align-items:center"><span style="font-size:11px;color:var(--text-muted)">Días:</span>
    <input type="number" value="${t.dur}" id="edit-dur-${tid}" min="1" style="font-size:11px;padding:2px 4px;width:52px" /></div>
    <div style="display:flex;gap:3px">
      <button class="btn-primary" style="padding:2px 8px;font-size:11px" onclick="saveEditTask('${tid}','${eid}')"><i class="ti ti-check"></i></button>
      <button class="btn-secondary" style="padding:2px 8px;font-size:11px" onclick="cancelEdit('${tid}','${eid}')"><i class="ti ti-x"></i></button>
    </div></div>`;
};
window.saveEditTask = async function(tid,eid) {
  const ev=events.find(e=>e.id===eid); if(!ev) return;
  const t=(ev.gantt||[]).find(g=>g.id===tid); if(!t) return;
  t.name=(document.getElementById('edit-name-'+tid)||{}).value||t.name;
  t.resp=(document.getElementById('edit-resp-'+tid)||{}).value||'';
  t.startDate=(document.getElementById('edit-sd-'+tid)||{}).value||t.startDate;
  t.dur=parseInt((document.getElementById('edit-dur-'+tid)||{}).value)||t.dur;
  await updateDoc(doc(db,'events',eid),{gantt:ev.gantt});
  const dtc=document.getElementById('dt-gantt-content');
  if(dtc)dtc.innerHTML=buildGanttHTML(ev.gantt,ev.date,true,eid); else loadGanttTab();
};
window.cancelEdit = function(tid,eid) {
  const ev=events.find(e=>e.id===eid); if(!ev) return;
  const dtc=document.getElementById('dt-gantt-content');
  if(dtc)dtc.innerHTML=buildGanttHTML(ev.gantt,ev.date,true,eid); else loadGanttTab();
};

// ─── Files ────────────────────────────────────────────────────────────────────
window.attachFilesToEvent = async function(eid,input) {
  const ev=events.find(e=>e.id===eid); if(!ev) return;
  showToast('Subiendo archivos...');
  try {
    const uploaded=await uploadFiles(eid,Array.from(input.files));
    const allFiles=[...(ev.files||[]),...uploaded.filter(u=>!(ev.files||[]).find(f=>f.name===u.name))];
    await updateDoc(doc(db,'events',eid),{files:allFiles});
    for(const f of Array.from(input.files)){
      const ext=f.name.split('.').pop().toLowerCase();
      if(['txt','md','csv'].includes(ext)){
        const text=await f.text();
        if(!fileContents[eid])fileContents[eid]=[];
        fileContents[eid]=fileContents[eid].filter(x=>x.name!==f.name);
        fileContents[eid].push({name:f.name,content:text.slice(0,8000)});
      }
    }
    showToast('✓ Archivos subidos');
  } catch(err){ console.error(err); showToast('Error al subir archivos'); }
};

window.removeFile = async function(eid,path,name) {
  const ev=events.find(e=>e.id===eid); if(!ev) return;
  try {
    if(path) await deleteObject(ref(storage,path));
    const files=(ev.files||[]).filter(f=>f.name!==name);
    await updateDoc(doc(db,'events',eid),{files});
    if(fileContents[eid])fileContents[eid]=fileContents[eid].filter(x=>x.name!==name);
    showToast('Archivo eliminado');
  } catch(err){ console.error(err); }
};

function fileItemHTML(f,eid) {
  const icons={pdf:'ti-file-type-pdf',xlsx:'ti-file-type-xls',xls:'ti-file-type-xls',docx:'ti-file-type-doc',doc:'ti-file-type-doc',jpg:'ti-photo',jpeg:'ti-photo',png:'ti-photo',txt:'ti-file-text',csv:'ti-file-spreadsheet'};
  const ext=(f.name.split('.').pop()||'').toLowerCase();
  const icon=icons[ext]||'ti-file';
  const link=f.url?`<a href="${f.url}" target="_blank" style="font-size:11px;color:var(--blue);display:flex;align-items:center;gap:3px"><i class="ti ti-external-link" style="font-size:11px"></i> Abrir / Descargar</a>`:'';
  return `<div class="file-item">
    <i class="ti ${icon}" style="font-size:18px;color:#185FA5"></i>
    <div style="flex:1;min-width:0"><div class="file-item-name">${f.name}</div>${link}</div>
    <span class="file-size">${f.size}</span>
    <button style="border:none;background:none;cursor:pointer;color:var(--text-muted);padding:2px" onclick="removeFile('${eid}','${f.path||''}','${f.name}')">
      <i class="ti ti-x" style="font-size:14px"></i></button>
  </div>`;
}


// ─── Delete event ─────────────────────────────────────────────────────────────
window.deleteEvent = async function(id, title) {
  if (!confirm(`¿Eliminar el evento "${title}"? Esta acción no se puede deshacer.`)) return;
  try {
    await deleteDoc(doc(db,'events',id));
    showToast('Evento eliminado');
  } catch(err) { console.error(err); showToast('Error al eliminar'); }
};

// ─── Edit event modal ─────────────────────────────────────────────────────────
window.openEditModal = function(id) {
  const e = events.find(ev => ev.id === id);
  if (!e) return;
  document.getElementById('modal-root').innerHTML = `
    <div class="modal-overlay" onclick="if(event.target===this)closeModal()">
      <div class="modal">
        <div class="modal-header">
          <span class="modal-header-title">Editar evento</span>
          <button class="btn-secondary btn-sm" onclick="closeModal()"><i class="ti ti-x"></i></button>
        </div>
        <div class="modal-body">
          <div class="form-grid">
            <div class="form-group"><label>Tipo de evento</label>
              <select id="ef-type">
                <option value="shutdown" ${e.type==='shutdown'?'selected':''}>Paro de planta</option>
                <option value="repair" ${e.type==='repair'?'selected':''}>Reparación de equipo</option>
                <option value="catalyst" ${e.type==='catalyst'?'selected':''}>Cambio de catalizador</option>
                <option value="material" ${e.type==='material'?'selected':''}>Orden de materiales</option>
                <option value="maintenance" ${e.type==='maintenance'?'selected':''}>Intervención / Mantenimiento</option>
                <option value="other" ${e.type==='other'?'selected':''}>Otro evento relevante</option>
              </select>
            </div>
            <div class="form-group"><label>Fecha inicio</label><input type="date" id="ef-date" value="${e.date}" /></div>
          </div>
          <div class="form-group"><label>Título *</label><input type="text" id="ef-title" value="${e.title}" /></div>
          <div class="form-grid">
            <div class="form-group"><label>Equipo / área</label><input type="text" id="ef-equipment" value="${e.equipment||''}" /></div>
            <div class="form-group"><label>Responsable</label><input type="text" id="ef-responsible" value="${e.responsible||''}" /></div>
          </div>
          <div class="form-grid">
            <div class="form-group"><label>Duración (días)</label><input type="number" id="ef-duration" value="${e.duration||''}" min="1" /></div>
            <div class="form-group"><label>Catalizador</label><input type="text" id="ef-catalyst" value="${e.catalyst||''}" /></div>
          </div>
          <div class="form-group"><label>Materiales / órdenes</label><input type="text" id="ef-materials" value="${e.materials||''}" /></div>
          <div class="form-group"><label>Notas / observaciones</label><textarea id="ef-notes">${e.notes||''}</textarea></div>
          <div class="form-group"><label>Etiquetas (separadas por coma)</label><input type="text" id="ef-tags" value="${(e.tags||[]).join(', ')}" /></div>
        </div>
        <div class="modal-footer">
          <button class="btn-danger" onclick="deleteEvent('${e.id}','${e.title.replace(/'/g,'')}');closeModal()"><i class="ti ti-trash"></i> Eliminar evento</button>
          <button class="btn-secondary" onclick="closeModal()">Cancelar</button>
          <button class="btn-primary" onclick="saveEditEvent('${e.id}')"><i class="ti ti-device-floppy"></i> Guardar cambios</button>
        </div>
      </div>
    </div>`;
};

window.saveEditEvent = async function(id) {
  const title = (document.getElementById('ef-title')||{}).value.trim();
  if (!title) { alert('El título es obligatorio'); return; }
  const updated = {
    type:        (document.getElementById('ef-type')||{}).value,
    date:        (document.getElementById('ef-date')||{}).value,
    title,
    equipment:   (document.getElementById('ef-equipment')||{}).value||'',
    responsible: (document.getElementById('ef-responsible')||{}).value||'',
    duration:    parseInt((document.getElementById('ef-duration')||{}).value)||null,
    catalyst:    (document.getElementById('ef-catalyst')||{}).value||'',
    materials:   (document.getElementById('ef-materials')||{}).value||'',
    notes:       (document.getElementById('ef-notes')||{}).value||'',
    tags:        ((document.getElementById('ef-tags')||{}).value||'').split(',').map(s=>s.trim()).filter(Boolean),
  };
  try {
    await updateDoc(doc(db,'events',id), updated);
    closeModal();
    showToast('✓ Evento actualizado');
  } catch(err) { console.error(err); showToast('Error al guardar'); }
};

// ─── Gantt tab ─────────────────────────────────────────────────────────────────
window.populateGanttSelect = function() {
  const sel=document.getElementById('gantt-event-select'); if(!sel) return;
  const cur=sel.value;
  sel.innerHTML='<option value="">— Seleccionar evento —</option>'+events.map(e=>`<option value="${e.id}"${e.id===cur?' selected':''}>${e.title.substring(0,52)}</option>`).join('');
};
window.loadGanttTab = function() {
  const id=(document.getElementById('gantt-event-select')||{}).value;
  const ev=events.find(e=>e.id===id);
  const c=document.getElementById('gantt-tab-container');
  const btn=document.getElementById('btn-export-gantt');
  document.getElementById('gantt-add-form').style.display='none';
  if(!ev){
    document.getElementById('gantt-event-title').textContent='Selecciona un evento';
    document.getElementById('gantt-event-sub').textContent='';
    c.innerHTML='<div class="empty"><i class="ti ti-calendar-event"></i>Ningún evento seleccionado</div>';
    if(btn)btn.style.display='none'; return;
  }
  document.getElementById('gantt-event-title').textContent=ev.title;
  document.getElementById('gantt-event-sub').textContent=TYPE_LABELS[ev.type]+(ev.duration?` · ${ev.duration} días`:'');
  c.innerHTML=buildGanttHTML(ev.gantt,ev.date,true,ev.id);
  if(btn)btn.style.display=ev.gantt&&ev.gantt.length?'inline-flex':'none';
  const sd=document.getElementById('gt-start-date'); if(sd)sd.value=ev.date;
};
window.showGanttAddForm = function() {
  const id=(document.getElementById('gantt-event-select')||{}).value;
  if(!id){alert('Primero selecciona un evento');return;}
  const f=document.getElementById('gantt-add-form');
  f.style.display=f.style.display==='none'?'block':'none';
  const ev=events.find(e=>e.id===id);
  const sd=document.getElementById('gt-start-date'); if(ev&&sd)sd.value=ev.date;
};
window.saveGanttTask = async function() {
  const id=(document.getElementById('gantt-event-select')||{}).value;
  const ev=events.find(e=>e.id===id); if(!ev) return;
  const name=(document.getElementById('gt-name')||{}).value.trim();
  const startDate=(document.getElementById('gt-start-date')||{}).value;
  const dur=parseInt((document.getElementById('gt-dur')||{}).value)||1;
  const resp=(document.getElementById('gt-resp')||{}).value.trim();
  if(!name){alert('Escribe el nombre de la actividad');return;}
  const gantt=[...(ev.gantt||[]),{id:'g'+Date.now(),name,startDate,dur,resp,color:(ev.gantt||[]).length%GANTT_COLORS.length}];
  await updateDoc(doc(db,'events',id),{gantt});
  document.getElementById('gt-name').value='';
  document.getElementById('gt-resp').value='';
  document.getElementById('gantt-add-form').style.display='none';
};

// ─── Gantt HTML ────────────────────────────────────────────────────────────────
function buildGanttHTML(tasks,eventStartDate,editMode,eventId) {
  if(!tasks||!tasks.length) return'<div class="empty"><i class="ti ti-calendar-event"></i>Sin tareas. Agrega actividades con <strong>+ Agregar tarea</strong>.</div>';
  const starts=tasks.map(t=>parseDate(t.startDate));
  const ends=tasks.map(t=>addDays(parseDate(t.startDate),t.dur));
  const minDate=new Date(Math.min(...starts));
  const maxDate=new Date(Math.max(...ends));
  const total=Math.ceil((maxDate-minDate)/86400000)+1;
  const days=Array.from({length:total},(_,i)=>addDays(minDate,i));
  const monthSpans=[];let cur=null;
  days.forEach(d=>{const key=`${d.getFullYear()}-${d.getMonth()}`;if(cur&&cur.key===key){cur.span++;}else{cur={key,label:`${MONTHS_ES[d.getMonth()]} ${d.getFullYear()}`,span:1};monthSpans.push(cur);}});
  const today=new Date();today.setHours(0,0,0,0);
  const fh=editMode
    ?`<th class="gantt-task-col" style="background:var(--bg);border-bottom:1px solid var(--border)"></th><th class="gantt-resp-col" style="background:var(--bg);border-bottom:1px solid var(--border)"></th><th class="gantt-action-col" style="background:var(--bg);border-bottom:1px solid var(--border)"></th>`
    :`<th class="gantt-task-col" style="background:var(--bg);border-bottom:1px solid var(--border)"></th><th class="gantt-resp-col" style="background:var(--bg);border-bottom:1px solid var(--border)"></th>`;
  const fh2=editMode
    ?`<th class="gantt-task-col" style="background:var(--bg);font-size:11px;font-weight:500;color:var(--text-muted);text-align:left;padding:4px 8px;border-bottom:1px solid var(--border)">Actividad</th><th class="gantt-resp-col" style="background:var(--bg);font-size:11px;color:var(--text-muted);border-bottom:1px solid var(--border)">Responsable</th><th class="gantt-action-col" style="background:var(--bg);border-bottom:1px solid var(--border)"></th>`
    :`<th class="gantt-task-col" style="background:var(--bg);font-size:11px;font-weight:500;color:var(--text-muted);text-align:left;padding:4px 8px;border-bottom:1px solid var(--border)">Actividad</th><th class="gantt-resp-col" style="background:var(--bg);font-size:11px;color:var(--text-muted);border-bottom:1px solid var(--border)">Responsable</th>`;
  let html=`<div class="gantt-wrap"><table class="gantt-table"><thead><tr>${fh}`;
  monthSpans.forEach(ms=>{html+=`<th class="gantt-hdr-month" colspan="${ms.span}">${ms.label}</th>`;});
  html+=`</tr><tr>${fh2}`;
  days.forEach(d=>{const dow=d.getDay();const isT=d.getTime()===today.getTime();const cls=isT?' today-col':(dow===0||dow===6?' weekend':'');html+=`<th class="gantt-hdr-day${cls}">${d.getDate()}</th>`;});
  html+=`</tr></thead><tbody>`;
  tasks.forEach(t=>{
    const tStart=parseDate(t.startDate);const color=GANTT_COLORS[t.color%GANTT_COLORS.length]||'#378ADD';
    if(editMode){html+=`<tr class="task-row" id="task-row-${t.id}"><td class="gantt-task-col" style="font-size:12px">${t.name}</td><td class="gantt-resp-col">${t.resp||'—'}</td><td class="gantt-action-col"><div style="display:flex;gap:4px"><button class="btn-edit" onclick="startEditTask('${t.id}','${eventId}')"><i class="ti ti-pencil" style="font-size:12px"></i></button><button class="btn-danger" onclick="deleteTask('${t.id}','${eventId}')"><i class="ti ti-trash" style="font-size:12px"></i></button></div></td>`;}
    else{html+=`<tr class="task-row"><td class="gantt-task-col" style="font-size:12px">${t.name}</td><td class="gantt-resp-col">${t.resp||'—'}</td>`;}
    days.forEach(d=>{const dEnd=addDays(tStart,t.dur);const inBar=d>=tStart&&d<dEnd;const iF=d.getTime()===tStart.getTime();const iL=d.getTime()===addDays(tStart,t.dur-1).getTime();html+=`<td class="gantt-day-col">${inBar?`<div style="height:18px;background:${color};opacity:0.85;border-radius:${iF?'4px':'0'} ${iL?'4px':'0'} ${iL?'4px':'0'} ${iF?'4px':'0'};margin:0 1px"></div>`:'&nbsp;'}</td>`;});
    html+='</tr>';
  });
  html+='</tbody></table></div>';return html;
}

// ─── PDF footer ────────────────────────────────────────────────────────────────
function addPdfFooter(doc) {
  const pgW=doc.internal.pageSize.getWidth(),pgH=doc.internal.pageSize.getHeight(),pc=doc.internal.getNumberOfPages();
  const ds=new Date().toLocaleDateString('es-MX',{year:'numeric',month:'long',day:'numeric'});
  for(let i=1;i<=pc;i++){doc.setPage(i);doc.setDrawColor(210,210,210);doc.setLineWidth(0.2);doc.line(10,pgH-9,pgW-10,pgH-9);doc.setTextColor(160,160,160);doc.setFontSize(7);doc.setFont('helvetica','normal');doc.text(ds,10,pgH-5);doc.text(`${i} / ${pc}`,pgW-10,pgH-5,{align:'right'});}
}

// ─── Export Gantt PDF ──────────────────────────────────────────────────────────
window.exportGanttPDF = function(eventId) {
  const{jsPDF}=window.jspdf||{};
  const id=eventId||(document.getElementById('gantt-event-select')||{}).value;
  const ev=events.find(e=>e.id===id);
  if(!ev||!ev.gantt||!ev.gantt.length){showToast('Sin tareas para exportar');return;}
  const tasks=ev.gantt;
  const starts=tasks.map(t=>parseDate(t.startDate)),ends=tasks.map(t=>addDays(parseDate(t.startDate),t.dur));
  const minDate=new Date(Math.min(...starts)),maxDate=new Date(Math.max(...ends));
  const totalDays=Math.ceil((maxDate-minDate)/86400000)+1;
  const days=Array.from({length:totalDays},(_,i)=>addDays(minDate,i));
  const doc=new jsPDF({orientation:totalDays>25?'landscape':'portrait',unit:'mm',format:'a4'});
  const pgW=doc.internal.pageSize.getWidth();
  doc.setTextColor(20,20,20);doc.setFontSize(12);doc.setFont('helvetica','bold');doc.text(ev.title.substring(0,80),10,14);
  doc.setFontSize(8.5);doc.setFont('helvetica','normal');doc.setTextColor(90,90,90);
  doc.text([TYPE_LABELS[ev.type],ev.equipment,ev.responsible,ev.duration?`${ev.duration} días`:''].filter(Boolean).join('  ·  '),10,20);
  doc.setDrawColor(200,200,200);doc.setLineWidth(0.3);doc.line(10,23,pgW-10,23);
  const tCW=50,rCW=28,dW=Math.min(8,Math.floor((pgW-tCW-rCW-10)/totalDays)),rH=7,hH=10,sX=5;let sY=27;
  const mSpans=[];let cM=null;
  days.forEach(d=>{const k=`${d.getFullYear()}-${d.getMonth()}`;if(cM&&cM.key===k){cM.span++;}else{cM={key:k,label:`${MONTHS_ES[d.getMonth()]} ${d.getFullYear()}`,span:1};mSpans.push(cM);}});
  doc.setFillColor(230,241,251);doc.rect(sX,sY,tCW+rCW+totalDays*dW,hH/2,'F');
  doc.setFontSize(7);doc.setTextColor(24,95,165);doc.setFont('helvetica','bold');
  let mX=sX+tCW+rCW;mSpans.forEach(ms=>{doc.text(ms.label,mX+2,sY+4);mX+=ms.span*dW;});
  const dhY=sY+hH/2;doc.setFillColor(242,245,248);doc.rect(sX,dhY,tCW+rCW+totalDays*dW,hH/2,'F');
  doc.setFontSize(6);doc.setFont('helvetica','normal');
  days.forEach((d,i)=>{const dow=d.getDay();doc.setTextColor(dow===0||dow===6?[200,80,80]:[110,110,110]);doc.text(String(d.getDate()),sX+tCW+rCW+i*dW+dW/2,dhY+3.5,{align:'center'});});
  doc.setTextColor(90,90,90);doc.setFontSize(7);doc.setFont('helvetica','bold');doc.text('Actividad',sX+2,sY+4);doc.text('Responsable',sX+tCW+2,sY+4);
  doc.setDrawColor(190,190,190);doc.setLineWidth(0.2);doc.rect(sX,sY,tCW+rCW+totalDays*dW,hH,undefined);doc.line(sX+tCW,sY,sX+tCW,sY+hH);doc.line(sX+tCW+rCW,sY,sX+tCW+rCW,sY+hH);
  let rY=sY+hH;
  tasks.forEach((t,ti)=>{
    const rgb=GANTT_RGB[t.color%GANTT_RGB.length]||[55,138,221];
    doc.setFillColor(...(ti%2===0?[255,255,255]:[249,251,253]));doc.rect(sX,rY,tCW+rCW+totalDays*dW,rH,'F');
    doc.setFontSize(7);doc.setFont('helvetica','normal');doc.setTextColor(30,30,30);doc.text((t.name.length>28?t.name.substring(0,27)+'…':t.name),sX+2,rY+rH/2+1.5);
    doc.setTextColor(100,100,100);doc.text(((t.resp||'—').length>16?(t.resp||'').substring(0,15)+'…':(t.resp||'—')),sX+tCW+2,rY+rH/2+1.5);
    const tS=parseDate(t.startDate);
    days.forEach((d,i)=>{if(d>=tS&&d<addDays(tS,t.dur)){const iF=d.getTime()===tS.getTime(),iL=d.getTime()===addDays(tS,t.dur-1).getTime();const bx=sX+tCW+rCW+i*dW;doc.setFillColor(...rgb);doc.roundedRect(bx+0.8,rY+1.5,dW-1.6,rH-3,iF?1:0,iL?1:0,'F');}});
    doc.setDrawColor(220,220,220);doc.setLineWidth(0.1);doc.line(sX,rY+rH,sX+tCW+rCW+totalDays*dW,rY+rH);doc.line(sX+tCW,rY,sX+tCW,rY+rH);doc.line(sX+tCW+rCW,rY,sX+tCW+rCW,rY+rH);rY+=rH;
  });
  doc.setDrawColor(160,160,160);doc.setLineWidth(0.3);doc.rect(sX,sY,tCW+rCW+totalDays*dW,hH+tasks.length*rH,undefined);
  addPdfFooter(doc);doc.save(`Gantt_${ev.title.replace(/[^a-zA-Z0-9]/g,'_').substring(0,40)}.pdf`);showToast('Gantt exportado');
};

// ─── Export All Events PDF ─────────────────────────────────────────────────────
window.exportAllEventsPDF = function() {
  const{jsPDF}=window.jspdf||{};
  const doc=new jsPDF({orientation:'portrait',unit:'mm',format:'a4'});
  const pgW=doc.internal.pageSize.getWidth(),pgH=doc.internal.pageSize.getHeight(),margin=10,colW=pgW-margin*2;
  const sorted=[...events].sort((a,b)=>new Date(b.date)-new Date(a.date));let y=14;
  sorted.forEach((ev,idx)=>{
    if(y>pgH-50){doc.addPage();y=14;}
    const rgb=TYPE_RGB[ev.type]||[136,135,128];
    doc.setFillColor(...rgb);doc.rect(margin,y,2.5,32,'F');doc.setFillColor(250,251,252);doc.rect(margin+2.5,y,colW-2.5,32,'F');doc.setDrawColor(220,220,220);doc.setLineWidth(0.2);doc.rect(margin,y,colW,32,undefined);
    doc.setTextColor(...rgb);doc.setFontSize(7);doc.setFont('helvetica','bold');doc.text(`#${String(idx+1).padStart(2,'0')}  ${TYPE_LABELS[ev.type].toUpperCase()}`,margin+5,y+5);
    doc.setTextColor(20,20,20);doc.setFontSize(10);doc.setFont('helvetica','bold');doc.text(doc.splitTextToSize(ev.title,colW-15)[0],margin+5,y+10);
    doc.setFontSize(8);doc.setFont('helvetica','normal');doc.setTextColor(90,90,90);
    const d=new Date(ev.date+'T00:00:00').toLocaleDateString('es-MX',{year:'numeric',month:'short',day:'numeric'});
    doc.text([d,ev.equipment,ev.responsible,ev.duration?`${ev.duration} días`:''].filter(Boolean).join('  ·  '),margin+5,y+16);
    if(ev.notes){doc.setFontSize(7.5);doc.setTextColor(60,60,60);doc.text(doc.splitTextToSize(ev.notes,colW-15).slice(0,2).join('\n'),margin+5,y+21);}
    const extras=[];if(ev.catalyst)extras.push(`Cat: ${ev.catalyst.substring(0,35)}`);if(ev.materials)extras.push(`Mat: ${ev.materials.substring(0,40)}`);if(ev.gantt&&ev.gantt.length)extras.push(`Gantt: ${ev.gantt.length} tareas`);if(ev.files&&ev.files.length)extras.push(`Archivos: ${ev.files.length}`);
    if(extras.length){doc.setFontSize(7);doc.setTextColor(130,130,130);doc.text(extras.join('  |  ').substring(0,110),margin+5,y+28);}
    y+=36;
  });
  addPdfFooter(doc);doc.save(`Bitacora_${new Date().toISOString().split('T')[0]}.pdf`);showToast('PDF exportado');
};

// ─── Export Single Event PDF ───────────────────────────────────────────────────
window.exportEventPDF = function(eid) {
  const{jsPDF}=window.jspdf||{};
  const ev=events.find(e=>e.id===eid); if(!ev) return;
  const doc=new jsPDF({orientation:'portrait',unit:'mm',format:'a4'});
  const pgW=doc.internal.pageSize.getWidth(),pgH=doc.internal.pageSize.getHeight(),margin=12,rgb=TYPE_RGB[ev.type]||[136,135,128];
  doc.setFillColor(...rgb);doc.rect(margin,10,3,40,'F');doc.setTextColor(20,20,20);doc.setFontSize(13);doc.setFont('helvetica','bold');
  const tl=doc.splitTextToSize(ev.title,pgW-margin*2-5);doc.text(tl,margin+6,17);
  doc.setFontSize(9);doc.setFont('helvetica','normal');doc.setTextColor(...rgb);doc.text(TYPE_LABELS[ev.type],margin+6,17+tl.length*6+2);
  let y=58;
  const fields=[['Fecha',new Date(ev.date+'T00:00:00').toLocaleDateString('es-MX',{year:'numeric',month:'long',day:'numeric'})],['Equipo / Área',ev.equipment],['Responsable',ev.responsible],['Duración',ev.duration?`${ev.duration} días`:null],['Catalizador',ev.catalyst],['Materiales',ev.materials]].filter(f=>f[1]);
  doc.setFillColor(242,246,250);doc.rect(margin,y-5,pgW-margin*2,fields.length*8+5,'F');doc.setDrawColor(210,220,230);doc.setLineWidth(0.2);doc.rect(margin,y-5,pgW-margin*2,fields.length*8+5,undefined);
  fields.forEach(([label,val])=>{doc.setFont('helvetica','bold');doc.setFontSize(8);doc.setTextColor(100,100,100);doc.text(label+':',margin+3,y);doc.setFont('helvetica','normal');doc.setTextColor(20,20,20);doc.text(doc.splitTextToSize(String(val),pgW-margin*2-35)[0],margin+35,y);y+=8;});
  y+=6;
  if(ev.notes){doc.setFont('helvetica','bold');doc.setFontSize(9);doc.setTextColor(60,60,60);doc.text('Notas y observaciones',margin,y);y+=5;doc.setFont('helvetica','normal');doc.setFontSize(8.5);doc.setTextColor(40,40,40);const nl=doc.splitTextToSize(ev.notes,pgW-margin*2);doc.text(nl,margin,y);y+=nl.length*5+6;}
  if(ev.files&&ev.files.length){if(y>pgH-30){doc.addPage();y=14;}doc.setFont('helvetica','bold');doc.setFontSize(9);doc.setTextColor(60,60,60);doc.text('Archivos adjuntos',margin,y);y+=5;ev.files.forEach(f=>{doc.setFont('helvetica','normal');doc.setFontSize(8);doc.setTextColor(40,40,40);doc.text(`• ${f.name}  (${f.size})`,margin+3,y);y+=5;});}
  addPdfFooter(doc);doc.save(`Evento_${ev.title.replace(/[^a-zA-Z0-9]/g,'_').substring(0,40)}.pdf`);showToast('Ficha exportada');
  if(ev.gantt&&ev.gantt.length)exportGanttPDF(eid);
};

// ─── AI ───────────────────────────────────────────────────────────────────────
const SUGGESTIONS=['¿Cuándo fue el último paro de planta?','¿Qué catalizadores se han usado?','¿Quién estuvo a cargo del último evento?','What materials were ordered in 2024?'];
function renderAIChips(){const el=document.getElementById('ai-chips');if(el)el.innerHTML=SUGGESTIONS.map(s=>`<button class="ai-chip" onclick="askAI('${s}')">${s}</button>`).join('');}
window.sendAI=function(){const i=document.getElementById('ai-input');const q=i.value.trim();if(!q)return;i.value='';askAI(q);};
function addMsg(text,role){const c=document.getElementById('ai-chat');const d=document.createElement('div');d.className='msg msg-'+role;d.textContent=text;c.appendChild(d);c.scrollTop=c.scrollHeight;}
window.askAI=async function(question){
  addMsg(question,'user');
  const chat=document.getElementById('ai-chat');
  const thinking=document.createElement('div');thinking.className='msg msg-ai';
  thinking.innerHTML='<div class="dot-pulse"><span></span><span></span><span></span></div>';
  chat.appendChild(thinking);chat.scrollTop=chat.scrollHeight;
  const ctx=events.map(e=>{
    const base=`EVENTO: ${e.title}\nTipo: ${TYPE_LABELS[e.type]}\nFecha: ${e.date}\nEquipo: ${e.equipment||'N/A'}\nResponsable: ${e.responsible||'N/A'}\nDuración: ${e.duration?e.duration+' días':'N/A'}\nCatalizador: ${e.catalyst||'N/A'}\nMateriales: ${e.materials||'N/A'}\nNotas: ${e.notes||'N/A'}\nArchivos: ${(e.files||[]).map(f=>f.name).join(', ')||'ninguno'}\nTareas Gantt: ${(e.gantt||[]).map(t=>`${t.name} (inicio: ${t.startDate}, duración: ${t.dur} días, responsable: ${t.resp||'—'})`).join('; ')||'ninguna'}`;
    const extracted=(fileContents[e.id]||[]).map(f=>`\n[Contenido de ${f.name}]:\n${f.content}`).join('\n');
    return base+extracted;
  }).join('\n\n---\n\n');
  try{
    const res=await fetch('/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({system:`You are an expert refinery operations assistant. Data may be in Spanish or English — respond in the same language as the user. Be concise and technical.\n\nPLANT HISTORY:\n${ctx}`,question})});
    const data=await res.json();chat.removeChild(thinking);addMsg(data.content?.[0]?.text||'Sin respuesta.','ai');
  }catch(err){chat.removeChild(thinking);addMsg('Error al conectar con el asistente.','ai');}
};

// Boot
subscribeToEvents();
renderAIChips();
