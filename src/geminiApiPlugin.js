import { GoogleGenAI, Type } from '@google/genai';

export function geminiApiPlugin() {
  return {
    name: 'gemini-prescription-api',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (req.url === '/api/parse-prescription' && req.method === 'POST') {
          let body = '';
          req.on('data', chunk => {
            body += chunk;
            if (body.length > 25000000) { // 25MB limit
              res.writeHead(413, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Imagem muito grande (máximo 25MB)' }));
            }
          });

          req.on('end', async () => {
            try {
              const { base64Image, mimeType = 'image/jpeg' } = JSON.parse(body);
              const apiKey = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY;
              if (!apiKey) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({ error: 'Chave GEMINI_API_KEY não configurada no ambiente.' }));
              }

              const ai = new GoogleGenAI({
                apiKey,
                httpOptions: {
                  headers: {
                    'User-Agent': 'aistudio-build'
                  }
                }
              });
              const prompt = `Você é um farmacêutico e assistente médico inteligente no aplicativo MedHora.
Analise a imagem da receita médica, atestado, bula ou embalagem de remédio fornecida.
Identifique todos os medicamentos prescritos com seus respectivos detalhes de posologia.

Para cada medicamento extraia com muito cuidado:
1. name: Nome comercial ou genérico do medicamento (ex: "Amoxicilina", "Dipirona 500mg", "Tobramicina 0,3%").
2. dose: Quantidade e instrução de uso (ex: "1 comprimido", "1 gota no olho acometido", "10ml via oral").
3. scheduleType: "interval" (se for a cada X horas), "times" (se tiver horários fixos explícitos, ex: "08:00, 20:00"), ou "asNeeded" (se for 'se dor', 'se febre', SOS).
4. freq: Se for interval, número de horas entre doses (somente um de: "6", "8", "12", "24"). Se for asNeeded coloque "prn". Se o intervalo original for de 4h, arredonde ou adapte para "6".
5. times: Lista de horários fixos em formato HH:MM (ex: ["08:00", "20:00"]) caso existam, ou lista vazia.
6. days: Duração do tratamento em dias (ex: 7 para antibióticos, 14, 30, ou 365 se for uso contínuo). Número inteiro entre 1 e 365. Padrão 7 se não especificado e não contínuo.
7. notes: Recomendações e avisos adicionais (ex: "Tomar após as refeições", "Evitar sol", "Uso em jejum").
8. confidenceNotes: Breve explicação do que você leu na receita para o paciente conferir.

Se algum dado estiver ilegível ou com dúvida, adicione um aviso em notes e confidenceNotes para o usuário conferir antes de salvar.`;

              const cleanBase64 = base64Image.includes('base64,') ? base64Image.split('base64,')[1] : base64Image;

              // Valid Gemini models
              const candidateModels = ['gemini-3.8-flash', 'gemini-flash-latest', 'gemini-3.5-flash'];
              let lastError = null;

              for (const model of candidateModels) {
                try {
                  const response = await ai.models.generateContent({
                    model,
                    contents: [
                      {
                        role: 'user',
                        parts: [
                          { text: prompt },
                          {
                            inlineData: {
                              mimeType,
                              data: cleanBase64
                            }
                          }
                        ]
                      }
                    ],
                    config: {
                      responseMimeType: 'application/json',
                      responseSchema: {
                        type: Type.OBJECT,
                        properties: {
                          doctorNotes: { type: Type.STRING },
                          medications: {
                            type: Type.ARRAY,
                            items: {
                              type: Type.OBJECT,
                              properties: {
                                name: { type: Type.STRING },
                                dose: { type: Type.STRING },
                                scheduleType: {
                                  type: Type.STRING,
                                  enum: ['interval', 'times', 'asNeeded']
                                },
                                freq: { type: Type.STRING },
                                times: {
                                  type: Type.ARRAY,
                                  items: { type: Type.STRING }
                                },
                                days: { type: Type.INTEGER },
                                start: { type: Type.STRING },
                                notes: { type: Type.STRING },
                                confidenceNotes: { type: Type.STRING }
                              },
                              required: ['name', 'dose', 'scheduleType', 'days']
                            }
                          }
                        },
                        required: ['medications']
                      }
                    }
                  });

                  if (response.text) {
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(response.text);
                    return;
                  }
                } catch (e) {
                  console.warn(`Tentativa com ${model} falhou:`, e.message);
                  lastError = e;
                }
              }

              throw lastError || new Error('Não foi possível processar a imagem da receita médica.');
            } catch (err) {
              console.error('Erro na API Gemini:', err);
              res.writeHead(500, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: err.message || 'Erro ao processar a imagem com Inteligência Artificial.' }));
            }
          });
          return;
        }
        next();
      });
    }
  };
}
