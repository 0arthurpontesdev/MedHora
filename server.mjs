import http from 'node:http';
import fs from 'node:fs';
import {openDatabase} from './database.mjs';
import {createMailer,loadEmailConfig,reminderText,validEmail} from './mailer.mjs';
import {dosesBetween} from './src/schedule.js';

const env = loadEmailConfig();
process.env.TZ = env.TZ || 'America/Fortaleza';
const mail = createMailer(env);
let emailVerified = false;
let emailError = null;
if (mail.configured) mail.verify().then(()=>{emailVerified=true;}).catch(error=>{emailError=error.code || 'SMTP_ERROR';});
fs.mkdirSync('data',{recursive:true});
const database = openDatabase();
let lastTest = 0;
function valid(state) {
  return state && Number.isInteger(state.revision) && Array.isArray(state.meds) && state.meds.length <= 200 &&
    new Set(state.meds.map(m=>m?.id)).size === state.meds.length && state.taken && typeof state.taken === 'object' && !Array.isArray(state.taken) &&
    Object.entries(state.taken).every(([k,v])=>k.length < 200 && typeof v === 'boolean') && state.meds.every(m=>
    m && typeof m.id === 'string' && m.id.length > 0 && m.id.length <= 100 && typeof m.name === 'string' && m.name.trim() && m.name.length <= 120 &&
    typeof m.dose === 'string' && m.dose.trim() && m.dose.length <= 500 && (!m.notes || typeof m.notes === 'string' && m.notes.length <= 2000) &&
    [6,8,12,24].includes(Number(m.freq)) && Number.isInteger(Number(m.days)) && Number(m.days)>=1 && Number(m.days)<=365 &&
    (m.startsAt ? Number.isFinite(Date.parse(m.startsAt)) : Number.isFinite(Date.parse(m.created)) && /^\d{2}:\d{2}$/.test(m.start)));
}
http.createServer(async(req,res)=>{
  const reply=(code,data)=>{res.writeHead(code,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
  if (!['127.0.0.1:8787','localhost:8787','127.0.0.1:5173','localhost:5173'].includes(req.headers.host)) return reply(403,{error:'Host não autorizado'});
  if (req.headers.origin && !['http://localhost:5173','http://127.0.0.1:5173'].includes(req.headers.origin)) return reply(403,{error:'Origem não autorizada'});
  if (req.url === '/api/status' && req.method === 'GET') return reply(200,{configured:mail.configured,verified:emailVerified,error:emailError,recipient:database.recipient(),database:'sqlite',deliveries:database.deliveries()});
  if (req.url === '/api/state' && req.method === 'GET') return reply(200,database.read());
  if (!((req.url === '/api/state' || req.url === '/api/recipient') && req.method === 'PUT') && !(req.url === '/api/email/test' && req.method === 'POST')) return reply(404,{error:'Não encontrado'});
  if (!req.headers['content-type']?.startsWith('application/json')) return reply(415,{error:'JSON obrigatório'});
  try {
    let body='';
    for await (const chunk of req) {body+=chunk;if(body.length>1000000)return reply(413,{error:'Limite excedido'});}
    let state;
    try {state=JSON.parse(body);} catch {return reply(400,{error:'JSON inválido'});}
    if (req.url === '/api/recipient') {
      const recipient=state?.recipient?.trim();
      if (recipient !== '' && !validEmail(recipient)) return reply(400,{error:'Informe um e-mail válido.'});
      database.setRecipient(recipient);
      return reply(200,{recipient});
    }
    if (req.url === '/api/email/test') {
      if (!mail.configured) return reply(503,{error:'Preencha a senha de app do Gmail no servidor e reinicie o serviço.'});
      if (!database.recipient()) return reply(400,{error:'Salve o e-mail de destino primeiro.'});
      if (Date.now()-lastTest < 30000) return reply(429,{error:'Aguarde 30 segundos antes de outro teste.'});
      lastTest=Date.now();
      try {
        await mail.send('Teste — Minha Medicação','Seu e-mail está conectado para receber lembretes. Este é um teste, sem informações de medicamentos.',database.recipient());
        emailError=null;emailVerified=true;
        return reply(200,{message:'Teste aceito pelo Gmail. Confira sua caixa de entrada e o spam.'});
      } catch(error) {emailError=error.code || 'SMTP_ERROR';return reply(502,{error:'O Gmail não confirmou o envio. Confira a senha de app e a conexão.'});}
    }
    if (!valid(state)) return reply(400,{error:'Confira os dados e os limites do cadastro.'});
    reply(200,database.write(state,state.revision));
  } catch(error) {reply(error.status || 500,{error:error.status === 409 ? error.message : 'Não foi possível salvar a agenda.'});}
}).listen(8787,'127.0.0.1',()=>console.log('Banco SQLite e API: http://127.0.0.1:8787'));

let busy=false;
async function tick() {
  if (!mail.configured || !database.recipient() || busy) return;
  busy=true;
  try {
    const now=Date.now();
    for(const dose of dosesBetween(database.read().meds,new Date(now-5*60000),new Date(now+1))) {
      const current=database.read();
      if(current.taken[dose.doseKey] || !current.meds.some(m=>m.id===dose.id) || !database.claim(dose.doseKey,now))continue;
      try {
        await mail.send('Lembrete de medicamento',reminderText(dose,process.env.TZ),database.recipient());
        database.sent(dose.doseKey);emailVerified=true;emailError=null;
      } catch(error) {database.failed(dose.doseKey,error);emailError=error.code || 'SMTP_ERROR';console.error(`Falha de envio (${emailError}).`);}
    }
  } catch {console.error('Falha no serviço de lembretes. Confira o banco e a configuração.');}
  finally {busy=false;}
}
setInterval(tick,15000);
tick();
