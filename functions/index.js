import {initializeApp} from 'firebase-admin/app';
import {getFirestore, FieldValue} from 'firebase-admin/firestore';
import {defineSecret, defineString} from 'firebase-functions/params';
import {onCall, HttpsError} from 'firebase-functions/v2/https';
import {onSchedule} from 'firebase-functions/v2/scheduler';
import nodemailer from 'nodemailer';

initializeApp();
const db=getFirestore();
const gmailPassword=defineSecret('GMAIL_APP_PASSWORD');
const gmailUser=defineString('GMAIL_USER',{default:'0arthurpontesdev@gmail.com'});
const emailPattern=/^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/;
const transport=()=>nodemailer.createTransport({service:'gmail',auth:{user:gmailUser.value(),pass:gmailPassword.value()}});

function dueTimes(med,from,until) {
  const start=med.startsAt.toMillis(),step=Number(med.freq)*3600000,end=start+Number(med.days)*86400000;
  if(!Number.isFinite(step)||step<=0)return[];
  const first=start+Math.max(0,Math.ceil((from-start)/step))*step,result=[];
  for(let at=first;at<Math.min(end,until);at+=step)result.push(at);
  return result;
}
const doseKey=(medId,at)=>`${new Date(at).toISOString().slice(0,10)}-${medId}-${new Date(at).getUTCHours()*60+new Date(at).getUTCMinutes()}`;
async function recipientFor(uid){const snap=await db.doc(`users/${uid}/settings/notifications`).get();return snap.exists?snap.data().recipientEmail:'';}
async function claim(ref) {
  return db.runTransaction(async tx=>{const snap=await tx.get(ref);if(snap.exists)return false;tx.create(ref,{status:'sending',attempts:1,attemptedAt:FieldValue.serverTimestamp()});return true;});
}
async function sendReminder(uid,med,at) {
  const recipient=await recipientFor(uid);if(!emailPattern.test(recipient))return;
  const key=doseKey(med.id,at),delivery=db.doc(`users/${uid}/deliveries/${key}`);
  if(!(await claim(delivery)))return;
  try {
    const time=new Date(at).toLocaleString('pt-BR',{timeZone:'America/Fortaleza'});
    await transport().sendMail({from:gmailUser.value(),to:recipient,subject:'Lembrete de medicamento',text:`Horário programado: ${time}\nMedicamento: ${med.name}\nDose cadastrada: ${med.dose}\n${med.notes || ''}\n\nConfira sua agenda e registre a dose caso já tenha tomado.`});
    await delivery.update({status:'sent',sentAt:FieldValue.serverTimestamp()});
  } catch(error) {
    await delivery.update({status:'uncertain',errorCode:String(error.code || 'UNKNOWN').slice(0,80),finishedAt:FieldValue.serverTimestamp()});
    throw error;
  }
}

export const medicationReminders=onSchedule({schedule:'every 1 minutes',timeZone:'America/Fortaleza',region:'southamerica-east1',secrets:[gmailPassword],memory:'256MiB',maxInstances:1},async()=>{
  const now=Date.now(),from=now-90000;
  const medications=await db.collectionGroup('medications').get();
  for(const item of medications.docs){const uid=item.ref.parent.parent.id,med=item.data();for(const at of dueTimes(med,from,now+1))await sendReminder(uid,med,at);}
});

export const sendTestEmail=onCall({region:'southamerica-east1',secrets:[gmailPassword],memory:'256MiB',maxInstances:2},async request=>{
  if(!request.auth)throw new HttpsError('unauthenticated','Entre na sua conta.');
  const recipient=await recipientFor(request.auth.uid);
  if(!emailPattern.test(recipient))throw new HttpsError('failed-precondition','Salve um e-mail de destino válido.');
  await transport().sendMail({from:gmailUser.value(),to:recipient,subject:'Teste — Minha Medicação',text:'Seu e-mail está conectado para receber lembretes. Este teste não contém informações de medicamentos.'});
  return {message:'Teste aceito pelo Gmail. Confira sua caixa de entrada e o spam.'};
});
