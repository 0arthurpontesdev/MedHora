import {initializeApp} from 'firebase-admin/app';
import {getFirestore, FieldValue} from 'firebase-admin/firestore';
import {getMessaging} from 'firebase-admin/messaging';
import {getAuth} from 'firebase-admin/auth';
import {defineSecret, defineString} from 'firebase-functions/params';
import {onCall, HttpsError} from 'firebase-functions/v2/https';
import {onSchedule} from 'firebase-functions/v2/scheduler';
import {onDocumentCreated} from 'firebase-functions/v2/firestore';
import nodemailer from 'nodemailer';

initializeApp();
const db=getFirestore();
const gmailPassword=defineSecret('GMAIL_APP_PASSWORD');
const gmailUser=defineString('GMAIL_USER',{default:'0arthurpontesdev@gmail.com'});
const SITE_URL='https://medhora-familia.web.app';
const emailPattern=/^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/;
const transport=()=>nodemailer.createTransport({service:'gmail',auth:{user:gmailUser.value(),pass:gmailPassword.value()}});
const escapeHtml=value=>String(value||'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
function localParts(at){
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Fortaleza',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(at));
  return Object.fromEntries(parts.map(item=>[item.type,item.value]));
}
function localTimestamp(date,time){return Date.parse(`${date}T${time}:00-03:00`);}
function dueTimes(med,from,until) {
  if((med.status||'active')!=='active'||med.asNeeded===true||med.scheduleType==='asNeeded')return[];
  if(med.scheduleType==='times'){
    const startDay=localTimestamp(med.date,'00:00'),days=Number(med.days),result=[];
    const total=days>0?days:Math.max(1,Math.ceil((until-startDay)/86400000)+1);
    for(let day=0;day<total;day++)for(const time of (Array.isArray(med.times)?med.times:[])){
      if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(time))continue;
      const date=new Date(startDay+day*86400000).toISOString().slice(0,10),at=localTimestamp(date,time);
      if(at>=from&&at<until)result.push(at);
    }
    return result;
  }
  const start=med.startsAt?.toMillis?.()??Date.parse(med.startsAt),step=Number(med.freq)*3600000;
  const days=Number(med.days),end=days>0?start+days*86400000:Number.POSITIVE_INFINITY;
  if(!Number.isFinite(start)||!Number.isFinite(step)||step<=0)return[];
  const first=start+Math.max(0,Math.ceil((from-start)/step))*step,result=[];
  for(let at=first;at<Math.min(end,until);at+=step)result.push(at);
  return result;
}
const doseKey=(medId,at)=>{const p=localParts(at);return `${p.year}-${p.month}-${p.day}-${medId}-${Number(p.hour)*60+Number(p.minute)}`;};
async function settingsFor(uid){
  const [settings,profile]=await Promise.all([db.doc(`users/${uid}/settings/notifications`).get(),db.doc(`users/${uid}`).get()]);
  const value=settings.exists?settings.data():{};
  return {recipientEmail:value.recipientEmail||profile.data()?.email||'',leadMinutes:[0,5,10,15,30].includes(Number(value.leadMinutes))?Number(value.leadMinutes):5,emailEnabled:value.emailEnabled!==false,pushEnabled:value.pushEnabled!==false};
}
async function claim(ref){return db.runTransaction(async tx=>{const snap=await tx.get(ref);if(snap.exists)return false;tx.create(ref,{status:'sending',attempts:1,attemptedAt:FieldValue.serverTimestamp()});return true;});}
async function sendReminder(uid,med,at,settings){
  const key=doseKey(med.id,at),delivery=db.doc(`users/${uid}/deliveries/${key}`);
  if(!(await claim(delivery)))return;
  const p=localParts(at),clock=`${p.hour}:${p.minute}`,subject=`${settings.leadMinutes?`Em ${settings.leadMinutes} min`:'Agora'}: ${med.name}`;
  const safeSubject=escapeHtml(subject),safeName=escapeHtml(med.name),safeDose=escapeHtml(med.dose||'Dose não informada');
  let sent=0;
  try{
    if(settings.emailEnabled&&emailPattern.test(settings.recipientEmail)){
      await transport().sendMail({from:gmailUser.value(),to:settings.recipientEmail,subject,text:`Horário: ${clock}\nMedicamento: ${med.name}\nDose: ${med.dose||'não informada'}\n\nAbra sua agenda: ${SITE_URL}`,html:`<div style="font-family:Arial,sans-serif;color:#17352d"><h2>${safeSubject}</h2><p><strong>${safeName}</strong><br>${safeDose}</p><p><a href="${SITE_URL}">Abrir agenda e registrar a dose</a></p></div>`});sent++;
    }
    if(settings.pushEnabled){
      const tokens=(await db.collection(`users/${uid}/pushTokens`).where('enabled','==',true).get()).docs.map(item=>item.data().token).filter(Boolean);
      if(tokens.length){await getMessaging().sendEachForMulticast({tokens,notification:{title:subject,body:`${med.name} • ${med.dose||'consulte a prescrição'}`},webpush:{fcmOptions:{link:SITE_URL}}});sent+=tokens.length;}
    }
    if(!sent)throw new Error('Nenhum canal de lembrete está ativo.');
    await delivery.update({status:'sent',sentAt:FieldValue.serverTimestamp(),channels:sent});
  }catch(error){await delivery.update({status:'uncertain',errorCode:String(error.code||error.message||'UNKNOWN').slice(0,160),finishedAt:FieldValue.serverTimestamp()});throw error;}
}

export const sendFamilyInviteEmail=onDocumentCreated({document:'invitations/{inviteId}',region:'southamerica-east1',secrets:[gmailPassword],memory:'256MiB',maxInstances:2},async event=>{
  const snapshot=event.data;if(!snapshot)return;
  const ref=snapshot.ref;
  const invite=await db.runTransaction(async tx=>{
    const latest=await tx.get(ref),value=latest.data();
    if(!latest.exists||value.status!=='pending'||value.deliveryMethod!=='email'||value.emailStatus!=='pending'||!emailPattern.test(value.invitedEmail))return null;
    tx.update(ref,{emailStatus:'sending'});
    return value;
  });
  if(!invite)return;
  const link=`${SITE_URL}/?invite=${encodeURIComponent(invite.inviteId)}`;
  try{
    const owner=String(invite.ownerName||'Um familiar').slice(0,120);
    const role=invite.accountType==='minor'?'menor':invite.accountType==='elderly'?'idoso':'adulto';
    await transport().sendMail({
      from:gmailUser.value(),to:invite.invitedEmail,
      subject:`${owner} convidou você para o MedHora Família`,
      text:`${owner} convidou você para entrar na família do MedHora como ${role}.\n\nAceitar convite: ${link}\n\nCódigo: ${invite.inviteId}\n\nAceite somente se você conhece essa pessoa.`,
      html:`<div style="font-family:Arial,sans-serif;line-height:1.5;color:#17352d;max-width:520px"><p style="color:#517068">CONVITE PARA A FAMÍLIA</p><h2 style="color:#17785d">${escapeHtml(owner)} convidou você</h2><p>Entre no MedHora como <strong>${escapeHtml(role)}</strong>.</p><p><a href="${link}" style="display:inline-block;background:#17785d;color:#fff;padding:12px 18px;border-radius:8px;text-decoration:none;font-weight:bold">Ver e aceitar convite</a></p><p style="font-size:12px;color:#6c7d78">Código alternativo: ${escapeHtml(invite.inviteId)}<br>Aceite somente se você conhece essa pessoa.</p></div>`,
    });
    await ref.update({emailStatus:'sent',emailSentAt:FieldValue.serverTimestamp()});
  }catch(error){await ref.update({emailStatus:'failed'});throw error;}
});

export const medicationReminders=onSchedule({schedule:'every 1 minutes',timeZone:'America/Fortaleza',region:'southamerica-east1',secrets:[gmailPassword],memory:'256MiB',maxInstances:1},async()=>{
  const now=Date.now(),medications=await db.collectionGroup('medications').get();
  for(const item of medications.docs){const uid=item.ref.parent.parent.id,med=item.data(),settings=await settingsFor(uid),lead=settings.leadMinutes*60000;for(const at of dueTimes(med,now+lead-90000,now+lead+60000))await sendReminder(uid,med,at,settings);}
});

export const sendTestEmail=onCall({region:'southamerica-east1',secrets:[gmailPassword],memory:'256MiB',maxInstances:2},async request=>{
  if(!request.auth)throw new HttpsError('unauthenticated','Entre na sua conta.');
  const settings=await settingsFor(request.auth.uid);
  if(!emailPattern.test(settings.recipientEmail))throw new HttpsError('failed-precondition','Salve um e-mail de destino válido.');
  await transport().sendMail({from:gmailUser.value(),to:settings.recipientEmail,subject:'Teste — MedHora Família',text:`Seu e-mail está conectado.\n\nAbra sua agenda: ${SITE_URL}`});
  return {message:'Teste enviado. Confira sua caixa de entrada e o spam.'};
});

export const deleteMyAccount=onCall({region:'southamerica-east1',memory:'256MiB'},async request=>{
  if(!request.auth)throw new HttpsError('unauthenticated','Entre na sua conta.');
  await db.recursiveDelete(db.doc(`users/${request.auth.uid}`));
  await getAuth().deleteUser(request.auth.uid);
  return {deleted:true};
});
