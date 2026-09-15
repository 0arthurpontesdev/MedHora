import {createMailer,loadEmailConfig} from './mailer.mjs';
import {openDatabase} from './database.mjs';
try {
  const mail = createMailer(loadEmailConfig());
  if (!mail.configured) throw new Error(`Preencha no arquivo .env: ${mail.missing.join(', ')}`);
  await mail.verify();
  console.log('Conexão segura e autenticação SMTP verificadas.');
  if (process.argv.includes('--send')) {
    const database=openDatabase();
    const recipient=database.recipient();database.close();
    await mail.send('Teste — Minha Medicação','O envio de lembretes por e-mail está conectado. Este é um teste, sem dados de medicamentos.',recipient);
    console.log('E-mail de teste aceito pelo provedor. Confira a caixa de entrada e o spam.');
  }
} catch(error) {
  console.error(error.code ? `Falha SMTP (${error.code}). Confira as credenciais e o provedor.` : error.message);
  process.exitCode=1;
}
