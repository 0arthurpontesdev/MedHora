import {dosesBetween, medicationScheduleType, medicationStatus, pad} from './schedule.js';

export function normalizeText(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function formatTime(minutes) {
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}

export function buildMariaAgendaContext(meds, takenState, now = new Date()) {
  const dayStart = new Date(now);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);
  const todayDoses = dosesBetween(meds, dayStart, dayEnd);
  const taken = todayDoses.filter((dose) => Boolean(takenState[dose.doseKey]));
  const pending = todayDoses.filter((dose) => !takenState[dose.doseKey]);
  const pastStart=new Date(dayStart);pastStart.setDate(pastStart.getDate()-60);
  const recentTaken=dosesBetween(meds,pastStart,now,{includeInactive:true})
    .filter(dose=>Boolean(takenState[dose.doseKey])).sort((a,b)=>b.at-a.at);
  const weekStart=new Date(dayStart);weekStart.setDate(weekStart.getDate()-weekStart.getDay());
  const weekEnd=new Date(weekStart);weekEnd.setDate(weekEnd.getDate()+7);
  const endingThisWeek=meds.filter(med=>{
    const days=Number(med.days)||0;if(!days||!med.date)return false;
    const end=new Date(`${med.date}T12:00:00`);end.setDate(end.getDate()+days-1);
    return end>=weekStart&&end<weekEnd;
  }).map(med=>{const end=new Date(`${med.date}T12:00:00`);end.setDate(end.getDate()+Number(med.days)-1);return {name:med.name,date:localDateLabel(end)};});
  const analysisStart=new Date(dayStart);analysisStart.setDate(analysisStart.getDate()-30);
  const missedByMedication=new Map();
  dosesBetween(meds,analysisStart,now,{includeInactive:true}).filter(dose=>dose.at<=now&&!takenState[dose.doseKey]).forEach(dose=>missedByMedication.set(dose.name,(missedByMedication.get(dose.name)||0)+1));
  const frequentlyMissed=[...missedByMedication.entries()].sort((a,b)=>b[1]-a[1]).slice(0,5).map(([name,count])=>({name,count}));
  const completedTreatments=meds.filter(med=>med.status==='active'&&Number(med.days)>0).filter(med=>{const start=new Date(`${med.date}T00:00:00`);return Number.isFinite(+start)&&(+start+Number(med.days)*86400000)<=+dayStart;}).map(med=>med.name);

  return {
    medications: meds.slice(0, 50).map((med) => ({
      name: String(med.name || '').slice(0, 120),
      dose: String(med.dose || '').slice(0, 200),
      status: medicationStatus(med),
      scheduleType: medicationScheduleType(med),
      frequencyHours: Number(med.freq) || 0,
      start: String(med.start || '').slice(0,5),
      times: Array.isArray(med.times) ? med.times.slice(0, 8) : [],
      date: String(med.date||''),
      days: Number(med.days)||0,
    })),
    today: {
      total: todayDoses.length,
      taken: taken.length,
      pending: pending.length,
      takenItems: taken.map((dose) => ({name: dose.name, time: formatTime(dose.mins)})),
      pendingItems: pending.map((dose) => ({name: dose.name, time: formatTime(dose.mins)})),
      lateItems: pending.filter(dose=>dose.at<now).map(dose=>({name:dose.name,time:formatTime(dose.mins)})),
      lastScheduledTime: todayDoses.length?formatTime(todayDoses[todayDoses.length-1].mins):'',
    },
    lastTaken: recentTaken[0]?{name:recentTaken[0].name,time:formatTime(recentTaken[0].mins),date:localDateLabel(new Date(recentTaken[0].at))}:null,
    paused: meds.filter(med=>medicationStatus(med)==='paused').map(med=>med.name),
    endingThisWeek,
    frequentlyMissed,
    completedTreatments,
  };
}

export function answerFamilyAgendaQuestion(question,familyAgendas=[],now=new Date()){
  const text=normalizeText(question);
  if(!familyAgendas.length)return '';
  const mentionsFamily=/(familia|familiar|quem|filho|filha|dependente)/.test(text)||familyAgendas.some(person=>normalizeText(person.name).split(' ').some(part=>part.length>=3&&text.includes(part)));
  if(!mentionsFamily)return '';
  const start=new Date(now);start.setHours(0,0,0,0);const end=new Date(start);end.setDate(end.getDate()+1);
  const people=familyAgendas.map(person=>({...person,doses:dosesBetween(person.meds||[],start,end)}));
  const timeMatch=text.match(/\b([01]?\d|2[0-3])(?::|h)([0-5]\d)?\b/);
  const named=people.find(person=>normalizeText(person.name).split(' ').some(part=>part.length>=3&&text.includes(part)));
  if(named&&/(ja|administr|tomou|tomado|dose)/.test(text)){
    const targetMinutes=timeMatch?Number(timeMatch[1])*60+Number(timeMatch[2]||0):null;
    const matches=named.doses.filter(dose=>targetMinutes===null||Math.abs(dose.mins-targetMinutes)<=30);
    if(!matches.length)return `Não encontrei dose de **${named.name}** nesse horário hoje.`;
    return matches.map(dose=>named.taken?.[dose.doseKey]?`Sim. **${named.name}** tem ${dose.name} das ${formatTime(dose.mins)} marcado como administrado.`:`Ainda não há confirmação de que **${named.name}** administrou ${dose.name} das ${formatTime(dose.mins)}.`).join('\n');
  }
  if(/quem.*(medicamento|remedio|dose)|familia.*(agora|manha|tarde|noite)/.test(text)){
    let min=0,max=1440;if(/manha/.test(text)){max=12*60;}else if(/tarde/.test(text)){min=12*60;max=18*60;}else if(/noite/.test(text)){min=18*60;}else if(/agora/.test(text)){const current=now.getHours()*60+now.getMinutes();min=current-30;max=current+30;}
    const pending=people.flatMap(person=>person.doses.filter(dose=>dose.mins>=min&&dose.mins<max&&!person.taken?.[dose.doseKey]).map(dose=>({person:person.name,...dose})));
    return pending.length?`Pendências da família nesse período:\n${pending.map(item=>`• **${item.person}** — ${formatTime(item.mins)}, ${item.name}`).join('\n')}`:'Não encontrei doses pendentes da família nesse período.';
  }
  return '';
}

function localDateLabel(date){return new Intl.DateTimeFormat('pt-BR',{day:'2-digit',month:'2-digit'}).format(date);}

export function extractMedicationSubject(question) {
  const original=String(question||'').trim();
  const searchable=original.replace(/(\d),(?=\d)/g,'$1__DECIMAL_COMMA__').replace(/(\d)\.(?=\d)/g,'$1__DECIMAL_DOT__');
  const normalized=normalizeText(original);
  if(/(?:para que serve[m]?|para q serve[m]?|pra que serve[m]?|pra q serve[m]?|qual.*funcao).*(meus|todos os).*(medicamentos|remedios)/.test(normalized))return '';
  const patterns=[
    /(?:para que serve|pra que serve|pra q serve|para q serve|qual (?:é )?a fun(?:ç|c)[aã]o d[oa])\s+(?:rem[eé]dio |medicamento |o |a )?([^?.,!]+)/i,
    /(?:o que [eé]|oq [eé]|o q [eé])\s+(?:o |a |rem[eé]dio |medicamento )?([^?.,!]+)/i,
    /(?:sobre|bula d[oa]|efeitos? d[oa]|intera(?:ç|c)[aã]o d[oa]|contraindica(?:ç|c)[aã]o d[oa])\s+([^?.,!]+)/i,
  ];
  for(const pattern of patterns){
    const match=searchable.match(pattern);if(!match)continue;
    const value=match[1]
      .replace(/__DECIMAL_COMMA__/g,',')
      .replace(/__DECIMAL_DOT__/g,'.')
      .replace(/\b(?:por favor|pra mim|para mim|hoje)\b.*$/i,'')
      .trim();
    if(!/^(?:(?:todos os )?meus? )?(?:medicamentos?|rem[eé]dios?)$/i.test(value)&&value.length>=2)return value.slice(0,120);
  }
  return '';
}

export function findMentionedMedication(question,medications=[]) {
  const text=normalizeText(question);
  return medications.find(med=>{const name=normalizeText(med.name);return name.length>=3&&text.includes(name);})||null;
}

export function answerMariaProfileQuestion(question) {
  const text=normalizeText(question).replace(/[^a-z0-9 ]/g,' ').replace(/\s+/g,' ').trim();
  if(/(por que|porque|pq).*(chama|nome).*m\s*a\s*r\s*i\s*a|o que significa.*m\s*a\s*r\s*i\s*a|significado.*m\s*a\s*r\s*i\s*a|quem (e|eh) (a )?m\s*a\s*r\s*i\s*a/.test(text)){
    return 'Meu nome é M.A.R.I.A., sigla de Mecanismo de Apoio para Registro e Informação Assistencial.\n\nFui criada para ajudar você a registrar medicamentos, consultar sua agenda e acompanhar a rotina com mais clareza e tranquilidade.';
  }
  if(/^(oi|ola|bom dia|boa tarde|boa noite|e ai|opa)$/.test(text)){
    return 'Olá! Que bom ter você por aqui. Posso conferir sua agenda, seus horários, doses administradas ou ajudar a cadastrar um receituário. Como posso ajudar?';
  }
  if(/(o que voce (faz|pode fazer)|como voce pode ajudar|quais.*funcoes|ajuda|menu de ajuda)/.test(text)){
    return 'Posso ajudar com:\n\n• medicamentos e horários cadastrados;\n• doses administradas e pendentes;\n• leitura de receituário por imagem;\n• informações gerais sobre medicamentos, com fontes;\n• organização da agenda e acompanhamento familiar.\n\nNão faço diagnósticos nem indico mudanças no tratamento.';
  }
  if(/(como|quero).*(cadastrar|adicionar).*(receita|receituario|medicamento)/.test(text)){
    return 'Você pode tocar em “Anexar receituário” aqui na conversa. Eu leio a imagem, mostro os campos encontrados e você confere tudo antes de cadastrar. Também é possível usar “Adicionar medicamento” para preencher manualmente.';
  }
  if(/(como funciona|como usar).*(lembrete|notificacao|aviso)/.test(text)){
    return 'Os lembretes usam os horários salvos na sua agenda. Na área “Celular”, você pode ativar notificações neste aparelho. Confira também se o navegador permitiu notificações para o MedHora.';
  }
  if(/(como|quero).*(adicionar|convidar|acompanhar).*(familiar|familia)/.test(text)) return 'Abra a área “Família”, informe o e-mail da pessoa e gere um convite. Compartilhe o código somente com o familiar autorizado.';
  if(/(como|onde).*(ativar|configurar).*(notificacao|celular)/.test(text)) return 'Abra a área “Celular”, toque em ativar notificações e permita os avisos quando o navegador solicitar.';
  if(/(como|onde).*(exportar|baixar|salvar).*(agenda|backup|dados)/.test(text)) return 'Abra a área “Backup” e toque em “Baixar backup”. O arquivo guarda medicamentos e registros da agenda.';
  if(/(como|posso|quero).*(gerar|exportar|baixar).*(relatorio|pdf).*(medicamento|dose|medico|consulta|7 dias|mes)/.test(text)||/(relatorio|pdf).*(consulta|medico|medicamento)/.test(text)) return 'Abra “Histórico” e toque em “Gerar PDF” para os últimos 7 dias. Na área “Backup”, você também pode gerar o relatório do mês, com horários previstos, horários reais, doses sem confirmação e registros fora do horário.';
  if(/onde.*(dose|doses).*(sem confirmacao|nao confirmad|esquecid)|onde.*sem confirmacao/.test(text)) return 'Abra “Histórico” e selecione o filtro “Sem confirmação”. Ele mostra os horários que já passaram e ainda não foram confirmados.';
  if(/(obrigad|valeu|agradecid)/.test(text)) return 'Por nada! Fico feliz em ajudar. Quando precisar, é só me chamar.';
  if(/(como voce esta|tudo bem com voce|como vai voce)/.test(text)) return 'Estou pronta para ajudar você. Como está sua rotina hoje? Posso conferir a agenda, os horários ou os registros.';
  if(/^(tchau|ate mais|ate logo|falou)$/.test(text)) return 'Até mais! Cuide-se e conte comigo para acompanhar sua agenda.';
  return '';
}

export function outOfScopeResponse(question) {
  const text=normalizeText(question);
  const inScope=/(medicamento|remedio|dose|agenda|horario|tratamento|receita|receituario|bula|notificacao|lembrete|familiar|familia|saude|sintoma|reacao|tomei|administr|aplicar|colirio|comprimido|capsula|xarope|para que serve|efeito colateral|contraindicacao|interacao|como (tomar|usar|aplicar))/.test(text);
  if(inScope)return '';
  return 'Essa pergunta foge do que fui criada para acompanhar. Posso ajudar com sua agenda, medicamentos, horários, registros, lembretes e leitura de receituários. Se quiser, pergunte “o que você pode fazer?” para ver alguns exemplos.';
}

export function unsafeMedicationAdviceResponse(question) {
  const text=normalizeText(question);
  if(/(minha agenda|meus medicamentos|meus remedios|cadastrad|conforme a agenda|com base na agenda)/.test(text)&&
    /(como|qual|quais|quando).*(tomar|usar|aplicar|administrar|procedimento|horario)/.test(text)) return '';
  if(/\b(posso|devo) (tomar|usar)|qual (dose|dosagem)|aumentar (a )?dose|diminuir (a )?dose|parar de tomar|trocar (o )?remedio|substituir/.test(text)){
    return 'Não posso decidir se você deve iniciar, parar, trocar ou alterar a dose de um medicamento. Confirme com seu médico ou farmacêutico, que pode considerar sua prescrição e seu estado de saúde. Se você estiver passando mal ou tiver uma reação forte, procure atendimento imediatamente ou ligue para o SAMU 192.';
  }
  return '';
}

export function emergencyResponse(question) {
  const text = normalizeText(question);
  const emergencyTerms = [
    'falta de ar', 'nao consigo respirar', 'inchaco no rosto', 'inchaco na garganta', 'desmaiei',
    'desmaiando', 'convulsao', 'dor no peito', 'sangramento grave', 'reacao alergica forte',
    'dor muito forte', 'overdose', 'tomei muitos', 'quero me matar', 'risco de vida',
  ];
  if (emergencyTerms.some((term) => text.includes(term))) {
    return 'Isso pode ser uma emergência. Ligue agora para o SAMU pelo número 192 ou vá imediatamente ao pronto-socorro. Se possível, peça ajuda a alguém próximo. Não espere uma resposta da M.A.R.I.A. para procurar atendimento.';
  }
  const unwellTerms = [
    'nao estou bem', 'n estou bem', 'to mal', 'tô mal', 'estou passando mal',
    'estou me sentindo mal', 'tive uma reacao', 'um medicamento me fez mal',
    'o remedio me fez mal', 'remedio me fez mal', 'medicamento fez mal',
    'tive efeito colateral', 'estou com efeito colateral', 'tive efeitos colaterais',
  ];
  if (unwellTerms.some((term) => text.includes(term))) {
    return 'Sinto muito que você não esteja bem. Se os sintomas forem fortes, estiverem piorando ou houver falta de ar, desmaio, dor no peito, convulsão ou reação alérgica, ligue agora para o SAMU 192 ou procure um pronto-socorro. Caso não pareça uma emergência, entre em contato com um profissional de saúde para receber orientação.';
  }
  return '';
}

export function answerAgendaQuestion(question, context) {
  const text = normalizeText(question);
  const mentioned=findMentionedMedication(question,context.medications);
  const asksSavedInstructions=/(como|qual|quais|quando).*(tomar|usar|aplicar|administrar|procedimento|horario|hora|dose)|com base na (minha )?agenda|conforme (a )?(minha )?agenda/.test(text);
  if(mentioned&&(asksSavedInstructions||/quantas.*(dose|falta)|proxim.*(dose|horario|hora)/.test(text))){
    const relatedTaken=context.today.takenItems.filter(item=>normalizeText(item.name)===normalizeText(mentioned.name));
    const relatedPending=context.today.pendingItems.filter(item=>normalizeText(item.name)===normalizeText(mentioned.name));
    const schedule=mentioned.scheduleType==='times'
      ? `Horários cadastrados: ${mentioned.times.join(', ') || 'não informados'}.`
      : mentioned.scheduleType==='interval'
      ? `Intervalo cadastrado: a cada ${mentioned.frequencyHours} hora(s), começando às ${mentioned.start || 'hora não informada'}.`
      : 'Esse medicamento está cadastrado para uso quando necessário, sem horário fixo.';
    return `Claro. Segundo o que está cadastrado na sua agenda:\n\n• ${mentioned.name}${mentioned.dose?` — ${mentioned.dose}`:''}\n• ${schedule}\n• Hoje: ${relatedTaken.length} administrada(s) e ${relatedPending.length} pendente(s)${relatedPending.length?` (${relatedPending.map(item=>item.time).join(', ')})`:''}.\n\nEstou apenas reproduzindo sua agenda, sem alterar a orientação da receita.`;
  }
  const asksMeds = /(quais|listar|mostre).*(medicamento|remedio)|meus (medicamentos|remedios)/.test(text);
  const asksTaken = /(quanto|quantas|qtd|quantidade).*(tomei|tomadas)|doses? tomadas? hoje/.test(text);
  const asksPending = /(quanto|quantas|qtd|quantidade).*(falta|faltam|pendente)|doses? pendentes?/.test(text);
  const asksNext = /(qual|quando|horario).*(proxim).*(dose|medicamento|remedio)|proxima dose/.test(text);
  const asksLate=/(qual|quais).*(medicamento|remedio|dose).*(atrasad)|o que.*atrasad/.test(text);
  const asksLast=/(qual|quando).*(ultima|ultimo).*(dose|medicamento|remedio)/.test(text);
  const asksEndToday=/(que horas|quando).*(termina|acaba).*(agenda|horario).*(hoje)?/.test(text);
  const asksEndsWeek=/(qual|quais).*(tratamento|medicamento|remedio).*(termina|acaba|encerra).*(semana)/.test(text);
  const asksPaused=/(tenho|qual|quais).*(medicamento|remedio).*(pausad)/.test(text);
  const asksMostMissed=/(qual|quais).*(medicamento|remedio).*(esquec|nao confirm)|costumo esquecer|mais esquec/.test(text);
  const asksCompleted=/(qual|quais).*(tratamento|medicamento|remedio).*(concluid|terminad|finalizad)/.test(text);
  const asksTodayAdministration=/(quais|que).*(medicamento|remedio).*(preciso|tenho).*(administrar|tomar|usar|aplicar).*(hoje)|(?:administrar|tomar|usar|aplicar).*(hoje).*(medicamento|remedio)/.test(text);
  const asksAllInstructions=asksSavedInstructions&&/(meus (medicamentos|remedios)|todos|cada)/.test(text);
  if (!asksMeds && !asksTaken && !asksPending && !asksAllInstructions && !asksNext&&!asksLate&&!asksLast&&!asksEndToday&&!asksEndsWeek&&!asksPaused&&!asksTodayAdministration&&!asksMostMissed&&!asksCompleted) return '';

  const parts = [];
  if (asksAllInstructions) {
    const active=context.medications.filter(med=>med.status==='active');
    parts.push(active.length?`Claro. Segundo a sua agenda:\n${active.map(med=>{
      const schedule=med.scheduleType==='times'
        ? `nos horários ${med.times.join(', ') || 'não informados'}`
        : med.scheduleType==='interval'
        ? `a cada ${med.frequencyHours} hora(s), a partir de ${med.start || 'horário não informado'}`
        : 'quando necessário, sem horário fixo';
      return `• ${med.name}${med.dose?` — ${med.dose}`:''}; ${schedule}.`;
    }).join('\n')}\n\nEssas são as instruções salvas na sua agenda. Não alterei a prescrição.`:'Você não tem medicamentos ativos cadastrados.');
  } else if (asksMeds) {
    const active = context.medications.filter((med) => med.status === 'active');
    parts.push(active.length
      ? `Seus medicamentos ativos são:\n${active.map((med) => `• ${med.name}${med.dose ? ` — ${med.dose}` : ''}`).join('\n')}`
      : 'Você não tem medicamentos ativos cadastrados.');
  }
  if (asksTaken) {
    parts.push(`Hoje você marcou ${context.today.taken} de ${context.today.total} dose(s) como tomada(s).`);
  }
  if (asksPending) {
    parts.push(context.today.pending
      ? `Faltam ${context.today.pending} dose(s) hoje:\n${context.today.pendingItems.map((item) => `• ${item.time} — ${item.name}`).join('\n')}`
      : 'Não há doses pendentes hoje.');
  }
  if (asksTodayAdministration && !asksPending) {
    parts.push(context.today.pending
      ? `Ainda estão pendentes na sua agenda hoje:\n${context.today.pendingItems.map((item) => `• ${item.time} — ${item.name}`).join('\n')}`
      : 'Não há doses pendentes na sua agenda hoje.');
  }
  if(asksNext){
    const next=context.today.pendingItems[0];
    parts.push(next?`Sua próxima dose pendente na agenda é ${next.name}, às ${next.time}.`:'Não há outra dose pendente na agenda de hoje.');
  }
  if(asksLate)parts.push(context.today.lateItems.length?`Estão atrasados na agenda de hoje:\n${context.today.lateItems.map(item=>`• **${item.name}**, previsto para **${item.time}**`).join('\n')}`:'Não há medicamento atrasado na agenda de hoje.');
  if(asksLast)parts.push(context.lastTaken?`Sua última dose confirmada foi **${context.lastTaken.name}**, em **${context.lastTaken.date} às ${context.lastTaken.time}**.`:'Não encontrei dose confirmada nos últimos 60 dias.');
  if(asksEndToday)parts.push(context.today.lastScheduledTime?`O último horário previsto na agenda de hoje é **${context.today.lastScheduledTime}**.`:'Não há horários previstos na agenda de hoje.');
  if(asksEndsWeek)parts.push(context.endingThisWeek.length?`Tratamentos com término cadastrado nesta semana:\n${context.endingThisWeek.map(item=>`• **${item.name}** — ${item.date}`).join('\n')}`:'Nenhum tratamento ativo tem término cadastrado para esta semana.');
  if(asksPaused)parts.push(context.paused.length?`Medicamentos pausados:\n${context.paused.map(name=>`• **${name}**`).join('\n')}`:'Você não tem medicamentos pausados.');
  if(asksMostMissed)parts.push(context.frequentlyMissed?.length?`Nos últimos 30 dias, estes medicamentos tiveram mais horários sem confirmação:\n${context.frequentlyMissed.map(item=>`• **${item.name}** — ${item.count} horário(s)`).join('\n')}\n\n“Sem confirmação” não significa necessariamente que a dose não foi administrada.`:'Não encontrei horários passados sem confirmação nos últimos 30 dias.');
  if(asksCompleted)parts.push(context.completedTreatments?.length?`Tratamentos concluídos que podem ser arquivados:\n${context.completedTreatments.map(name=>`• **${name}**`).join('\n')}`:'Não encontrei tratamento concluído aguardando arquivamento.');
  return parts.join('\n\n');
}

export function needsMedicalSources(question) {
  const text = normalizeText(question);
  return /(para que serve|pra que serve|pra q serve|para q serve|serve para|qual a funcao|efeito colateral|bula|interacao|contraindicacao|^(o que e|oq e|o q e)\s+)/.test(text);
}

export function isMedicationDefinitionQuestion(question){
  const text=normalizeText(question).trim();
  return /(para que serve|pra que serve|pra q serve|para q serve|serve para)/.test(text)||/^(o que e|oq e|o q e)\s+/.test(text);
}

export function isCollectiveMedicationPurposeQuestion(question){
  const text=normalizeText(question);
  return /(?:para que serve[m]?|para q serve[m]?|pra que serve[m]?|pra q serve[m]?|qual.*funcao).*(meus|todos os).*(medicamentos|remedios)/.test(text);
}
