# MedHora Família

Agenda pessoal de medicamentos publicada no Firebase. Cada pessoa entra com a própria conta Google e acessa somente a sua agenda, seus registros de doses e o e-mail de destino que escolheu.

## Site publicado

<https://medhora-familia.web.app>

O site e o banco Firestore já estão publicados no projeto `minha-medicacao-arthur-2026`. O login Google e as regras privadas por usuário também estão configurados.

## O que já funciona

- Login individual com Google.
- Cadastro de medicamento, dose, primeira data e horário, frequência de 6, 8, 12 ou 24 horas e duração do tratamento.
- Cadastro de medicamentos para uso quando necessário, sem gerar alertas em horários inventados.
- Agenda diária, registro de dose tomada e remoção de medicamento.
- Edição, pausa, retomada e encerramento de tratamentos.
- Horários personalizados (até oito horários específicos por dia).
- Histórico dos últimos sete dias, com doses tomadas e sem registro.
- Compartilhamento familiar somente para visualização, por convite destinado a um e-mail Google específico.
- Backup em JSON da agenda e dos registros.
- Dados sincronizados no Firestore e separados pelo identificador da conta Google.
- Lembretes enviados automaticamente ao e-mail usado no login Google.
- E-mail com link direto para abrir a agenda e registrar a dose.
- Lembretes gratuitos cerca de 5 minutos antes do horário, verificados pelo Google Apps Script a cada minuto.
- Notificações push pelo Firebase Cloud Messaging, inclusive com o site fechado após a ativação no aparelho.

## E-mail automático gratuito

O projeto permanece no plano Spark, sem conta de faturamento. O serviço [Minha Medicação — lembretes gratuitos](https://script.google.com/home/projects/15UPno-oJBP9cB03SfTD_qLlGRCZs7zMimSRNgeSVv59NkHEvv7Fa3lKb/edit) usa um acionador do Google Apps Script para verificar o Firestore a cada minuto e enviar pelo Gmail da conta que criou o script. O mesmo serviço envia mensagens push pelo Firebase Cloud Messaging aos aparelhos ativados.

## Compartilhamento familiar

O dono da agenda informa o e-mail Google do familiar e gera um código. O familiar entra com exatamente esse e-mail, cola o código na área **Família** e recebe acesso somente para visualização. Medicamentos e registros só podem ser alterados pelo dono. A interface limita o grupo ao dono e dois familiares.

## Notificações no celular

Cada pessoa deve entrar pelo celular e tocar em **Ativar no celular** uma vez em cada aparelho. Android e navegadores compatíveis recebem a notificação com o site fechado. No iPhone/iPad, instale o site na Tela de Início pelo Safari antes de ativar.

O Apps Script usa um acionador de um minuto e contas Gmail pessoais têm atualmente cota de 100 destinatários por dia. Consulte a [documentação de acionadores](https://developers.google.com/apps-script/guides/triggers/installable) e as [cotas oficiais](https://developers.google.com/apps-script/guides/services/quotas). O código-fonte e o manifesto ficam em `apps-script/`.

## Desenvolvimento

Requisitos: Node.js 22 ou superior e Firebase CLI autenticado.

```sh
npm install
npm run dev
```

Verificação e publicação do site:

```sh
npm test
npm run build
firebase deploy --only firestore,auth,hosting --project minha-medicacao-arthur-2026
```

As Cloud Functions em `functions/` são uma alternativa futura que exige o plano Blaze; elas não estão publicadas nem são necessárias para o serviço gratuito atual.

```sh
cd functions
npm install
```

## Versão local anterior

O servidor em `server/` e o banco `data/medication.sqlite` continuam disponíveis para desenvolvimento local. A versão publicada usa Firebase Authentication e Firestore; ela não lê o SQLite do computador.

O aplicativo organiza os horários informados e não substitui orientação médica nem calcula compensações para doses atrasadas.
