import React, {useEffect, useRef, useState} from 'react';
import {AlertTriangle, ArrowUpRight, BookOpen, ChevronDown, ExternalLink, Loader2, Paperclip, Plus, RotateCcw, Send, Sparkles, Trash2} from 'lucide-react';
import {askMaria} from '../mariaAssistant.js';

const QUICK_QUESTIONS = [
  'Por que você se chama M.A.R.I.A.?',
  'Como devo administrar meus medicamentos?',
  'Qual é minha próxima dose?',
  'Quantas doses faltam hoje?',
  'Para que servem meus medicamentos?',
  'Quais medicamentos eu costumo esquecer mais?',
  'Quem da minha família tem medicamentos pendentes hoje?',
  'Como gerar um relatório dos últimos 7 dias para o médico?',
];

function GoogleSearchSuggestions({html}) {
  const host = useRef(null);
  useEffect(() => {
    if (!host.current || !html) return;
    const root = host.current.shadowRoot || host.current.attachShadow({mode: 'open'});
    root.innerHTML = html;
  }, [html]);
  return html ? <div className="mariaSearchSuggestions" ref={host} aria-label="Sugestões da Pesquisa Google" /> : null;
}

function RichText({text}){
  const parts=String(text||'').split(/(\*\*[^*]+\*\*)/g);
  return <p>{parts.map((part,index)=>part.startsWith('**')&&part.endsWith('**')?<strong key={index}>{part.slice(2,-2)}</strong>:<React.Fragment key={index}>{part}</React.Fragment>)}</p>;
}

function messageDateKey(value){
  if(!value)return 'previous';
  const date=new Date(value);
  if(Number.isNaN(date.getTime()))return 'previous';
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function messageDayLabel(value){
  if(!value)return 'Mensagens anteriores';
  const date=new Date(value);
  if(Number.isNaN(date.getTime()))return 'Mensagens anteriores';
  const today=new Date();
  const todayStart=new Date(today.getFullYear(),today.getMonth(),today.getDate());
  const dateStart=new Date(date.getFullYear(),date.getMonth(),date.getDate());
  const dayDifference=Math.round((todayStart-dateStart)/86400000);
  if(dayDifference===0)return 'Hoje';
  if(dayDifference===1)return 'Ontem';
  return new Intl.DateTimeFormat('pt-BR',{weekday:'long',day:'2-digit',month:'long',year:'numeric'}).format(date);
}

function messageTimeLabel(value){
  if(!value)return '';
  const date=new Date(value);
  if(Number.isNaN(date.getTime()))return '';
  return new Intl.DateTimeFormat('pt-BR',{hour:'2-digit',minute:'2-digit'}).format(date);
}

export function MariaAssistant({meds, takenState, familyAgendas=[], now, personName, storageKey='self', onRequestRegistration, onOpenPrescription}) {
  const welcome={
    id: 'welcome',
    role: 'assistant',
    text: `Olá, ${personName?.split(' ')[0] || 'tudo bem'}! Estou aqui para ajudar com sua rotina. Posso ler o que está salvo na agenda, conferir horários e explicar informações gerais com fontes.`,
    sources: [],
    createdAt: new Date().toISOString(),
  };
  const historyKey=`medhora-maria-history-${storageKey}`;
  const [messages, setMessages] = useState(()=>{
    try {
      const saved=JSON.parse(localStorage.getItem(historyKey)||'[]');
      const valid=Array.isArray(saved)
        ? saved.filter(item=>item&&typeof item.text==='string'&&item.text.trim()).slice(-30)
        : [];
      return valid.length?[welcome,...valid]:[welcome];
    }
    catch{return [welcome];}
  });
  const [question, setQuestion] = useState('');
  const [sending, setSending] = useState(false);
  const [showSuggestions,setShowSuggestions]=useState(false);
  const bottomRef = useRef(null);
  const hasConversation=messages.length>1;

  useEffect(() => {
    if (typeof bottomRef.current?.scrollIntoView === 'function') {
      bottomRef.current.scrollIntoView({behavior: 'smooth'});
    }
  }, [messages, sending]);

  useEffect(()=>{
    const stored=messages.filter(item=>item.id!=='welcome').slice(-30).map(({searchHtml,...item})=>item);
    localStorage.setItem(historyKey,JSON.stringify(stored));
  },[messages,historyKey]);

  useEffect(()=>{
    const handleAdded=(event)=>setMessages(items=>[...items,{id:crypto.randomUUID(),role:'assistant',text:`Pronto! Cadastrei ${event.detail?.count || ''} medicamento(s) a partir do receituário. Confira os dados na tela Medicamentos.`,sources:[],createdAt:new Date().toISOString()}]);
    window.addEventListener('medhora:maria-prescription-added',handleAdded);
    return()=>window.removeEventListener('medhora:maria-prescription-added',handleAdded);
  },[]);

  async function send(text,{retryId='',appendUser=true}={}) {
    const clean = String(text || '').trim();
    if (!clean || sending) return;
    const userMessage = {id: crypto.randomUUID(), role: 'user', text: clean, sources: [], createdAt:new Date().toISOString()};
    const previous = messages.filter(item=>item.id!==retryId);
    setMessages((items) => [...items.filter(item=>item.id!==retryId), ...(appendUser?[userMessage]:[])]);
    setQuestion('');
    setSending(true);
    try {
      const answer = await askMaria({question: clean, meds, takenState, familyAgendas, now, history: previous});
      if (!answer || typeof answer.text !== 'string' || !answer.text.trim()) {
        throw new Error('A M.A.R.I.A. não retornou uma resposta completa. Tente novamente.');
      }
      const answerText=String(answer.text).trim();
      setMessages((items) => [...items, {id: crypto.randomUUID(), role: 'assistant', ...answer, text:answerText, createdAt:new Date().toISOString()}]);
    } catch (error) {
      setMessages((items) => [...items, {
        id: crypto.randomUUID(), role: 'assistant', text: error.message || 'Não consegui responder agora.', sources: [], error: true, retryQuestion:clean, createdAt:new Date().toISOString(),
      }]);
    } finally {
      setSending(false);
    }
  }

  return (
    <section className="mariaPage hasConversation" aria-label="Conversa com a M.A.R.I.A.">
      <header className="mariaPageHeader">
        <div className="mariaAvatar"><Sparkles size={24} /></div>
        <div className="mariaHeaderCopy">
          <span className="eyebrow">ASSISTENTE DA SUA AGENDA</span>
          <h1>Converse com a M.A.R.I.A.</h1>
          <p>Informações gerais e acompanhamento. Ela não substitui médico, farmacêutico ou atendimento de emergência.</p>
        </div>
        <div className="mariaHeaderActions">
          <span className="mariaEmergencyHint" tabIndex="0" aria-label="Em uma emergência, procure atendimento médico, ligue para o SAMU 192 ou vá a um pronto-socorro"><AlertTriangle size={14}/>SAMU 192<span className="mariaSafetyTooltip" role="tooltip">Em uma emergência, procure atendimento médico, ligue para o SAMU 192 ou vá a um pronto-socorro.</span></span>
          <button type="button" className="mariaSuggestionsToggle" aria-expanded={showSuggestions} onClick={()=>setShowSuggestions(value=>!value)}><Sparkles size={15}/>Sugestões<ChevronDown size={15} className={showSuggestions?'rotated':''}/></button>
          <button type="button" className="softBtn mariaClear" onClick={()=>{if(confirm('Apagar a conversa salva neste aparelho?')){localStorage.removeItem(historyKey);setMessages([welcome]);}}}><Trash2 size={16}/>Apagar conversa</button>
        </div>
      </header>

      {showSuggestions&&<div className="mariaQuickQuestions">
        <span className="mariaQuickLabel">Você pode perguntar:</span>
        {QUICK_QUESTIONS.map((item) => (
          <button type="button" key={item} onClick={() => send(item)} disabled={sending}>{item}</button>
        ))}
      </div>}

      <div className="mariaConversation" aria-live="polite">
        {!hasConversation&&<aside className="mariaInitialSafety" role="note"><AlertTriangle size={20}/><div><strong>Antes de começar</strong><p>Em uma emergência, ligue para o SAMU <b>192</b> ou procure um pronto-socorro.</p><ul><li>A M.A.R.I.A. não faz diagnósticos.</li><li>Ela não indica iniciar, parar, trocar ou alterar a dose de medicamentos.</li><li>Confira informações médicas com seu médico ou farmacêutico.</li></ul></div></aside>}
        {messages.map((message,index) => (
          <React.Fragment key={message.id}>
          {(index===0||messageDateKey(messages[index-1]?.createdAt)!==messageDateKey(message.createdAt))&&(
            <div className="mariaDayDivider" role="separator" aria-label={messageDayLabel(message.createdAt)}><span>{messageDayLabel(message.createdAt)}</span></div>
          )}
          <article className={`mariaMessage ${message.role} ${message.error ? 'error' : ''} ${message.urgent ? 'urgent' : ''}`}>
            {message.role==='assistant'&&<span className="mariaBubbleAvatar"><Sparkles size={15}/></span>}
            <div className="mariaBubbleBody"><div className="mariaMessageMeta"><strong>{message.role === 'assistant' ? 'M.A.R.I.A.' : 'Você'}</strong>{messageTimeLabel(message.createdAt)&&<time dateTime={message.createdAt}>{messageTimeLabel(message.createdAt)}</time>}</div>
            <RichText text={message.text}/>
            {message.sources?.length > 0 && (
              <div className="mariaSources">
                <span><BookOpen size={15} /> Fontes consultadas</span>
                <div>
                  {message.sources.map((source) => (
                    <a key={source.url} href={source.url} target="_blank" rel="noopener noreferrer">
                      {source.title}<ExternalLink size={12} />
                    </a>
                  ))}
                </div>
              </div>
            )}
            {message.suggestRegistration?.name && onRequestRegistration && (
              <button type="button" className="mariaRegisterAction" onClick={()=>onRequestRegistration(message.suggestRegistration.name)}>
                <Plus size={16}/>Cadastrar “{message.suggestRegistration.name}”
              </button>
            )}
            {message.followUpSuggestions?.length > 0 && (
              <div className="mariaFollowUps" aria-label="Sugestões para continuar a conversa">
                {message.followUpSuggestions.map((suggestion) => (
                  <button type="button" key={suggestion.prompt} onClick={() => send(suggestion.prompt)} disabled={sending}>
                    {suggestion.text}<ArrowUpRight size={14}/>
                  </button>
                ))}
              </div>
            )}
            <GoogleSearchSuggestions html={message.searchHtml} />
            {message.retryQuestion&&<button type="button" className="mariaRetry" onClick={()=>send(message.retryQuestion,{retryId:message.id,appendUser:false})} disabled={sending}><RotateCcw size={15}/>Tentar novamente</button>}
            </div>
          </article>
          </React.Fragment>
        ))}
        {sending && <div className="mariaTyping"><Loader2 className="spinner" size={18} /> M.A.R.I.A. está consultando…</div>}
        <div ref={bottomRef} />
      </div>

      <form className="mariaComposer" onSubmit={(event) => {event.preventDefault(); send(question);}}>
        <label htmlFor="maria-question">Pergunte sobre sua agenda ou seus medicamentos</label>
        <div className="mariaComposerRow">
          {onOpenPrescription&&<button type="button" className="mariaAttach iconOnly" onClick={onOpenPrescription} aria-label="Anexar imagem ou PDF do receituário" title="Anexar imagem ou PDF do receituário"><Paperclip size={21}/></button>}
          <textarea
            id="maria-question"
            rows="1"
            maxLength="800"
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); send(question); }
            }}
            placeholder="Ex.: Para que serve a Tobramicina?"
          />
          <button className="primary mariaSend" disabled={sending || !question.trim()} aria-label="Enviar pergunta">
            <Send size={18} /> <span>Enviar</span>
          </button>
        </div>
      </form>
    </section>
  );
}
