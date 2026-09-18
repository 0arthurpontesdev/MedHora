import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Bell,
  Baby,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  Clock3,
  Copy,
  Download,
  Upload,
  History,
  HeartHandshake,
  Home,
  LogOut,
  Menu,
  Mail,
  Pencil,
  Pill,
  Undo2,
  Plus,
  QrCode,
  Settings,
  ShieldCheck,
  Smartphone,
  Trash2,
  UserRound,
  UserPlus,
  Users,
  X,
  Sparkles,
  ArrowRight
} from 'lucide-react';
import { deleteUser, onAuthStateChanged, reauthenticateWithPopup, signInAnonymously, signInWithPopup, signInWithRedirect, signOut } from 'firebase/auth';
import './styles.css';
import { dosesBetween, localDateKey, medicationScheduleType, medicationStatus, pad, getMedicationDurationInfo } from './schedule.js';
import { auth, googleProvider } from './firebase.js';
import {
  acceptFamilyInvite,
  addMedication,
  claimDevicePairing,
  createDevicePairing,
  createFamilyInvite,
  deleteAccountData,
  ensureProfile,
  leaveSharedAgenda,
  removeDependent,
  removeMedication,
  removeMember,
  removePairedDevice,
  rejectFamilyInvite,
  restoreBackup,
  saveNotificationSettings,
  saveAiConsent,
  savePushTokenForOwner,
  setDoseTaken,
  subscribeAgenda,
  subscribeCareControl,
  subscribeConnections,
  subscribeDependents,
  subscribeMembers,
  subscribeIncomingInvites,
  subscribeFamilyGroup,
  subscribePairedDevices,
  subscribeNotificationSettings,
  subscribeSharedAgenda,
  updateMedication
} from './cloudStore.js';
import { activatePushNotifications, listenForForegroundMessages } from './push.js';
import { MedsView } from './components/MedsView.jsx';
import { resolveAgendaPermissions } from './accessControl.js';
import {LandingPage, LegalPage} from './components/LandingPage.jsx';
import {ErrorBoundary} from './ErrorBoundary.jsx';
import {installGlobalErrorMonitoring, reportClientError} from './errorMonitoring.js';

function lazyWithRefresh(loader, exportName) {
  const retryKey = `medhora-chunk-retry-${exportName}`;
  return React.lazy(async () => {
    try {
      const module = await loader();
      sessionStorage.removeItem(retryKey);
      return {default: module[exportName]};
    } catch (error) {
      const isMissingChunk = /dynamically imported module|failed to fetch|loading chunk/i.test(String(error?.message || error));
      if (isMissingChunk && !sessionStorage.getItem(retryKey)) {
        sessionStorage.setItem(retryKey, '1');
        window.location.reload();
        return new Promise(() => {});
      }
      sessionStorage.removeItem(retryKey);
      throw error;
    }
  });
}

const AiScannerModal=lazyWithRefresh(()=>import('./components/AiScannerModal.jsx'),'AiScannerModal');
const MariaAssistant=lazyWithRefresh(()=>import('./components/MariaAssistant.jsx'),'MariaAssistant');

const SITE_URL = 'https://medhora-familia.web.app';
const fmtMinutes = (m) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
const fmtDay = (d) =>
  new Intl.DateTimeFormat('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' }).format(d);

function App({ user, onSignOut, pairedAccess }) {
  const [own, setOwn] = useState({ meds: [], taken: {}, doseRecords: {} });
  const [shared, setShared] = useState({ meds: [], taken: {}, doseRecords: {} });
  const [connections, setConnections] = useState([]);
  const [members, setMembers] = useState([]);
  const [dependents, setDependents] = useState([]);
  const [incomingInvites,setIncomingInvites]=useState([]);
  const [familyMembers,setFamilyMembers]=useState([]);
  const [familyAgendaStates,setFamilyAgendaStates]=useState({});
  const [devices, setDevices] = useState([]);
  const [control, setControl] = useState(null);
  const [notificationSettings, setNotificationSettings] = useState({recipientEmail:user.email||'',leadMinutes:5,emailEnabled:true,pushEnabled:true});
  const [privacyConsent, setPrivacyConsent] = useState(()=>{
    const value=localStorage.getItem('medhora-ai-consent');
    if(value==='accepted')return true;
    try{return JSON.parse(value)?.accepted===true&&JSON.parse(value)?.version==='2026-09-18';}catch{return false;}
  });
  const restoreInputRef=useRef(null);

  const [selected, setSelected] = useState('self');
  const [page, setPage] = useState(()=>new URLSearchParams(window.location.search).has('invite')?'family':'agenda'); // 'agenda', 'meds', 'history', 'family', 'phone', 'backup'
  const [now, setNow] = useState(new Date());
  const [modalMed, setModalMed] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalDraftName, setModalDraftName] = useState('');
  const [aiModalOpen, setAiModalOpen] = useState(false);
  const [scannerOpening,setScannerOpening]=useState(false);
  const scannerOpeningTimer=useRef(null);
  const [message, setMessage] = useState('');
  const messageTimeoutRef = useRef(null);

  const notify = (msg) => setMessage(msg);
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [showPrevious, setShowPrevious] = useState(false);
  const [online,setOnline]=useState(()=>navigator.onLine);
  const [onboardingHidden,setOnboardingHidden]=useState(()=>localStorage.getItem('medhora-onboarding-hidden')==='1');

  const pairedMode = !!pairedAccess;
  const viewingOwn = !pairedMode && selected === 'self';
  const selectedConnection = connections.find((x) => x.ownerUid === selected);
  const selectedDependent = dependents.find((x) => x.dependentUid === selected);
  const selectedFamilyMember=familyMembers.find((x)=>x.uid===selected);
  const selectedPerson = selectedDependent || selectedConnection || selectedFamilyMember;
  const managedAccount = !!control && (control.accountType==='elderly'?control.selfManage===false:new Date(control.adultAt?.toDate?.() || control.adultAt) > now);
  const selectedManagedByUser=!!selectedFamilyMember&&selectedFamilyMember.selfManage===false&&selectedFamilyMember.guardianUid===user.uid;
  const {canManage,canToggle}=resolveAgendaPermissions({pairedMode,viewingOwn,managedAccount,selectedDependent:!!selectedDependent||selectedManagedByUser});
  const ownerUid = pairedMode ? pairedAccess.ownerUid : viewingOwn ? user.uid : selected;
  const state = pairedMode ? own : viewingOwn ? own : shared;
  const familyTargets=useMemo(()=>{
    const map=new Map();
    dependents.forEach(person=>map.set(person.dependentUid,{uid:person.dependentUid,name:person.displayName||'Dependente'}));
    connections.forEach(person=>map.set(person.ownerUid,{uid:person.ownerUid,name:person.ownerName||'Familiar'}));
    familyMembers.filter(person=>person.uid!==user.uid).forEach(person=>map.set(person.uid,{uid:person.uid,name:person.displayName||'Familiar'}));
    return [...map.values()].slice(0,20);
  },[dependents,connections,familyMembers,user.uid]);
  const familyTargetKey=familyTargets.map(item=>item.uid).join('|');

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 15000);
    return () => clearInterval(id);
  }, []);

  useEffect(()=>{
    const update=()=>setOnline(navigator.onLine);
    window.addEventListener('online',update);window.addEventListener('offline',update);
    return()=>{window.removeEventListener('online',update);window.removeEventListener('offline',update);};
  },[]);

  useEffect(() => {
    if (messageTimeoutRef.current) clearTimeout(messageTimeoutRef.current);
    if (message) messageTimeoutRef.current = setTimeout(() => setMessage(''), 8000);
    return () => { if (messageTimeoutRef.current) clearTimeout(messageTimeoutRef.current); };
  }, [message]);

  useEffect(() => {
    let stops = [];
    let active = true;
    if (pairedMode) {
      stops = [
        subscribeSharedAgenda(
          pairedAccess.ownerUid,
          (v) => {
            setOwn(v);
            setReady(true);
          },
          () => setMessage('Este aparelho não tem mais acesso à agenda.')
        )
      ];
    } else {
      ensureProfile(user)
        .then(() => {
          if (!active) return;
          stops = [
            subscribeAgenda(
              user,
              (v) => {
                setOwn(v);
                setReady(true);
              },
              () => setMessage('Não foi possível acessar sua agenda na nuvem.')
            ),
            subscribeConnections(user, setConnections, () =>
              setMessage('Não foi possível carregar as agendas compartilhadas.')
            ),
            subscribeMembers(user, setMembers, () => setMessage('Não foi possível carregar sua família.')),
            subscribeDependents(user, setDependents, () =>
              setMessage('Não foi possível carregar os dependentes.')
            ),
            subscribeIncomingInvites(user,setIncomingInvites,()=>setIncomingInvites([])),
            subscribeFamilyGroup(user,setFamilyMembers,()=>setFamilyMembers([])),
            subscribePairedDevices(user, setDevices, () => setDevices([])),
            subscribeCareControl(user, setControl, () => setControl(null)),
            subscribeNotificationSettings(user,setNotificationSettings,()=>{})
          ];
        })
        .catch(() => setMessage('Não foi possível preparar sua conta.'));
    }

    const foreground = listenForForegroundMessages((p) =>
      setMessage(p?.notification?.title || 'Você recebeu um lembrete.')
    );

    return () => {
      active = false;
      stops.forEach((s) => s());
      foreground();
    };
  }, [user.uid, pairedMode]);

  useEffect(() => {
    setShowPrevious(false);
    if (pairedMode || viewingOwn) {
      setShared({ meds: [], taken: {}, doseRecords: {} });
      return;
    }
    return subscribeSharedAgenda(selected, setShared, () => {
      setMessage('O acesso a esta agenda não está mais disponível.');
      setSelected('self');
    });
  }, [selected, viewingOwn, pairedMode]);

  useEffect(()=>{
    if(pairedMode||page!=='maria'){setFamilyAgendaStates({});return undefined;}
    const stops=familyTargets.map(person=>subscribeSharedAgenda(person.uid,value=>setFamilyAgendaStates(current=>({...current,[person.uid]:value})),()=>{}));
    return()=>stops.forEach(stop=>stop());
  },[pairedMode,page,familyTargetKey]);

  const mariaFamilyAgendas=useMemo(()=>[
    {uid:user.uid,name:user.displayName||user.email||'Você',meds:own.meds,taken:own.taken},
    ...familyTargets.filter(person=>familyAgendaStates[person.uid]).map(person=>({...person,...familyAgendaStates[person.uid]})),
  ],[user.uid,user.displayName,user.email,own.meds,own.taken,familyTargetKey,familyAgendaStates]);

  const dayStart = useMemo(() => {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    return d;
  }, [localDateKey(now)]);

  const dayEnd = useMemo(() => {
    const d = new Date(dayStart);
    d.setDate(d.getDate() + 1);
    return d;
  }, [dayStart]);

  const doses = useMemo(() => dosesBetween(state.meds, dayStart, dayEnd), [state.meds, dayStart, dayEnd]);

  const history = useMemo(() => {
    const from = new Date(dayStart);
    from.setDate(from.getDate() - from.getDay());
    const until = new Date(from);
    until.setDate(until.getDate() + 7);
    const scheduled=dosesBetween(state.meds, from, until, { includeInactive: true })
      .filter(item => item.at <= now || medicationStatus(item) === 'active');
    const scheduledKeys=new Set(scheduled.map(item=>item.doseKey));
    const recorded=Object.values(state.doseRecords||{}).filter(record=>{
      const at=+new Date(record.scheduledAt||record.takenAt);return Number.isFinite(at)&&at>=+from&&at<+until&&!scheduledKeys.has(record.doseKey);
    }).map(record=>{const at=+new Date(record.scheduledAt||record.takenAt);const date=new Date(at);return {id:record.medicationId,name:record.medicationName,dose:'',at,mins:date.getHours()*60+date.getMinutes(),doseKey:record.doseKey,restoredRecord:true};});
    return [...scheduled,...recorded]
      .sort((a,b)=>a.at-b.at)
      .slice(0, 300);
  }, [state.meds, state.doseRecords, dayStart, now]);

  const mins = now.getHours() * 60 + now.getMinutes();
  const next = doses.find((d) => !state.taken[d.doseKey]);
  const done = doses.filter((d) => state.taken[d.doseKey]).length;
  const pendingDoses = doses.filter((d) => !state.taken[d.doseKey]);
  const previousDoses = doses.filter((d) => state.taken[d.doseKey]).reverse();
  const completedTreatments=useMemo(()=>state.meds.filter(med=>medicationStatus(med)==='active'&&getMedicationDurationInfo(med,now).isFinished),[state.meds,localDateKey(now)]);

  async function withSave(action, fallback) {
    setSaving(true);
    setMessage('');
    try {
      await action();
      return true;
    } catch (e) {
      setMessage(e.message || fallback);
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function saveMed(data) {
    const ok = await withSave(
      () => (modalMed ? updateMedication(user, modalMed.id, data, ownerUid) : addMedication(user, data, ownerUid)),
      'Não foi possível salvar o medicamento.'
    );
    if (ok) {
      setModalOpen(false);
      setModalMed(null);
      setModalDraftName('');
    }
    return ok;
  }

  async function handleAddMultipleMeds(medsList) {
    if (!medsList || !medsList.length) return;
    setSaving(true);
    setMessage('');
    let count = 0;
    try {
      for (const medData of medsList) {
        await addMedication(user, medData, ownerUid);
        count++;
      }
      setMessage(`Sucesso! ${count} medicamento(s) cadastrado(s) com a M.A.R.I.A.`);
      window.dispatchEvent(new CustomEvent('medhora:maria-prescription-added',{detail:{count}}));
    } catch (e) {
      setMessage(`Cadastrados ${count} medicamento(s). Erro: ${e.message || 'Falha ao salvar medicamento.'}`);
    } finally {
      setSaving(false);
    }
  }

  async function toggleDose(dose) {
    const key=typeof dose==='string'?dose:dose.doseKey;
    if(state.taken[key])return withSave(()=>setDoseTaken(user,key,false,ownerUid),'Não foi possível desfazer o registro.');
    const item=typeof dose==='string'?doses.find(candidate=>candidate.doseKey===key):dose;
    if(!item)return;
    const takenAt=new Date();
    const differenceMinutes=Math.round((+takenAt-Number(item.at))/60000);
    const outOfSchedule=Math.abs(differenceMinutes)>15;
    let scheduleAdjusted=false;
    if(outOfSchedule){
      const direction=differenceMinutes>0?`${differenceMinutes} minuto(s) depois`:`${Math.abs(differenceMinutes)} minuto(s) antes`;
      if(!confirm(`${item.name} estava previsto para ${fmtMinutes(item.mins)}. Registrar como administrado ${direction}, às ${takenAt.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}?`))return;
      if(medicationScheduleType(item)==='interval'&&canManage){
        scheduleAdjusted=confirm(`Deseja recalcular os próximos horários de ${item.name} a partir deste horário real?\n\nOK: reajustar a agenda.\nCancelar: apenas registrar a dose fora do horário.`);
      }
    }
    await withSave(async()=>{
      await setDoseTaken(user,key,true,ownerUid,{medicationId:item.id,medicationName:item.name,scheduledAt:new Date(item.at),takenAt,outOfSchedule,scheduleAdjusted});
      if(scheduleAdjusted)await updateMedication(user,item.id,{...item,scheduleAnchorAt:takenAt.toISOString()},ownerUid);
    },'Não foi possível registrar a dose.');
  }

  async function changeStatus(med, status) {
    const action = status === 'paused' ? 'Pausar' : status === 'ended' ? 'Encerrar' : null;
    if (
      action &&
      !confirm(
        `${action} ${med.name}? ${
          status === 'ended' ? 'Você poderá reativá-lo depois.' : 'Os lembretes ficarão suspensos.'
        }`
      )
    )
      return;
    await withSave(
      () => updateMedication(user, med.id, { ...med, status }, ownerUid),
      'Não foi possível alterar o tratamento.'
    );
  }

  async function removeMed(med) {
    if (confirm(`Remover definitivamente ${med.name}? O medicamento sairá da agenda.`)) {
      await withSave(() => removeMedication(user, med.id, ownerUid), 'Não foi possível remover o medicamento.');
    }
  }

  async function enablePush() {
    setSaving(true);
    setMessage('');
    try {
      await savePushTokenForOwner(user, await activatePushNotifications(), ownerUid);
      setMessage('Notificações ativadas neste aparelho.');
    } catch (e) {
      setMessage(e.message || 'Não foi possível ativar as notificações.');
    } finally {
      setSaving(false);
    }
  }

  function openScanner(){
    if(!privacyConsent){setPage('privacy');notify('Leia e aceite o uso da M.A.R.I.A. antes de enviar um receituário.');return;}
    if(scannerOpening||aiModalOpen)return;
    setScannerOpening(true);
    if(scannerOpeningTimer.current)clearTimeout(scannerOpeningTimer.current);
    scannerOpeningTimer.current=setTimeout(()=>{setScannerOpening(false);setAiModalOpen(true);},650);
  }

  async function importBackupFile(file){
    if(!file)return;
    if(!confirm('Restaurar este backup substituirá seus medicamentos e registros atuais. Deseja continuar?'))return;
    await withSave(async()=>{const payload=JSON.parse(await file.text());await restoreBackup(user,payload);},'Não foi possível restaurar o backup.');
    if(restoreInputRef.current)restoreInputRef.current.value='';
  }

  async function deleteAccount(){
    const typed=prompt('Esta ação apaga permanentemente sua conta e seus dados. Digite EXCLUIR para confirmar.');
    if(typed!=='EXCLUIR')return;
    await withSave(async()=>{
      await reauthenticateWithPopup(user,googleProvider);
      await deleteAccountData(user);
      localStorage.removeItem('medhora-ai-consent');
      localStorage.removeItem('medhora-paired-access');
      await deleteUser(user);
    },'Não foi possível excluir a conta. Entre novamente e tente outra vez.');
  }

  async function updateAiConsent(accepted){
    const value={accepted,version:'2026-09-18',updatedAt:new Date().toISOString()};
    localStorage.setItem('medhora-ai-consent',JSON.stringify(value));
    setPrivacyConsent(accepted);
    if(!pairedMode)await withSave(()=>saveAiConsent(user,accepted,value.version),'A preferência foi salva neste aparelho, mas não pôde ser sincronizada.');
    notify(accepted?'Preferência de privacidade salva.':'Consentimento da M.A.R.I.A. removido.');
  }

  function exportBackup() {
    const blob = new Blob(
      [
        JSON.stringify(
          {
            version: 3,
            exportedAt: new Date().toISOString(),
            account: { email: user.email, displayName: user.displayName },
            medications: own.meds,
            takenDoses: own.taken,
            doseRecords: own.doseRecords||{}
          },
          null,
          2
        )
      ],
      { type: 'application/json' }
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `minha-medicacao-${localDateKey()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setMessage('Backup baixado para este aparelho.');
  }

  function exportMedicalReport(period='week'){
    const until=new Date(now);const from=new Date(until);
    if(period==='month')from.setDate(1);else from.setDate(from.getDate()-6);
    from.setHours(0,0,0,0);
    const scheduled=dosesBetween(state.meds,from,until,{includeInactive:true});
    const keys=new Set(scheduled.map(item=>item.doseKey));
    const recorded=Object.values(state.doseRecords||{}).filter(record=>{const at=+new Date(record.scheduledAt||record.takenAt);return at>=+from&&at<=+until&&!keys.has(record.doseKey);}).map(record=>{const at=+new Date(record.scheduledAt||record.takenAt);const date=new Date(at);return {doseKey:record.doseKey,name:record.medicationName,dose:'',at,mins:date.getHours()*60+date.getMinutes()};});
    import('./medicalReport.js').then(({openMedicalReport})=>openMedicalReport({personName:name,medications:state.meds,items:[...scheduled,...recorded].sort((a,b)=>a.at-b.at),taken:state.taken,records:state.doseRecords||{},from,until,title:period==='month'?'Relatório mensal de medicamentos':'Relatório dos últimos 7 dias'})).catch(error=>{reportClientError(error,{source:'medical-report'});notify(error.message||'Não foi possível abrir o relatório.');});
  }

  function selectAgenda(uid) {
    setSelected(uid);
    setPage('agenda');
    setMenuOpen(false);
  }

  const today = new Intl.DateTimeFormat('pt-BR', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric'
  }).format(now);

  const name = pairedMode
    ? pairedAccess.ownerName
    : viewingOwn
    ? user.displayName || user.email
    : selectedPerson?.displayName || selectedPerson?.ownerName || 'Familiar';

  const navItems = pairedMode
      ? [
        ['agenda', <Home />, 'Agenda'],
        ['meds', <Pill />, 'Medicamentos'],
        ['maria', <Sparkles />, 'M.A.R.I.A.'],
        ['history', <History />, 'Histórico'],
        ['phone', <Smartphone />, 'Celular']
      ]
    : [
        ['agenda', <Home />, 'Agenda'],
        ['meds', <Pill />, 'Medicamentos'],
        ['maria', <Sparkles />, 'M.A.R.I.A.'],
        ['history', <History />, 'Histórico'],
        ['family', <Users />, 'Família'],
        ['phone', <Smartphone />, 'Celular'],
        ['backup', <Download />, 'Backup'],
        ['privacy', <ShieldCheck />, 'Privacidade']
      ];

  return (
    <div className="shell">
      <header className="topbar">
        <button className="mobileMenu" onClick={() => setMenuOpen((v) => !v)} aria-label="Abrir menu">
          <Menu />
        </button>
        <div className="brand">
          <div className="brandIcon">
            <Pill size={22} />
          </div>
          <div>
            <strong>MedHora Família</strong>
            <span>{pairedMode ? 'Acesso rápido no celular' : 'Acompanhamento pessoal'}</span>
          </div>
        </div>
        <button className="ghost" onClick={onSignOut}>
          <LogOut size={18} />
          <span>Sair</span>
        </button>
      </header>
      {!online&&<div className="offlineBanner" role="status"><span>Você está sem internet. Consulte o que já estiver carregado; alterações podem não sincronizar.</span></div>}

      <div className="appLayout">
        <nav className={`sidebarNav ${menuOpen ? 'open' : ''}`}>
          <div className="navAccount">
            <UserRound />
            <div>
              <strong>{pairedMode ? 'Aparelho conectado' : user.displayName || 'Minha conta'}</strong>
              <span>{pairedMode ? name : user.email}</span>
            </div>
          </div>
          {navItems.map(([id, icon, label]) => (
            <NavButton
              key={id}
              active={page === id}
              icon={icon}
              label={label}
              onClick={() => {
                if(id==='maria'&&!privacyConsent){setPage('privacy');notify('Aceite o uso da M.A.R.I.A. para continuar.');setMenuOpen(false);return;}
                setPage(id);
                setMenuOpen(false);
              }}
            />
          ))}
        </nav>

        <main className={`page ${page==='maria'?'mariaHostPage':''}`}>
          {message && (
            <div className="appToast" role="status" key={message}>
              <div><CheckCircle2 size={19}/><span>{message}</span><button type="button" onClick={() => setMessage('')} title="Fechar aviso" aria-label="Fechar aviso"><X size={17}/></button></div>
              <span className="toastProgress" aria-hidden="true" />
            </div>
          )}
          {!pairedMode && (
            <AgendaSwitcher
              user={user}
              connections={connections}
              dependents={dependents}
              familyMembers={familyMembers}
              selected={selected}
              onSelect={selectAgenda}
            />
          )}

          {page === 'agenda' && (
            <div className="agendaDashboard">
              <section className="welcome">
                <div className="welcomeCopy">
                  <p className="eyebrow">
                    <CalendarDays size={15} />
                    {today}
                  </p>
                  <h1>{viewingOwn || pairedMode ? 'Cuide dos seus horários.' : `Agenda de ${name}`}</h1>
                  <p className="subtitle">
                    {pairedMode
                      ? 'Acesso rápido protegido para acompanhar e marcar as doses neste aparelho.'
                      : managedAccount && viewingOwn
                      ? control.accountType === 'elderly'
                        ? `Seus tratamentos são administrados por ${control.guardianName}. Você pode confirmar suas doses.`
                        : `Seu responsável, ${control.guardianName}, administra os tratamentos. Você pode marcar suas doses.`
                      : selectedDependent
                      ? 'Você administra os tratamentos deste dependente.'
                      : selectedConnection
                      ? 'Acompanhamento autorizado somente para visualização.'
                      : 'Marque cada medicamento assim que administrar.'}
                  </p>
                </div>

                {canManage && (
                  <div className="agendaActionsGroup">
                    <button
                      className="agendaAiButton"
                      type="button"
                      disabled={!ready || saving}
                      onClick={openScanner}
                    >
                      <Sparkles size={18} />
                      <span>Ler com a M.A.R.I.A.</span>
                    </button>

                    <button
                      className="primary"
                      type="button"
                      disabled={!ready || saving}
                      onClick={() => {
                        setModalMed(null);
                        setModalDraftName('');
                        setModalOpen(true);
                      }}
                    >
                      <Plus size={18} />
                      <span>Adicionar medicamento</span>
                    </button>
                  </div>
                )}
              </section>

              {!pairedMode&&viewingOwn&&!onboardingHidden&&state.meds.length===0&&<section className="onboardingCard" aria-labelledby="onboarding-title"><div><span className="tag green">PRIMEIROS PASSOS</span><h2 id="onboarding-title">Prepare sua agenda em poucos minutos</h2><p>Cadastre o primeiro tratamento e escolha como deseja receber os lembretes.</p></div><ol><li><span>1</span><button type="button" onClick={()=>{setModalMed(null);setModalDraftName('');setModalOpen(true);}}>Cadastrar um medicamento</button></li><li><span>2</span><button type="button" onClick={()=>setPage('phone')}>Configurar lembretes</button></li><li><span>3</span><button type="button" onClick={()=>setPage('family')}>Convidar alguém da família</button></li></ol><button type="button" className="onboardingDismiss" aria-label="Ocultar primeiros passos" onClick={()=>{localStorage.setItem('medhora-onboarding-hidden','1');setOnboardingHidden(true);}}><X size={17}/></button></section>}

              {canManage&&completedTreatments.length>0&&<section className="treatmentCompleteNotice"><CheckCircle2 size={22}/><div><strong>{completedTreatments.length===1?`O tratamento de ${completedTreatments[0].name} foi concluído.`:`${completedTreatments.length} tratamentos foram concluídos.`}</strong><span>Você pode arquivar o tratamento concluído e manter os registros no histórico.</span></div>{completedTreatments.length===1&&<button type="button" className="softBtn" onClick={()=>changeStatus(completedTreatments[0],'ended')}>Arquivar tratamento</button>}</section>}

              <section className="nextCard">
                <div className="nextCardCopy">
                  <span className="tag">
                    <Clock3 size={15} />
                    {next && next.mins < mins ? 'DOSE PENDENTE' : 'PRÓXIMA DOSE'}
                  </span>
                  <h2>{next ? next.name : 'Nenhuma dose pendente'}</h2>
                  <p>
                    {next
                      ? `${next.dose} • ${next.notes || 'sem observações'}`
                      : state.meds.length
                      ? 'Tudo certo por hoje.'
                      : 'Nenhum medicamento cadastrado.'}
                  </p>
                </div>
                <div className="nextTimeWrap">
                  <span>Horário</span>
                  <div className="nextTime">{next ? fmtMinutes(next.mins) : '--:--'}</div>
                </div>
              </section>

              <section className="stats">
                <Stat kind="taken" icon={<CheckCircle2 />} value={done} label="Doses administradas" />
                <Stat kind="pending" icon={<Clock3 />} value={doses.length - done} label="Doses pendentes" />
                <Stat kind="meds" icon={<Pill />} value={state.meds.length} label="Medicamentos" />
              </section>

              <div className="agendaGrid">
                <section className="panel">
                  <div className="panelHead">
                    <div>
                      <h2>Agenda de hoje</h2>
                      <p>
                        {doses.length
                          ? `${pendingDoses.length} pendente(s) • ${done} administrada(s)`
                          : 'Nenhum horário programado.'}
                      </p>
                    </div>
                    <span className="liveTime">
                      {now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  <div className="timeline">
                    {doses.length === 0 ? (
                      <Empty onAdd={canManage ? () => { setModalMed(null); setModalDraftName(''); setModalOpen(true); } : null} />
                    ) : pendingDoses.length === 0 && !showPrevious ? (
                      <div className="agendaComplete">
                        <CheckCircle2 size={28} />
                        <strong>Tudo administrado por hoje</strong>
                        <span>As doses concluídas estão em “Ver anteriores”.</span>
                      </div>
                    ) : (
                      <>
                        {pendingDoses.map((d) => (
                        <DoseRow
                          key={d.doseKey}
                          dose={d}
                          taken={false}
                          late={d.mins < mins}
                          canToggle={canToggle}
                          saving={saving}
                          onToggle={toggleDose}
                        />
                        ))}
                        {showPrevious && previousDoses.length > 0 && (
                          <>
                            <div className="previousDivider"><span>Anteriores de hoje</span></div>
                            {previousDoses.map((d) => (
                              <DoseRow
                                key={d.doseKey}
                                dose={d}
                                taken
                                late={false}
                                canToggle={canToggle}
                                saving={saving}
                                onToggle={toggleDose}
                              />
                            ))}
                          </>
                        )}
                      </>
                    )}
                  </div>
                  {previousDoses.length > 0 && (
                    <button className="previousToggle" onClick={() => setShowPrevious((value) => !value)} aria-expanded={showPrevious}>
                      <History size={16} />
                      {showPrevious ? 'Ocultar anteriores' : `Ver anteriores (${previousDoses.length})`}
                      <ChevronDown className={showPrevious ? 'rotated' : ''} size={16} />
                    </button>
                  )}
                </section>

                <MedicationList
                  meds={state.meds}
                  editable={canManage}
                  saving={saving}
                  onEdit={(m) => {
                    setModalDraftName('');
                    setModalMed(m);
                    setModalOpen(true);
                  }}
                  onStatus={changeStatus}
                  onRemove={removeMed}
                  onOpenAi={openScanner}
                  onAddManual={() => {
                    setModalMed(null);
                    setModalDraftName('');
                    setModalOpen(true);
                  }}
                  onNavigateMeds={() => setPage('meds')}
                />
              </div>
            </div>
          )}

          {page === 'meds' && (
            <MedsView
              meds={state.meds}
              takenState={state.taken}
              editable={canManage}
              saving={saving}
              now={now}
              onAddManual={() => {
                setModalMed(null);
                setModalDraftName('');
                setModalOpen(true);
              }}
              onOpenAiScanner={openScanner}
              onEdit={(m) => {
                setModalDraftName('');
                setModalMed(m);
                setModalOpen(true);
              }}
              onStatus={changeStatus}
              onRemove={removeMed}
              onToggleDose={toggleDose}
            />
          )}

          {page === 'history' && (
            <>
              <PageTitle title="Histórico" subtitle="Acompanhe o que foi administrado e o que ainda está previsto até sábado." />
              <HistoryPanel items={history} taken={state.taken} records={state.doseRecords||{}} now={now} onExport={()=>exportMedicalReport('week')} />
            </>
          )}

          {page === 'maria' && (
            <React.Suspense fallback={<section className="panel">Carregando a M.A.R.I.A...</section>}>
              <MariaAssistant
                meds={state.meds}
                takenState={state.taken}
                familyAgendas={mariaFamilyAgendas}
                now={now}
                personName={name}
                storageKey={ownerUid}
                onRequestRegistration={(medicineName) => {
                  if (!canManage) {
                    notify('Você não tem permissão para cadastrar nesta agenda.');
                    return;
                  }
                  setModalMed(null);
                  setModalDraftName(String(medicineName || '').trim().slice(0, 120));
                  setModalOpen(true);
                }}
                onOpenPrescription={canManage ? openScanner : null}
              />
            </React.Suspense>
          )}

          {page === 'family' && (
            <>
              <PageTitle
                title="Família"
                subtitle="Acompanhe familiares ou administre a agenda de um dependente menor de idade."
              />
              <FamilyPanel
                user={user}
                members={members}
                connections={connections}
                dependents={dependents}
                incomingInvites={incomingInvites}
                familyMembers={familyMembers}
                onSelect={selectAgenda}
                onMessage={notify}
                onRemoveMember={(m) =>
                  withSave(() => removeMember(user, m.memberUid), 'Não foi possível remover o acesso.')
                }
                onRemoveDependent={(d) =>
                  withSave(() => removeDependent(user, d.dependentUid), 'Não foi possível remover o dependente.')
                }
                onLeave={(o) => withSave(() => leaveSharedAgenda(user, o), 'Não foi possível sair da agenda.')}
              />
            </>
          )}

          {page === 'phone' && (
            <>
              <PageTitle
                title="Celular"
                subtitle={pairedMode ? 'Ative os avisos neste aparelho.' : 'Conecte um celular sem precisar digitar uma conta Google.'}
              />
              <PhonePanel
                user={user}
                pairedMode={pairedMode}
                devices={devices}
                onActivate={enablePush}
                saving={saving}
                onMessage={notify}
                onRemove={(device) =>
                  withSave(() => removePairedDevice(user, device.deviceUid), 'Não foi possível remover o aparelho.')
                }
                settings={notificationSettings}
                onSaveSettings={(value)=>withSave(()=>saveNotificationSettings(user,value),'Não foi possível salvar as preferências.')}
              />
            </>
          )}

          {page === 'backup' && (
            <>
              <PageTitle title="Backup" subtitle="Guarde uma cópia da sua agenda e dos registros." />
              <section className="panel simplePage backupActions">
                <Download size={34} />
                <h2>Exportar meus dados</h2>
                <p>O arquivo contém seus medicamentos e o histórico das doses registradas.</p>
                <button className="primary" onClick={exportBackup}>
                  <Download size={17} />
                  Baixar backup
                </button>
                <div className="reportExportActions"><button className="softBtn" onClick={()=>exportMedicalReport('week')}><Download size={17}/> Relatório dos últimos 7 dias</button><button className="softBtn" onClick={()=>exportMedicalReport('month')}><Download size={17}/> Relatório deste mês em PDF</button></div>
                <input ref={restoreInputRef} className="hiddenFileInput" type="file" accept="application/json,.json" onChange={event=>importBackupFile(event.target.files?.[0])}/>
                <button className="softBtn" onClick={()=>restoreInputRef.current?.click()}>
                  <Upload size={17}/> Restaurar backup
                </button>
              </section>
            </>
          )}

          {page === 'privacy' && (
            <PrivacyPanel
              accepted={privacyConsent}
              onAccept={()=>updateAiConsent(true)}
              onRevoke={()=>updateAiConsent(false)}
              onDelete={deleteAccount}
              saving={saving}
            />
          )}
        </main>
      </div>

      {modalOpen && (
        <MedicationModal
          initial={modalMed}
          suggestedName={modalDraftName}
          onClose={() => {
            setModalOpen(false);
            setModalMed(null);
            setModalDraftName('');
          }}
          onSave={saveMed}
        />
      )}

      {aiModalOpen && (
        <React.Suspense fallback={<MariaOpeningLoader label="Preparando a leitura..."/>}>
          <AiScannerModal
            onClose={() => setAiModalOpen(false)}
            onAddMedications={handleAddMultipleMeds}
          />
        </React.Suspense>
      )}
      {scannerOpening&&<MariaOpeningLoader label="Abrindo a M.A.R.I.A..."/>}
    </div>
  );
}

function MariaOpeningLoader({label}){
  return <div className="backdrop mariaOpeningBackdrop" role="status" aria-live="polite"><div className="mariaOpeningCard"><div className="mariaOrbitLoader" aria-hidden="true"><span className="mariaCore"><Sparkles size={38}/></span><span className="mariaOrbit orbitOne"><Sparkles size={15}/></span><span className="mariaOrbit orbitTwo"><Sparkles size={11}/></span><span className="mariaOrbit orbitThree"><Sparkles size={9}/></span></div><strong>{label}</strong></div></div>;
}

function NavButton({ active, icon, label, onClick }) {
  return (
    <button className={`navButton ${active ? 'active' : ''}`} onClick={onClick} aria-current={active?'page':undefined}>
      {React.cloneElement(icon, { size: 19 })}
      <span>{label}</span>
    </button>
  );
}

function PageTitle({ title, subtitle }) {
  return (
    <section className="pageTitle">
      <h1>{title}</h1>
      <p>{subtitle}</p>
    </section>
  );
}

function AgendaSwitcher({ user, connections, dependents, familyMembers=[], selected, onSelect }) {
  const people = [
    ...dependents.map((x) => ({ ...x, uid: x.dependentUid, name: x.displayName, badge: 'Dependente' })),
    ...connections.map((x) => ({ ...x, uid: x.ownerUid, name: x.ownerName, badge: 'Acompanhando' }))
  ];
  familyMembers.filter(person=>person.uid!==user.uid&&!people.some(item=>item.uid===person.uid)).forEach(person=>people.push({uid:person.uid,name:person.displayName,badge:familyRoleLabel(person.accountType)}));
  if (!people.length) return null;
  return (
    <section className="agendaSwitcher">
      <strong>Agenda:</strong>
      <button className={selected === 'self' ? 'active' : ''} onClick={() => onSelect('self')}>
        <UserRound size={16} />
        {user.displayName || 'Eu'}
      </button>
      {people.map((p) => (
        <button className={selected === p.uid ? 'active' : ''} key={p.uid} onClick={() => onSelect(p.uid)}>
          <Users size={16} />
          {p.name}
          <small>{p.badge}</small>
        </button>
      ))}
    </section>
  );
}

function DoseRow({ dose, taken, late, canToggle, saving, onToggle }) {
  return (
    <article className={`dose ${taken ? 'taken' : ''}`}>
      <div className="doseTime">{fmtMinutes(dose.mins)}</div>
      <div className="dotWrap">
        <span className="dot">{taken && <Check size={13} />}</span>
      </div>
      <div className="doseInfo">
        <div className="doseTitle">
          <h3>{dose.name}</h3>
          {late && <span className="late">horário passou</span>}
        </div>
        <p>
          {dose.dose}
          {dose.notes ? ` • ${dose.notes}` : ''}
        </p>
      </div>
      {canToggle ? (
        <button
          className={taken ? 'doneBtn' : 'takeBtn'}
          disabled={saving}
          onClick={() => onToggle(dose)}
        >
          {taken ? (
            <>
              <Undo2 size={16} />
              Desfazer registro
            </>
          ) : (
            <>
              <Check size={16} />
              Administrei
            </>
          )}
        </button>
      ) : (
        <span className={taken ? 'historyTaken' : 'historyMissed'}>{taken ? 'Administrada' : 'Pendente'}</span>
      )}
    </article>
  );
}

function MedicationList({ meds, editable, saving, onEdit, onStatus, onRemove, onOpenAi, onAddManual, onNavigateMeds }) {
  return (
    <section className="panel medsPanel">
      <div className="panelHead">
        <div>
          <h2>Medicamentos</h2>
          <p>Tratamentos e duração estimada.</p>
        </div>
        <div className="panelHeadActions">
          {onNavigateMeds && (
            <button
              type="button"
              className="softBtn small"
              onClick={onNavigateMeds}
              title="Abrir tela completa de medicamentos com filtros e duração detalhada"
            >
              Ver detalhes <ArrowRight size={14} />
            </button>
          )}
        </div>
      </div>
      <div className="medList">
        {meds.length === 0 ? (
          <div style={{ padding: '24px 16px', textAlign: 'center', color: 'var(--text-secondary)' }}>
            <p className="muted" style={{ margin: '0 0 12px' }}>Nenhum medicamento cadastrado.</p>
            {editable && (
              <div style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>
                <button type="button" className="softBtn small" onClick={onAddManual}>
                  + Cadastrar manual
                </button>
                <button type="button" className="aiScanBtn small" onClick={onOpenAi}>
                  <Sparkles size={14} /> Ler com a M.A.R.I.A.
                </button>
              </div>
            )}
          </div>
        ) : (
          meds.slice(0, 4).map((m) => {
            const status = medicationStatus(m);
            const schedule = medicationScheduleType(m);
            const duration = getMedicationDurationInfo(m);
            return (
              <div className={`medItem ${status !== 'active' ? 'inactiveMed' : ''}`} key={m.id}>
                <div className="miniPill">
                  <Pill size={17} />
                </div>
                <div className="medText">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    <strong>{m.name}</strong>
                    <span className={`status-badge-inline ${duration.badgeClass}`} style={{ fontSize: '11px', padding: '2px 7px', borderRadius: '999px', fontWeight: 600 }}>
                      {duration.statusText}
                    </span>
                  </div>
                  <span>{m.dose}</span>
                  <small>
                    {schedule === 'asNeeded'
                      ? 'Quando necessário'
                      : schedule === 'times'
                      ? `${m.times.join(', ')} • ${m.days} dia(s)`
                      : `A cada ${m.freq}h • ${m.days} dia(s) • início ${m.start}`}
                  </small>
                  {status !== 'active' && <em>{status === 'paused' ? 'Pausado' : 'Encerrado'}</em>}
                </div>
                {editable && (
                  <div className="medActions">
                    <button className="editBtn" disabled={saving} onClick={() => onEdit(m)}>
                      <Pencil size={15} />
                      Editar
                    </button>
                    <details className="settingsMenu">
                      <summary title="Configurações">
                        <Settings size={17} />
                      </summary>
                      <div className="settingsPopover">
                        {status === 'active' && <button onClick={() => onStatus(m, 'paused')}>Pausar</button>}
                        {status !== 'active' && <button onClick={() => onStatus(m, 'active')}>Reativar tratamento</button>}
                        {status !== 'ended' && <button onClick={() => onStatus(m, 'ended')}>Encerrar</button>}
                        <button className="dangerText" onClick={() => onRemove(m)}>
                          Remover definitivamente
                        </button>
                      </div>
                    </details>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
      {meds.length > 4 && onNavigateMeds && (
        <button type="button" className="medListFooter" onClick={onNavigateMeds}>
          Ver todos os {meds.length} medicamentos <ArrowRight size={15} />
        </button>
      )}
    </section>
  );
}

function Stat({ icon, value, label, kind }) {
  return (
    <div className={`stat ${kind}`}>
      <span className="statIcon">{React.cloneElement(icon, { size: 21 })}</span>
      <div className="statCopy">
        <strong>{value}</strong>
        <span>{label}</span>
      </div>
    </div>
  );
}

function Empty({ onAdd }) {
  return (
    <div className="empty">
      <div className="emptyIcon">
        <Pill />
      </div>
      <h3>Sua agenda está vazia</h3>
      <p>Não há doses programadas para hoje.</p>
      {onAdd && (
        <button className="softBtn" onClick={onAdd}>
          <Plus size={17} />
          Adicionar agora
        </button>
      )}
    </div>
  );
}

function HistoryPanel({ items, taken, records={}, now, onExport }) {
  const [filter, setFilter] = useState('all');
  const administered = items.filter((item) => Boolean(taken[item.doseKey])).length;
  const upcoming = items.filter((item) => !taken[item.doseKey] && item.at > now).length;
  const unregistered = items.filter((item) => !taken[item.doseKey] && item.at <= now).length;
  const adherencePercent = items.length ? Math.round((administered / items.length) * 100) : 0;
  const filtered = items.filter((item) => filter === 'all' || (filter === 'administered' ? Boolean(taken[item.doseKey]) : filter==='upcoming' ? !taken[item.doseKey]&&item.at>now : !taken[item.doseKey]&&item.at<=now));
  const groups = filtered.reduce((map, item) => {
    const key = localDateKey(new Date(item.at));
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(item);
    return map;
  }, new Map());

  return (
    <section className="historyDashboard">
      <div className="historyOverview">
        <div className="historyOverviewIcon"><CheckCircle2 size={24}/></div>
        <div className="historyOverviewCopy">
          <span>Previsão da semana até sábado</span>
          <strong>{administered} administrada(s) de {items.length} previstas</strong>
          <small>{items.length ? `${upcoming} ainda prevista(s)${unregistered?` e ${unregistered} horário(s) passado(s) sem confirmação`:''}.` : 'Ainda não há doses previstas nesta semana.'}</small>
          <div className="historyProgress"><span style={{width: `${adherencePercent}%`}} /></div>
        </div>
        <div className="historyPercent"><strong>{adherencePercent}%</strong><span>da previsão semanal</span></div>
      </div>
      <div className="historyFilters" aria-label="Filtrar histórico">
        <button type="button" className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>Todas <span>{items.length}</span></button>
        <button type="button" className={filter === 'administered' ? 'active' : ''} onClick={() => setFilter('administered')}>Administradas <span>{administered}</span></button>
        <button type="button" className={filter === 'upcoming' ? 'active' : ''} onClick={() => setFilter('upcoming')}>Próximas <span>{upcoming}</span></button>
        <button type="button" className={filter === 'unregistered' ? 'active' : ''} onClick={() => setFilter('unregistered')}>Sem confirmação <span>{unregistered}</span></button>
      </div>
      <div className="historyToolbar"><div><h2>Semana atual</h2><p>Do domingo até sábado, agrupado por dia.</p></div><div className="historyToolbarActions"><span>{filtered.length} resultado(s)</span>{onExport&&<button type="button" className="softBtn small" onClick={onExport}><Download size={14}/> Gerar PDF</button>}</div></div>
      {filtered.length === 0 ? (
        <div className="historyEmpty"><History size={28}/><strong>{items.length ? 'Nenhum registro neste filtro' : 'Ainda não há registros'}</strong><span>{items.length ? 'Escolha outro indicador acima para consultar.' : 'As doses administradas e não registradas aparecerão aqui.'}</span></div>
      ) : (
        <div className="historyDays">
          {[...groups.entries()].map(([dateKey, dayItems]) => {
            const date = new Date(`${dateKey}T12:00:00`);
            const label = dateKey === localDateKey() ? 'Hoje' : new Intl.DateTimeFormat('pt-BR', {weekday:'long', day:'2-digit', month:'long'}).format(date);
            return <section className="historyDay" key={dateKey}><header><strong>{label}</strong><span>{dayItems.length} dose(s)</span></header><div>{dayItems.map((item) => {const ok=Boolean(taken[item.doseKey]);const future=!ok&&item.at>now;const record=records[item.doseKey];const actual=record?.takenAt?new Date(record.takenAt):null;return <article className={`historyDoseRow ${record?.outOfSchedule?'outOfSchedule':''}`} key={item.doseKey}><time>{fmtMinutes(item.mins)}</time><span className={`historyStatusDot ${ok?'ok':future?'future':'missing'}`}>{ok?<Check size={13}/>:<Clock3 size={13}/>}</span><div><strong>{item.name}</strong><small>{record?.outOfSchedule&&actual?`Previsto ${fmtMinutes(item.mins)} • administrado ${actual.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}${record.scheduleAdjusted?' • agenda reajustada':''}`:(item.dose || 'Dose não informada')}</small></div><em className={ok?'historyTaken':future?'historyUpcoming':'historyMissed'}>{record?.outOfSchedule?'Fora do horário':ok?'Administrada':future?'Prevista':'Sem confirmação'}</em></article>;})}</div></section>;
          })}
        </div>
      )}
    </section>
  );
}

function FamilyPanel({
  user,
  members,
  connections,
  dependents,
  incomingInvites=[],
  familyMembers=[],
  onSelect,
  onMessage,
  onRemoveMember,
  onRemoveDependent,
  onLeave
}) {
  const [email, setEmail] = useState('');
  const [mode, setMode] = useState('adult');
  const [birthDate, setBirthDate] = useState('');
  const [elderSelfManage,setElderSelfManage]=useState(true);
  const [deliveryMethod,setDeliveryMethod]=useState('email');
  const [inviteResult, setInviteResult] = useState(null);
  const [joinCode, setJoinCode] = useState(()=>new URLSearchParams(window.location.search).get('invite')?.toUpperCase()||'');
  const [showCodeEntry,setShowCodeEntry]=useState(()=>Boolean(new URLSearchParams(window.location.search).get('invite')));
  const [busy, setBusy] = useState(false);
  const people=useMemo(()=>{
    const map=new Map();
    familyMembers.filter(person=>person.uid!==user.uid).forEach(person=>map.set(person.uid,{uid:person.uid,title:person.displayName,email:person.email,accountType:person.accountType||'adult',kind:person.accountType==='minor'?'minor':'group',source:person}));
    dependents.forEach(person=>{const previous=map.get(person.dependentUid);map.set(person.dependentUid,{uid:person.dependentUid,title:person.displayName,email:person.email,accountType:'minor',kind:'dependent',source:{...previous?.source,...person}});});
    connections.forEach(person=>{const previous=map.get(person.ownerUid);map.set(person.ownerUid,{uid:person.ownerUid,title:person.ownerName||previous?.title,email:person.email||previous?.email,accountType:person.accountType||previous?.accountType||'adult',kind:person.accountType==='minor'?'minor':'peer',source:{...previous?.source,...person}});});
    members.forEach(person=>{if(!map.has(person.memberUid))map.set(person.memberUid,{uid:person.memberUid,title:person.displayName,email:person.email,accountType:person.accountType||'adult',kind:'member',source:person});});
    return [...map.values()];
  },[members,connections,dependents,familyMembers,user.uid]);
  const total = Math.min(5,people.length+1);
  const hasFamilyGroup=familyMembers.length>0;
  const isCurrentAdmin=!hasFamilyGroup||familyMembers.some(person=>person.uid===user.uid&&person.isFamilyAdmin===true);
  const currentFamilyMember=familyMembers.find(person=>person.uid===user.uid);

  async function invite(e) {
    e.preventDefault();
    if (total >= 5) {
      onMessage('Limite atingido: a família pode ter até cinco pessoas.');
      return;
    }
    setBusy(true);
    try {
      const result=await createFamilyInvite(user, email, mode, birthDate,elderSelfManage,deliveryMethod);
      setInviteResult(result);
      setEmail('');
      setBirthDate('');
      onMessage(deliveryMethod==='email'?'Convite criado. O e-mail será enviado automaticamente.':'Convite criado. Copie o link ou o código para compartilhar.');
    } catch (e) {
      onMessage(e.message || 'Não foi possível criar o convite.');
    } finally {
      setBusy(false);
    }
  }

  async function reject(inviteId) {
    setBusy(true);
    try {
      await rejectFamilyInvite(user,inviteId);
      onMessage('Convite recusado.');
    } catch (e) {
      onMessage(e.message||'Não foi possível recusar o convite.');
    } finally {
      setBusy(false);
    }
  }

  async function join(e,selectedCode='') {
    e?.preventDefault?.();
    const codeToUse=selectedCode||joinCode;
    setBusy(true);
    try {
      const name = await acceptFamilyInvite(user, codeToUse);
      setJoinCode('');
      window.history.replaceState({},'',window.location.pathname);
      onMessage(`Vínculo com ${name} adicionado.`);
    } catch (e) {
      onMessage(e.message || 'Não foi possível aceitar o convite.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="familyWorkspace">
      <section className="familyHero">
        <div className="familyHeroIcon"><HeartHandshake size={28}/></div>
        <div><span className="eyebrow">CUIDADO COMPARTILHADO</span><h2>Sua família no MedHora</h2><p>Adultos e idosos acompanham a família. Menores acessam somente a própria rotina.</p></div>
        <div className="familyCapacity"><strong>{total}</strong><span>de 5 pessoas</span><div><i style={{width:`${total/5*100}%`}}/></div></div>
      </section>

      <div className="familyMainGrid">
      <section className="panel familyPanel familyMembersPanel">
        <div className="panelHead"><div><h2>Membros da família</h2><p>Selecione uma pessoa para consultar a agenda permitida.</p></div><span className="familyCountBadge">{total}/5</span></div>
        <div className="familyBody">
          <FamilyRow title={user.displayName||'Você'} subtitle={user.email} accountType={currentFamilyMember?.accountType||'self'} selfManage={currentFamilyMember?.selfManage} isSelf isAdmin={isCurrentAdmin} />
          {people.map(person=><FamilyRow key={person.uid} title={person.title} subtitle={person.email} accountType={person.accountType} selfManage={person.source?.selfManage} isAdmin={person.source?.isFamilyAdmin===true} onOpen={()=>onSelect(person.uid)} onRemove={person.kind==='dependent'?()=>onRemoveDependent(person.source):person.kind==='member'?()=>onRemoveMember(person.source):person.kind==='peer'?()=>onLeave(person.uid):null}/>) }
          {!people.length&&<div className="familyEmpty"><Users size={26}/><strong>Só você por enquanto</strong><span>Envie um convite para começar sua família.</span></div>}
        </div>
      </section>

      <section className="panel familyPanel familyInvitePanel">
        <div className="panelHead"><div><h2>Convites</h2><p>Gerencie entradas e convide familiares em um só lugar.</p></div>{incomingInvites.length>0?<span className="familyCountBadge">{incomingInvites.length}</span>:<UserPlus size={20}/>}</div>
        {incomingInvites.length>0&&<div className="familyInboxList compact">{incomingInvites.map(invite=><article key={invite.inviteId}><div className="familyMemberAvatar"><Mail size={18}/></div><div><strong>{invite.ownerName}</strong><span>Convite para entrar como {familyRoleLabel(invite.accountType||invite.mode)}</span></div><div className="inviteDecision"><button className="softBtn small danger" type="button" disabled={busy} onClick={()=>reject(invite.inviteId)}><X size={15}/>Recusar</button><button className="primary small" type="button" disabled={busy} onClick={()=>join(null,invite.inviteId)}><Check size={15}/>Aceitar</button></div></article>)}</div>}
        {isCurrentAdmin&&<form className="familyForm compactInviteForm" onSubmit={invite}>
          <fieldset className="familyRolePicker"><legend>Tipo de conta</legend>
            <button type="button" className={mode==='adult'?'active':''} onClick={()=>setMode('adult')}><UserRound size={19}/><span><strong>Adulto</strong><small>Acompanhamento mútuo</small></span></button>
            <button type="button" className={mode==='elderly'?'active':''} onClick={()=>setMode('elderly')}><HeartHandshake size={19}/><span><strong>Idoso</strong><small>Acompanhamento mútuo</small></span></button>
            <button type="button" className={mode==='minor'?'active':''} onClick={()=>setMode('minor')}><Baby size={19}/><span><strong>Menor</strong><small>Vê apenas a própria agenda</small></span></button>
          </fieldset>
          <label>
            E-mail Google da pessoa
            <input
              required
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="familiar@gmail.com"
            />
          </label>
          {mode === 'minor' && (
            <label>
              Data de nascimento do menor
              <input
                required
                type="date"
                max={localDateKey()}
                value={birthDate}
                onChange={(e) => setBirthDate(e.target.value)}
              />
            </label>
          )}
          {mode==='elderly'&&<label className="elderManagementChoice"><input type="checkbox" checked={elderSelfManage} onChange={event=>setElderSelfManage(event.target.checked)}/><span><strong>O idoso gerencia os próprios medicamentos</strong><small>Desmarque para o administrador da família cadastrar e editar os tratamentos. O idoso ainda poderá confirmar as doses.</small></span></label>}
          <fieldset className="inviteDeliveryPicker"><legend>Como deseja compartilhar?</legend><label><input type="radio" name="invite-delivery" checked={deliveryMethod==='email'} onChange={()=>setDeliveryMethod('email')}/><span><strong>Enviar por e-mail</strong><small>O MedHora envia automaticamente.</small></span></label><label><input type="radio" name="invite-delivery" checked={deliveryMethod==='link'} onChange={()=>setDeliveryMethod('link')}/><span><strong>Somente link</strong><small>Você compartilha por onde preferir.</small></span></label></fieldset>
          <button className="primary familyInviteButton" disabled={busy || total >= 5}>
            {deliveryMethod==='email'?<Mail size={16}/>:<Copy size={16}/>} {busy?'Gerando…':deliveryMethod==='email'?'Enviar convite':'Gerar link'}
          </button>
        </form>}
        {!isCurrentAdmin&&<div className="familyAdminNotice"><ShieldCheck size={18}/><span>Somente o administrador da família pode convidar novos membros.</span></div>}
        {inviteResult?.inviteId && (
          <div className="inviteCode">
            <span>{inviteResult.deliveryMethod==='email'?'E-mail na fila • código alternativo':'Convite pronto'}</span>
            <strong>{inviteResult.inviteId}</strong>
            <button type="button" onClick={() => navigator.clipboard.writeText(inviteResult.link||inviteResult.inviteId)}>
              <Copy size={15} />
              Copiar link
            </button>
          </div>
        )}
        <button type="button" className="codeEntryToggle" onClick={()=>setShowCodeEntry(value=>!value)} aria-expanded={showCodeEntry}><ChevronDown className={showCodeEntry?'rotated':''} size={16}/>{showCodeEntry?'Ocultar entrada por código':'Tenho um código de convite'}</button>
        {showCodeEntry&&<form className="familyForm inline compactCodeForm" onSubmit={join}><input required value={joinCode} onChange={(e)=>setJoinCode(e.target.value.toUpperCase())} placeholder="Cole o código aqui"/><button className="softBtn" disabled={busy}><Check/>Aceitar</button></form>}
      </section>
      </div>
      <div className="minorNote familyPrivacyRule"><ShieldCheck/><p><strong>Permissões da família</strong>Há um único administrador. Adultos e idosos acompanham a família; menores veem somente a própria agenda e têm os tratamentos gerenciados pelo administrador.</p></div>
    </div>
  );
}

function familyRoleLabel(type){return type==='minor'||type==='dependent'?'Menor de idade':type==='elderly'?'Idoso':'Adulto';}

function FamilyRow({ title, subtitle, accountType='adult', selfManage=true, onOpen, onRemove, isSelf=false, isAdmin=false }) {
  return (
    <div className="familyRow">
      <div className={`familyMemberAvatar ${accountType}`}>{accountType==='minor'?<Baby size={18}/>:accountType==='elderly'?<HeartHandshake size={18}/>:<UserRound size={18}/>}</div>
      <div className="familyMemberCopy">
        <strong>{title}</strong>
        <span>{isSelf?'Você • ':''}{isAdmin?'Administrador da família':accountType==='elderly'&&selfManage===false?'Idoso • medicamentos gerenciados pelo administrador':accountType==='self'?'Membro adulto':familyRoleLabel(accountType)}{subtitle?` • ${subtitle}`:''}</span>
      </div>
      {onOpen&&<button className="smallBtn familyOpenButton" onClick={onOpen}>Ver agenda<ArrowRight size={14}/></button>}
      {onRemove&&<button className="iconBtn danger" onClick={onRemove} aria-label={`Remover ${title}`} title="Remover vínculo">
        <Trash2 size={16} />
      </button>}
    </div>
  );
}

function PhonePanel({ user, pairedMode, devices, onActivate, saving, onMessage, onRemove, settings, onSaveSettings }) {
  const [qr, setQr] = useState('');
  const [pairUrl, setPairUrl] = useState('');
  const [expires, setExpires] = useState('');
  const [creating, setCreating] = useState(false);
  const [preferences,setPreferences]=useState(settings||{recipientEmail:user.email||'',leadMinutes:5,emailEnabled:true,pushEnabled:true});
  useEffect(()=>setPreferences(settings||preferences),[settings]);

  async function createQr() {
    setCreating(true);
    try {
      const pair = await createDevicePairing(user);
      const {default:QRCode}=await import('qrcode');
      const url = `${SITE_URL}/?pair=${pair.pairId}`;
      setPairUrl(url);
      setQr(
        await QRCode.toDataURL(url, {
          width: 300,
          margin: 2,
          color: { dark: '#123c31', light: '#ffffff' }
        })
      );
      setExpires(
        new Date(pair.expiresAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
      );
      onMessage('QR Code de acesso direto criado. Ele funciona uma única vez por cerca de 10 minutos.');
    } catch (e) {
      onMessage(e.message || 'Não foi possível gerar o QR Code.');
    } finally {
      setCreating(false);
    }
  }

  if (pairedMode) {
    return (
      <section className="panel phonePanel pairedPhone">
        <div className="phoneBadge">
          <Smartphone size={42} />
        </div>
        <div>
          <span className="tag green">APARELHO CONECTADO</span>
          <h2>Acesso direto ativo</h2>
          <p>
            Este aparelho já está conectado à agenda. Ative as notificações para receber os lembretes mesmo com o
            site fechado.
          </p>
          <button className="primary" disabled={saving} onClick={onActivate}>
            <Bell size={18} />
            Ativar notificações
          </button>
        </div>
      </section>
    );
  }

  return (
    <>
      <section className="panel notificationPreferences">
        <div className="panelHead"><div><h2>Preferências dos lembretes</h2><p>O e-mail da sua conta Google é usado automaticamente e pode ser alterado.</p></div></div>
        <form className="familyForm" onSubmit={async event=>{event.preventDefault();if(await onSaveSettings(preferences))onMessage('Preferências de lembrete salvas.');}}>
          <label>E-mail de destino<input type="email" required value={preferences.recipientEmail||''} onChange={event=>setPreferences(value=>({...value,recipientEmail:event.target.value}))}/></label>
          <label>Avisar antes do horário<select value={preferences.leadMinutes??5} onChange={event=>setPreferences(value=>({...value,leadMinutes:Number(event.target.value)}))}>
            <option value="0">No horário</option><option value="5">5 minutos antes</option><option value="10">10 minutos antes</option><option value="15">15 minutos antes</option><option value="30">30 minutos antes</option>
          </select></label>
          <label className="settingCheck"><input type="checkbox" checked={preferences.emailEnabled!==false} onChange={event=>setPreferences(value=>({...value,emailEnabled:event.target.checked}))}/> Receber por e-mail</label>
          <label className="settingCheck"><input type="checkbox" checked={preferences.pushEnabled!==false} onChange={event=>setPreferences(value=>({...value,pushEnabled:event.target.checked}))}/> Receber notificação no celular</label>
          <button className="primary" disabled={saving}><Check size={17}/>Salvar preferências</button>
        </form>
      </section>
      <section className="panel phonePanel">
        <div className={`qrBox ${!qr ? 'qrPlaceholder' : ''}`}>
          {qr ? (
            <img src={qr} alt="QR Code temporário para entrar no MedHora Família" />
          ) : (
            <QrCode size={132} />
          )}
        </div>
        <div>
          <span className="tag green">ACESSO RÁPIDO SEGURO</span>
          <h2>Entre no celular sem digitar uma conta</h2>
          <p>
            Gere um QR Code temporário e leia com a câmera do celular. A agenda abre diretamente e o aparelho fica
            registrado na sua conta.
          </p>
          <ul className="securityList">
            <li>Uso único</li>
            <li>Expira em cerca de 10 minutos</li>
            <li>Pode ser revogado</li>
          </ul>
          <div className="qrActions">
            <button className="primary" disabled={creating} onClick={createQr}>
              <QrCode size={18} />
              {creating ? 'Gerando…' : qr ? 'Gerar outro QR Code' : 'Gerar QR de acesso direto'}
            </button>
            {pairUrl && (
              <a className="smallBtn qrLink" data-pair-link href={pairUrl} target="_blank" rel="noreferrer">
                <Smartphone size={16} />
                Abrir no aparelho
              </a>
            )}
          </div>
          {expires && <p className="expiry">Válido até {expires} ou até o primeiro uso.</p>}
        </div>
      </section>
      {devices.length > 0 && (
        <section className="panel devicesPanel">
          <div className="panelHead">
            <div>
              <h2>Aparelhos conectados</h2>
              <p>Remova qualquer aparelho que você não reconheça ou não use mais.</p>
            </div>
          </div>
          <div className="deviceList">
            {devices.map((device) => (
              <div className="deviceRow" key={device.deviceUid}>
                <Smartphone />
                <div>
                  <strong>{device.label || 'Aparelho'}</strong>
                  <span>Conectado por QR Code</span>
                </div>
                <button className="smallBtn dangerText" onClick={() => onRemove(device)}>
                  Remover acesso
                </button>
              </div>
            ))}
          </div>
        </section>
      )}
    </>
  );
}

function MedicationModal({ initial, suggestedName = '', onClose, onSave }) {
  const type = initial ? medicationScheduleType(initial) : 'interval';
  const [form, setForm] = useState({
    name: initial?.name || suggestedName || '',
    dose: initial?.dose || '',
    start: initial?.start || '',
    freq: type === 'asNeeded' ? 'prn' : String(initial?.freq || '6'),
    scheduleType: type,
    days: initial?.days ? String(initial.days) : '',
    date: initial?.date || localDateKey(),
    notes: initial?.notes || '',
    times: (initial?.times || []).join(', ')
  });
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const dialog = useRef(null);
  const set = (f) => (e) => setForm((v) => ({ ...v, [f]: e.target.value }));

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  async function submit(e) {
    e.preventDefault();
    setError('');
    const values = {
      ...form,
      name: form.name.trim(),
      dose: form.dose.trim(),
      status: initial?.status || 'active'
    };
    if (form.scheduleType === 'times') {
      values.times = form.times
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean);
      if (
        !values.times.length ||
        values.times.length > 8 ||
        values.times.some((v) => !/^([01]\d|2[0-3]):[0-5]\d$/.test(v))
      ) {
        setError('Informe de 1 a 8 horários válidos, como 08:00, 14:00.');
        return;
      }
    } else if (form.scheduleType === 'asNeeded') {
      values.freq = 'prn';
    }
    setSubmitting(true);
    if (!(await onSave(values))) setSubmitting(false);
  }

  return (
    <dialog
      ref={dialog}
      onCancel={onClose}
      className="backdrop"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <form className="modal" onSubmit={submit}>
        <div className="modalHead">
          <div>
            <span className="tag green">{initial ? 'EDITAR' : 'NOVO TRATAMENTO'}</span>
            <h2>{initial ? 'Editar medicamento' : 'Adicionar medicamento'}</h2>
            <p>Preencha conforme a prescrição.</p>
          </div>
          <button type="button" className="closeBtn" onClick={onClose} aria-label="Fechar janela">
            <X />
          </button>
        </div>
        <label>
          Nome
          <input autoFocus required value={form.name} onChange={set('name')} />
        </label>
        <label>
          Dose / instrução <span className="optional">opcional</span>
          <input value={form.dose} onChange={set('dose')} placeholder="Ex.: 1 gota no olho acometido" />
        </label>
        <div className="formGrid">
          <label>
            Tipo de horário
            <select value={form.scheduleType} onChange={set('scheduleType')}>
              <option value="interval">Intervalo de horas</option>
              <option value="times">Horários personalizados</option>
              <option value="asNeeded">Quando necessário</option>
            </select>
          </label>
          <label>
            Duração em dias <span className="optional">opcional</span>
            <input min="1" max="365" type="number" value={form.days} onChange={set('days')} placeholder="Uso contínuo" />
          </label>
        </div>
        <label>
          Data inicial
          <input required type="date" value={form.date} onChange={set('date')} />
        </label>
        {form.scheduleType === 'interval' && (
          <div className="formGrid">
            <label>
              Primeira dose
              <input required type="time" value={form.start} onChange={set('start')} />
            </label>
            <label>
              Frequência
              <select value={form.freq} onChange={set('freq')}>
                <option value="6">A cada 6 horas</option>
                <option value="8">A cada 8 horas</option>
                <option value="12">A cada 12 horas</option>
                <option value="24">Uma vez ao dia</option>
              </select>
            </label>
          </div>
        )}
        {form.scheduleType === 'times' && (
          <label>
            Horários separados por vírgula
            <input required value={form.times} onChange={set('times')} placeholder="08:00, 14:00, 20:00" />
          </label>
        )}
        <label>
          Observações <span className="optional">opcional</span>
          <input value={form.notes} onChange={set('notes')} />
        </label>
        {error && <p role="alert">{error}</p>}
        <div className="modalActions">
          <button type="button" className="cancel" onClick={onClose}>
            Cancelar
          </button>
          <button disabled={submitting} className="primary">
            <Check />
            Salvar
          </button>
        </div>
      </form>
    </dialog>
  );
}

function PrivacyPanel({accepted,onAccept,onRevoke,onDelete,saving}){
  return <>
    <PageTitle title="Privacidade e seus dados" subtitle="Controle como seus dados de saúde são usados e apague tudo quando quiser."/>
    <section className="panel privacyPanel">
      <ShieldCheck size={38}/><h2>M.A.R.I.A. e receituários</h2>
      <p>Quando você usa a M.A.R.I.A., a imagem do receituário ou a pergunta pode ser enviada ao Google Gemini. Pesquisas sobre a finalidade de medicamentos consultam fontes públicas. O MedHora não usa essas informações para diagnóstico.</p>
      <ul><li>A M.A.R.I.A. não substitui médico, farmacêutico ou atendimento de emergência.</li><li>Ela não faz diagnósticos nem recomenda iniciar, parar, trocar ou alterar doses.</li><li>Em uma emergência, ligue para o SAMU 192 ou procure um pronto-socorro.</li></ul>
      <ul><li>Confira toda leitura antes de cadastrar.</li><li>Não envie documentos que não sejam necessários.</li><li>As conversas ficam apenas neste navegador e podem ser apagadas na própria tela.</li></ul>
      {accepted?<button className="softBtn" onClick={onRevoke}>Revogar consentimento da M.A.R.I.A.</button>:<button className="primary" onClick={onAccept}><Check/>Li, compreendi os limites e aceito usar a M.A.R.I.A.</button>}
    </section>
    <section className="panel dangerZone"><h2>Excluir conta e dados</h2><p>Apaga medicamentos, doses, vínculos, aparelhos e a conta. Essa ação não pode ser desfeita.</p><button className="dangerButton" disabled={saving} onClick={onDelete}><Trash2 size={17}/>Excluir permanentemente</button></section>
  </>;
}

function Login() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const initialLegal=new URLSearchParams(location.search).get('legal');
  const [legal,setLegal]=useState(['privacy','terms'].includes(initialLegal)?initialLegal:'');

  useEffect(()=>{
    const sync=()=>{const value=new URLSearchParams(location.search).get('legal');setLegal(['privacy','terms'].includes(value)?value:'');};
    window.addEventListener('popstate',sync);return()=>window.removeEventListener('popstate',sync);
  },[]);

  function showLegal(type){
    const url=new URL(location.href);url.searchParams.set('legal',type);history.pushState({},'',url);setLegal(type);window.scrollTo(0,0);
  }
  function closeLegal(){
    const url=new URL(location.href);url.searchParams.delete('legal');history.pushState({},'',url);setLegal('');window.scrollTo(0,0);
  }

  async function enter() {
    setBusy(true);
    setError('');
    try {
      await Promise.race([
        signInWithPopup(auth, googleProvider),
        new Promise((_, r) => setTimeout(() => r({ code: 'auth/popup-timeout' }), 12000))
      ]);
    } catch (cause) {
      console.error('Falha ao autenticar com Google:', cause);
      if (
        ['auth/popup-blocked', 'auth/operation-not-supported-in-this-environment', 'auth/popup-timeout'].includes(
          cause?.code
        )
      ) {
        try {
          await signInWithRedirect(auth, googleProvider);
          return;
        } catch (redirectErr) {
          console.error('Falha no signInWithRedirect:', redirectErr);
        }
      }
      if (cause?.code === 'auth/unauthorized-domain') {
        setError('Domínio não autorizado pelo Firebase. Ao testar localmente, acesse por http://localhost:5173');
      } else {
        setError(cause?.message || 'Não foi possível entrar com o Google. Tente abrir no Chrome, Edge ou Safari.');
      }
      setBusy(false);
    }
  }

  return legal?<LegalPage type={legal} onBack={closeLegal}/>:<LandingPage busy={busy} error={error} onEnter={enter} onLegal={showLegal}/>;
}

function Root() {
  const [user, setUser] = useState(undefined);
  const [paired, setPaired] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('medhora-paired-access') || 'null');
    } catch {
      return null;
    }
  });
  const [pairing, setPairing] = useState(false);
  const [pairError, setPairError] = useState('');
  const pairId = new URLSearchParams(location.search).get('pair');

  useEffect(()=>{
    if('serviceWorker' in navigator)navigator.serviceWorker.register('/firebase-messaging-sw.js').catch(error=>reportClientError(error,{source:'service-worker'}));
  },[]);

  useEffect(() => {
    const stop = onAuthStateChanged(auth, setUser);
    const fallback = setTimeout(() => setUser((v) => (v === undefined ? null : v)), 8000);
    return () => {
      stop();
      clearTimeout(fallback);
    };
  }, []);

  useEffect(() => {
    if (user === undefined) return;
    if (pairId && !user) {
      setPairing(true);
      signInAnonymously(auth).catch(() => {
        setPairError('Não foi possível iniciar o acesso pelo QR Code.');
        setPairing(false);
      });
      return;
    }
    if (user?.isAnonymous && pairId) {
      setPairing(true);
      claimDevicePairing(user, pairId)
        .then((access) => {
          localStorage.setItem('medhora-paired-access', JSON.stringify(access));
          setPaired(access);
          history.replaceState({}, '', location.pathname);
          setPairing(false);
        })
        .catch(async (e) => {
          localStorage.removeItem('medhora-paired-access');
          setPairError(e.message || 'Este QR Code não pôde ser utilizado.');
          setPairing(false);
          await signOut(auth);
        });
    }
  }, [user, pairId]);

  async function leave() {
    localStorage.removeItem('medhora-paired-access');
    setPaired(null);
    await signOut(auth);
  }

  if (user === undefined) {
    return (
      <main className="loginPage">
        <section className="loginCard pairingCard">
          <Pill />
          <h1>Carregando o MedHora…</h1>
        </section>
      </main>
    );
  }

  if (pairing) {
    return (
      <main className="loginPage">
        <section className="loginCard pairingCard">
          <QrCode />
          <h1>Conectando o aparelho…</h1>
          <p>Validando o QR Code de acesso único.</p>
        </section>
      </main>
    );
  }

  if (pairError && !user) {
    return (
      <main className="loginPage">
        <section className="loginCard pairingCard">
          <X />
          <h1>Não foi possível conectar</h1>
          <p>{pairError}</p>
          <a className="primary" href={SITE_URL}>
            Voltar ao início
          </a>
        </section>
      </main>
    );
  }

  if (user?.isAnonymous && !paired) {
    return <main className="loginPage">Preparando acesso…</main>;
  }

  return user ? (
    <App user={user} pairedAccess={user.isAnonymous ? paired : null} onSignOut={leave} />
  ) : (
    <Login />
  );
}

installGlobalErrorMonitoring();
createRoot(document.getElementById('root')).render(<ErrorBoundary><Root /></ErrorBoundary>);
