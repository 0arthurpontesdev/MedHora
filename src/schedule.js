export const pad = n => String(n).padStart(2, '0');
export const localDateKey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;

export function medicationStatus(med) {
  return med.status || 'active';
}

export function medicationScheduleType(med) {
  if (med.asNeeded || Number(med.freq) <= 0) return 'asNeeded';
  return med.scheduleType || 'interval';
}

function customDosesBetween(med, from, until) {
  const result=[];
  const times=Array.isArray(med.times) ? med.times : [];
  const firstDay=new Date(`${med.date}T00:00:00`);
  if (!Number.isFinite(+firstDay) || !times.length) return result;
  const end=new Date(firstDay);end.setDate(end.getDate()+Number(med.days));
  for(let day=new Date(firstDay);day<end;day.setDate(day.getDate()+1)) {
    for(const time of times) {
      if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(time))continue;
      const [hour,minute]=time.split(':').map(Number);
      const at=new Date(day);at.setHours(hour,minute,0,0);
      if(at>=from&&at<until)result.push({...med,at:+at,mins:hour*60+minute,doseKey:`${localDateKey(at)}-${med.id}-${hour*60+minute}`});
    }
  }
  return result;
}

export function dosesBetween(meds, from, until, options={}) {
  const result = [];
  for (const med of meds) {
    if((!options.includeInactive&&medicationStatus(med)!=='active')||medicationScheduleType(med)==='asNeeded')continue;
    if(medicationScheduleType(med)==='times') {result.push(...customDosesBetween(med,from,until));continue;}
    const start = new Date(med.startsAt || `${localDateKey(new Date(med.created))}T${med.start}`);
    const step = Number(med.freq) * 3600000;
    const end = +start + Number(med.days) * 86400000;
    if (!Number.isFinite(+start) || !Number.isFinite(step) || step < 3600000 || !Number.isFinite(end)) continue;
    for (let t = +start + Math.max(0, Math.ceil((+from - start) / step)) * step; t < Math.min(end, +until); t += step) {
      const date = new Date(t);
      const mins = date.getHours()*60 + date.getMinutes();
      result.push({...med, at: t, mins, doseKey: `${localDateKey(date)}-${med.id}-${mins}`});
    }
  }
  return result.sort((a,b) => a.at-b.at);
}

export function getMedicationDurationInfo(med, now = new Date()) {
  const status = medicationStatus(med);
  if (status !== 'active') {
    return {
      statusText: status === 'paused' ? 'Pausado' : 'Encerrado',
      badgeClass: 'status-inactive',
      daysLeft: 0,
      isContinuous: false,
      isFinished: true,
      endDateFormatted: null
    };
  }

  const daysTotal = Number(med.days) || 0;
  // If days >= 365 or not specified or 0, treat as continuous treatment
  if (!daysTotal || daysTotal >= 365) {
    return {
      statusText: 'Uso contínuo',
      badgeClass: 'status-continuous',
      daysLeft: Infinity,
      isContinuous: true,
      isFinished: false,
      endDateFormatted: null
    };
  }

  // Calculate start date
  let startDate = null;
  if (med.date) {
    startDate = new Date(`${med.date}T00:00:00`);
  } else if (med.startsAt) {
    startDate = new Date(med.startsAt);
  } else if (med.created) {
    startDate = new Date(med.created);
  }

  if (!startDate || isNaN(+startDate)) {
    startDate = new Date(now);
  }

  const endDate = new Date(startDate);
  endDate.setDate(endDate.getDate() + daysTotal);

  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);

  const endDayStart = new Date(endDate);
  endDayStart.setHours(0, 0, 0, 0);

  const msPerDay = 86400000;
  const diffDays = Math.ceil((endDayStart.getTime() - todayStart.getTime()) / msPerDay);

  const endDateFormatted = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(endDate);

  if (diffDays <= 0) {
    return {
      statusText: 'Tratamento concluído',
      badgeClass: 'status-finished',
      daysLeft: 0,
      isContinuous: false,
      isFinished: true,
      endDateFormatted
    };
  }

  if (diffDays === 1) {
    return {
      statusText: 'Último dia hoje!',
      badgeClass: 'status-warning',
      daysLeft: 1,
      isContinuous: false,
      isFinished: false,
      endDateFormatted
    };
  }

  return {
    statusText: `Restam ${diffDays} dias`,
    badgeClass: diffDays <= 3 ? 'status-warning' : 'status-active',
    daysLeft: diffDays,
    isContinuous: false,
    isFinished: false,
    endDateFormatted
  };
}
