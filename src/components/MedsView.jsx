import React, {useMemo, useState} from 'react';
import {Calendar, Check, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, Clock3, Pencil, Pill, Plus, RotateCcw, Settings, Sparkles} from 'lucide-react';
import {dosesBetween, getMedicationDurationInfo, localDateKey, medicationScheduleType, medicationStatus, pad} from '../schedule.js';

const fmtMinutes = (minutes) => `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
function dateFromKey(value) { const [y,m,d]=String(value).split('-').map(Number); return new Date(y,m-1,d,12,0,0,0); }
function shiftDate(value, amount) { const date=dateFromKey(value); date.setDate(date.getDate()+amount); return localDateKey(date); }
function medicationStartDate(med) { const raw=med.date?`${med.date}T00:00:00`:med.startsAt||med.created;const date=new Date(raw);if(!Number.isFinite(+date))return null;date.setHours(0,0,0,0);return date; }
function isMedicationActiveOnDate(med,date) { if(medicationStatus(med)!=='active')return false;const start=medicationStartDate(med);if(start&&date<start)return false;const days=Number(med.days)||0;if(!start||!days||days>=365)return true;const end=new Date(start);end.setDate(end.getDate()+days);return date<end; }
function calendarDays(month) { const first=new Date(month.getFullYear(),month.getMonth(),1);const start=new Date(first);start.setDate(start.getDate()-start.getDay());return Array.from({length:42},(_,index)=>{const date=new Date(start);date.setDate(start.getDate()+index);return date;}); }

export function MedsView({meds,takenState,editable,saving,now,onAddManual,onOpenAiScanner,onEdit,onStatus,onRemove,onToggleDose}) {
  const [filter,setFilter]=useState('all');
  const [search,setSearch]=useState('');
  const [selectedDate,setSelectedDate]=useState(()=>localDateKey(now));
  const [expandedIds,setExpandedIds]=useState(()=>new Set());
  const [calendarOpen,setCalendarOpen]=useState(false);
  const [calendarMonth,setCalendarMonth]=useState(()=>dateFromKey(localDateKey(now)));
  const todayKey=localDateKey(now);
  const selectedDay=useMemo(()=>{const start=dateFromKey(selectedDate);start.setHours(0,0,0,0);const end=new Date(start);end.setDate(end.getDate()+1);return {start,end};},[selectedDate]);
  const dateLabel=selectedDate===todayKey?'Hoje':new Intl.DateTimeFormat('pt-BR',{weekday:'short',day:'2-digit',month:'short'}).format(selectedDay.start);
  const allDayDoses=useMemo(()=>dosesBetween(meds,selectedDay.start,selectedDay.end),[meds,selectedDay]);
  const dosesByMedId=useMemo(()=>{const grouped={};allDayDoses.forEach(dose=>{if(!grouped[dose.id])grouped[dose.id]=[];grouped[dose.id].push(dose);});return grouped;},[allDayDoses]);
  const enrichedMeds=useMemo(()=>meds.map(med=>{const dayDoses=dosesByMedId[med.id]||[],activeOnDate=isMedicationActiveOnDate(med,selectedDay.start),start=medicationStartDate(med);let durationInfo=getMedicationDurationInfo(med,selectedDay.start);if(medicationStatus(med)==='active'&&!activeOnDate&&start&&selectedDay.start<start)durationInfo={...durationInfo,statusText:`Inicia em ${start.toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit'})}`,badgeClass:'status-inactive'};return {...med,activeOnDate,durationInfo,dayDoses,pendingDoses:dayDoses.filter(dose=>!takenState[dose.doseKey])};}),[meds,selectedDay,dosesByMedId,takenState]);
  const filteredMeds=useMemo(()=>enrichedMeds.filter(med=>{const term=search.trim().toLowerCase();if(term&&!med.name.toLowerCase().includes(term)&&!String(med.dose||'').toLowerCase().includes(term))return false;if(filter==='pending_day')return med.pendingDoses.length>0;if(filter==='active')return med.activeOnDate;if(filter==='continuous')return med.durationInfo.isContinuous;return true;}),[enrichedMeds,search,filter]);
  const activeMeds=enrichedMeds.filter(med=>med.activeOnDate).length;
  const medsWithPending=enrichedMeds.filter(med=>med.pendingDoses.length>0).length;
  const currentMinutes=now.getHours()*60+now.getMinutes();
  const toggleExpanded=id=>setExpandedIds(current=>{const next=new Set(current);if(next.has(id))next.delete(id);else next.add(id);return next;});
  const chooseDate=date=>{setSelectedDate(localDateKey(date));setCalendarMonth(new Date(date));setCalendarOpen(false);};
  const moveSelectedDate=amount=>{const value=shiftDate(selectedDate,amount);setSelectedDate(value);setCalendarMonth(dateFromKey(value));};
  const rawCalendarTitle=new Intl.DateTimeFormat('pt-BR',{month:'long',year:'numeric'}).format(calendarMonth);
  const calendarTitle=rawCalendarTitle.charAt(0).toUpperCase()+rawCalendarTitle.slice(1);

  return <div className="medsViewWrapper">
    <section className="medsViewHeader">
      <div><p className="eyebrow"><Pill size={15}/> TRATAMENTOS</p><h1>Meus medicamentos</h1><p>Consulte tratamentos, horários, duração e registros de cada data.</p></div>
      {editable&&<div className="medsHeaderActions"><button type="button" className="agendaAiButton" onClick={onOpenAiScanner} disabled={saving}><Sparkles size={18}/> Ler com a M.A.R.I.A.</button><button type="button" className="primary" onClick={onAddManual} disabled={saving}><Plus size={18}/> Novo medicamento</button></div>}
    </section>

    <section className="medsStatsGrid" aria-label="Resumo dos medicamentos">
      <button type="button" className={`medsStatCard ${filter==='all'?'activeCard':''}`} onClick={()=>setFilter('all')}><span className="statIconWrapper medsTotal"><Pill size={21}/></span><span><strong className="statNum">{meds.length}</strong><span className="statText">Cadastrados</span></span></button>
      <button type="button" className={`medsStatCard ${filter==='pending_day'?'activeCard':''}`} onClick={()=>setFilter('pending_day')}><span className="statIconWrapper medsPending"><Clock3 size={21}/></span><span><strong className="statNum">{medsWithPending}</strong><span className="statText">Pendentes na data</span></span></button>
      <button type="button" className={`medsStatCard ${filter==='active'?'activeCard':''}`} onClick={()=>setFilter('active')}><span className="statIconWrapper medsActive"><CheckCircle2 size={21}/></span><span><strong className="statNum">{activeMeds}</strong><span className="statText">Tratamentos na data</span></span></button>
    </section>

    <section className="medsControlsPanel" aria-label="Filtros dos medicamentos">
      <div className="medsDateControl"><span className="controlLabel">Data das doses</span><div className="dateControlRow"><button type="button" onClick={()=>moveSelectedDate(-1)} aria-label="Dia anterior"><ChevronLeft size={18}/></button><button type="button" className="datePickerButton" onClick={()=>setCalendarOpen(value=>!value)} aria-expanded={calendarOpen}><Calendar size={16}/><span>{dateLabel}</span></button><button type="button" onClick={()=>moveSelectedDate(1)} aria-label="Próximo dia"><ChevronRight size={18}/></button>{selectedDate!==todayKey&&<button type="button" className="todayShortcut" onClick={()=>chooseDate(dateFromKey(todayKey))}>Hoje</button>}</div>{calendarOpen&&<div className="medhoraCalendar" role="dialog" aria-label="Selecionar data"><header><button type="button" onClick={()=>setCalendarMonth(current=>new Date(current.getFullYear(),current.getMonth()-1,1))} aria-label="Mês anterior"><ChevronLeft size={17}/></button><strong>{calendarTitle}</strong><button type="button" onClick={()=>setCalendarMonth(current=>new Date(current.getFullYear(),current.getMonth()+1,1))} aria-label="Próximo mês"><ChevronRight size={17}/></button></header><div className="calendarWeek"><span>D</span><span>S</span><span>T</span><span>Q</span><span>Q</span><span>S</span><span>S</span></div><div className="calendarGrid">{calendarDays(calendarMonth).map(date=>{const key=localDateKey(date);return <button type="button" key={key} className={`${date.getMonth()!==calendarMonth.getMonth()?'outside':''} ${key===todayKey?'today':''} ${key===selectedDate?'selected':''}`} onClick={()=>chooseDate(date)} aria-label={date.toLocaleDateString('pt-BR')}>{date.getDate()}</button>;})}</div></div>}</div>
      <label className="medsSearchBox"><span className="controlLabel">Buscar</span><input type="search" placeholder="Nome ou dosagem" value={search} onChange={event=>setSearch(event.target.value)}/></label>
      <div className="filterPills" aria-label="Filtrar tratamentos"><button type="button" className={`pillBtn ${filter==='all'?'active':''}`} onClick={()=>setFilter('all')}>Todos</button><button type="button" className={`pillBtn ${filter==='pending_day'?'active':''}`} onClick={()=>setFilter('pending_day')}>Pendentes</button><button type="button" className={`pillBtn ${filter==='continuous'?'active':''}`} onClick={()=>setFilter('continuous')}>Uso contínuo</button></div>
    </section>

    <div className="medsCardsList">
      {filteredMeds.length===0?<div className="emptyMedsState"><Pill size={44}/><h3>Nenhum medicamento encontrado</h3><p>{search||filter!=='all'?'Altere a data, os filtros ou a busca.':'Cadastre seus medicamentos para acompanhar o tratamento.'}</p></div>:filteredMeds.map(med=>{
        const expanded=expandedIds.has(med.id),scheduleType=medicationScheduleType(med),status=medicationStatus(med),{durationInfo,dayDoses,pendingDoses}=med;
        return <article key={med.id} className={`medDetailedCard ${expanded?'expanded':''}`}>
          <button type="button" className="medCardToggle" onClick={()=>toggleExpanded(med.id)} aria-expanded={expanded}>
            <span className="medCardTitleGroup"><span className="medPillIcon"><Pill size={21}/></span><span className="medTitleText"><strong>{med.name}</strong><small>{med.dose||'Dose não informada'}</small></span></span>
            <span className="medCardSummary"><span className={`durationBadge ${durationInfo.badgeClass}`}><Calendar size={13}/>{durationInfo.statusText}</span><span className="schedBadge">{scheduleType==='asNeeded'?'Se necessário':scheduleType==='times'?`${med.times?.length||0} horários`:`A cada ${med.freq}h`}</span><ChevronDown className={`expandChevron ${expanded?'rotated':''}`} size={20}/></span>
          </button>
          {expanded&&<div className="medCardExpandable">
            <div className="medDetailsRow"><div className="medDetailItem"><span className="detailLabel">Frequência e horários</span><strong className="detailValue">{scheduleType==='asNeeded'?'Uso sob demanda':scheduleType==='times'?(med.times||[]).join(', '):`A cada ${med.freq} horas • início ${med.start||'não informado'}`}</strong></div><div className="medDetailItem"><span className="detailLabel">Duração</span><strong className="detailValue">{durationInfo.isContinuous?'Uso contínuo':`${med.days||'—'} dia(s)${durationInfo.endDateFormatted?` • até ${durationInfo.endDateFormatted}`:''}`}</strong></div>{med.notes&&<div className="medDetailItem fullWidth"><span className="detailLabel">Observações</span><p className="detailNotes">{med.notes}</p></div>}</div>
            {scheduleType!=='asNeeded'&&<div className="medDaySchedule"><div className="todaySectionHead"><strong>Doses de {dateLabel.toLowerCase()}</strong>{dayDoses.length>0&&pendingDoses.length===0&&<span className="allDosesTaken"><CheckCircle2 size={14}/> Todas administradas</span>}{pendingDoses.length>0&&<span className="dosesRemainingNotice">{pendingDoses.length} pendente(s)</span>}</div>{dayDoses.length===0?<p className="noDosesForDate">Nenhuma dose programada para esta data.</p>:<div className="todayDosesChips">{dayDoses.map(dose=>{const administered=Boolean(takenState[dose.doseKey]);const late=selectedDate===todayKey&&!administered&&dose.mins<currentMinutes;return <div key={dose.doseKey} className={`doseChip ${administered?'taken':late?'late':'pending'}`}><span className="doseChipTime">{fmtMinutes(dose.mins)}</span><span className="doseChipStatus">{administered?'Administrada':late?'Atrasada':'Aguardando'}</span>{onToggleDose&&<button type="button" className="chipActionBtn" disabled={saving} onClick={()=>onToggleDose(dose)} title={administered?'Desfazer registro':'Marcar como administrada'}>{administered?<RotateCcw size={13}/>:<Check size={13}/>}<span>{administered?'Desfazer':'Confirmar'}</span></button>}</div>;})}</div>}</div>}
            {editable&&<div className="medCardActionsBar"><button type="button" className="editActionBtn" disabled={saving} onClick={()=>onEdit(med)}><Pencil size={15}/> Editar</button><details className="medOptionsMenu"><summary><Settings size={16}/> Configurações <ChevronDown size={14}/></summary><div className="medOptionsPopover">{status==='active'&&<button type="button" onClick={()=>onStatus(med,'paused')}>Pausar tratamento</button>}{status!=='active'&&<button type="button" onClick={()=>onStatus(med,'active')}>Reativar tratamento</button>}{status!=='ended'&&<button type="button" onClick={()=>onStatus(med,'ended')}>Encerrar tratamento</button>}<button type="button" className="dangerText" onClick={()=>onRemove(med)}>Remover definitivamente</button></div></details></div>}
          </div>}
        </article>;
      })}
    </div>
  </div>;
}
