import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import QRCode from 'qrcode';
import {
  Bell,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  Clock3,
  Copy,
  Download,
  History,
  Home,
  LogOut,
  Menu,
  Pencil,
  Pill,
  Play,
  Plus,
  QrCode,
  Settings,
  ShieldCheck,
  Smartphone,
  Trash2,
  UserRound,
  Users,
  X,
  Sparkles,
  ArrowRight
} from 'lucide-react';
import { onAuthStateChanged, signInAnonymously, signInWithPopup, signInWithRedirect, signOut } from 'firebase/auth';
import './styles.css';
import { dosesBetween, localDateKey, medicationScheduleType, medicationStatus, pad, getMedicationDurationInfo } from './schedule.js';
import { auth, googleProvider } from './firebase.js';
import {
  acceptFamilyInvite,
  addMedication,
  claimDevicePairing,
  createDevicePairing,
  createFamilyInvite,
  ensureProfile,
  leaveSharedAgenda,
  removeDependent,
  removeMedication,
  removeMember,
  removePairedDevice,
  savePushTokenForOwner,
  setDoseTaken,
  subscribeAgenda,
  subscribeCareControl,
  subscribeConnections,
  subscribeDependents,
  subscribeMembers,
  subscribePairedDevices,
  subscribeSharedAgenda,
  updateMedication
} from './cloudStore.js';
import { activatePushNotifications, listenForForegroundMessages } from './push.js';
import { MedsView } from './components/MedsView.jsx';

const AiScannerModal=React.lazy(()=>import('./components/AiScannerModal.jsx').then(module=>({default:module.AiScannerModal})));

const SITE_URL = 'https://medhora-familia.web.app';
const fmtMinutes = (m) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
const fmtDay = (d) =>
  new Intl.DateTimeFormat('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' }).format(d);

function App({ user, onSignOut, pairedAccess }) {
  const [own, setOwn] = useState({ meds: [], taken: {} });
  const [shared, setShared] = useState({ meds: [], taken: {} });
  const [connections, setConnections] = useState([]);
  const [members, setMembers] = useState([]);
  const [dependents, setDependents] = useState([]);
  const [devices, setDevices] = useState([]);
  const [control, setControl] = useState(null);

  const [selected, setSelected] = useState('self');
  const [page, setPage] = useState('agenda'); // 'agenda', 'meds', 'history', 'family', 'phone', 'backup'
  const [now, setNow] = useState(new Date());
  const [modalMed, setModalMed] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [aiModalOpen, setAiModalOpen] = useState(false);
  const [message, setMessage] = useState('');
  const messageTimeoutRef = useRef(null);

  const notify = (msg) => {
    if (messageTimeoutRef.current) clearTimeout(messageTimeoutRef.current);
    setMessage(msg);
    if (msg) {
      messageTimeoutRef.current = setTimeout(() => {
        setMessage('');
      }, 5000);
    }
  };
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const pairedMode = !!pairedAccess;
  const viewingOwn = !pairedMode && selected === 'self';
  const selectedConnection = connections.find((x) => x.ownerUid === selected);
  const selectedDependent = dependents.find((x) => x.dependentUid === selected);
  const selectedPerson = selectedDependent || selectedConnection;
  const managedMinor = !!control && new Date(control.adultAt?.toDate?.() || control.adultAt) > now;
  const canManage = !pairedMode && ((viewingOwn && !managedMinor) || !!selectedDependent);
  const canToggle = pairedMode || viewingOwn || !!selectedDependent;
  const ownerUid = pairedMode ? pairedAccess.ownerUid : viewingOwn ? user.uid : selected;
  const state = pairedMode ? own : viewingOwn ? own : shared;

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 15000);
    return () => clearInterval(id);
  }, []);

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
            subscribePairedDevices(user, setDevices, () => setDevices([])),
            subscribeCareControl(user, setControl, () => setControl(null))
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
    setShowAll(false);
    if (pairedMode || viewingOwn) {
      setShared({ meds: [], taken: {} });
      return;
    }
    return subscribeSharedAgenda(selected, setShared, () => {
      setMessage('O acesso a esta agenda não está mais disponível.');
      setSelected('self');
    });
  }, [selected, viewingOwn, pairedMode]);

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
    from.setDate(from.getDate() - 6);
    return dosesBetween(state.meds, from, new Date(now.getTime() + 60000), { includeInactive: true })
      .reverse()
      .slice(0, 100);
  }, [state.meds, dayStart, now]);

  const mins = now.getHours() * 60 + now.getMinutes();
  const next = doses.find((d) => !state.taken[d.doseKey]);
  const done = doses.filter((d) => state.taken[d.doseKey]).length;
  const displayed = showAll ? doses : doses.slice(0, 6);

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
    } catch (e) {
      setMessage(`Cadastrados ${count} medicamento(s). Erro: ${e.message || 'Falha ao salvar medicamento.'}`);
    } finally {
      setSaving(false);
    }
  }

  const toggleDose = (key) =>
    withSave(() => setDoseTaken(user, key, !state.taken[key], ownerUid), 'Não foi possível registrar a dose.');

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

  function exportBackup() {
    const blob = new Blob(
      [
        JSON.stringify(
          {
            version: 2,
            exportedAt: new Date().toISOString(),
            account: { email: user.email, displayName: user.displayName },
            medications: own.meds,
            takenDoses: own.taken
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
        ['history', <History />, 'Histórico'],
        ['phone', <Smartphone />, 'Celular']
      ]
    : [
        ['agenda', <Home />, 'Agenda'],
        ['meds', <Pill />, 'Medicamentos'],
        ['history', <History />, 'Histórico'],
        ['family', <Users />, 'Família'],
        ['phone', <Smartphone />, 'Celular'],
        ['backup', <Download />, 'Backup']
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
                setPage(id);
                setMenuOpen(false);
              }}
            />
          ))}
        </nav>

        <main className="page">
          {message && (
            <div className="feedback" role="status" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
              <span>{message}</span>
              <button 
                type="button" 
                onClick={() => setMessage('')} 
                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px', display: 'flex', alignItems: 'center', color: 'inherit' }}
                title="Fechar aviso"
              >
                <X size={16} />
              </button>
            </div>
          )}
          <p className="cloudStatus">
            {saving ? 'Salvando na nuvem…' : ready ? `Nuvem conectada • ${name}` : 'Conectando à sua agenda…'}
          </p>
          {!pairedMode && (
            <AgendaSwitcher
              user={user}
              connections={connections}
              dependents={dependents}
              selected={selected}
              onSelect={selectAgenda}
            />
          )}

          {page === 'agenda' && (
            <>
              <section className="welcome">
                <div>
                  <p className="eyebrow">
                    <CalendarDays size={15} />
                    {today}
                  </p>
                  <h1>{viewingOwn || pairedMode ? 'Cuide dos seus horários.' : `Agenda de ${name}`}</h1>
                  <p className="subtitle">
                    {pairedMode
                      ? 'Acesso rápido protegido para acompanhar e marcar as doses neste aparelho.'
                      : managedMinor && viewingOwn
                      ? `Seu responsável, ${control.guardianName}, administra os tratamentos. Você pode marcar suas doses.`
                      : selectedDependent
                      ? 'Você administra os tratamentos deste dependente.'
                      : selectedConnection
                      ? 'Acompanhamento autorizado somente para visualização.'
                      : 'Marque cada medicamento assim que tomar.'}
                  </p>
                </div>

                {canManage && (
                  <div className="agendaActionsGroup">
                    <button
                      className="aiScanBtn"
                      type="button"
                      disabled={!ready || saving}
                      onClick={() => setAiModalOpen(true)}
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
                        setModalOpen(true);
                      }}
                    >
                      <Plus size={18} />
                      <span>Adicionar medicamento</span>
                    </button>
                  </div>
                )}
              </section>

              <section className="nextCard">
                <div>
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
                <div className="nextTime">{next ? fmtMinutes(next.mins) : '--:--'}</div>
              </section>

              <section className="stats">
                <Stat kind="taken" icon={<CheckCircle2 />} value={done} label="Doses tomadas" />
                <Stat kind="pending" icon={<Clock3 />} value={doses.length - done} label="Doses pendentes" />
                <Stat kind="meds" icon={<Pill />} value={state.meds.length} label="Medicamentos" />
              </section>

              <div className="agendaGrid">
                <section className="panel">
                  <div className="panelHead">
                    <div>
                      <h2>Agenda de hoje</h2>
                      <p>
                        Mostrando {Math.min(displayed.length, doses.length)} de {doses.length} horários.
                      </p>
                    </div>
                    <span className="liveTime">
                      {now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  <div className="timeline">
                    {doses.length === 0 ? (
                      <Empty onAdd={canManage ? () => setModalOpen(true) : null} />
                    ) : (
                      displayed.map((d) => (
                        <DoseRow
                          key={d.doseKey}
                          dose={d}
                          taken={!!state.taken[d.doseKey]}
                          late={!state.taken[d.doseKey] && d.mins < mins}
                          canToggle={canToggle}
                          saving={saving}
                          onToggle={toggleDose}
                        />
                      ))
                    )}
                  </div>
                  {doses.length > 6 && (
                    <button className="showMore" onClick={() => setShowAll((v) => !v)}>
                      {showAll ? 'Mostrar menos' : `Mostrar mais ${doses.length - 6}`}
                      <ChevronDown className={showAll ? 'rotated' : ''} />
                    </button>
                  )}
                </section>

                <MedicationList
                  meds={state.meds}
                  editable={canManage}
                  saving={saving}
                  onEdit={(m) => {
                    setModalMed(m);
                    setModalOpen(true);
                  }}
                  onStatus={changeStatus}
                  onRemove={removeMed}
                  onOpenAi={() => setAiModalOpen(true)}
                  onAddManual={() => {
                    setModalMed(null);
                    setModalOpen(true);
                  }}
                  onNavigateMeds={() => setPage('meds')}
                />
              </div>
            </>
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
                setModalOpen(true);
              }}
              onOpenAiScanner={() => setAiModalOpen(true)}
              onEdit={(m) => {
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
              <PageTitle title="Histórico" subtitle="Inclui as doses de hoje assim que o horário chega." />
              <HistoryPanel items={history} taken={state.taken} />
            </>
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
                onSelect={selectAgenda}
                onMessage={setMessage}
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
                onMessage={setMessage}
                onRemove={(device) =>
                  withSave(() => removePairedDevice(user, device.deviceUid), 'Não foi possível remover o aparelho.')
                }
              />
            </>
          )}

          {page === 'backup' && (
            <>
              <PageTitle title="Backup" subtitle="Guarde uma cópia da sua agenda e dos registros." />
              <section className="panel simplePage">
                <Download size={34} />
                <h2>Exportar meus dados</h2>
                <p>O arquivo contém seus medicamentos e o histórico das doses registradas.</p>
                <button className="primary" onClick={exportBackup}>
                  <Download size={17} />
                  Baixar backup
                </button>
              </section>
            </>
          )}
        </main>
      </div>

      {modalOpen && (
        <MedicationModal
          initial={modalMed}
          onClose={() => {
            setModalOpen(false);
            setModalMed(null);
          }}
          onSave={saveMed}
        />
      )}

      {aiModalOpen && (
        <React.Suspense fallback={<div className="backdrop"><div className="panel">Carregando a M.A.R.I.A...</div></div>}>
          <AiScannerModal
            onClose={() => setAiModalOpen(false)}
            onAddMedications={handleAddMultipleMeds}
          />
        </React.Suspense>
      )}
    </div>
  );
}

function NavButton({ active, icon, label, onClick }) {
  return (
    <button className={`navButton ${active ? 'active' : ''}`} onClick={onClick}>
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

function AgendaSwitcher({ user, connections, dependents, selected, onSelect }) {
  const people = [
    ...dependents.map((x) => ({ ...x, uid: x.dependentUid, name: x.displayName, badge: 'Dependente' })),
    ...connections.map((x) => ({ ...x, uid: x.ownerUid, name: x.ownerName, badge: 'Acompanhando' }))
  ];
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
          onClick={() => onToggle(dose.doseKey)}
        >
          {taken ? (
            <>
              <Play size={16} />
              Desfazer
            </>
          ) : (
            <>
              <Check size={16} />
              Tomei
            </>
          )}
        </button>
      ) : (
        <span className={taken ? 'historyTaken' : 'historyMissed'}>{taken ? 'Tomada' : 'Pendente'}</span>
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
        <div className="panelHeadActions" style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          {onNavigateMeds && (
            <button
              type="button"
              className="softBtn small"
              onClick={onNavigateMeds}
              title="Abrir tela completa de medicamentos com filtros e duração detalhada"
              style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '13px', padding: '6px 10px' }}
            >
              Ver detalhes <ArrowRight size={14} />
            </button>
          )}
          {editable && (
            <button
              type="button"
              className="aiScanBtn small"
              onClick={onOpenAi}
              title="Ler receita médica com Inteligência Artificial"
            >
              <Sparkles size={14} /> M.A.R.I.A.
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
          meds.map((m) => {
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

function HistoryPanel({ items, taken }) {
  return (
    <section className="panel historyPanel">
      <div className="panelHead">
        <div>
          <h2>
            <History size={19} />
            Últimos 7 dias
          </h2>
          <p>Doses até o horário atual, incluindo hoje.</p>
        </div>
      </div>
      {items.length === 0 ? (
        <p className="muted historyEmpty">Ainda não há doses para mostrar.</p>
      ) : (
        <div className="historyGrid">
          {items.map((i) => {
            const ok = !!taken[i.doseKey];
            return (
              <div className="historyItem" key={i.doseKey}>
                <span>
                  {fmtDay(new Date(i.at))} • {fmtMinutes(i.mins)}
                </span>
                <strong>{i.name}</strong>
                <em className={ok ? 'historyTaken' : 'historyMissed'}>{ok ? 'Tomada' : 'Sem registro'}</em>
              </div>
            );
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
  onSelect,
  onMessage,
  onRemoveMember,
  onRemoveDependent,
  onLeave
}) {
  const [email, setEmail] = useState('');
  const [mode, setMode] = useState('viewer');
  const [birthDate, setBirthDate] = useState('');
  const [code, setCode] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [busy, setBusy] = useState(false);
  const total = members.length + dependents.length;

  async function invite(e) {
    e.preventDefault();
    if (total >= 2) {
      onMessage('Limite atingido: sua família pode ter até três pessoas.');
      return;
    }
    setBusy(true);
    try {
      setCode(await createFamilyInvite(user, email, mode, birthDate));
      setEmail('');
      setBirthDate('');
      onMessage('Convite criado. Envie o código somente para a pessoa indicada.');
    } catch (e) {
      onMessage(e.message || 'Não foi possível criar o convite.');
    } finally {
      setBusy(false);
    }
  }

  async function join(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const name = await acceptFamilyInvite(user, joinCode);
      setJoinCode('');
      onMessage(`Vínculo com ${name} adicionado.`);
    } catch (e) {
      onMessage(e.message || 'Não foi possível aceitar o convite.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="familyGrid">
      <section className="panel familyPanel">
        <div className="panelHead">
          <div>
            <h2>Novo convite</h2>
            <p>{total}/2 vínculos criados por você.</p>
          </div>
        </div>
        <form className="familyForm" onSubmit={invite}>
          <label>
            Tipo de acesso
            <select value={mode} onChange={(e) => setMode(e.target.value)}>
              <option value="viewer">Adulto acompanha minha agenda</option>
              <option value="dependent">Menor: eu gerencio a agenda</option>
            </select>
          </label>
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
          {mode === 'dependent' && (
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
          <button className="primary" disabled={busy || total >= 2}>
            <Plus size={16} />
            Gerar convite
          </button>
        </form>
        {code && (
          <div className="inviteCode">
            <span>Código do convite</span>
            <strong>{code}</strong>
            <button type="button" onClick={() => navigator.clipboard.writeText(code)}>
              <Copy size={15} />
              Copiar
            </button>
          </div>
        )}
      </section>

      <section className="panel familyPanel">
        <div className="panelHead">
          <div>
            <h2>Pessoas da família</h2>
            <p>Selecione uma pessoa para abrir a agenda.</p>
          </div>
        </div>
        <div className="familyBody">
          {!members.length && !dependents.length && !connections.length && (
            <p className="muted">Nenhum familiar vinculado.</p>
          )}
          {dependents.map((d) => (
            <FamilyRow
              key={d.dependentUid}
              title={d.displayName}
              subtitle="Dependente • você gerencia"
              onOpen={() => onSelect(d.dependentUid)}
              onRemove={() => onRemoveDependent(d)}
            />
          ))}
          {members.map((m) => (
            <FamilyRow
              key={m.memberUid}
              title={m.displayName}
              subtitle="Acompanha sua agenda"
              onRemove={() => onRemoveMember(m)}
            />
          ))}
          {connections.map((c) => (
            <FamilyRow
              key={c.ownerUid}
              title={c.ownerName}
              subtitle="Você acompanha esta agenda"
              onOpen={() => onSelect(c.ownerUid)}
              onRemove={() => onLeave(c.ownerUid)}
            />
          ))}
        </div>
      </section>

      <section className="panel familyPanel acceptPanel">
        <div className="panelHead">
          <div>
            <h2>Aceitar convite</h2>
            <p>Use o código recebido do familiar.</p>
          </div>
        </div>
        <form className="familyForm inline" onSubmit={join}>
          <input
            required
            value={joinCode}
            onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
            placeholder="Cole o código aqui"
          />
          <button className="softBtn" disabled={busy}>
            <Check />
            Aceitar
          </button>
        </form>
        <div className="minorNote">
          <ShieldCheck />
          <p>
            <strong>Proteção para menores</strong>O menor marca as doses. O responsável pode adicionar, editar,
            pausar, encerrar e remover tratamentos até os 18 anos.
          </p>
        </div>
      </section>
    </div>
  );
}

function FamilyRow({ title, subtitle, onOpen, onRemove }) {
  return (
    <div className="familyRow">
      <div>
        <strong>{title}</strong>
        <span>{subtitle}</span>
      </div>
      {onOpen && (
        <button className="smallBtn" onClick={onOpen}>
          Ver agenda
        </button>
      )}
      <button className="iconBtn danger" onClick={onRemove}>
        <Trash2 size={16} />
      </button>
    </div>
  );
}

function PhonePanel({ user, pairedMode, devices, onActivate, saving, onMessage, onRemove }) {
  const [qr, setQr] = useState('');
  const [pairUrl, setPairUrl] = useState('');
  const [expires, setExpires] = useState('');
  const [creating, setCreating] = useState(false);

  async function createQr() {
    setCreating(true);
    try {
      const pair = await createDevicePairing(user);
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

function MedicationModal({ initial, onClose, onSave }) {
  const type = initial ? medicationScheduleType(initial) : 'interval';
  const [form, setForm] = useState({
    name: initial?.name || '',
    dose: initial?.dose || '',
    start: initial?.start || '',
    freq: type === 'asNeeded' ? 'prn' : String(initial?.freq || '6'),
    scheduleType: type,
    days: String(initial?.days || 1),
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
          <button type="button" className="closeBtn" onClick={onClose}>
            <X />
          </button>
        </div>
        <label>
          Nome
          <input autoFocus required value={form.name} onChange={set('name')} />
        </label>
        <label>
          Dose / instrução
          <input required value={form.dose} onChange={set('dose')} placeholder="Ex.: 1 gota no olho acometido" />
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
            Duração em dias
            <input required min="1" max="365" type="number" value={form.days} onChange={set('days')} />
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

function Login() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

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

  return (
    <main className="loginPage">
      <section className="loginCard">
        <div className="brandIcon">
          <Pill />
        </div>
        <p className="eyebrow">MEDHORA FAMÍLIA</p>
        <h1>Sua agenda de remédios, sempre com você.</h1>
        <p>Entre com sua conta Google. Cada pessoa da família terá uma agenda individual e privada.</p>
        <button className="primary" disabled={busy} onClick={enter}>
          {busy ? 'Abrindo o Google…' : 'Entrar com Google'}
        </button>
        {error && <p role="alert">{error}</p>}
        <small>
          Este aplicativo organiza os horários informados. Siga sempre a prescrição do seu profissional de saúde.
        </small>
      </section>
    </main>
  );
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

createRoot(document.getElementById('root')).render(<Root />);
