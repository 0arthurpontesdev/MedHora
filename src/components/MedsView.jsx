import React, { useState, useMemo } from 'react';
import { Pill, Plus, Sparkles, Clock3, Calendar, AlertCircle, CheckCircle2, Pencil, Trash2, Settings, ChevronDown, Check, Play } from 'lucide-react';
import { medicationScheduleType, medicationStatus, getMedicationDurationInfo, dosesBetween, pad } from '../schedule.js';

const fmtMinutes = (m) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;

export function MedsView({
  meds,
  takenState,
  editable,
  saving,
  now,
  onAddManual,
  onOpenAiScanner,
  onEdit,
  onStatus,
  onRemove,
  onToggleDose
}) {
  const [filter, setFilter] = useState('all'); // 'all', 'pending_today', 'active', 'continuous'
  const [search, setSearch] = useState('');

  // Calculate today's pending doses per medication
  const todayStart = useMemo(() => {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    return d;
  }, [now]);

  const todayEnd = useMemo(() => {
    const d = new Date(todayStart);
    d.setDate(d.getDate() + 1);
    return d;
  }, [todayStart]);

  const allTodayDoses = useMemo(() => {
    return dosesBetween(meds, todayStart, todayEnd);
  }, [meds, todayStart, todayEnd]);

  const currentMinutes = now.getHours() * 60 + now.getMinutes();

  // Group today's doses by med id
  const dosesByMedId = useMemo(() => {
    const map = {};
    for (const dose of allTodayDoses) {
      if (!map[dose.id]) map[dose.id] = [];
      map[dose.id].push(dose);
    }
    return map;
  }, [allTodayDoses]);

  // Enrich medications with duration info and pending count
  const enrichedMeds = useMemo(() => {
    return meds.map((med) => {
      const durationInfo = getMedicationDurationInfo(med, now);
      const todayDoses = dosesByMedId[med.id] || [];
      const pendingDoses = todayDoses.filter((d) => !takenState[d.doseKey]);
      const takenDoses = todayDoses.filter((d) => !!takenState[d.doseKey]);

      return {
        ...med,
        durationInfo,
        todayDoses,
        pendingDoses,
        takenDoses
      };
    });
  }, [meds, now, dosesByMedId, takenState]);

  // Filtered meds
  const filteredMeds = useMemo(() => {
    return enrichedMeds.filter((m) => {
      const matchSearch =
        m.name.toLowerCase().includes(search.toLowerCase()) ||
        (m.dose && m.dose.toLowerCase().includes(search.toLowerCase()));
      if (!matchSearch) return false;

      if (filter === 'pending_today') {
        return m.pendingDoses.length > 0;
      }
      if (filter === 'active') {
        return medicationStatus(m) === 'active' && !m.durationInfo.isFinished;
      }
      if (filter === 'continuous') {
        return m.durationInfo.isContinuous;
      }
      return true;
    });
  }, [enrichedMeds, search, filter]);

  // Overall statistics
  const totalMeds = meds.length;
  const activeMeds = enrichedMeds.filter((m) => medicationStatus(m) === 'active').length;
  const medsWithPendingToday = enrichedMeds.filter((m) => m.pendingDoses.length > 0).length;

  return (
    <div className="medsViewWrapper">
      {/* Header section */}
      <section className="medsViewHeader">
        <div>
          <h1>Meus Medicamentos</h1>
          <p>Consulte todos os seus tratamentos, previsão de término e doses que faltam hoje.</p>
        </div>

        {editable && (
          <div className="medsHeaderActions">
            <button
              type="button"
              className="aiScanBtn"
              onClick={onOpenAiScanner}
              disabled={saving}
              title="Escanear com IA"
            >
              <Sparkles size={18} />
              <span>Ler Receita com IA</span>
            </button>

            <button
              type="button"
              className="primary"
              onClick={onAddManual}
              disabled={saving}
            >
              <Plus size={18} />
              <span>Novo medicamento</span>
            </button>
          </div>
        )}
      </section>

      {/* KPI Cards */}
      <section className="medsStatsGrid">
        <div
          className={`medsStatCard ${filter === 'all' ? 'activeCard' : ''}`}
          onClick={() => setFilter('all')}
        >
          <div className="statIconWrapper medsTotal">
            <Pill size={22} />
          </div>
          <div>
            <div className="statNum">{totalMeds}</div>
            <div className="statText">Total de Medicamentos</div>
          </div>
        </div>

        <div
          className={`medsStatCard ${filter === 'pending_today' ? 'activeCard' : ''}`}
          onClick={() => setFilter('pending_today')}
        >
          <div className="statIconWrapper medsPending">
            <Clock3 size={22} />
          </div>
          <div>
            <div className="statNum">{medsWithPendingToday}</div>
            <div className="statText">Com doses pendentes hoje</div>
          </div>
        </div>

        <div
          className={`medsStatCard ${filter === 'active' ? 'activeCard' : ''}`}
          onClick={() => setFilter('active')}
        >
          <div className="statIconWrapper medsActive">
            <CheckCircle2 size={22} />
          </div>
          <div>
            <div className="statNum">{activeMeds}</div>
            <div className="statText">Em andamento</div>
          </div>
        </div>
      </section>

      {/* Filter and Search Bar */}
      <div className="medsControlsBar">
        <div className="searchBox">
          <input
            type="search"
            placeholder="Buscar por nome do remédio ou dosagem..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className="filterPills">
          <button
            type="button"
            className={`pillBtn ${filter === 'all' ? 'active' : ''}`}
            onClick={() => setFilter('all')}
          >
            Todos ({totalMeds})
          </button>
          <button
            type="button"
            className={`pillBtn ${filter === 'pending_today' ? 'active' : ''}`}
            onClick={() => setFilter('pending_today')}
          >
            Doses Pendentes Hoje ({medsWithPendingToday})
          </button>
          <button
            type="button"
            className={`pillBtn ${filter === 'continuous' ? 'active' : ''}`}
            onClick={() => setFilter('continuous')}
          >
            Uso Contínuo
          </button>
        </div>
      </div>

      {/* Medication Cards List */}
      <div className="medsCardsList">
        {filteredMeds.length === 0 ? (
          <div className="emptyMedsState">
            <Pill size={48} />
            <h3>Nenhum medicamento encontrado</h3>
            <p>
              {search || filter !== 'all'
                ? 'Tente alterar os filtros ou o termo de busca.'
                : 'Cadastre seus remédios para acompanhar horários e duração de tratamentos.'}
            </p>
            {editable && !search && filter === 'all' && (
              <div className="emptyActions">
                <button type="button" className="aiScanBtn" onClick={onOpenAiScanner}>
                  <Sparkles size={17} /> Ler receita com IA
                </button>
                <button type="button" className="primary" onClick={onAddManual}>
                  <Plus size={17} /> Cadastrar manualmente
                </button>
              </div>
            )}
          </div>
        ) : (
          filteredMeds.map((med) => {
            const { durationInfo, todayDoses, pendingDoses, takenDoses } = med;
            const schedType = medicationScheduleType(med);
            const status = medicationStatus(med);

            return (
              <article key={med.id} className="medDetailedCard">
                <div className="medCardMain">
                  <div className="medCardHeader">
                    <div className="medCardTitleGroup">
                      <div className="medPillIcon">
                        <Pill size={24} />
                      </div>
                      <div>
                        <h2>{med.name}</h2>
                        <span className="medDosage">{med.dose}</span>
                      </div>
                    </div>

                    <div className="medBadgesGroup">
                      {/* Duration badge */}
                      <span className={`durationBadge ${durationInfo.badgeClass}`}>
                        <Calendar size={13} />
                        {durationInfo.statusText}
                      </span>

                      {/* Schedule type badge */}
                      <span className="schedBadge">
                        {schedType === 'asNeeded'
                          ? 'Se necessário (SOS)'
                          : schedType === 'times'
                          ? `${med.times?.length || 0}x ao dia`
                          : `A cada ${med.freq}h`}
                      </span>
                    </div>
                  </div>

                  {/* Body Info Grid */}
                  <div className="medDetailsRow">
                    <div className="medDetailItem">
                      <span className="detailLabel">Frequência / Horários</span>
                      <strong className="detailValue">
                        {schedType === 'asNeeded'
                          ? 'Uso sob demanda'
                          : schedType === 'times'
                          ? (med.times || []).join(', ')
                          : `A cada ${med.freq} horas (Início ${med.start || '08:00'})`}
                      </strong>
                    </div>

                    <div className="medDetailItem">
                      <span className="detailLabel">Duração Total</span>
                      <strong className="detailValue">
                        {durationInfo.isContinuous
                          ? 'Uso contínuo (indeterminado)'
                          : `${med.days} dias ${
                              durationInfo.endDateFormatted ? `(até ${durationInfo.endDateFormatted})` : ''
                            }`}
                      </strong>
                    </div>

                    {med.notes && (
                      <div className="medDetailItem fullWidth">
                        <span className="detailLabel">Instruções / Observações</span>
                        <p className="detailNotes">{med.notes}</p>
                      </div>
                    )}
                  </div>

                  {/* Today's pending doses section */}
                  {schedType !== 'asNeeded' && (
                    <div className="medTodaySchedule">
                      <div className="todaySectionHead">
                        <strong>Doses de Hoje ({todayDoses.length}):</strong>
                        {pendingDoses.length === 0 && todayDoses.length > 0 && (
                          <span className="allDosesTaken">
                            <CheckCircle2 size={14} /> Todas as doses de hoje tomadas!
                          </span>
                        )}
                        {pendingDoses.length > 0 && (
                          <span className="dosesRemainingNotice">
                            Faltam {pendingDoses.length} dose{pendingDoses.length > 1 ? 's' : ''} hoje
                          </span>
                        )}
                      </div>

                      <div className="todayDosesChips">
                        {todayDoses.map((dose) => {
                          const isTaken = !!takenState[dose.doseKey];
                          const isLate = !isTaken && dose.mins < currentMinutes;

                          return (
                            <div
                              key={dose.doseKey}
                              className={`doseChip ${isTaken ? 'taken' : isLate ? 'late' : 'pending'}`}
                            >
                              <span className="doseChipTime">{fmtMinutes(dose.mins)}</span>
                              <span className="doseChipStatus">
                                {isTaken ? 'Tomada' : isLate ? 'Atrasada' : 'Aguardando'}
                              </span>

                              {onToggleDose && (
                                <button
                                  type="button"
                                  className="chipActionBtn"
                                  disabled={saving}
                                  onClick={() => onToggleDose(dose.doseKey)}
                                  title={isTaken ? 'Desfazer dose' : 'Marcar como tomada'}
                                >
                                  {isTaken ? <Play size={13} /> : <Check size={13} />}
                                </button>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>

                {/* Card footer actions */}
                {editable && (
                  <div className="medCardActionsBar">
                    <button
                      type="button"
                      className="editActionBtn"
                      disabled={saving}
                      onClick={() => onEdit(med)}
                    >
                      <Pencil size={15} /> Editar
                    </button>

                    <details className="settingsMenu">
                      <summary title="Mais opções">
                        <Settings size={16} /> Mais opções
                      </summary>
                      <div className="settingsPopover">
                        {status === 'active' && (
                          <button type="button" onClick={() => onStatus(med, 'paused')}>
                            Pausar tratamento
                          </button>
                        )}
                        {status !== 'active' && (
                          <button type="button" onClick={() => onStatus(med, 'active')}>
                            Reativar tratamento
                          </button>
                        )}
                        {status !== 'ended' && (
                          <button type="button" onClick={() => onStatus(med, 'ended')}>
                            Encerrar tratamento
                          </button>
                        )}
                        <button
                          type="button"
                          className="dangerText"
                          onClick={() => onRemove(med)}
                        >
                          Remover definitivamente
                        </button>
                      </div>
                    </details>
                  </div>
                )}
              </article>
            );
          })
        )}
      </div>
    </div>
  );
}
