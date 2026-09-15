import nodemailer from 'nodemailer';
import fs from 'node:fs';

export function loadEmailConfig() {
  if (fs.existsSync('.env')) process.loadEnvFile('.env');
  return process.env;
}
export function createMailer(env) {
  const required = ['SMTP_HOST','SMTP_USER','SMTP_PASS','MAIL_FROM'];
  const missing = required.filter(key=>!env[key]?.trim());
  if (missing.length) return {configured:false,missing};
  const port = Number(env.SMTP_PORT || 587);
  if (![465,587].includes(port)) throw new Error('Use SMTP_PORT 465 ou 587.');
  if (!validEmail(env.MAIL_FROM)) throw new Error('MAIL_FROM deve conter um único endereço de e-mail.');
  const transport = nodemailer.createTransport({host:env.SMTP_HOST,port,secure:port === 465,requireTLS:port !== 465,
    auth:{user:env.SMTP_USER,pass:env.SMTP_PASS},connectionTimeout:10000,greetingTimeout:10000,socketTimeout:20000});
  return {configured:true,missing:[],verify:()=>transport.verify(),
    async send(subject,text,to=env.MAIL_TO) {
      if (!validEmail(to)) throw new Error('Defina um endereço de destino válido no site.');
      const result = await transport.sendMail({from:env.MAIL_FROM,to,subject,text});
      if (!result.accepted?.length || result.rejected?.length) throw Object.assign(new Error('Destinatário não aceito'),{code:'EENVELOPE'});
      return result;
    },
  };
}
export const validEmail = value => typeof value === 'string' && value.length <= 254 && /^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/.test(value);
export function reminderText(dose, timezone) {
  return `Horário programado: ${new Date(dose.at).toLocaleString('pt-BR',{timeZone:timezone})}\nMedicamento: ${dose.name}\nDose cadastrada: ${dose.dose}\n${dose.notes || ''}\n\nConfira sua agenda e registre a dose caso já tenha tomado.`;
}
