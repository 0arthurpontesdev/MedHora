const STORAGE_KEY='medhora-client-errors';

export async function reportClientError(error,context={}){
  const event={
    message:String(error?.message||error||'Erro desconhecido').slice(0,500),
    name:String(error?.name||'Error').slice(0,80),
    stack:String(error?.stack||'').slice(0,3000),
    context,
    url:location.href.replace(location.search,''),
    userAgent:navigator.userAgent.slice(0,300),
    occurredAt:new Date().toISOString(),
  };
  try{
    const previous=JSON.parse(localStorage.getItem(STORAGE_KEY)||'[]');
    localStorage.setItem(STORAGE_KEY,JSON.stringify([...(Array.isArray(previous)?previous:[]),event].slice(-10)));
  }catch{}
  const endpoint=import.meta.env.VITE_ERROR_REPORTING_ENDPOINT;
  if(endpoint){
    try{await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(event),keepalive:true});}catch{}
  }
}

export function installGlobalErrorMonitoring(){
  const onError=event=>reportClientError(event.error||event.message,{source:'window'});
  const onRejection=event=>reportClientError(event.reason,{source:'unhandled-rejection'});
  window.addEventListener('error',onError);
  window.addEventListener('unhandledrejection',onRejection);
  return()=>{window.removeEventListener('error',onError);window.removeEventListener('unhandledrejection',onRejection);};
}
