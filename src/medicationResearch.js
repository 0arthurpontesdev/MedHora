const WIKIPEDIA_API = 'https://pt.wikipedia.org/w/api.php';
const GROUNDED_MODEL='gemini-3.5-flash-lite';
const GROUNDED_TIMEOUT_MS=12000;
const GROUNDED_QUOTA_COOLDOWN_MS=5*60*1000;
const medicationResearchCache=new Map();
let groundedUnavailableUntil=0;
const VERIFIED_MEDICATIONS = {
  dorflex:{
    name:'Dorflex',
    title:'Dorflex — informações oficiais do produto',
    url:'https://www.dorflex.com.br/produtos/para-que-serve',
    summary:'Dorflex é uma linha de medicamentos. A versão tradicional combina dipirona, citrato de orfenadrina e cafeína e é indicada para aliviar dores associadas a contraturas musculares, incluindo dor de cabeça tensional. Outras versões da linha possuem composições diferentes, por isso é necessário conferir a embalagem e a bula.',
    officialSource:{title:'Dorflex — bula do produto',url:'https://www.dorflex.com.br/dam/jcr%3Ab4b7e8b6-bd50-452d-8e15-15c9c82c339b/bula_dorflex.pdf'},
  },
  bilastina:{
    title:'Bilastina — consulta de bula na Anvisa',
    url:'https://consultas.anvisa.gov.br/#/bulario/q/?nomeProduto=bilastina',
    summary:'A bilastina é um anti-histamínico usado para aliviar sintomas de rinite ou rinoconjuntivite alérgica e urticária. A indicação individual e a duração do tratamento dependem da prescrição e da bula da apresentação utilizada.',
  },
  dipirona:{
    title:'Dipirona — consulta de bula na Anvisa',
    url:'https://consultas.anvisa.gov.br/#/bulario/q/?nomeProduto=dipirona',
    summary:'A dipirona, também chamada metamizol, é um medicamento analgésico e antitérmico, utilizado para aliviar dor e febre. A apresentação, a dose e as restrições precisam ser conferidas na bula e na prescrição.',
  },
  prednisolona:{
    title:'Prednisolona — consulta de bula na Anvisa',
    url:'https://consultas.anvisa.gov.br/#/bulario/q/?nomeProduto=prednisolona',
    summary:'A prednisolona é um corticosteroide usado em diferentes condições inflamatórias, alérgicas e imunológicas. Ela não é a mesma substância que prednisona; a indicação e a forma de uso dependem da apresentação e da prescrição.',
  },
  tobramicina:{
    title:'Tobrex (tobramicina) — bulas aprovadas pela Anvisa',
    url:'https://www.pro.novartis.com/br-pt/bulas/tobrex',
    summary:'A tobramicina é um antibiótico aminoglicosídeo. Na apresentação oftálmica a 0,3%, é usada no tratamento de infecções bacterianas externas dos olhos causadas por micro-organismos sensíveis; deve ser utilizada exatamente como prescrita.',
  },
  budesonida:{
    title:'Busonid (budesonida) — bula do fabricante',
    url:'https://www.ache.com.br/arquivos/BU%20BUSONID%20AQ%20NA%2050%20E%20100%20MCG4945700.pdf',
    summary:'A budesonida é um corticosteroide. O spray nasal de 50 mcg por dose é indicado para tratamento de rinites e, em algumas situações, de pólipos nasais; a quantidade de aplicações deve seguir a prescrição.',
  },
  acetilcisteina:{
    title:'Acetilcisteína — informações do Ministério da Saúde',
    url:'https://www.gov.br/saude/pt-br/composicao/conjur/demandas-judiciais/notas-tecnicas/notas-tecnicas-medicamentos/a/acetilciste-na-atualiz-02-12-2015.pdf/view',
    summary:'A acetilcisteína é um agente mucolítico: ajuda a tornar as secreções respiratórias menos viscosas, facilitando sua eliminação. Cimegripe MUC 600 mg contém acetilcisteína; a forma de uso deve seguir a bula da apresentação e a orientação profissional.',
  },
  amoxicilina_clavulanato:{
    title:'Amoxicilina + clavulanato de potássio — bulas aprovadas pela Anvisa',
    url:'https://www.pro.novartis.com/br-pt/bulas',
    summary:'Amoxicilina com clavulanato de potássio é uma associação antibiótica usada contra infecções bacterianas sensíveis. Não trata infecções virais, e o tipo de infecção, a dose e a duração devem seguir a prescrição.',
  },
  soro_fisiologico:{
    title:'Solução fisiológica de cloreto de sódio 0,9% — Anvisa',
    url:'https://anvisalegis.datalegis.net/action/ActionDatalegis.php?acao=abrirTextoAto&cod_menu=9882&cod_modulo=310&link=S&numeroAto=00000107&orgao=RDC%2FDC%2FANVISA%2FMS&seqAto=000&tipo=RDC&valorAno=2016',
    summary:'Soro fisiológico 0,9% é uma solução de cloreto de sódio. Conforme a apresentação, pode ser destinado a nebulização, higiene nasal, lavagem de ferimentos ou outros usos; é necessário conferir o rótulo, a esterilidade e a via indicada no produto.',
  },
};
const QUERY_ALIASES={lorsatan:'Losartan',losartana:'Losartan',metamizol:'Dipirona'};

let groundedMedicationModelPromise;

function withTimeout(promise,timeoutMs){
  let timeoutId;
  const timeout=new Promise((_,reject)=>{
    timeoutId=setTimeout(()=>reject(new Error('Tempo limite da pesquisa fundamentada excedido.')),timeoutMs);
  });
  return Promise.race([promise,timeout]).finally(()=>clearTimeout(timeoutId));
}

function isQuotaError(error){
  const message=String(error?.message||error||'').toLowerCase();
  return error?.status===429||message.includes('429')||message.includes('quota')||message.includes('resource_exhausted');
}

async function getGroundedMedicationModel(){
  if(!groundedMedicationModelPromise){
    groundedMedicationModelPromise=Promise.all([import('firebase/ai'),import('./firebase.js')]).then(([firebaseAi,firebaseModule])=>
      firebaseAi.getGenerativeModel(
        firebaseAi.getAI(firebaseModule.mariaFirebaseApp,{backend:new firebaseAi.GoogleAIBackend()}),
        {
    model:GROUNDED_MODEL,
    tools:[{googleSearch:{}}],
    systemInstruction:`Você verifica medicamentos para uma agenda pessoal brasileira.
Pesquise na web antes de responder. Priorize, nesta ordem: Bulário/Consultas da Anvisa, páginas gov.br,
bula oficial do fabricante e instituições de saúde reconhecidas. Nunca use apenas semelhança de nome.
Confirme marca, princípio ativo, concentração e apresentação quando estiverem disponíveis.
Marcas podem ter versões com composições diferentes: se a versão não estiver clara, marque ambiguous=true.
Não dê diagnóstico, posologia individual, recomendação de uso ou alteração de tratamento.
Responda em português do Brasil e somente como JSON válido.`,
    generationConfig:{
      responseMimeType:'application/json',
      temperature:0,
      maxOutputTokens:700,
      responseJsonSchema:{
        type:'object',additionalProperties:false,
        properties:{
          identifiedName:{type:'string'},
          activeIngredients:{type:'array',items:{type:'string'}},
          summary:{type:'string'},
          confidence:{type:'string',enum:['high','medium','low']},
          ambiguous:{type:'boolean'},
          reason:{type:'string'},
        },
        required:['identifiedName','activeIngredients','summary','confidence','ambiguous','reason'],
      },
    },
        },
      )
    );
  }
  return groundedMedicationModelPromise;
}

export function normalizeMedicationName(value) {
  return String(value || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').replace(/\s+/g, ' ').trim();
}

export function cleanMedicationQuery(value) {
  return String(value || '')
    .replace(/\b\d+(?:[.,]\d+)?\s*(?:mg|mcg|µg|g|ml|ui|%|comprimidos?|capsulas?|gotas?|jatos?|doses?)\b/gi, '')
    .replace(/\s*[-–—]\s*$/, '')
    .replace(/\s+/g, ' ').trim().slice(0, 120);
}

export function medicationLookupKey(value) {
  const name=normalizeMedicationName(cleanMedicationQuery(value));
  if (/\bcimegripe\s+muc\b|\bacetilcisteina\b/.test(name)) return 'acetilcisteina';
  if (/\b(amoxicilina)\b/.test(name) && /\b(clavulanato|clavulanico)\b/.test(name)) return 'amoxicilina_clavulanato';
  if (/\bbusonid\b|\bbudesonida\b/.test(name)) return 'budesonida';
  if (/\bsoro fisiologico\b|\bcloreto de sodio\b/.test(name)) return 'soro_fisiologico';
  if (/\btobramicina\b|\btobrex\b/.test(name)) return 'tobramicina';
  if (/\bprednisolona\b/.test(name)) return 'prednisolona';
  if (/\bdipirona\b|\bmetamizol\b/.test(name)) return 'dipirona';
  if (/\bbilastina\b/.test(name)) return 'bilastina';
  if (/\bdorflex\b/.test(name)) return 'dorflex';
  return name;
}

function wikipediaQueryFor(value){
  const key=medicationLookupKey(value);
  const aliases={
    amoxicilina_clavulanato:'Amoxicilina/ácido clavulânico',
    soro_fisiologico:'Soro fisiológico',
    acetilcisteina:'Acetilcisteína',
    budesonida:'Budesonida',
    tobramicina:'Tobramicina',
    prednisolona:'Prednisolona',
    dipirona:'Dipirona',
    bilastina:'Bilastina',
  };
  return aliases[key]||QUERY_ALIASES[key]||cleanMedicationQuery(value);
}

function groundingData(response){
  const metadata=response?.candidates?.[0]?.groundingMetadata;
  const sources=(metadata?.groundingChunks||[])
    .map(chunk=>chunk?.web)
    .filter(source=>source?.uri&&source?.title)
    .map(source=>({title:String(source.title).slice(0,180),url:source.uri}));
  return {
    sources:[...new Map(sources.map(source=>[source.url,source])).values()].slice(0,6),
    searchHtml:metadata?.searchEntryPoint?.renderedContent||'',
    queries:Array.isArray(metadata?.webSearchQueries)?metadata.webSearchQueries:[],
  };
}

function hasQueryEvidence(inputName,identifiedName,queries=[]){
  const ignored=new Set(['medicamento','remedio','bula','para','serve','comprimido','capsula']);
  const tokens=normalizeMedicationName(cleanMedicationQuery(inputName)).split(/\s+/)
    .filter(token=>token.length>=4&&!ignored.has(token)&&!/^[0-9]+$/.test(token));
  const identified=normalizeMedicationName(identifiedName);
  const searched=normalizeMedicationName(queries.join(' '));
  return tokens.some(token=>identified.includes(token)||searched.includes(token));
}

export async function researchMedicationWithGrounding(inputName){
  const displayName=cleanMedicationQuery(inputName);
  if(!displayName||Date.now()<groundedUnavailableUntil)return null;
  const groundedMedicationModel=await getGroundedMedicationModel();
  let result;
  try{
    result=await withTimeout(groundedMedicationModel.generateContent(
      `MEDICAMENTO INFORMADO PELO USUÁRIO: ${JSON.stringify(displayName)}\n\n`+
      'Identifique exatamente o produto ou princípio ativo e explique apenas para que costuma ser utilizado, em até três frases. '+
      'Se houver mais de uma versão possível, não escolha uma por suposição: marque como ambíguo e explique qual dado falta.'
    ),GROUNDED_TIMEOUT_MS);
  }catch(error){
    if(isQuotaError(error))groundedUnavailableUntil=Date.now()+GROUNDED_QUOTA_COOLDOWN_MS;
    throw error;
  }
  const raw=result.response.text();
  const parsed=JSON.parse(raw);
  const grounded=groundingData(result.response);
  const confidence=['high','medium','low'].includes(parsed.confidence)?parsed.confidence:'low';
  const summary=summarizeSourceExtract(parsed.summary,520);
  if(parsed.ambiguous||confidence==='low'||!summary||!grounded.sources.length||
    !hasQueryEvidence(displayName,parsed.identifiedName,grounded.queries))return null;
  const ingredients=Array.isArray(parsed.activeIngredients)
    ? parsed.activeIngredients.map(item=>String(item||'').trim()).filter(Boolean).slice(0,6)
    : [];
  return {
    name:displayName,
    identifiedName:String(parsed.identifiedName||displayName).trim().slice(0,140),
    activeIngredients:ingredients,
    title:grounded.sources[0].title,
    url:grounded.sources[0].url,
    summary,
    sources:grounded.sources.slice(1),
    searchHtml:grounded.searchHtml,
    confidence,
  };
}

export function summarizeSourceExtract(value, maxLength = 520) {
  const clean = String(value || '').replace(/\s+/g, ' ').trim();
  if (!clean) return '';
  const sentences = clean.match(/[^.!?]+[.!?]+/g) || [clean];
  const summary = sentences.slice(0, 3).join(' ').replace(/\s+/g, ' ').trim();
  if (summary.length <= maxLength) return summary;
  return `${summary.slice(0, maxLength).replace(/\s+\S*$/, '')}…`;
}

export function sourceMatchesMedication(name, page = {}) {
  const query = normalizeMedicationName(wikipediaQueryFor(name));
  const title = normalizeMedicationName(page.title);
  if (!query || query.length < 3) return false;
  const significant=query.split(/\s+/).filter(token=>token.length>2&&!['acido','com','sodio','potassio'].includes(token));
  return title === query || significant.every(token=>new RegExp(`(^|\\s)${token}(\\s|$)`).test(title));
}

async function researchMedicationByNameUncached(inputName) {
  const originalName=cleanMedicationQuery(inputName);
  const lookupKey=medicationLookupKey(originalName);
  const verified=VERIFIED_MEDICATIONS[lookupKey];
  if(verified)return {...verified,name:originalName};
  try{
    const grounded=await researchMedicationWithGrounding(originalName);
    if(grounded)return grounded;
  }catch(error){
    console.warn('A pesquisa fundamentada do medicamento não ficou disponível.',error);
  }
  return researchMedicationInWikipedia(originalName);
}

export async function researchMedicationInWikipedia(inputName){
  const originalName=cleanMedicationQuery(inputName);
  const name = wikipediaQueryFor(originalName);
  if (!name) return null;
  const baseParams={prop:'extracts|info',exintro:'1',explaintext:'1',inprop:'url',redirects:'1',format:'json',origin:'*'};
  const directParams=new URLSearchParams({action:'query',titles:name,...baseParams});
  const directResponse=await fetch(`${WIKIPEDIA_API}?${directParams}`,{headers:{Accept:'application/json'}});
  if(!directResponse.ok)throw new Error(`Fonte indisponível (${directResponse.status})`);
  const directData=await directResponse.json();
  const directPages=Object.values(directData?.query?.pages||{});
  let page=directPages.find(candidate=>!candidate.missing&&sourceMatchesMedication(name,candidate));
  if(!page){
    const searchParams=new URLSearchParams({action:'query',generator:'search',gsrsearch:`intitle:"${name}" medicamento`,gsrlimit:'5',gsrinfo:'suggestion',...baseParams});
    const searchResponse=await fetch(`${WIKIPEDIA_API}?${searchParams}`,{headers:{Accept:'application/json'}});
    if(!searchResponse.ok)throw new Error(`Fonte indisponível (${searchResponse.status})`);
    const searchData=await searchResponse.json();
    const pages=Object.values(searchData?.query?.pages||{}).sort((a,b)=>(a.index||99)-(b.index||99));
    page=pages.find(candidate=>sourceMatchesMedication(name,candidate));
  }
  const summary = summarizeSourceExtract(page?.extract);
  if (!page?.fullurl || !summary) return null;
  return {
    name:originalName, title: `${page.title || name} — resumo enciclopédico`, url: page.fullurl, summary,
    officialSource:{title:`Anvisa — consultar bula de ${name}`,url:`https://consultas.anvisa.gov.br/#/bulario/q/?nomeProduto=${encodeURIComponent(name)}`},
  };
}

export function clearMedicationResearchCache(){
  medicationResearchCache.clear();
  groundedUnavailableUntil=0;
}

export async function researchMedicationByName(inputName) {
  const originalName=cleanMedicationQuery(inputName);
  if(!originalName)return null;
  const cacheKey=normalizeMedicationName(originalName);
  if(medicationResearchCache.has(cacheKey))return medicationResearchCache.get(cacheKey);
  const researchPromise=researchMedicationByNameUncached(originalName).catch(error=>{
    medicationResearchCache.delete(cacheKey);
    throw error;
  });
  medicationResearchCache.set(cacheKey,researchPromise);
  if(medicationResearchCache.size>100){
    const oldestKey=medicationResearchCache.keys().next().value;
    medicationResearchCache.delete(oldestKey);
  }
  return researchPromise;
}

export async function researchMedicationPurposes(medications = [], {offset = 0, limit = 3} = {}) {
  const active = medications.filter(med => med.status === 'active' && String(med.name || '').trim());
  const batch = active.slice(offset, offset + limit);
  const results = await Promise.allSettled(batch.map(med => researchMedicationByName(med.name)));
  return results.filter(result => result.status === 'fulfilled' && result.value).map(result => result.value);
}
