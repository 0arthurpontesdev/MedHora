import {
  collection, deleteDoc, doc, getDoc, getDocs, onSnapshot, query, serverTimestamp, setDoc,
  Timestamp, updateDoc, where, writeBatch
} from 'firebase/firestore';
import {db} from './firebase.js';

const userRef = user => doc(db,'users',user.uid);
const child = (user,group,id) => doc(db,'users',user.uid,group,id);
const ownerChild = (ownerUid,group,id) => doc(db,'users',ownerUid,group,id);

export async function ensureProfile(user) {
  const ref=userRef(user);const snapshot=await getDoc(ref);
  const data={uid:user.uid,email:user.email || '',displayName:user.displayName || '',updatedAt:serverTimestamp()};
  if(snapshot.exists()) await updateDoc(ref,data);
  else await setDoc(ref,{...data,createdAt:serverTimestamp()});
}

function medicationFromSnapshot(item) {
  const value=item.data();
  return {
    ...value,id:item.id,status:value.status || 'active',
    scheduleType:value.asNeeded ? 'asNeeded' : (value.scheduleType || 'interval'),
    times:Array.isArray(value.times) ? value.times : [],
    startsAt:value.startsAt?.toDate?.().toISOString() || value.startsAt,
    scheduleAnchorAt:value.scheduleAnchorAt?.toDate?.().toISOString() || value.scheduleAnchorAt || value.startsAt?.toDate?.().toISOString() || value.startsAt,
    created:value.createdAt?.toDate?.().toISOString() || '',
  };
}

function subscribeOwnerAgenda(ownerUid,onState,onError) {
  let meds=[],taken={},doseRecords={};const emit=()=>onState({meds,taken,doseRecords});
  const stops=[
    onSnapshot(collection(db,'users',ownerUid,'medications'),snap=>{meds=snap.docs.map(medicationFromSnapshot);emit();},onError),
    onSnapshot(collection(db,'users',ownerUid,'doses'),snap=>{
      taken=Object.fromEntries(snap.docs.map(item=>[item.id,item.data().taken===true]));
      doseRecords=Object.fromEntries(snap.docs.map(item=>{const value=item.data();return [item.id,{...value,scheduledAt:value.scheduledAt?.toDate?.().toISOString()||value.scheduledAt||'',takenAt:value.takenAt?.toDate?.().toISOString()||value.takenAt||value.updatedAt?.toDate?.().toISOString()||'',updatedAt:value.updatedAt?.toDate?.().toISOString()||''}];}));
      emit();
    },onError),
  ];
  return ()=>stops.forEach(stop=>stop());
}

export const subscribeAgenda=(user,onState,onError)=>subscribeOwnerAgenda(user.uid,onState,onError);
export const subscribeSharedAgenda=(ownerUid,onState,onError)=>subscribeOwnerAgenda(ownerUid,onState,onError);

export function subscribeDependents(user,onState,onError) {
  return onSnapshot(collection(db,'users',user.uid,'dependents'),snap=>onState(snap.docs.map(item=>item.data())),onError);
}
export function subscribeCareControl(user,onState,onError) {
  return onSnapshot(doc(db,'users',user.uid,'control','access'),snap=>onState(snap.exists()?snap.data():null),onError);
}

function medicationFields(data) {
  const asNeeded=data.freq==='prn'||data.scheduleType==='asNeeded';
  const scheduleType=asNeeded?'asNeeded':data.scheduleType==='times'?'times':'interval';
  const times=scheduleType==='times'
    ? [...new Set((Array.isArray(data.times)?data.times:String(data.times||'').split(',')).map(v=>String(v).trim()).filter(Boolean))].sort()
    : [];
  const start=scheduleType==='times'?(times[0]||'00:00'):scheduleType==='asNeeded'?'00:00':data.start;
  const startsAt=new Date(`${data.date}T${start}`);
  const suppliedAnchor=new Date(data.scheduleAnchorAt||startsAt);
  const scheduleAnchorAt=Number.isFinite(+suppliedAnchor)?suppliedAnchor:startsAt;
  return {
    name:String(data.name||'').trim(),dose:String(data.dose||'').trim(),notes:String(data.notes||'').trim(),start,date:data.date,
    freq:scheduleType==='interval'?Number(data.freq):0,asNeeded,scheduleType,times,
    status:data.status||'active',days:Math.max(0,Number(data.days)||0),startsAt:Timestamp.fromDate(startsAt),scheduleAnchorAt:Timestamp.fromDate(scheduleAnchorAt),updatedAt:serverTimestamp(),
  };
}

export async function addMedication(user,data,ownerUid=user.uid) {
  const id=crypto.randomUUID();
  await setDoc(ownerChild(ownerUid,'medications',id),{id,ownerUid,...medicationFields(data),createdAt:serverTimestamp()});
}
export async function updateMedication(user,id,data,ownerUid=user.uid) {
  await updateDoc(ownerChild(ownerUid,'medications',id),medicationFields(data));
}
export const removeMedication=(user,id,ownerUid=user.uid)=>deleteDoc(ownerChild(ownerUid,'medications',id));
export async function setDoseTaken(user,doseKey,taken,ownerUid=user.uid,details={}) {
  const ref=ownerChild(ownerUid,'doses',doseKey);
  if(taken) {
    const scheduledDate=new Date(details.scheduledAt||Date.now());
    const takenDate=new Date(details.takenAt||Date.now());
    await setDoc(ref,{
      doseKey,ownerUid,taken:true,
      medicationId:String(details.medicationId||'').slice(0,100),
      medicationName:String(details.medicationName||'Medicamento').slice(0,120),
      scheduledAt:Timestamp.fromDate(Number.isFinite(+scheduledDate)?scheduledDate:new Date()),
      takenAt:Timestamp.fromDate(Number.isFinite(+takenDate)?takenDate:new Date()),
      outOfSchedule:details.outOfSchedule===true,
      scheduleAdjusted:details.scheduleAdjusted===true,
      takenByUid:user.uid,
      updatedAt:serverTimestamp(),
    });
  }
  else await deleteDoc(ref);
}

export function subscribeConnections(user,onState,onError) {
  return onSnapshot(collection(db,'users',user.uid,'connections'),snap=>onState(snap.docs.map(item=>item.data())),onError);
}
export function subscribeMembers(user,onState,onError) {
  return onSnapshot(collection(db,'users',user.uid,'members'),snap=>onState(snap.docs.map(item=>item.data())),onError);
}

export async function createFamilyInvite(user,invitedEmail,mode='viewer',birthDate='',elderSelfManage=true,deliveryMethod='email') {
  const invited=String(invitedEmail||'').trim().toLowerCase(),accountType=mode==='dependent'?'minor':mode;
  if(!/^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/.test(invited))throw new Error('Informe um e-mail válido.');
  if(invited===(user.email||'').toLowerCase())throw new Error('Use o e-mail de outra pessoa da família.');
  if(!['adult','elderly','minor'].includes(accountType))throw new Error('Escolha um tipo de conta válido.');
  let adultAt=Timestamp.fromDate(new Date());
  if(accountType==='minor'){
    const birth=new Date(`${birthDate}T12:00:00`),adult=new Date(birth);adult.setFullYear(adult.getFullYear()+18);
    if(!birthDate||Number.isNaN(+birth)||adult<=new Date())throw new Error('Informe a data de nascimento de uma pessoa menor de 18 anos.');
    adultAt=Timestamp.fromDate(adult);
  }
  const accountRef=child(user,'family','account'),accountSnap=await getDoc(accountRef);
  if(accountSnap.data()?.accountType==='minor')throw new Error('Contas de menores não podem convidar familiares.');
  const familyOwnerUid=accountSnap.data()?.familyOwnerUid||user.uid;
  if(accountSnap.exists()&&familyOwnerUid!==user.uid)throw new Error('Somente o administrador da família pode enviar convites.');
  if(!['email','link'].includes(deliveryMethod))throw new Error('Escolha uma forma de envio válida.');
  const nowStamp=serverTimestamp(),ownerName=(user.displayName||user.email||'Familiar').slice(0,120);
  let guardianName=ownerName;
  if(!accountSnap.exists()){
    const setup=writeBatch(db);
    setup.set(doc(db,'families',familyOwnerUid),{familyOwnerUid,ownerName,createdAt:nowStamp,updatedAt:nowStamp});
    setup.set(doc(db,'families',familyOwnerUid,'members',user.uid),{uid:user.uid,displayName:ownerName,email:user.email||'',accountType:'adult',inviteId:'',joinedAt:nowStamp});
    setup.set(accountRef,{familyOwnerUid,accountType:'adult',updatedAt:nowStamp});
    await setup.commit();
  }else{
    const memberDocs=await getDocs(collection(db,'families',familyOwnerUid,'members'));
    if(memberDocs.size>=5)throw new Error('Esta família já possui cinco pessoas.');
    const familySnapshot=await getDoc(doc(db,'families',familyOwnerUid));
    guardianName=familySnapshot.data()?.ownerName||ownerName;
  }
  const inviteId=crypto.randomUUID().replaceAll('-','').slice(0,20).toUpperCase(),link=`https://medhora-familia.web.app/?invite=${inviteId}`;
  const emailStatus=deliveryMethod==='email'?'pending':'skipped';
  await setDoc(doc(db,'invitations',inviteId),{inviteId,ownerUid:user.uid,ownerName,familyOwnerUid,guardianUid:familyOwnerUid,guardianName,invitedEmail:invited,status:'pending',acceptedUid:'',mode:accountType==='minor'?'dependent':'viewer',accountType,selfManage:accountType==='elderly'?elderSelfManage!==false:true,birthDate:accountType==='minor'?birthDate:'',adultAt,deliveryMethod,emailStatus,createdAt:serverTimestamp(),updatedAt:serverTimestamp()});
  return {inviteId,link,email:invited,accountType,deliveryMethod,emailStatus};
}

export async function acceptFamilyInvite(user,inviteIdInput) {
  const inviteId=String(inviteIdInput||'').trim().toUpperCase(),inviteRef=doc(db,'invitations',inviteId),snapshot=await getDoc(inviteRef);
  if(!snapshot.exists())throw new Error('Convite não encontrado.');
  const invite=snapshot.data();
  if((user.email||'').toLowerCase()!==invite.invitedEmail)throw new Error('Este convite foi criado para outro e-mail.');
  if(invite.status!=='pending'&&invite.acceptedUid!==user.uid)throw new Error('Este convite já foi utilizado.');
  if(invite.status==='accepted'&&invite.acceptedUid===user.uid)return invite.ownerName;
  if(invite.ownerUid===user.uid)throw new Error('Você já faz parte desta família.');
  const familyOwnerUid=invite.familyOwnerUid||invite.ownerUid;
  const batch=writeBatch(db),personName=(user.displayName||user.email||'Familiar').slice(0,120),accountType=invite.accountType||(invite.mode==='dependent'?'minor':'adult'),joinedAt=serverTimestamp();
  batch.set(child(user,'family','account'),{familyOwnerUid,accountType,updatedAt:joinedAt});
  const selfManage=accountType!=='elderly'||invite.selfManage!==false,guardianUid=invite.guardianUid||familyOwnerUid,guardianName=invite.guardianName||invite.ownerName;
  batch.set(doc(db,'families',familyOwnerUid,'members',user.uid),{uid:user.uid,displayName:personName,email:user.email||'',accountType,selfManage,guardianUid,inviteId,joinedAt});
  if(accountType==='minor'){
    batch.set(doc(db,'users',user.uid,'control','access'),{guardianUid,guardianName,birthDate:invite.birthDate,adultAt:invite.adultAt,inviteId,accountType:'minor',selfManage:false,createdAt:joinedAt});
    batch.set(ownerChild(guardianUid,'dependents',user.uid),{dependentUid:user.uid,displayName:personName,email:user.email||'',birthDate:invite.birthDate,adultAt:invite.adultAt,inviteId,accountType:'minor',familyOwnerUid,joinedAt});
  }else{
    batch.set(ownerChild(invite.ownerUid,'members',user.uid),{memberUid:user.uid,email:user.email||'',displayName:personName,inviteId,accountType,familyOwnerUid,joinedAt});
    batch.set(child(user,'connections',invite.ownerUid),{ownerUid:invite.ownerUid,ownerName:invite.ownerName,inviteId,accountType:'adult',familyOwnerUid,joinedAt});
    if(accountType==='elderly'&&!selfManage)batch.set(doc(db,'users',user.uid,'control','access'),{guardianUid,guardianName,birthDate:'',adultAt:Timestamp.fromDate(new Date()),inviteId,accountType:'elderly',selfManage:false,createdAt:joinedAt});
  }
  batch.update(inviteRef,{status:'accepted',acceptedUid:user.uid,updatedAt:serverTimestamp()});
  await batch.commit();return invite.ownerName;
}

export async function rejectFamilyInvite(user,inviteIdInput) {
  const inviteId=String(inviteIdInput||'').trim().toUpperCase();
  const inviteRef=doc(db,'invitations',inviteId),snapshot=await getDoc(inviteRef);
  if(!snapshot.exists())throw new Error('Convite não encontrado.');
  const invite=snapshot.data();
  if((user.email||'').toLowerCase()!==invite.invitedEmail)throw new Error('Este convite foi criado para outro e-mail.');
  if(invite.status!=='pending')throw new Error('Este convite já foi respondido.');
  await updateDoc(inviteRef,{status:'rejected',acceptedUid:'',updatedAt:serverTimestamp()});
}

export function subscribeIncomingInvites(user,onState,onError){
  if(!user.email){onState([]);return()=>{};}
  const incoming=query(collection(db,'invitations'),where('invitedEmail','==',user.email.toLowerCase()));
  return onSnapshot(incoming,snapshot=>onState(snapshot.docs.map(item=>item.data()).filter(item=>item.status==='pending')),onError);
}

export function subscribeFamilyGroup(user,onState,onError){
  let stopMembers=()=>{};
  const stopAccount=onSnapshot(child(user,'family','account'),account=>{
    stopMembers();
    if(!account.exists()){onState([]);return;}
    if(account.data().accountType==='minor'){onState([{uid:user.uid,accountType:'minor',isFamilyAdmin:false,selfManage:false}]);return;}
    const familyOwnerUid=account.data().familyOwnerUid;
    stopMembers=onSnapshot(collection(db,'families',familyOwnerUid,'members'),snapshot=>onState(snapshot.docs.map(item=>({...item.data(),isFamilyAdmin:item.id===familyOwnerUid}))),onError);
  },onError);
  return()=>{stopMembers();stopAccount();};
}

export async function removeDependent(user,dependentUid) {
  const dependentRef=child(user,'dependents',dependentUid);
  const dependent=await getDoc(dependentRef);
  const batch=writeBatch(db);
  batch.delete(dependentRef);
  batch.delete(doc(db,'users',dependentUid,'control','access'));
  const inviteId=dependent.data()?.inviteId;
  if(inviteId)batch.delete(doc(db,'invitations',inviteId));
  await batch.commit();
}

export async function removeMember(user,memberUid) {
  const memberRef=child(user,'members',memberUid);
  const member=await getDoc(memberRef);
  const batch=writeBatch(db);
  batch.delete(memberRef);
  batch.delete(ownerChild(memberUid,'connections',user.uid));
  const inviteId=member.data()?.inviteId;
  if(inviteId)batch.delete(doc(db,'invitations',inviteId));
  await batch.commit();
}
export async function leaveSharedAgenda(user,ownerUid) {
  const batch=writeBatch(db);
  batch.delete(child(user,'connections',ownerUid));
  batch.delete(ownerChild(ownerUid,'members',user.uid));
  await batch.commit();
}

async function sha256(value) {
  const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map(byte=>byte.toString(16).padStart(2,'0')).join('');
}
export async function savePushToken(user,token) {
  return savePushTokenForOwner(user,token,user.uid);
}
export async function savePushTokenForOwner(user,token,ownerUid) {
  const id=await sha256(token);
  const ref=ownerChild(ownerUid,'pushTokens',id);const snapshot=await getDoc(ref);
  let pairId='';
  if(ownerUid!==user.uid){
    const device=await getDoc(ownerChild(ownerUid,'devices',user.uid));
    if(!device.exists())throw new Error('Este aparelho não está mais autorizado.');
    pairId=device.data().pairId||'';
  }
  const data={ownerUid,token,enabled:true,platform:navigator.userAgent.slice(0,300),deviceUid:user.uid,pairId,updatedAt:serverTimestamp()};
  if(snapshot.exists())await updateDoc(ref,data);
  else await setDoc(ref,{...data,createdAt:serverTimestamp()});
}

export async function createDevicePairing(user) {
  const pairId=crypto.randomUUID().replaceAll('-','')+crypto.randomUUID().replaceAll('-','');
  const expires=new Date(Date.now()+9*60*1000);
  await setDoc(doc(db,'pairings',pairId),{
    pairId,ownerUid:user.uid,ownerName:(user.displayName||'Minha agenda').slice(0,120),
    status:'pending',claimedUid:'',expiresAt:Timestamp.fromDate(expires),
    createdAt:serverTimestamp(),updatedAt:serverTimestamp(),
  });
  return {pairId,expiresAt:expires.toISOString()};
}

export async function claimDevicePairing(user,pairIdInput) {
  const pairId=String(pairIdInput||'').trim();
  const pairRef=doc(db,'pairings',pairId),snapshot=await getDoc(pairRef);
  if(!snapshot.exists())throw new Error('Este QR Code não existe ou já expirou.');
  const pair=snapshot.data(),expires=pair.expiresAt?.toDate?.()||new Date(pair.expiresAt);
  if(expires<=new Date())throw new Error('Este QR Code expirou. Gere um novo no computador.');
  if(pair.status==='claimed'&&pair.claimedUid===user.uid)return {ownerUid:pair.ownerUid,ownerName:pair.ownerName};
  if(pair.status!=='pending')throw new Error('Este QR Code já foi utilizado.');
  const batch=writeBatch(db);
  batch.set(ownerChild(pair.ownerUid,'devices',user.uid),{
    deviceUid:user.uid,label:navigator.userAgent.includes('Mobile')?'Celular':'Aparelho',pairId,
    platform:navigator.userAgent.slice(0,300),createdAt:serverTimestamp(),lastSeenAt:serverTimestamp(),
  });
  batch.update(pairRef,{status:'claimed',claimedUid:user.uid,updatedAt:serverTimestamp()});
  await batch.commit();
  return {ownerUid:pair.ownerUid,ownerName:pair.ownerName};
}

export function subscribePairedDevices(user,onState,onError) {
  return onSnapshot(collection(db,'users',user.uid,'devices'),snap=>onState(snap.docs.map(item=>item.data())),onError);
}
export async function removePairedDevice(user,deviceUid) {
  const deviceRef=child(user,'devices',deviceUid);
  const device=await getDoc(deviceRef);
  const tokens=await getDocs(query(collection(db,'users',user.uid,'pushTokens'),where('deviceUid','==',deviceUid)));
  const batch=writeBatch(db);
  tokens.docs.forEach(token=>batch.delete(token.ref));
  batch.delete(deviceRef);
  const pairId=device.data()?.pairId;
  if(pairId)batch.delete(doc(db,'pairings',pairId));
  await batch.commit();
}

export function subscribeNotificationSettings(user,onState,onError) {
  return onSnapshot(doc(db,'users',user.uid,'settings','notifications'),snapshot=>{
    const saved=snapshot.exists()?snapshot.data():{};
    onState({leadMinutes:5,emailEnabled:true,pushEnabled:true,...saved,recipientEmail:saved.recipientEmail||user.email||''});
  },onError);
}

export async function saveNotificationSettings(user,settings) {
  const recipientEmail=String(settings.recipientEmail||user.email||'').trim().toLowerCase();
  const leadMinutes=[0,5,10,15,30].includes(Number(settings.leadMinutes))?Number(settings.leadMinutes):5;
  await setDoc(doc(db,'users',user.uid,'settings','notifications'),{
    ownerUid:user.uid,recipientEmail,leadMinutes,
    emailEnabled:settings.emailEnabled!==false,pushEnabled:settings.pushEnabled!==false,
    updatedAt:serverTimestamp(),
  },{merge:true});
}

export async function saveAiConsent(user,accepted,version='2026-09-18') {
  await setDoc(doc(db,'users',user.uid,'settings','privacy'),{
    ownerUid:user.uid,aiConsent:accepted===true,consentVersion:String(version).slice(0,20),updatedAt:serverTimestamp(),
  },{merge:true});
}

export async function restoreBackup(user,payload) {
  if(!payload||![2,3].includes(payload.version)||!Array.isArray(payload.medications)||typeof payload.takenDoses!=='object'){
    throw new Error('Este arquivo não é um backup válido do MedHora Família.');
  }
  if(payload.medications.length>200||Object.keys(payload.takenDoses||{}).length>250){
    throw new Error('O backup excede o limite seguro de 200 medicamentos e 250 registros.');
  }
  const writes=[];
  payload.medications.forEach(raw=>{
    const id=String(raw.id||crypto.randomUUID()).slice(0,100);
    const data={...raw,date:String(raw.date||'').slice(0,10),start:String(raw.start||'00:00').slice(0,5)};
    const type=data.asNeeded?'asNeeded':data.scheduleType||'interval';
    if(!String(data.name||'').trim()||!/^(\d{4})-(\d{2})-(\d{2})$/.test(data.date)||!['interval','times','asNeeded'].includes(type))throw new Error('O backup contém um medicamento incompleto ou inválido.');
    const days=Number(data.days)||0,times=Array.isArray(data.times)?data.times:[];
    if(days<0||days>365||String(data.dose||'').length>500||
      (type==='interval'&&(![6,8,12,24].includes(Number(data.freq))||!/^([01]\d|2[0-3]):[0-5]\d$/.test(data.start)))||
      (type==='times'&&(!times.length||times.length>8||times.some(time=>!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)))))throw new Error('O backup contém horários ou duração inválidos.');
    const fields=medicationFields(data);
    writes.push({ref:ownerChild(user.uid,'medications',id),data:{id,ownerUid:user.uid,...fields,createdAt:serverTimestamp()}});
  });
  Object.entries(payload.takenDoses||{}).filter(([,taken])=>taken===true).forEach(([doseKey])=>{
    const safeKey=String(doseKey).slice(0,180);
    const dateMatch=safeKey.match(/^(\d{4}-\d{2}-\d{2})-.*-(\d{1,4})$/);
    const minutes=dateMatch?Math.max(0,Math.min(1439,Number(dateMatch[2])||0)):0;
    const scheduledAt=dateMatch?new Date(`${dateMatch[1]}T${String(Math.floor(minutes/60)).padStart(2,'0')}:${String(minutes%60).padStart(2,'0')}:00`):new Date();
    const detail=payload.doseRecords?.[doseKey]||{};
    const savedScheduled=new Date(detail.scheduledAt||scheduledAt),savedTaken=new Date(detail.takenAt||savedScheduled);
    writes.push({ref:ownerChild(user.uid,'doses',safeKey),data:{doseKey:safeKey,ownerUid:user.uid,taken:true,medicationId:String(detail.medicationId||'').slice(0,100),medicationName:String(detail.medicationName||'Medicamento importado').slice(0,120),scheduledAt:Timestamp.fromDate(Number.isFinite(+savedScheduled)?savedScheduled:scheduledAt),takenAt:Timestamp.fromDate(Number.isFinite(+savedTaken)?savedTaken:scheduledAt),outOfSchedule:detail.outOfSchedule===true,scheduleAdjusted:detail.scheduleAdjusted===true,takenByUid:user.uid,updatedAt:serverTimestamp()}});
  });
  const [medications,doses]=await Promise.all([
    getDocs(collection(db,'users',user.uid,'medications')),
    getDocs(collection(db,'users',user.uid,'doses')),
  ]);
  const existingDocs=[...medications.docs,...doses.docs];
  const existingByPath=new Map(existingDocs.map(item=>[item.ref.path,item]));
  writes.forEach(item=>{
    const current=existingByPath.get(item.ref.path);
    if(current&&item.ref.path.includes('/medications/'))item.data.createdAt=current.data().createdAt;
  });
  const importedPaths=new Set(writes.map(item=>item.ref.path));
  const obsolete=existingDocs.filter(item=>!importedPaths.has(item.ref.path));
  const operationCount=writes.length+obsolete.length;

  // A restauração comum cabe em um único commit: ou tudo muda, ou nada muda.
  if(operationCount<=450){
    const batch=writeBatch(db);
    writes.forEach(item=>batch.set(item.ref,item.data));
    obsolete.forEach(item=>batch.delete(item.ref));
    await batch.commit();
    return;
  }

  // Em backups excepcionalmente grandes, grava primeiro. Assim uma falha de rede
  // nunca apaga a agenda atual antes de existir uma cópia restaurada utilizável.
  for(let index=0;index<writes.length;index+=400){
    const batch=writeBatch(db);
    writes.slice(index,index+400).forEach(item=>batch.set(item.ref,item.data));
    await batch.commit();
  }
  for(let index=0;index<obsolete.length;index+=400){
    const batch=writeBatch(db);
    obsolete.slice(index,index+400).forEach(item=>batch.delete(item.ref));
    await batch.commit();
  }
}

export async function deleteAccountData(user) {
  const groups=['medications','doses','members','connections','dependents','devices','pushTokens','settings','control','deliveries'];
  const snapshots=await Promise.all(groups.map(group=>getDocs(collection(db,'users',user.uid,group))));
  const invitations=await getDocs(query(collection(db,'invitations'),where('ownerUid','==',user.uid)));
  const refs=[];
  snapshots.forEach(snapshot=>snapshot.docs.forEach(item=>refs.push(item.ref)));
  invitations.docs.forEach(item=>refs.push(item.ref));
  snapshots[2].docs.forEach(item=>refs.push(ownerChild(item.id,'connections',user.uid)));
  snapshots[3].docs.forEach(item=>refs.push(ownerChild(item.id,'members',user.uid)));
  snapshots[4].docs.forEach(item=>refs.push(ownerChild(item.id,'control','access')));
  for(let index=0;index<refs.length;index+=400){const batch=writeBatch(db);refs.slice(index,index+400).forEach(ref=>batch.delete(ref));await batch.commit();}
  await deleteDoc(userRef(user));
}
