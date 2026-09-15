const PROJECT_ID = 'minha-medicacao-arthur-2026';
const FIRESTORE_ROOT = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
const TIME_ZONE = 'America/Fortaleza';
const SITE_URL = 'https://medhora-familia.web.app';
const REMINDER_LEAD_MINUTES = 5;
const REMINDER_CATCH_UP_MINUTES = 2;

function setup() {
  ScriptApp.getProjectTriggers()
    .filter(trigger => trigger.getHandlerFunction() === 'runReminders')
    .forEach(trigger => ScriptApp.deleteTrigger(trigger));
  ScriptApp.newTrigger('runReminders').timeBased().everyMinutes(1).create();
  return `Ativado. Medicamentos: ${listMedications_().length}. Cota diária restante: ${MailApp.getRemainingDailyQuota()}.`;
}

function sendTestEmail() {
  const recipients = {};
  listMedications_().forEach(entry => {
    const email = recipientFor_(entry.uid);
    if (isValidEmail_(email)) recipients[email] = true;
  });
  const emails = Object.keys(recipients);
  if (!emails.length) throw new Error('Nenhum e-mail de destino válido foi salvo no site.');
  emails.forEach(email => MailApp.sendEmail({
    to: email,
    subject: 'Teste — MedHora Família',
    name: 'MedHora Família',
    body: `O serviço gratuito de lembretes está ativo.\n\nAbra sua agenda: ${SITE_URL}`,
    htmlBody: `<div style="font-family:Arial,sans-serif;line-height:1.5;color:#17352d"><h2 style="color:#17785d">MedHora Família</h2><p>O serviço gratuito de lembretes está ativo.</p><p><a href="${SITE_URL}" style="display:inline-block;background:#17785d;color:#fff;padding:12px 18px;border-radius:8px;text-decoration:none;font-weight:bold">Abrir minha agenda</a></p></div>`,
  }));
  return `Teste enviado para ${emails.length} destinatário(s).`;
}

function runReminders() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return;
  try {
    const now = Date.now();
    const from = now + (REMINDER_LEAD_MINUTES - REMINDER_CATCH_UP_MINUTES) * 60 * 1000;
    const until = now + REMINDER_LEAD_MINUTES * 60 * 1000 + 60 * 1000;
    const channels = {};
    listMedications_().forEach(entry => {
      const med = entry.medication;
      if ((med.status || 'active') !== 'active' || med.asNeeded === true || med.scheduleType === 'asNeeded') return;
      dueTimes_(med, from, until).forEach(at => {
        const userChannels = channels[entry.uid] || (channels[entry.uid] = {
          email: recipientFor_(entry.uid),
          pushTokens: pushTokensFor_(entry.uid),
        });
        if (!isValidEmail_(userChannels.email) && !userChannels.pushTokens.length) return;
        sendReminder_(entry.uid, med, at, userChannels);
      });
    });
  } finally {
    lock.releaseLock();
  }
}

function listMedications_() {
  const result = firestoreFetch_(`${FIRESTORE_ROOT}:runQuery`, {
    method: 'post',
    payload: JSON.stringify({structuredQuery:{from:[{collectionId:'medications',allDescendants:true}]}}),
  });
  return result
    .filter(row => row.document)
    .map(row => {
      const match = row.document.name.match(/\/users\/([^/]+)\/medications\/([^/]+)$/);
      return match ? {uid:match[1], medication:decodeFields_(row.document.fields)} : null;
    })
    .filter(Boolean);
}

function recipientFor_(uid) {
  const profile = UrlFetchApp.fetch(`${FIRESTORE_ROOT}/users/${encodeURIComponent(uid)}`, {
    headers:authHeaders_(), muteHttpExceptions:true,
  });
  if (profile.getResponseCode() === 200) {
    const loginEmail = decodeFields_(JSON.parse(profile.getContentText()).fields).email || '';
    if (isValidEmail_(loginEmail)) return loginEmail;
  }
  const legacy = UrlFetchApp.fetch(`${FIRESTORE_ROOT}/users/${encodeURIComponent(uid)}/settings/notifications`, {
    headers:authHeaders_(), muteHttpExceptions:true,
  });
  if (legacy.getResponseCode() !== 200) return '';
  return decodeFields_(JSON.parse(legacy.getContentText()).fields).recipientEmail || '';
}

function dueTimes_(med, from, until) {
  if (med.scheduleType === 'times' && Array.isArray(med.times)) {
    const result = [];
    const days = Number(med.days);
    for (let day = 0; day < days; day++) {
      med.times.forEach(time => {
        if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return;
        const base = new Date(`${med.date}T${time}:00-03:00`).getTime() + day * 86400000;
        if (base >= from && base < until) result.push(base);
      });
    }
    return result;
  }
  const start = Date.parse(med.startsAt);
  const step = Number(med.freq) * 3600000;
  const end = start + Number(med.days) * 86400000;
  if (!Number.isFinite(start) || !Number.isFinite(step) || step <= 0) return [];
  const first = start + Math.max(0, Math.ceil((from - start) / step)) * step;
  const result = [];
  for (let at = first; at < Math.min(end, until); at += step) result.push(at);
  return result;
}

function sendReminder_(uid, med, at, channels) {
  const localDate = Utilities.formatDate(new Date(at), TIME_ZONE, 'yyyy-MM-dd');
  const localHour = Number(Utilities.formatDate(new Date(at), TIME_ZONE, 'H'));
  const localMinute = Number(Utilities.formatDate(new Date(at), TIME_ZONE, 'm'));
  const doseKey = `${localDate}-${med.id}-${localHour * 60 + localMinute}`;
  const deliveryUrl = `${FIRESTORE_ROOT}/users/${encodeURIComponent(uid)}/deliveries/${encodeURIComponent(doseKey)}`;
  if (!claimDelivery_(deliveryUrl)) return;
  try {
    const time = Utilities.formatDate(new Date(at), TIME_ZONE, "dd/MM/yyyy 'às' HH:mm");
    const clock = Utilities.formatDate(new Date(at), TIME_ZONE, 'HH:mm');
    const safeName = htmlEscape_(med.name);
    const safeDose = htmlEscape_(med.dose);
    const safeNotes = htmlEscape_(med.notes || '');
    let sent = false;
    const errors = [];
    if (isValidEmail_(channels.email) && MailApp.getRemainingDailyQuota() > 0) {
      try {
        MailApp.sendEmail({
          to: channels.email,
          subject: `Às ${clock}: ${med.name}`,
          name: 'MedHora Família',
          body: `Seu próximo horário é ${time}.\n\nMedicamento: ${med.name}\nDose: ${med.dose}${med.notes ? `\nObservação: ${med.notes}` : ''}\n\nAbra sua agenda: ${SITE_URL}\n\nSiga sempre a prescrição do seu profissional de saúde.`,
          htmlBody: `<div style="font-family:Arial,sans-serif;line-height:1.5;color:#17352d;max-width:520px"><p style="color:#517068;margin-bottom:6px">LEMBRETE DE MEDICAÇÃO</p><h2 style="margin:0 0 16px;color:#17785d">Próximo horário: ${clock}</h2><div style="background:#f1f7f5;border-radius:12px;padding:16px;margin-bottom:18px"><strong style="font-size:18px">${safeName}</strong><p style="margin:6px 0 0">${safeDose}</p>${safeNotes ? `<p style="margin:6px 0 0;color:#517068">${safeNotes}</p>` : ''}</div><p><a href="${SITE_URL}" style="display:inline-block;background:#17785d;color:#fff;padding:12px 18px;border-radius:8px;text-decoration:none;font-weight:bold">Abrir agenda e marcar como tomado</a></p><p style="font-size:12px;color:#6c7d78;margin-top:22px">Siga sempre a prescrição do seu profissional de saúde.</p></div>`,
        });
        sent = true;
      } catch (error) { errors.push(String(error && error.message || error)); }
    }
    channels.pushTokens.forEach(token => {
      try { sendPush_(token, med, clock); sent = true; }
      catch (error) { errors.push(String(error && error.message || error)); }
    });
    if (!sent) throw new Error(errors.join(' | ') || 'Nenhum canal disponível.');
    updateDelivery_(deliveryUrl, 'sent');
  } catch (error) {
    updateDelivery_(deliveryUrl, 'uncertain', String(error && error.message || 'UNKNOWN').slice(0,200));
    throw error;
  }
}

function pushTokensFor_(uid) {
  const response = UrlFetchApp.fetch(`${FIRESTORE_ROOT}/users/${encodeURIComponent(uid)}/pushTokens?pageSize=20`, {
    headers:authHeaders_(), muteHttpExceptions:true,
  });
  if (response.getResponseCode() !== 200) return [];
  const payload = JSON.parse(response.getContentText());
  return (payload.documents || []).map(doc => decodeFields_(doc.fields)).filter(item => item.enabled === true && item.token).map(item => item.token);
}

function sendPush_(token, med, clock) {
  const response = UrlFetchApp.fetch(`https://fcm.googleapis.com/v1/projects/${PROJECT_ID}/messages:send`, {
    method:'post',headers:authHeaders_(),contentType:'application/json',muteHttpExceptions:true,
    payload:JSON.stringify({message:{
      token,
      notification:{title:`Às ${clock}: ${med.name}`,body:String(med.dose)},
      webpush:{fcm_options:{link:SITE_URL}},
    }}),
  });
  if (response.getResponseCode() >= 300) throw new Error(`FCM respondeu ${response.getResponseCode()}: ${response.getContentText().slice(0,160)}`);
}

function claimDelivery_(url) {
  const response = UrlFetchApp.fetch(`${url}?currentDocument.exists=false`, {
    method:'patch', headers:authHeaders_(), contentType:'application/json', muteHttpExceptions:true,
    payload:JSON.stringify({fields:{status:{stringValue:'sending'},attemptedAt:{timestampValue:new Date().toISOString()}}}),
  });
  return response.getResponseCode() === 200;
}

function updateDelivery_(url, status, error) {
  const fields = {status:{stringValue:status},finishedAt:{timestampValue:new Date().toISOString()}};
  if (error) fields.error = {stringValue:error};
  const response = UrlFetchApp.fetch(url, {
    method:'patch', headers:authHeaders_(), contentType:'application/json', muteHttpExceptions:true,
    payload:JSON.stringify({fields}),
  });
  if (response.getResponseCode() >= 300) throw new Error(`Falha ao registrar envio: ${response.getResponseCode()}`);
}

function firestoreFetch_(url, options) {
  const response = UrlFetchApp.fetch(url, Object.assign({headers:authHeaders_(),contentType:'application/json',muteHttpExceptions:true}, options || {}));
  if (response.getResponseCode() >= 300) throw new Error(`Firestore respondeu ${response.getResponseCode()}: ${response.getContentText().slice(0,300)}`);
  return JSON.parse(response.getContentText());
}

function authHeaders_() {
  return {Authorization:`Bearer ${ScriptApp.getOAuthToken()}`};
}

function decodeFields_(fields) {
  const result = {};
  Object.keys(fields || {}).forEach(key => {
    const value = fields[key];
    if ('stringValue' in value) result[key] = value.stringValue;
    else if ('integerValue' in value) result[key] = Number(value.integerValue);
    else if ('booleanValue' in value) result[key] = value.booleanValue;
    else if ('timestampValue' in value) result[key] = value.timestampValue;
    else if ('arrayValue' in value) result[key] = (value.arrayValue.values || []).map(item => item.stringValue || '');
  });
  return result;
}

function isValidEmail_(value) {
  return typeof value === 'string' && /^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/.test(value);
}

function htmlEscape_(value) {
  return String(value || '').replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
}
