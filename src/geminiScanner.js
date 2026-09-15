export async function parsePrescriptionWithGemini(base64Image, mimeType = 'image/jpeg') {
  try {
    const res = await fetch('/api/parse-prescription', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ base64Image, mimeType })
    });

    if (res.ok) {
      const data = await res.json();
      return data;
    }
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.error || 'Erro ao processar imagem da receita no servidor.');
  } catch (backendErr) {
    console.error('Erro na leitura da receita via Gemini:', backendErr);
    throw new Error(backendErr.message || 'Erro ao conectar ao serviço de Inteligência Artificial para ler o receituário.');
  }
}

