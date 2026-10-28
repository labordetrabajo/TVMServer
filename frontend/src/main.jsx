import React,{useEffect,useState} from 'react';
import{createRoot}from'react-dom/client';
import './style.css';

async function api(route,opts={}){
  const r=await fetch('/api'+route,{credentials:'same-origin',...opts,headers:{...(opts.body instanceof FormData?{}:{'Content-Type':'application/json'}),...opts.headers}});
  const json=await r.json().catch(()=>({}));if(!r.ok)throw Error(json.error||`Error HTTP ${r.status}`);return json;
}
const asDate=v=>v?new Date(v).toLocaleString('es-AR'):'—';
const readableBytes=v=>v>=1024**3?(v/1024**3).toFixed(2)+' GB':v>=1024**2?(v/1024**2).toFixed(1)+' MB':v>=1024?(v/1024).toFixed(1)+' KB':(v||0)+' B';
const statuses={pending:'Pendiente',approved:'Aprobado',rejected:'Rechazado'};
const localDateTime=iso=>{if(!iso)return '';const d=new Date(iso);const pad=n=>String(n).padStart(2,'0');return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;};
const isoDateTime=value=>value?new Date(value).toISOString():null;
const dateUrgency=(date,status)=>{
  if(status==='active')return {label:'Publicado',color:'published'};
  if(status==='completed')return {label:'Finalizado',color:'completed'};
  if(status==='cancelled')return {label:'Cancelado',color:'cancelled'};
  if(!date)return {label:'Sin fecha',color:'neutral'};
  const delta=new Date(date).getTime()-Date.now();
  if(delta<=0)return {label:status==='scheduled'?'Por activar':'Hoy / vencido',color:'overdue'};
  if(delta<=48*3600000)return {label:status==='scheduled'?'Programada · ≤2 días':'Próximos 2 días',color:'upcoming'};
  return {label:status==='scheduled'?'Programada':'Más de 2 días',color:'future'};
};
function Urgency({date,status}){const u=dateUrgency(date,status);return <span className={'urgency '+u.color}>{u.label}</span>;}
function GyALogo({compact=false}){
  return <img className={compact?'gya-logo gya-logo-compact':'gya-logo'}
    src="/brand/gya-logo-horizontal.png" alt="GyA Digital" width={compact?176:255} height={compact?39:57}/>;
}
function Login({onLogin}){
  const[email,setEmail]=useState(''),[password,setPassword]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const submit=async(e)=>{e.preventDefault();setBusy(true);setError('');try{const r=await api('/auth/login',{method:'POST',body:JSON.stringify({email,password})});onLogin(r.user);}catch(e){setError(e.message)}finally{setBusy(false)}};
  return <div className="login-screen"><div className="login-wave" aria-hidden="true"/><div className="login-card"><div className="login-card-header"><GyALogo/><span className="product-badge">TVM SERVER</span></div><div className="brand-large">Totem Video Manager</div><p>Administrá el contenido de tus tótems desde un solo lugar.</p><h2>Ingresar a mi cuenta</h2><form onSubmit={submit}><label>Correo electrónico<input type="email" autoComplete="username" value={email} onChange={e=>setEmail(e.target.value)} required/></label><label>Contraseña<input type="password" autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)} required/></label><button className="primary full" disabled={busy}>{busy?'Ingresando...':'Iniciar sesión'}</button>{error&&<p className="alert">{error}</p>}</form><small>TVM Server v0.4 · GyA Digital · Acceso protegido</small></div></div>
}
function Section({title,subtitle,children,toolbar}){return <section className="section"><div className="section-head"><div><h2>{title}</h2><p>{subtitle}</p></div>{toolbar}</div>{children}</section>}
function Field({label,children}){return <label>{label}{children}</label>}
// Selector de fecha y horario sin los controles de ruedita del navegador.
// Sigue emitiendo "YYYY-MM-DDTHH:mm", igual que los campos anteriores.
function DateTimeField({label,value,onChange,required=false,min='',disabled=false}){
  const date=value?.slice(0,10)||'';
  const hour=value?.slice(11,13)||'09';
  const minute=value?.slice(14,16)||'00';
  const minDate=min?.slice(0,10)||undefined;
  const hours=Array.from({length:24},(_,i)=>String(i).padStart(2,'0'));
  const minutes=Array.from({length:60},(_,i)=>String(i).padStart(2,'0'));
  const changeDate=nextDate=>onChange(nextDate?`${nextDate}T${hour}:${minute}`:'');
  const changeHour=nextHour=>{if(date)onChange(`${date}T${nextHour}:${minute}`)};
  const changeMinute=nextMinute=>{if(date)onChange(`${date}T${hour}:${nextMinute}`)};
  return <div className="datetime-field">
    <div className="datetime-label">{label}{required&&<span aria-label="obligatorio"> *</span>}</div>
    <div className="datetime-controls">
      <label className="datetime-part datetime-date">Fecha
        <input type="date" value={date} min={minDate} required={required} disabled={disabled} onChange={e=>changeDate(e.target.value)}/>
      </label>
      <label className="datetime-part">Hora
        <select value={hour} disabled={!date||disabled} onChange={e=>changeHour(e.target.value)}>
          {hours.map(h=><option key={h} value={h}>{h}</option>)}
        </select>
      </label>
      <label className="datetime-part">Minutos
        <select value={minute} disabled={!date||disabled} onChange={e=>changeMinute(e.target.value)}>
          {minutes.map(m=><option key={m} value={m}>{m}</option>)}
        </select>
      </label>
    </div>
    <div className="datetime-hint">{date?`Seleccionado: ${date.split('-').reverse().join('/')} a las ${hour}:${minute} hs`:'Elegí la fecha y después la hora y los minutos.'}</div>
  </div>;
}
function App(){
  const[user,setUser]=useState(undefined),[page,setPage]=useState('videos'),[clients,setClients]=useState([]),[totems,setTotems]=useState([]),[videos,setVideos]=useState([]),[schedules,setSchedules]=useState([]),[users,setUsers]=useState([]),[storage,setStorage]=useState(null),[error,setError]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState(false),[selectedTotem,setSelectedTotem]=useState('');
  const admin=user?.role==='admin';
  const fetchAll=async()=>{
    const results=await Promise.all([admin?api('/clients'):Promise.resolve({clients:[]}),api('/totems'),api('/videos'),admin?api('/schedules'):Promise.resolve({schedules:[]}),admin?api('/users'):Promise.resolve({users:[]}),admin?api('/admin/storage'):Promise.resolve(null)]);
    setClients(results[0].clients);setTotems(results[1].totems);setVideos(results[2].videos);setSchedules(results[3].schedules);setUsers(results[4].users);setStorage(results[5]);
  };
  useEffect(()=>{api('/auth/me').then(r=>setUser(r.user)).catch(()=>setUser(null))},[]);
  useEffect(()=>{if(user){fetchAll().catch(e=>setError(e.message))}},[user]);
  useEffect(()=>{if(!user||user.role!=='admin')return;const timer=setInterval(()=>fetchAll().catch(()=>{}),30000);return ()=>clearInterval(timer)},[user]);
  function showError(e){setMessage('');setError(e.message)}
  async function perform(fn){setBusy(true);setError('');setMessage('');try{const result=await fn();const msg=typeof result==='object'?result.msg:result;setMessage(msg||'Cambios guardados');if(!result?.skipRefresh)await fetchAll();}catch(e){showError(e)}finally{setBusy(false)}}
  async function logout(){try{await api('/auth/logout',{method:'POST'});}finally{setUser(null)}}
  if(user===undefined)return <div className="loading">Cargando Totem Video Manager...</div>;
  if(!user)return <Login onLogin={setUser}/>;
  const pendingCount=videos.filter(v=>v.status==='pending').length;
  const links=[['videos','Videos'],['totems','Tótems'],...(admin?[['alerts','Avisos'],['clients','Clientes'],['users','Usuarios'],['agenda','Agenda'],['playlists','Publicaciones'],['storage','Almacenamiento']]:[])];
  return <div className="app-shell"><aside className="sidebar"><div className="brand"><div className="brand-logo-box"><GyALogo compact/></div><div className="brand-product"><span>TVM SERVER</span><strong>Totem Video Manager</strong></div></div><div className="menu-label">PLATAFORMA DE CONTENIDOS</div><nav>{links.map(([key,label])=><button key={key} onClick={()=>{setPage(key);setError('');setMessage('')}} className={page===key?'active':''}>{label}{key==='alerts'&&pendingCount>0&&<span className="nav-count">{pendingCount}</span>}</button>)}</nav><div className="sidebar-foot"><div className="avatar">{user.email[0]?.toUpperCase()}</div><div className="user-info"><strong>{user.role==='admin'?'Administrador':'Cliente'}</strong><span title={user.email}>{user.email}</span></div><button className="signout" onClick={logout} title="Cerrar sesión">Salir</button></div></aside><main><header className="top"><div><span className="eyebrow">GYA DIGITAL / GESTIÓN CENTRALIZADA</span><h1>{links.find(l=>l[0]===page)?.[1]||'Panel'}</h1></div><div className="top-tools"><span className="online-dot"/> Panel conectado <button className="ghost" onClick={()=>perform(async()=>{await fetchAll();return 'Datos actualizados'})}>Actualizar</button></div></header><div className="main-content">{error&&<div className="alert" role="alert">{error}<button onClick={()=>setError('')}>×</button></div>}{message&&<div className="notice">{message}<button onClick={()=>setMessage('')}>×</button></div>}
    {page==='alerts'&&admin&&<AlertsPage videos={videos} schedules={schedules} storage={storage} onGoVideos={()=>setPage('videos')} onGoAgenda={()=>setPage('agenda')}/>}
    {page==='storage'&&admin&&<StoragePage storage={storage} onRefresh={()=>perform(async()=>{await fetchAll();return 'Almacenamiento actualizado'})}/>}
    {page==='videos'&&<VideosPage admin={admin} clients={clients} totems={totems} videos={videos} busy={busy} run={perform}/>}
    {page==='totems'&&<TotemsPage admin={admin} clients={clients} totems={totems} busy={busy} run={perform}/>}
    {page==='agenda'&&admin&&<AgendaPage videos={videos} totems={totems} schedules={schedules} clients={clients} busy={busy} run={perform}/>}
    {page==='clients'&&admin&&<ClientsPage clients={clients} busy={busy} run={perform}/>}
    {page==='users'&&admin&&<UsersPage users={users} clients={clients} me={user} busy={busy} run={perform} onSelfReset={()=>setUser(null)}/>}
    {page==='playlists'&&admin&&<PlaylistsPage videos={videos} schedules={schedules} totems={totems} selected={selectedTotem} setSelected={setSelectedTotem} busy={busy} run={perform}/>}
    <footer>TVM Server v0.4 · GyA Digital · Etapa 1 — Panel web. Sincronización Raspberry mediante agente independiente.</footer>
  </div></main></div>
}
function AlertsPage({videos,schedules,storage,onGoVideos,onGoAgenda}){
  const pending=videos.filter(v=>v.status==='pending');
  const next=schedules.filter(s=>s.status==='scheduled').sort((a,b)=>new Date(a.starts_at)-new Date(b.starts_at)).slice(0,8);
  const disk=storage?.disk;
  return <>
    <div className="stats"><Stat label="Pendientes de aprobación" value={pending.length}/><Stat label="Campañas programadas" value={schedules.filter(s=>s.status==='scheduled').length}/><Stat label="Campañas activas" value={schedules.filter(s=>s.status==='active').length}/></div>
    {disk&&disk.freeBytes<3*1024**3&&<div className="warning-box">Advertencia: quedan {readableBytes(disk.freeBytes)} libres en el disco del servidor. Revisá Almacenamiento.</div>}
    <Section title="Videos que necesitan autorización" subtitle="Nuevas cargas de los clientes esperando la revisión de GyA." toolbar={<button className="ghost" onClick={onGoVideos}>Ir a Videos</button>}>
      {pending.map(v=><div className="alert-item" key={v.id}><div><strong>{v.originalName}</strong><small>{v.clientName} · {asDate(v.uploadedAt)} · {v.note||'Sin nota'}</small></div><span className="urgency upcoming">Pendiente</span></div>)}
      {!pending.length&&<p className="helper">¡Al día! No hay videos pendientes de revisión.</p>}
    </Section>
    <Section title="Próximas publicaciones" subtitle="Campañas ya autorizadas que se activarán automáticamente según su fecha." toolbar={<button className="ghost" onClick={onGoAgenda}>Abrir Agenda</button>}>
      {next.map(s=><div className="alert-item" key={s.id}><div><strong>{s.video_name}</strong><small>{s.client_name} · Tótem {s.totem_code} · {asDate(s.starts_at)}</small></div><Urgency date={s.starts_at} status={s.status}/></div>)}
      {!next.length&&<p className="helper">No hay campañas programadas por comenzar.</p>}
    </Section>
  </>;
}
function StoragePage({storage,onRefresh}){
  if(!storage)return <Section title="Almacenamiento" subtitle="Cargando los datos del servidor..."/>;
  const disk=storage.disk;
  const percent=disk&&disk.totalBytes?Math.min(100,Math.round((disk.totalBytes-disk.freeBytes)*100/disk.totalBytes)):null;
  return <>
    <div className="stats"><Stat label="Espacio ocupado por videos" value={readableBytes(storage.totalBytes)}/><Stat label="Videos en biblioteca" value={storage.clients.reduce((n,c)=>n+c.videoCount,0)}/><Stat label="Disco libre" value={disk?readableBytes(disk.freeBytes):'No disponible'}/></div>
    <Section title="Espacio del servidor" subtitle="El espacio del disco incluye también PostgreSQL, el sistema operativo y otros proyectos del VPS." toolbar={<button className="ghost" onClick={onRefresh}>Actualizar</button>}>
      {disk&&<><div className="storage-progress"><div style={{width:percent+'%'}}/></div><p className="helper">{percent}% del disco en uso · {readableBytes(disk.freeBytes)} libres de {readableBytes(disk.totalBytes)} en total.</p></>}
      <p className="helper">Límite por archivo: {storage.maxUploadMb} MB. Verificación de códecs: <strong>{storage.ffprobeReady?'FFprobe disponible':'FFprobe no instalado · se permiten archivos sin comprobar códecs'}</strong>.</p>
      {disk&&disk.freeBytes<3*1024**3&&<div className="warning-box">Queda poco espacio libre: revisá los archivos y ampliá el disco antes de recibir más videos.</div>}
    </Section>
    <Section title="Uso por cliente" subtitle="Tamaño de los MP4 que cada empresa tiene almacenados, incluidos pendientes y rechazados.">
      <div className="table-wrapper"><table><thead><tr><th>Cliente</th><th>Videos</th><th>Espacio utilizado</th></tr></thead><tbody>
        {storage.clients.map(c=><tr key={c.clientId}><td><strong>{c.clientName}</strong></td><td>{c.videoCount}</td><td>{readableBytes(c.bytes)}</td></tr>)}
        {!storage.clients.length&&<tr><td colSpan="3" className="empty">Sin clientes todavía.</td></tr>}
      </tbody></table></div>
    </Section>
  </>;
}
function TotemCheckboxes({totems,selected,onChange}){
  return <div className="totem-chooser" role="group" aria-label="Seleccionar tótems">
    {totems.map(t=><label key={t.id} className="totem-choice"><input type="checkbox" checked={selected.includes(t.id)} onChange={e=>onChange(e.target.checked?[...selected,t.id]:selected.filter(id=>id!==t.id))}/><span>{t.code}<small>{t.client_name}</small></span></label>)}
    {!totems.length&&<p className="helper">Este cliente todavía no tiene tótems registrados. Crealo en la sección Tótems.</p>}
  </div>;
}
function AuthorizePanel({video,totems,busy,run,onClose}){
  const [chosen,setChosen]=useState([]);
  const [start,setStart]=useState(localDateTime(video.requestedStartAt)||localDateTime(new Date(Date.now()+60000)));
  const [end,setEnd]=useState(localDateTime(video.requestedEndAt));
  const eligible=totems.filter(t=>t.client_id===video.clientId);
  async function submit(e){
    e.preventDefault();
    if(!chosen.length){alert('Seleccioná al menos un tótem');return;}
    if(end&&new Date(end)<=new Date(start)){alert('La finalización debe ser posterior al inicio');return;}
    if(!confirm(`¿Autorizar «${video.originalName}» para ${chosen.length} tótem(s)?\nSe activará automáticamente según la fecha elegida.`))return;
    await run(async()=>{
      const r=await api('/videos/'+video.id+'/authorize-schedule',{method:'POST',body:JSON.stringify({totemIds:chosen,startsAt:isoDateTime(start),endsAt:isoDateTime(end)})});
      onClose();return `Video autorizado y programado en ${r.count} tótem(s).`;
    });
  }
  return <Section title="Autorizar y programar" subtitle="Un solo paso: revisar fecha, seleccionar tótems y autorizar. El servidor publicará automáticamente cuando corresponda." toolbar={<button className="ghost" onClick={onClose}>Cerrar</button>}>
    <div className="note-preview"><strong>Video:</strong> {video.originalName} · <strong>Cliente:</strong> {video.clientName}<br/><strong>Nota:</strong> {video.note||'Sin observaciones'}</div>
    {video.mediaValidation!=='compatible'&&<div className="warning-box">Este archivo no tiene verificación técnica de códecs. Antes de autorizar, reproducilo y revisá que sea compatible con la Raspberry. Recomendamos instalar FFprobe.</div>}
    <form className="upload-form" onSubmit={submit}>
      <Field label="Tótems donde se reproducirá"><TotemCheckboxes totems={eligible} selected={chosen} onChange={setChosen}/></Field>
      <div className="form-grid"><DateTimeField label="Inicio autorizado" value={start} onChange={setStart} required/><DateTimeField label="Finalización (opcional)" value={end} onChange={setEnd} min={start} disabled={!start}/></div>
      <div className="form-actions"><span className="helper">Si la fecha solicitada ya pasó y la campaña no terminó, comenzará al autorizarla. El video nunca se activa sin este permiso.</span><button className="primary" disabled={busy||!chosen.length||!start}>Confirmar autorización y programación</button></div>
    </form>
  </Section>;
}
function VideoPreview({video,onClose}){
  useEffect(()=>{const onKey=e=>{if(e.key==='Escape')onClose()};window.addEventListener('keydown',onKey);return ()=>window.removeEventListener('keydown',onKey)},[onClose]);
  return <div className="preview-shade" role="presentation" onMouseDown={e=>{if(e.target===e.currentTarget)onClose()}}>
    <div className="preview-panel" role="dialog" aria-modal="true" aria-label={'Vista previa de '+video.originalName}>
      <div className="preview-head"><div><strong>{video.originalName}</strong><small>{video.clientName} · {readableBytes(video.size)}</small></div><button className="ghost" onClick={onClose}>Cerrar ✕</button></div>
      <video className="video-preview" src={'/api/videos/'+video.id+'/file'} controls autoPlay playsInline preload="metadata">Tu navegador no puede reproducir este archivo.</video>
      <div className="preview-foot"><span><strong>Estado:</strong> {statuses[video.status]}</span><span><strong>Compatibilidad:</strong> {video.mediaValidation==='compatible'?'H.264 / AAC · validado':'Sin verificación FFprobe'}</span>{video.width&&<span>{video.width} × {video.height} · {video.fps} FPS</span>}</div>
      {video.note&&<p className="helper">Nota: {video.note}</p>}
    </div>
  </div>;
}
function MediaBadge({video}){
  const valid=video.mediaValidation==='compatible';
  return <span className={'media-badge '+(valid?'is-valid':'is-unknown')}>{valid?`Compatible · ${video.width}×${video.height}`:'Sin verificar códecs'}</span>;
}
function VideosPage({admin,clients,totems,videos,busy,run}){
  const [file,setFile]=useState(null),[clientId,setClientId]=useState('');
  const [note,setNote]=useState(''),[startsAt,setStartsAt]=useState(''),[endsAt,setEndsAt]=useState('');
  const [approvalMode,setApprovalMode]=useState('pending'),[directTotems,setDirectTotems]=useState([]),[authorizeId,setAuthorizeId]=useState(null),[previewId,setPreviewId]=useState(null);
  const currentClientTotems=totems.filter(t=>t.client_id===clientId);
  const authorization=videos.find(v=>v.id===authorizeId);
  const previewVideo=videos.find(v=>v.id===previewId);
  async function upload(e){
    e.preventDefault();if(!file)return;
    if(endsAt&&!startsAt){alert('Elegí una fecha de inicio antes de agregar una finalización');return;}
    if(startsAt&&new Date(startsAt).getTime()<Date.now()-60000){alert('La fecha solicitada debe ser futura');return;}
    if(endsAt&&new Date(endsAt)<=new Date(startsAt)){alert('La fecha de fin debe ser posterior al inicio');return;}
    if(admin&&approvalMode==='publish'&&!directTotems.length){alert('Para publicar directamente elegí al menos un tótem');return;}
    if(admin&&approvalMode==='publish'&&!confirm(`¿Autorizar y ${startsAt?'programar':'publicar ahora'} este archivo en ${directTotems.length} tótem(s)?`))return;
    await run(async()=>{
      const data=new FormData();data.append('video',file);
      if(admin){data.append('clientId',clientId);data.append('approvalMode',approvalMode);if(approvalMode==='publish')data.append('totemIds',JSON.stringify(directTotems));}
      data.append('note',note);
      if(startsAt)data.append('requestedStartAt',isoDateTime(startsAt));
      if(endsAt)data.append('requestedEndAt',isoDateTime(endsAt));
      await api('/videos',{method:'POST',body:data});
      setFile(null);setNote('');setStartsAt('');setEndsAt('');setDirectTotems([]);e.target.reset();
      return admin&&approvalMode==='publish'?`Video aprobado y ${startsAt?'programado':'publicado'} en ${directTotems.length} tótem(s).`:'Video recibido. GyA deberá autorizar y asignar los tótems.';
    });
  }
  const pending=videos.filter(v=>v.status==='pending').length;
  return <>
    {previewVideo&&<VideoPreview video={previewVideo} onClose={()=>setPreviewId(null)}/>}
    <div className="stats"><Stat label="Total de videos" value={videos.length}/><Stat label="Pendientes de revisión" value={pending}/><Stat label="Aprobados" value={videos.filter(v=>v.status==='approved').length}/></div>
    <Section title="Subir un video" subtitle={admin?'Carga por cuenta de cualquier cliente. Podés dejarlo pendiente o autorizarlo y publicarlo directamente.':'Cargá tu MP4, una nota y la fecha solicitada. GyA revisará y autorizará la campaña.'}>
      <form onSubmit={upload} className="upload-form">
        <div className="form-grid">
          <Field label="Archivo MP4"><input type="file" accept="video/mp4,.mp4" onChange={e=>setFile(e.target.files[0]||null)} required/></Field>
          {admin&&<Field label="Cliente"><select value={clientId} onChange={e=>{setClientId(e.target.value);setDirectTotems([]);}} required><option value="">Seleccionar cliente</option>{clients.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>}
        </div>
        <Field label="Descripción / nota para GyA"><textarea rows={3} placeholder="Ej.: Campaña del fin de semana, evento de lanzamiento..." maxLength={1000} value={note} onChange={e=>setNote(e.target.value)}/></Field>
        <div className="form-grid"><DateTimeField label={admin?'Fecha y hora de publicación (vacío = ahora al autorizar)':'Fecha y hora solicitadas (opcional)'} value={startsAt} onChange={v=>{setStartsAt(v);if(!v)setEndsAt('');}}/><DateTimeField label="Finalizar publicación (opcional)" min={startsAt} value={endsAt} disabled={!startsAt} onChange={setEndsAt}/></div>
        {admin&&<div className="admin-upload-options"><strong>¿Qué querés hacer con este video?</strong><label><input type="radio" name="approvalMode" checked={approvalMode==='pending'} onChange={()=>setApprovalMode('pending')}/> Solo subir: queda pendiente de autorización</label><label><input type="radio" name="approvalMode" checked={approvalMode==='publish'} onChange={()=>setApprovalMode('publish')}/> Autorizar y {startsAt?'programar automáticamente':'publicar ahora'}</label>
          {approvalMode==='publish'&&<Field label="Seleccioná los tótems de este cliente"><TotemCheckboxes totems={currentClientTotems} selected={directTotems} onChange={setDirectTotems}/></Field>}</div>}
        <div className="form-actions"><span className="helper">Hora local de esta computadora. Una publicación futura se activa cuando llega el horario, no al aprobarla.</span><button className="primary" disabled={busy||!file||(admin&&!clientId)||(admin&&approvalMode==='publish'&&!directTotems.length)}>{busy?'Subiendo...':admin&&approvalMode==='publish'?'Subir, autorizar y publicar/programar':'Enviar para aprobación'}</button></div>
      </form>
      <div className="helper">El archivo conserva su nombre original en pantalla y se guarda en el servidor con ID único. Si está disponible FFprobe, se verifican H.264, AAC, resolución Full HD y hasta 30 FPS. Sin FFprobe, se muestra «Sin verificar».</div>
    </Section>
    {admin&&authorization&&<AuthorizePanel key={authorization.id} video={authorization} totems={totems} busy={busy} run={run} onClose={()=>setAuthorizeId(null)}/>}
    <Section title={admin?'Biblioteca de todos los clientes':'Mis videos'} subtitle="Los videos de los clientes requieren autorización de GyA. Solo el administrador puede despublicar o borrar.">
      <div className="table-wrapper"><table><thead><tr><th>Archivo</th>{admin&&<th>Cliente</th>}<th>Nota</th><th>Publicación solicitada</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>
        {videos.map(v=><tr key={v.id}><td className="filename" title={v.originalName}>{v.originalName}<div className="secondary-small">{readableBytes(v.size)} · {asDate(v.uploadedAt)}</div><MediaBadge video={v}/>{v.status==='rejected'&&v.rejectionReason&&<div className="rejection-reason"><strong>Motivo:</strong> {v.rejectionReason}</div>}</td>{admin&&<td>{v.clientName}</td>}<td className="note-col" title={v.note||''}>{v.note||'—'}</td><td>{asDate(v.requestedStartAt)}{v.requestedEndAt&&<div className="secondary-small">Hasta: {asDate(v.requestedEndAt)}</div>}</td><td><span className={'pill '+v.status}>{statuses[v.status]}</span></td><td className="row-actions"><button className="preview-action" type="button" onClick={()=>setPreviewId(v.id)}>▶ Vista previa</button>{admin&&v.mediaValidation!=='compatible'&&<button className="preview-action" type="button" disabled={busy} onClick={()=>run(async()=>{const r=await api('/videos/'+v.id+'/verify',{method:'POST'});return r.mediaValidation==='compatible'?'Archivo compatible con Raspberry Pi 3.':'Sin FFprobe: archivo todavía no verificado.'})}>Verificar MP4</button>}{admin&&v.status!=='rejected'&&<button disabled={busy} className="authorize-action" onClick={()=>setAuthorizeId(v.id)}>{v.status==='pending'?'Autorizar y programar':'Programar en tótems'}</button>}{admin&&v.status!=='rejected'&&<button className="danger-text" disabled={busy} onClick={()=>{const reason=prompt('Motivo del rechazo (lo verá el cliente):');if(reason===null)return;if(reason.trim().length<5){alert('Ingresá al menos 5 caracteres');return;}if(!confirm('¿Rechazar el video y retirar todas sus publicaciones?'))return;run(async()=>{await api('/videos/'+v.id+'/status',{method:'PATCH',body:JSON.stringify({status:'rejected',reason:reason.trim()})});return 'Video rechazado. El cliente verá el motivo.'})}}>Rechazar</button>}{admin&&v.hasPublications&&<button className="unpublish-action" disabled={busy} onClick={()=>{if(!confirm('¿Despublicar «'+v.originalName+'»? Se retirará de las listas y se cancelarán sus campañas, pero se conservará el MP4.'))return;run(async()=>{const r=await api('/videos/'+v.id+'/unpublish',{method:'POST'});return 'Video despublicado en '+r.removedFrom+' tótem(s).'})}}>Despublicar</button>}{admin&&<button className="delete-action" disabled={busy} onClick={()=>{if(!confirm('¿ELIMINAR DEFINITIVAMENTE «'+v.originalName+'»? Se eliminará el MP4 y todas sus programaciones.'))return;run(async()=>{const r=await api('/videos/'+v.id,{method:'DELETE',body:JSON.stringify({confirm:true})});return r.cleanupPending?'Video eliminado del sistema; borrado físico pendiente de reintento.':'Video eliminado definitivamente.'})}}>Eliminar</button>}</td></tr>)}
        {!videos.length&&<tr><td colSpan={admin?6:5} className="empty">Todavía no hay videos cargados.</td></tr>}
      </tbody></table></div>
    </Section>
  </>;
}
function Stat({label,value}){return <div className="stat"><span>{label}</span><strong>{value}</strong></div>}
function ClientsPage({clients,busy,run}){
  const[name,setName]=useState(''),[email,setEmail]=useState(''),[pw,setPw]=useState(''),[selected,setSelected]=useState('');
  return <><Section title="Crear cliente" subtitle="Una empresa puede tener uno o varios tótems."><form className="inline-form" onSubmit={e=>{e.preventDefault();run(async()=>{await api('/clients',{method:'POST',body:JSON.stringify({name})});setName('');return 'Cliente creado'});}}><Field label="Nombre de empresa"><input value={name} onChange={e=>setName(e.target.value)} minLength={2} maxLength={150} required placeholder="Ej.: Coca-Cola"/></Field><button className="primary" disabled={busy}>Crear cliente</button></form></Section><Section title="Crear usuario del cliente" subtitle="El usuario solamente tendrá acceso a videos y tótems de su empresa."><form className="inline-form" onSubmit={e=>{e.preventDefault();run(async()=>{await api('/users/client',{method:'POST',body:JSON.stringify({clientId:selected,email,password:pw})});setEmail('');setPw('');return 'Acceso del cliente creado'})}}><Field label="Empresa"><select required value={selected} onChange={e=>setSelected(e.target.value)}><option value="">Seleccionar</option>{clients.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></Field><Field label="Correo"><input type="email" required value={email} onChange={e=>setEmail(e.target.value)}/></Field><Field label="Contraseña (mín. 12)"><input type="password" autoComplete="new-password" minLength={12} required value={pw} onChange={e=>setPw(e.target.value)}/></Field><button className="primary" disabled={busy}>Crear acceso</button></form></Section><Section title="Clientes registrados" subtitle="Listado de empresas"><div className="table-wrapper"><table><thead><tr><th>Empresa</th><th>ID</th><th>Alta</th></tr></thead><tbody>{clients.map(c=><tr key={c.id}><td><strong>{c.name}</strong></td><td className="mono">{c.id.slice(0,8)}…</td><td>{asDate(c.created_at)}</td></tr>)}{!clients.length&&<tr><td colSpan="3" className="empty">No hay clientes todavía.</td></tr>}</tbody></table></div></Section></>
}
function UsersPage({users,clients,me,busy,run,onSelfReset}){
  const[selectedId,setSelectedId]=useState(''),[email,setEmail]=useState(''),[password,setPassword]=useState(''),[active,setActive]=useState(true);
  const selected=users.find(u=>u.id===selectedId);
  function choose(user){setSelectedId(user.id);setEmail(user.email);setPassword('');setActive(user.is_active);}
  async function save(e){
    e.preventDefault();if(!selected)return;
    if(!email.trim()){alert('Ingresá un correo');return;}
    if(password&&password.length<12){alert('La contraseña nueva necesita al menos 12 caracteres');return;}
    if(!confirm(`¿Guardar los cambios del usuario ${selected.email}?${password?'\nLa contraseña anterior dejará de funcionar.':''}`))return;
    const isSelf=selected.id===me.id && (password||email.trim().toLowerCase()!==me.email);
    await run(async()=>{
      const patch={email,isActive:active};if(password)patch.password=password;
      await api('/users/'+selected.id,{method:'PATCH',body:JSON.stringify(patch)});
      setPassword('');
      if(isSelf){onSelfReset();return {msg:'Credenciales actualizadas. Iniciá sesión nuevamente.',skipRefresh:true};}
      return 'Usuario actualizado. Las sesiones anteriores se revocan si cambió la contraseña o el correo.';
    });
  }
  return <>
    <Section title="Gestión de usuarios" subtitle="Accesos de GyA y de cada cliente. Las contraseñas no se pueden ver: están protegidas; sí podés establecer una nueva.">
      <div className="table-wrapper"><table><thead><tr><th>Correo</th><th>Rol</th><th>Cliente</th><th>Alta</th><th>Acceso</th><th>Acciones</th></tr></thead><tbody>
        {users.map(u=><tr key={u.id}><td><strong>{u.email}</strong>{u.id===me.id&&<div className="secondary-small">Tu cuenta</div>}</td><td>{u.role==='admin'?'Administrador':'Cliente'}</td><td>{u.client_name||'GyA Digital'}</td><td>{asDate(u.created_at)}</td><td><span className={'pill '+(u.is_active?'approved':'rejected')}>{u.is_active?'Habilitado':'Deshabilitado'}</span></td><td className="row-actions"><button onClick={()=>choose(u)} className="authorize-action">Editar / Contraseña</button></td></tr>)}
        {!users.length&&<tr><td colSpan="6" className="empty">Sin usuarios registrados.</td></tr>}
      </tbody></table></div>
    </Section>
    {selected&&<Section title="Editar usuario" subtitle={`Modificando ${selected.email}. La contraseña actual nunca se muestra.`} toolbar={<button className="ghost" onClick={()=>setSelectedId('')}>Cerrar</button>}>
      <form className="upload-form" onSubmit={save}>
        <div className="form-grid"><Field label="Correo electrónico"><input type="email" required maxLength={254} value={email} onChange={e=>setEmail(e.target.value)}/></Field><Field label="Cliente / rol"><input value={`${selected.role==='admin'?'Administrador':'Cliente'} · ${selected.client_name||'GyA Digital'}`} disabled/></Field></div>
        <Field label="Nueva contraseña (opcional, mínimo 12 caracteres)"><input type="password" minLength={12} maxLength={128} autoComplete="new-password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="Dejá vacío para conservar la contraseña"/></Field>
        <label className="toggle-active"><input type="checkbox" checked={active} disabled={selected.id===me.id} onChange={e=>setActive(e.target.checked)}/><span>Permitir que este usuario inicie sesión</span></label>
        <p className="helper">Si cambiás la contraseña, el correo o desactivás el acceso, se cierran las sesiones anteriores del usuario. No se guardan contraseñas visibles.</p>
        <div className="form-actions"><span className="helper">Los cambios no eliminan clientes, videos ni tótems.</span><button className="primary" disabled={busy||!email.trim()}>Guardar usuario</button></div>
      </form>
    </Section>}
  </>;
}
function TotemsPage({admin,clients,totems,busy,run}){
  const[code,setCode]=useState(''),[client,setClient]=useState('');
  const[selected,setSelected]=useState(''),[details,setDetails]=useState(null),[detailError,setDetailError]=useState(''),[loading,setLoading]=useState(false),[pairToken,setPairToken]=useState('');
  const active=totems.find(t=>t.id===selected);
  async function load(id=selected){
    if(!id){setDetails(null);return;}
    setLoading(true);setDetailError('');
    try{const r=await api('/admin/totems/'+id+'/files');setDetails(r.totem);}
    catch(e){setDetailError(e.message)}finally{setLoading(false)}
  }
  const requestCleanup=()=>run(async()=>{
    if(!confirm('¿Solicitar limpieza del tótem? Solo se borrarán videos administrados por TVM que ya no estén en sus publicaciones.'))return 'Limpieza cancelada';
    await api('/admin/totems/'+selected+'/cleanup',{method:'POST',body:JSON.stringify({})});
    await load();return 'Limpieza solicitada. Se ejecutará cuando el tótem se conecte.';
  });
  const removeVideo=f=>run(async()=>{
    if(!confirm(`¿Retirar «${f.name}» solamente del tótem ${active?.code}? Se cancelarán sus publicaciones en este dispositivo y se borrará en la siguiente sincronización. No se eliminará del VPS ni de otros tótems.`))return 'Sin cambios';
    await api('/admin/totems/'+selected+'/videos/'+f.videoId+'/remove',{method:'POST',body:JSON.stringify({confirm:true})});
    await load();return 'Retiro solicitado. Esperando la próxima sincronización del tótem.';
  });
  const createToken=()=>run(async()=>{
    if(!confirm(`¿Vincular ${active?.code}? Si ya estaba vinculado, su clave anterior dejará de funcionar.`))return 'Sin cambios';
    const r=await api('/admin/totems/'+selected+'/pair',{method:'POST',body:JSON.stringify({confirm:true})});
    setPairToken(r.token);return 'Clave creada. Guardala ahora: no volverá a mostrarse.';
  });
  const disk=details?.device_disk_total!=null?Number(details.device_disk_total):null;
  const free=details?.device_disk_free!=null?Number(details.device_disk_free):null;
  const used=details?.device_disk_used!=null?Number(details.device_disk_used):null;
  const usage=disk>0?Math.min(100,Math.round(100*used/disk)):0;
  return <>
    {admin&&<Section title="Registrar tótem" subtitle="Asigná el dispositivo a un cliente. Después vinculás su agente para recibir datos reales."><form className="inline-form" onSubmit={e=>{e.preventDefault();run(async()=>{await api('/totems',{method:'POST',body:JSON.stringify({code,clientId:client})});setCode('');return 'Tótem registrado'})}}><Field label="Identificador"><input placeholder="TOTEM-001" value={code} onChange={e=>setCode(e.target.value.toUpperCase())} required pattern="[A-Z0-9-]{3,32}"/></Field><Field label="Cliente"><select required value={client} onChange={e=>setClient(e.target.value)}><option value="">Seleccionar</option>{clients.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></Field><button className="primary" disabled={busy}>Registrar tótem</button></form></Section>}
    <Section title={admin?'Almacenamiento de los tótems':'Mis tótems'} subtitle="Capacidad real informada por cada Raspberry conectada; los datos antiguos se identifican como desconectados.">
      <div className="table-wrapper"><table><thead><tr><th>Identificador</th>{admin&&<th>Cliente</th>}<th>Conexión</th><th>Libre</th><th>Uso</th><th>Último contacto</th>{admin&&<th>Gestionar</th>}</tr></thead><tbody>{totems.map(t=>{
        const online=t.last_seen && Date.now()-new Date(t.last_seen).getTime()<180000;
        const hasDisk=t.device_disk_total!=null && t.device_disk_free!=null;
        return <tr key={t.id}><td><strong>{t.code}</strong></td>{admin&&<td>{t.client_name}</td>}<td><span className={'pill '+(online?'approved':'pending')}>{online?'Online':'Sin conexión'}</span></td><td>{hasDisk?readableBytes(Number(t.device_disk_free)):'Sin datos'}</td><td>{hasDisk?`${Math.round(100*(Number(t.device_disk_total)-Number(t.device_disk_free))/Math.max(1,Number(t.device_disk_total)))}%`:'—'}</td><td>{asDate(t.last_seen)}</td>{admin&&<td><button className="authorize-action" onClick={()=>{setSelected(t.id);setPairToken('');setDetails(null);load(t.id)}}>Administrar</button></td>}</tr>
      })}{!totems.length&&<tr><td colSpan={admin?7:5} className="empty">No hay tótems registrados.</td></tr>}</tbody></table></div>
    </Section>
    {admin&&active&&<Section title={'Administrar '+active.code} subtitle="El servidor no borra directamente archivos de una Raspberry: deja la orden pendiente hasta que el dispositivo confirme." toolbar={<button className="ghost" onClick={()=>{setSelected('');setDetails(null);setPairToken('')}}>Cerrar</button>}>
      {detailError&&<div className="alert">{detailError}</div>}
      <div className="totem-toolbar"><button className="ghost" disabled={loading||busy} onClick={()=>load()}>{loading?'Consultando...':'Actualizar información'}</button><button className="ghost" disabled={busy} onClick={createToken}>Vincular / renovar clave</button><button className="ghost" disabled={busy} onClick={requestCleanup}>Liberar espacio</button></div>
      {pairToken&&<div className="token-card"><strong>Clave del agente: se muestra una sola vez</strong><p>Copiala a <code>tvm-agent/config.json</code> de la Raspberry. No la publiques en GitHub, ni la compartas con clientes.</p><code className="token-value">{pairToken}</code><div><button type="button" className="ghost" onClick={()=>navigator.clipboard?.writeText(pairToken)}>Copiar clave</button><button type="button" className="ghost" onClick={()=>setPairToken('')}>Ocultar</button></div></div>}
      {details&&<>
        <div className="stats"><Stat label="Capacidad SD/disco" value={disk!=null?readableBytes(disk):'Sin datos'}/><Stat label="Espacio disponible" value={free!=null?readableBytes(free):'Sin datos'}/><Stat label="Videos TVM en tótem" value={readableBytes(Number(details.device_video_bytes)||0)}/></div>
        {disk!=null&&<div className="totem-disk"><div className="totem-disk-bar"><span style={{width:usage+'%'}}/></div><p className="helper">Uso total: {usage}% · {readableBytes(free)} libre. {free<2*1024**3?'⚠ Queda poco espacio.':''}</p></div>}
        <p className="helper">Estado: {details.connectionStatus==='online'?'Conectado':'Sin conexión'} · Último informe: {asDate(details.device_reported_at)} · Playlist: v{details.playlist_version} · Confirmada: v{details.device_synced_version??'—'} · Limpieza: {Number(details.device_cleanup_generation)>Number(details.device_cleanup_ack)?'Pendiente':'Al día'}</p>
        {details.device_last_error&&<div className="warning-box">Último error del tótem: {details.device_last_error}</div>}
        <h3>Archivos descargados en este dispositivo</h3>
        <div className="table-wrapper"><table><thead><tr><th>Video</th><th>Espacio</th><th>Acción</th></tr></thead><tbody>{(details.files||[]).map(f=><tr key={f.videoId}><td>{f.name}</td><td>{readableBytes(Number(f.bytes))}</td><td><button type="button" className="delete-action" disabled={busy} onClick={()=>removeVideo(f)}>Eliminar del tótem</button></td></tr>)}{!details.files?.length&&<tr><td colSpan={3} className="empty">No hay archivos informados. Para verlos, primero vinculá y ejecutá el agente.</td></tr>}</tbody></table></div>
        <p className="helper">Eliminar del tótem retira ese video de sus publicaciones, conserva el MP4 en el VPS y no afecta otros dispositivos. La limpieza borra exclusivamente archivos TVM sin uso.</p>
      </>}
    </Section>}
  </>;
}
function PlaylistsPage({videos,schedules,totems,selected,setSelected,busy,run}){
  const[items,setItems]=useState([]),[version,setVersion]=useState(''),[loading,setLoading]=useState(false),[err,setErr]=useState('');
  const totem=totems.find(x=>x.id===selected);
  const scheduledIds=new Set(schedules.filter(s=>s.totem_id===selected&&['scheduled','active'].includes(s.status)).map(s=>s.video_id));
  const approved=videos.filter(v=>v.status==='approved'&&v.clientId===totem?.client_id&&!scheduledIds.has(v.id));
  useEffect(()=>{if(!selected){setItems([]);setVersion('');return;}setLoading(true);api('/totems/'+selected+'/playlist').then(r=>{setItems(r.items.map(v=>v.id));setVersion(r.totem.playlist_version)}).catch(e=>setErr(e.message)).finally(()=>setLoading(false));},[selected]);
  function move(i,dir){const n=i+dir;if(n<0||n>=items.length)return;setItems(prev=>{const a=[...prev];[a[i],a[n]]=[a[n],a[i]];return a})}
  return <Section title="Publicaciones por tótem" subtitle="Lista MANUAL. Las campañas con fecha se administran en Agenda y se activan automáticamente. No agregues manualmente un video programado."><Field label="Seleccioná un tótem"><select value={selected} onChange={e=>{setErr('');setSelected(e.target.value)}}><option value="">Elegir tótem</option>{totems.map(t=><option key={t.id} value={t.id}>{t.code} — {t.client_name}</option>)}</select></Field>{err&&<div className="alert">{err}</div>}{totem&&<><p className="helper">Versión publicada: v{version} · {loading?'Cargando…':'Modificá la lista y presioná Publicar cambios.'}</p><div className="playlist-editor"><div><h3>Videos aprobados</h3>{approved.filter(v=>!items.includes(v.id)).map(v=><div className="playlist-item" key={v.id}><span title={v.originalName}>{v.originalName}</span><button onClick={()=>setItems(x=>[...x,v.id])}>+ Agregar</button></div>)}{approved.every(v=>items.includes(v.id))&&<p className="helper">No quedan videos aprobados sin agregar.</p>}</div><div><h3>Lista del tótem ({items.length})</h3>{items.map((id,i)=>{const v=approved.find(x=>x.id===id)||videos.find(x=>x.id===id);return <div className="playlist-item" key={id}><span>{i+1}. {v?.originalName||id}</span><div className="playlist-buttons"><button onClick={()=>move(i,-1)} disabled={!i}>↑</button><button onClick={()=>move(i,1)} disabled={i===items.length-1}>↓</button><button onClick={()=>setItems(x=>x.filter(item=>item!==id))} className="danger-text">Quitar</button></div></div>})}{!items.length&&<p className="helper">Lista vacía.</p>}</div></div><button className="primary" disabled={busy||loading} onClick={()=>run(async()=>{if(!confirm('¿Publicar esta lista para '+totem.code+'?'))return 'Sin cambios';const r=await api('/totems/'+selected+'/playlist',{method:'PUT',body:JSON.stringify({videoIds:items})});setVersion(r.version);return 'Lista publicada como v'+r.version})}>Publicar cambios</button><p className="helper">Las campañas de Agenda se suman automáticamente cuando están activas. La sincronización con Raspberry sigue pendiente.</p></>}</Section>
}
function AgendaPage({videos,totems,schedules,clients,busy,run}){
  const[clientFilter,setClientFilter]=useState(''),[videoId,setVideoId]=useState(''),[totemId,setTotemId]=useState('');
  const[startsAt,setStartsAt]=useState(''),[endsAt,setEndsAt]=useState('');
  const[previewTotem,setPreviewTotem]=useState(''),[effective,setEffective]=useState(null),[previewError,setPreviewError]=useState('');
  const approved=videos.filter(v=>v.status==='approved'&&(!clientFilter||v.clientId===clientFilter));
  const selectedVideo=videos.find(v=>v.id===videoId);
  const targetTotems=totems.filter(t=>(!selectedVideo||t.client_id===selectedVideo.clientId)&&(!clientFilter||t.client_id===clientFilter));
  const filteredVideos=videos.filter(v=>!clientFilter||v.clientId===clientFilter);
  const filteredSchedules=schedules.filter(s=>!clientFilter||totems.find(t=>t.id===s.totem_id)?.client_id===clientFilter);
  const schedulesByVideo=new Map();
  for(const s of schedules){if(!schedulesByVideo.has(s.video_id))schedulesByVideo.set(s.video_id,[]);schedulesByVideo.get(s.video_id).push(s);}
  async function preview(id){setPreviewError('');setEffective(null);if(!id)return;try{setEffective(await api('/totems/'+id+'/effective-playlist'));}catch(e){setPreviewError(e.message);}}
  async function schedule(e){
    e.preventDefault();
    if(endsAt&&new Date(endsAt)<=new Date(startsAt)){alert('La fecha de fin debe ser posterior al inicio');return;}
    await run(async()=>{
      await api('/schedules',{method:'POST',body:JSON.stringify({videoId,totemId,startsAt:isoDateTime(startsAt),endsAt:isoDateTime(endsAt)})});
      if(previewTotem===totemId)await preview(totemId);
      setVideoId('');setTotemId('');setStartsAt('');setEndsAt('');
      return 'Nueva campaña programada. Se activará automáticamente a la fecha y hora indicadas.';
    });
  }
  return <>
    <div className="stats"><Stat label="Videos por revisar" value={videos.filter(v=>v.status==='pending').length}/><Stat label="Programaciones futuras" value={schedules.filter(s=>s.status==='scheduled').length}/><Stat label="Publicaciones activas" value={schedules.filter(s=>s.status==='active').length}/></div>
    <Section title="Agenda de publicaciones" subtitle="Fechas solicitadas por los clientes. El color señala qué tan cerca está la fecha, pero no reemplaza la aprobación.">
      <div className="agenda-tools"><Field label="Filtrar por cliente"><select value={clientFilter} onChange={e=>{setClientFilter(e.target.value);setVideoId('');setTotemId('')}}><option value="">Todos los clientes</option>{clients.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></Field><div className="legend"><Urgency date={new Date(Date.now()+5*86400000).toISOString()}/><Urgency date={new Date(Date.now()+86400000).toISOString()}/><Urgency date={new Date(Date.now()-3600000).toISOString()}/><Urgency status="active"/></div></div>
      <div className="table-wrapper"><table className="agenda-table"><thead><tr><th>Cliente</th><th>Video</th><th>Nota</th><th>Fecha solicitada</th><th>Revisión</th><th>Publicación</th></tr></thead><tbody>
        {filteredVideos.map(v=>{const ss=schedulesByVideo.get(v.id)||[];const active=ss.find(x=>x.status==='active');const planned=ss.find(x=>x.status==='scheduled');const done=ss.find(x=>x.status==='completed');const state=active||planned||done;const urgent=dateUrgency(state?.starts_at||v.requestedStartAt,state?.status);return <tr key={v.id} className={'agenda-row '+urgent.color}><td>{v.clientName}</td><td className="filename">{v.originalName}</td><td className="note-col" title={v.note}>{v.note||'—'}</td><td>{asDate(v.requestedStartAt)}{v.requestedEndAt&&<div className="secondary-small">Fin: {asDate(v.requestedEndAt)}</div>}</td><td><span className={'pill '+v.status}>{statuses[v.status]}</span></td><td><Urgency date={state?.starts_at||v.requestedStartAt} status={state?.status}/><div className="secondary-small">{ss.filter(x=>['active','scheduled'].includes(x.status)).length} tótem(s) asignado(s)</div></td></tr>})}
        {!filteredVideos.length&&<tr><td colSpan="6" className="empty">No hay videos para mostrar.</td></tr>}
      </tbody></table></div>
    </Section>
    <Section title="Añadir otra programación" subtitle="Esta opción permite agregar nuevas campañas a videos ya autorizados. Para los pendientes, usá Autorizar y programar desde Videos.">
      <form onSubmit={schedule} className="upload-form">
        <div className="form-grid"><Field label="Video aprobado"><select required value={videoId} onChange={e=>{const v=videos.find(x=>x.id===e.target.value);setVideoId(e.target.value);setTotemId('');setStartsAt(localDateTime(v?.requestedStartAt));setEndsAt(localDateTime(v?.requestedEndAt));}}><option value="">Seleccionar video aprobado</option>{approved.map(v=><option key={v.id} value={v.id}>{v.clientName} — {v.originalName}</option>)}</select></Field><Field label="Tótem de ese cliente"><select required value={totemId} onChange={e=>setTotemId(e.target.value)} disabled={!videoId}><option value="">Seleccionar tótem</option>{targetTotems.map(t=><option key={t.id} value={t.id}>{t.code} — {t.client_name}</option>)}</select></Field></div>
        {selectedVideo?.note&&<div className="note-preview"><strong>Nota del cliente:</strong> {selectedVideo.note}</div>}
        <div className="form-grid"><DateTimeField label="Fecha y hora de inicio autorizadas" required value={startsAt} onChange={setStartsAt}/><DateTimeField label="Finalizar automáticamente (opcional)" min={startsAt} value={endsAt} onChange={setEndsAt}/></div>
        <div className="form-actions"><span className="helper">Si la fecha ya pasó, la campaña comenzará al guardarla, siempre que no haya terminado. El servidor procesa las activaciones cada 10 segundos.</span><button className="primary" disabled={busy||!videoId||!totemId||!startsAt}>Autorizar y programar</button></div>
      </form>
    </Section>
    <Section title="Publicaciones asignadas" subtitle="Cada campaña se activa sola al llegar su fecha, o se retira al terminar. Podés cancelarla manualmente.">
      <div className="table-wrapper"><table><thead><tr><th>Cliente / tótem</th><th>Video</th><th>Inicio</th><th>Fin</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>
        {filteredSchedules.map(s=><tr key={s.id}><td><strong>{s.client_name}</strong><div className="secondary-small">{s.totem_code}</div></td><td className="filename">{s.video_name}</td><td>{asDate(s.starts_at)}</td><td>{asDate(s.ends_at)}</td><td><Urgency date={s.starts_at} status={s.status}/></td><td className="row-actions">{['scheduled','active'].includes(s.status)&&<button className="danger-text" disabled={busy} onClick={()=>{if(!confirm('¿Cancelar esta publicación programada?'))return;run(async()=>{await api('/schedules/'+s.id+'/cancel',{method:'PATCH'});return 'Programación cancelada'})}}>Cancelar</button>}</td></tr>)}
        {!filteredSchedules.length&&<tr><td colSpan="6" className="empty">No hay campañas programadas.</td></tr>}
      </tbody></table></div>
    </Section>
    <Section title="Ver reproducción efectiva" subtitle="Lista manual más campañas automáticas activas. Se omiten los videos duplicados.">
      <div className="inline-form"><Field label="Elegí el tótem"><select value={previewTotem} onChange={e=>{setPreviewTotem(e.target.value);preview(e.target.value);}}><option value="">Seleccionar tótem</option>{totems.map(t=><option key={t.id} value={t.id}>{t.code} — {t.client_name}</option>)}</select></Field><button className="ghost" disabled={!previewTotem} onClick={()=>preview(previewTotem)}>Actualizar lista</button></div>
      {previewError&&<p className="alert">{previewError}</p>}{effective&&<div className="effective-list"><p className="helper">Versión: v{effective.totem.playlist_version} · {effective.items.length} video(s) activo(s)</p>{effective.items.map((item,i)=><div className="effective-item" key={item.id}><span>{i+1}. {item.name}</span><span className={'source-tag '+item.source}>{item.source==='manual'?'Manual':'Programación automática'}</span></div>)}{!effective.items.length&&<p className="helper">Por ahora este tótem no tiene videos activos.</p>}</div>}
    </Section>
  </>;
}

createRoot(document.getElementById('root')).render(<App/>);
