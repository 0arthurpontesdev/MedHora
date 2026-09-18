const VALID_INTERVALS = new Set([6, 8, 12, 24]);
const VALID_TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export const FIELD_LABELS = {
  name: 'nome do medicamento',
  dose: 'dose / instrução',
  frequency: 'frequência',
  duration: 'duração',
  start: 'primeiro horário',
  times: 'horários',
};

export function getMedicationReview(med = {}) {
  const required = [];
  const optional = [];
  const scheduleType = med.scheduleType || 'unknown';

  if (!String(med.name || '').trim()) required.push('name');
  if (scheduleType === 'unknown') required.push('frequency');

  if (scheduleType === 'interval') {
    if (!VALID_INTERVALS.has(Number(med.freq))) required.push('frequency');
    if (!VALID_TIME.test(String(med.start || ''))) required.push('start');
  }

  if (scheduleType === 'times') {
    const times = Array.isArray(med.times) ? med.times : [];
    if (!times.length || times.some((time) => !VALID_TIME.test(String(time)))) required.push('times');
  }

  if (!String(med.dose || '').trim()) optional.push('dose');
  if (!(Number(med.days) >= 1 && Number(med.days) <= 365)) optional.push('duration');

  return {
    required: [...new Set(required)],
    optional: [...new Set(optional)],
    canRegister: required.length === 0,
  };
}

export function formatFieldList(fields = []) {
  return fields.map((field) => FIELD_LABELS[field] || field).join(', ');
}
