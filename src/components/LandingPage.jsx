import React from 'react';
import {
  ArrowRight, Bell, CheckCircle2, Clock3, HeartHandshake, Pill, ShieldCheck, Sparkles, Users
} from 'lucide-react';

const benefits = [
  {icon: <Clock3/>, title: 'Horários sob controle', text: 'Veja as próximas doses e registre o que foi administrado em poucos segundos.'},
  {icon: <Bell/>, title: 'Lembretes que acompanham você', text: 'Receba avisos por e-mail e notificações no celular, inclusive com o site fechado.'},
  {icon: <Users/>, title: 'Cuidado em família', text: 'Acompanhe familiares e administre, com permissão, a agenda de quem precisa de apoio.'},
  {icon: <Sparkles/>, title: 'Cadastro assistido pela M.A.R.I.A.', text: 'Transcreva receitas e embalagens com IA e confira cada informação antes de salvar.'},
];

export function LandingPage({busy, error, onEnter, onLegal}) {
  return <main className="landingPage">
    <header className="landingHeader">
      <a className="landingBrand" href="#inicio" aria-label="MedHora Família — início"><span><Pill size={21}/></span><strong>MedHora Família</strong></a>
      <nav aria-label="Navegação da apresentação">
        <a href="#recursos">Recursos</a><a href="#como-funciona">Como funciona</a><a href="#seguranca">Segurança</a>
      </nav>
      <button className="landingLogin" disabled={busy} onClick={onEnter}>Entrar</button>
    </header>

    <section className="landingHero" id="inicio">
      <div className="landingHeroCopy">
        <span className="landingEyebrow"><HeartHandshake size={16}/> Cuidado simples, todos os dias</span>
        <h1>Seus medicamentos no horário. Sua família mais tranquila.</h1>
        <p>Organize tratamentos, receba lembretes e acompanhe a rotina de quem você cuida em uma agenda privada e fácil de usar.</p>
        <div className="landingHeroActions">
          <button className="primary landingPrimary" disabled={busy} onClick={onEnter}>{busy?'Abrindo o Google…':'Começar gratuitamente'}<ArrowRight size={19}/></button>
          <a className="landingSecondary" href="#como-funciona">Ver como funciona</a>
        </div>
        {error&&<p className="landingError" role="alert">{error}</p>}
        <div className="landingTrust"><span><CheckCircle2/> Sem cartão</span><span><ShieldCheck/> Dados privados</span><span><CheckCircle2/> Funciona no celular</span></div>
      </div>
      <div className="landingPreview" aria-label="Exemplo da agenda do MedHora">
        <div className="previewTop"><div><small>AGENDA DE HOJE</small><strong>Olá, sua rotina está em dia.</strong></div><span>08:42</span></div>
        <div className="previewNext"><span>PRÓXIMA DOSE</span><strong>Losartana</strong><p>1 comprimido • às 09:00</p><button type="button" tabIndex="-1"><CheckCircle2/> Marcar como administrada</button></div>
        <div className="previewStats"><span><strong>2</strong> administradas</span><span><strong>1</strong> pendente</span><span><strong>3</strong> medicamentos</span></div>
      </div>
    </section>

    <section className="landingSection" id="recursos"><div className="landingSectionHead"><span>RECURSOS</span><h2>Tudo o que você precisa para cuidar da rotina</h2><p>Menos preocupação com horários e mais clareza para toda a família.</p></div><div className="benefitGrid">{benefits.map(item=><article key={item.title}><span>{item.icon}</span><h3>{item.title}</h3><p>{item.text}</p></article>)}</div></section>

    <section className="landingSteps" id="como-funciona"><div className="landingSectionHead"><span>COMO FUNCIONA</span><h2>Comece em três passos</h2></div><div className="stepsGrid"><article><b>1</b><h3>Entre com o Google</h3><p>Sua conta identifica e protege sua agenda.</p></article><article><b>2</b><h3>Cadastre o tratamento</h3><p>Digite os dados ou confira a leitura da receita pela M.A.R.I.A.</p></article><article><b>3</b><h3>Ative os lembretes</h3><p>Receba avisos e registre cada dose pelo celular.</p></article></div></section>

    <section className="landingSecurity" id="seguranca"><div><span className="securityIcon"><ShieldCheck/></span><div><small>PRIVACIDADE DESDE O INÍCIO</small><h2>Sua agenda pertence a você</h2><p>Cada conta acessa somente os próprios dados. O compartilhamento familiar depende de convite e pode ser removido quando você quiser.</p><button type="button" onClick={()=>onLegal('privacy')}>Conhecer a política de privacidade <ArrowRight size={16}/></button></div></div></section>

    <section className="landingCta"><Pill/><h2>Cuide dos horários com mais tranquilidade.</h2><p>Crie sua agenda e organize o próximo medicamento em poucos minutos.</p><button className="primary landingPrimary" disabled={busy} onClick={onEnter}>{busy?'Abrindo…':'Criar minha agenda'}<ArrowRight size={19}/></button></section>

    <footer className="landingFooter"><div className="landingBrand"><span><Pill size={18}/></span><strong>MedHora Família</strong></div><p>Organização de medicamentos para pessoas e famílias.</p><div><button onClick={()=>onLegal('privacy')}>Privacidade</button><button onClick={()=>onLegal('terms')}>Termos de uso</button><a href="mailto:0arthurpontesdev@gmail.com">Contato</a></div><small>O MedHora organiza informações e não substitui orientação médica.</small></footer>
  </main>;
}

export function LegalPage({type, onBack}) {
  const privacy=type==='privacy';
  return <main className="publicLegalPage"><article><button className="legalBack" onClick={onBack}>← Voltar</button><div className="landingBrand"><span><Pill size={19}/></span><strong>MedHora Família</strong></div><h1>{privacy?'Política de Privacidade':'Termos de Uso'}</h1><p className="legalUpdated">Última atualização: 18 de setembro de 2026</p>{privacy?<>
    <h2>1. Quais dados são tratados</h2><p>O MedHora armazena dados da conta Google, medicamentos, horários, registros de doses, preferências de lembrete, vínculos familiares e aparelhos autorizados. Esses dados podem revelar informações sobre saúde e devem ser tratados com cuidado.</p>
    <h2>2. Para que os dados são usados</h2><p>Usamos os dados para manter sua agenda, sincronizar registros, enviar lembretes, permitir compartilhamentos autorizados, gerar relatórios e operar os recursos solicitados por você.</p>
    <h2>3. Serviços externos</h2><p>Autenticação, banco de dados, hospedagem e notificações usam serviços Firebase/Google. Ao usar a M.A.R.I.A., perguntas, imagens de receitas ou PDFs podem ser enviados ao Google Gemini. Consultas gerais sobre medicamentos podem acessar fontes públicas.</p>
    <h2>4. Compartilhamento e família</h2><p>Seus dados não são vendidos. Uma agenda só é compartilhada quando você cria ou aceita um convite, ou conecta um aparelho por QR Code. O acesso pode ser removido na área Família ou Celular.</p>
    <h2>5. Retenção e exclusão</h2><p>Os dados permanecem enquanto a conta estiver ativa ou forem necessários para prestar o serviço. Você pode baixar um backup e excluir a conta e seus dados na tela Privacidade. Registros técnicos mínimos podem ser mantidos pelo tempo necessário para segurança e solução de falhas.</p>
    <h2>6. Seus controles</h2><p>Você pode consultar, corrigir e excluir informações dentro do aplicativo, revogar o uso da M.A.R.I.A. e solicitar suporte pelo e-mail abaixo.</p>
  </>:<>
    <h2>1. Finalidade</h2><p>O MedHora é uma ferramenta de organização de horários e registros informados pelo usuário. Ele não realiza diagnóstico, prescrição, cálculo de compensação de dose nem substitui médico ou farmacêutico.</p>
    <h2>2. Responsabilidade do usuário</h2><p>Confira os dados cadastrados e siga sempre a prescrição do profissional de saúde. Em caso de sintomas graves ou emergência, ligue para o SAMU 192 ou procure atendimento imediato.</p>
    <h2>3. M.A.R.I.A.</h2><p>A leitura por inteligência artificial pode conter erros. Nenhuma informação extraída deve ser cadastrada sem conferência. A M.A.R.I.A. não deve ser usada para decidir iniciar, interromper ou alterar tratamentos.</p>
    <h2>4. Disponibilidade</h2><p>Conexão com internet, navegador, permissões do aparelho e serviços de terceiros podem afetar sincronização e lembretes. Não dependa do MedHora como único meio de lembrar uma dose.</p>
    <h2>5. Uso adequado</h2><p>Não tente acessar dados de terceiros sem autorização, contornar controles de segurança ou usar o serviço para atividades ilícitas.</p>
  </>}<h2>Contato</h2><p>Dúvidas, suporte ou solicitações sobre dados: <a href="mailto:0arthurpontesdev@gmail.com">0arthurpontesdev@gmail.com</a>.</p></article></main>;
}
