import {dosesBetween} from './schedule.js';
import {normalizeText} from './mariaLogic.js';

export const MARIA_INTENTS = Object.freeze([
  'list_medications',
  'medication_schedule',
  'today_summary',
  'pending_doses',
  'administered_doses',
  'next_dose',
  'late_doses',
  'last_dose',
  'day_end',
  'ending_treatments',
  'paused_medications',
  'frequently_unconfirmed',
  'completed_treatments',
  'family_pending',
  'family_person_dose',
  'medication_purpose',
  'app_help',
  'health_concern',
  'unsafe_medical_advice',
  'out_of_scope',
  'unknown',
]);

const PERIODS = new Set(['today', 'morning', 'afternoon', 'evening', 'week', 'month', 'none']);
const SCOPES = new Set(['single', 'all', 'self', 'family', 'none']);

export function normalizeMariaIntent(value = {}) {
  const intent = MARIA_INTENTS.includes(value.intent) ? value.intent : 'unknown';
  return {
    intent,
    medication: String(value.medication || '').trim().slice(0, 120),
    person: String(value.person || '').trim().slice(0, 120),
    period: PERIODS.has(value.period) ? value.period : 'none',
    scope: SCOPES.has(value.scope) ? value.scope : 'none',
    confidence: Math.max(0, Math.min(1, Number(value.confidence) || 0)),
  };
}

function boldMedication(item) {
  return `**${item.name}**${item.dose ? ` — ${item.dose}` : ''}`;
}

function periodBounds(period) {
  if (period === 'morning') return [0, 12 * 60];
  if (period === 'afternoon') return [12 * 60, 18 * 60];
  if (period === 'evening') return [18 * 60, 24 * 60];
  return [0, 24 * 60];
}

function minutesFromTime(value) {
  const match = String(value || '').match(/^(\d{1,2}):(\d{2})$/);
  return match ? Number(match[1]) * 60 + Number(match[2]) : -1;
}

function filterPeriod(items, period) {
  const [start, end] = periodBounds(period);
  return items.filter((item) => {
    const minutes = minutesFromTime(item.time);
    return minutes >= start && minutes < end;
  });
}

function findMedication(context, requestedName) {
  const target = normalizeText(requestedName);
  if (!target) return null;
  return context.medications.find((medication) => {
    const name = normalizeText(medication.name);
    return name === target || name.includes(target) || target.includes(name);
  }) || null;
}

function scheduleDescription(medication) {
  if (medication.scheduleType === 'times') {
    return `Horários cadastrados: ${medication.times.join(', ') || 'não informados'}.`;
  }
  if (medication.scheduleType === 'interval') {
    return `Intervalo cadastrado: a cada ${medication.frequencyHours} hora(s), a partir de ${medication.start || 'horário não informado'}.`;
  }
  return 'Uso quando necessário, sem horário fixo cadastrado.';
}

function familyPending(intent, familyAgendas, now) {
  const start = new Date(now); start.setHours(0, 0, 0, 0);
  const end = new Date(start); end.setDate(end.getDate() + 1);
  const [periodStart, periodEnd] = periodBounds(intent.period);
  const targetPerson = normalizeText(intent.person);
  const entries = familyAgendas
    .filter((person) => !targetPerson || normalizeText(person.name).includes(targetPerson) || targetPerson.includes(normalizeText(person.name)))
    .flatMap((person) => dosesBetween(person.meds || [], start, end)
      .filter((dose) => dose.mins >= periodStart && dose.mins < periodEnd && !person.taken?.[dose.doseKey])
      .map((dose) => ({person: person.name, name: dose.name, time: `${String(Math.floor(dose.mins / 60)).padStart(2, '0')}:${String(dose.mins % 60).padStart(2, '0')}`})));
  return entries.length
    ? `Pendências da família nesse período:\n${entries.map((item) => `• **${item.person}** — ${item.time}, **${item.name}**`).join('\n')}`
    : 'Não encontrei doses pendentes da família nesse período.';
}

export function answerStructuredMariaIntent(intentInput, context, familyAgendas = [], now = new Date()) {
  const intent = normalizeMariaIntent(intentInput);
  const active = context.medications.filter((medication) => medication.status === 'active');
  switch (intent.intent) {
    case 'list_medications':
      return active.length
        ? `Seus medicamentos ativos são:\n${active.map((medication) => `• ${boldMedication(medication)}`).join('\n')}`
        : 'Você não tem medicamentos ativos cadastrados.';
    case 'medication_schedule': {
      const medication = findMedication(context, intent.medication);
      if (!medication) return intent.medication
        ? `Não encontrei “${intent.medication}” na sua agenda. Confira o nome ou envie um receituário para cadastrar.`
        : 'Qual medicamento da sua agenda você quer consultar?';
      const taken = context.today.takenItems.filter((item) => normalizeText(item.name) === normalizeText(medication.name));
      const pending = context.today.pendingItems.filter((item) => normalizeText(item.name) === normalizeText(medication.name));
      return `Segundo a sua agenda:\n\n• ${boldMedication(medication)}\n• ${scheduleDescription(medication)}\n• Hoje: ${taken.length} administrada(s) e ${pending.length} pendente(s)${pending.length ? ` (${pending.map((item) => item.time).join(', ')})` : ''}.\n\nEstou apenas reproduzindo o que está cadastrado, sem alterar a prescrição.`;
    }
    case 'today_summary':
      return `Hoje há ${context.today.total} dose(s) prevista(s): ${context.today.taken} administrada(s) e ${context.today.pending} pendente(s).`;
    case 'pending_doses': {
      const pending = filterPeriod(context.today.pendingItems, intent.period);
      return pending.length
        ? `Ainda estão pendentes:\n${pending.map((item) => `• **${item.time}** — **${item.name}**`).join('\n')}`
        : 'Não há doses pendentes nesse período.';
    }
    case 'administered_doses': {
      const taken = filterPeriod(context.today.takenItems, intent.period);
      return taken.length
        ? `Doses confirmadas nesse período:\n${taken.map((item) => `• **${item.time}** — **${item.name}**`).join('\n')}`
        : 'Não há doses confirmadas nesse período.';
    }
    case 'next_dose': {
      const next = context.today.pendingItems[0];
      return next ? `Sua próxima dose pendente é **${next.name}**, às **${next.time}**.` : 'Não há outra dose pendente hoje.';
    }
    case 'late_doses':
      return context.today.lateItems.length
        ? `Estão atrasadas na agenda de hoje:\n${context.today.lateItems.map((item) => `• **${item.name}**, prevista para **${item.time}**`).join('\n')}`
        : 'Não há doses atrasadas na agenda de hoje.';
    case 'last_dose':
      return context.lastTaken
        ? `Sua última dose confirmada foi **${context.lastTaken.name}**, em **${context.lastTaken.date} às ${context.lastTaken.time}**.`
        : 'Não encontrei dose confirmada nos últimos 60 dias.';
    case 'day_end':
      return context.today.lastScheduledTime ? `O último horário previsto hoje é **${context.today.lastScheduledTime}**.` : 'Não há horários previstos hoje.';
    case 'ending_treatments':
      return context.endingThisWeek.length
        ? `Tratamentos com término cadastrado nesta semana:\n${context.endingThisWeek.map((item) => `• **${item.name}** — ${item.date}`).join('\n')}`
        : 'Nenhum tratamento ativo tem término cadastrado para esta semana.';
    case 'paused_medications':
      return context.paused.length ? `Medicamentos pausados:\n${context.paused.map((name) => `• **${name}**`).join('\n')}` : 'Você não tem medicamentos pausados.';
    case 'frequently_unconfirmed':
      return context.frequentlyMissed.length
        ? `Nos últimos 30 dias, estes medicamentos tiveram mais horários sem confirmação:\n${context.frequentlyMissed.map((item) => `• **${item.name}** — ${item.count} horário(s)`).join('\n')}\n\n“Sem confirmação” não significa necessariamente que a dose não foi administrada.`
        : 'Não encontrei horários passados sem confirmação nos últimos 30 dias.';
    case 'completed_treatments':
      return context.completedTreatments.length
        ? `Tratamentos concluídos que podem ser arquivados:\n${context.completedTreatments.map((name) => `• **${name}**`).join('\n')}`
        : 'Não encontrei tratamento concluído aguardando arquivamento.';
    case 'family_pending':
    case 'family_person_dose':
      return familyPending(intent, familyAgendas, now);
    case 'app_help':
      return 'Posso consultar sua agenda, medicamentos, horários, registros, relatórios, lembretes, vínculos familiares e leitura de receituários. Diga com suas palavras o que deseja saber.';
    default:
      return '';
  }
}
