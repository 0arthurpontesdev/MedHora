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
    created:value.createdAt?.toDate?.().toISOString() || '',
  };
}

function subscribeOwnerAgenda(ownerUid,onState,onError) {
  let meds=[],taken={};const emit=()=>onState({meds,taken});
  const stops=[
    onSnapshot(collection(db,'users',ownerUid,'medications'),snap=>{meds=snap.docs.map(medicationFromSnapshot);emit();},onError),
    onSnapshot(collection(db,'users',ownerUid,'doses'),snap=>{taken=Object.fromEntries(snap.docs.map(item=>[item.id,item.data().taken===true]));emit();},onError),
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
  return {
    name:data.name.trim(),dose:data.dose.trim(),notes:(data.notes||'').trim(),start,date:data.date,
    freq:scheduleType==='interval'?Number(data.freq):0,asNeeded,scheduleType,times,
    status:data.status||'active',days:Number(data.days),startsAt:Timestamp.fromDate(startsAt),updatedAt:serverTimestamp(),
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
export async function setDoseTaken(user,doseKey,taken,ownerUid=user.uid) {
  const ref=ownerChild(ownerUid,'doses',doseKey);
  if(taken) await setDoc(ref,{doseKey,ownerUid,taken:true,updatedAt:serverTimestamp()});
  else await deleteDoc(ref);
}

export function subscribeConnections(user,onState,onError) {
  return onSnapshot(collection(db,'users',user.uid,'connections'),snap=>onState(snap.docs.map(item=>item.data())),onError);
}
export function subscribeMembers(user,onState,onError) {
  return onSnapshot(collection(db,'users',user.uid,'members'),snap=>onState(snap.docs.map(item=>item.data())),onError);
}

export async function createFamilyInvite(user,invitedEmail,mode='viewer',birthDate='') {
  const inviteId=crypto.randomUUID().replaceAll('-','').slice(0,20).toUpperCase();
  let adultAt=Timestamp.fromDate(new Date());
  if(mode==='dependent'){
    const birth=new Date(`${birthDate}T12:00:00`);
    if(!birthDate||Number.isNaN(birth.getTime()))throw new Error('Informe a data de nascimento do menor.');
    const adult=new Date(birth);adult.setFullYear(adult.getFullYear()+18);
    if(adult<=new Date())throw new Error('O modo dependente é somente para menores de 18 anos.');
    adultAt=Timestamp.fromDate(adult);
  }
  await setDoc(doc(db,'invitations',inviteId),{
    inviteId,ownerUid:user.uid,ownerName:(user.displayName||'Familiar').slice(0,120),
    invitedEmail:invitedEmail.trim().toLowerCase(),status:'pending',acceptedUid:'',mode,birthDate,adultAt,
    createdAt:serverTimestamp(),updatedAt:serverTimestamp(),
  });
  return inviteId;
}

export async function acceptFamilyInvite(user,inviteIdInput) {
  const inviteId=inviteIdInput.trim().toUpperCase();
  const inviteRef=doc(db,'invitations',inviteId);const snapshot=await getDoc(inviteRef);
  if(!snapshot.exists())throw new Error('Convite não encontrado.');
  const invite=snapshot.data();
  if((user.email||'').toLowerCase()!==invite.invitedEmail)throw new Error('Este convite foi criado para outro e-mail.');
  if(invite.status!=='pending'&&invite.acceptedUid!==user.uid)throw new Error('Este convite já foi utilizado.');
  if(invite.status==='accepted'&&invite.acceptedUid===user.uid)return invite.ownerName;
  if(invite.ownerUid===user.uid)throw new Error('Você já é o dono desta agenda.');
  const batch=writeBatch(db);const personName=(user.displayName||user.email||'Familiar').slice(0,120);
  if(invite.mode==='dependent'){
    batch.set(doc(db,'users',user.uid,'control','access'),{
      guardianUid:invite.ownerUid,guardianName:invite.ownerName,birthDate:invite.birthDate,
      adultAt:invite.adultAt,inviteId,createdAt:serverTimestamp(),
    });
    batch.set(ownerChild(invite.ownerUid,'dependents',user.uid),{
      dependentUid:user.uid,displayName:personName,email:user.email||'',birthDate:invite.birthDate,
      adultAt:invite.adultAt,inviteId,joinedAt:serverTimestamp(),
    });
  }else{
    batch.set(ownerChild(invite.ownerUid,'members',user.uid),{
      memberUid:user.uid,email:user.email||'',displayName:personName,inviteId,joinedAt:serverTimestamp(),
    });
    batch.set(child(user,'connections',invite.ownerUid),{
      ownerUid:invite.ownerUid,ownerName:invite.ownerName,inviteId,joinedAt:serverTimestamp(),
    });
  }
  batch.update(inviteRef,{status:'accepted',acceptedUid:user.uid,updatedAt:serverTimestamp()});
  await batch.commit();return invite.ownerName;
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
