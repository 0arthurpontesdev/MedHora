import React, { useState, useRef } from 'react';
import { Sparkles, Camera, Upload, AlertCircle, Check, Loader2, X, RefreshCw, Eye } from 'lucide-react';
import { parsePrescriptionWithMaria } from '../geminiScanner.js';
import { localDateKey } from '../schedule.js';

export function AiScannerModal({ onClose, onAddMedications }) {
  const [imagePreview, setImagePreview] = useState(null);
  const [mimeType, setMimeType] = useState('image/jpeg');
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState('');
  const [parsedData, setParsedData] = useState(null);
  const [selectedMeds, setSelectedMeds] = useState([]);
  const fileInputRef = useRef(null);
  const cameraInputRef = useRef(null);

  const handleFile = (file) => {
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setError('Por favor, selecione um arquivo de imagem válido (JPG, PNG ou WebP).');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError('A imagem é muito grande. Escolha uma foto de até 5 MB.');
      return;
    }
    setError('');
    setMimeType(file.type);
    const reader = new FileReader();
    reader.onload = (e) => {
      setImagePreview(e.target.result);
      processImage(e.target.result, file.type);
    };
    reader.readAsDataURL(file);
  };

  const processImage = async (base64, type) => {
    setAnalyzing(true);
    setError('');
    setParsedData(null);
    try {
      const data = await parsePrescriptionWithMaria(base64, type);
      if (!data.medications || data.medications.length === 0) {
        setError('Não foi possível identificar medicamentos legíveis nesta imagem. Tente enviar uma foto mais nítida com melhor iluminação.');
      } else {
        setParsedData(data);
        setSelectedMeds(data.medications
          .map((med, idx) => ({ med, idx }))
          .filter(({ med }) => !med.needsReview)
          .map(({ idx }) => idx));
      }
    } catch (err) {
      console.error(err);
      setError(err.message || 'Erro ao processar receita médica com Inteligência Artificial.');
    } finally {
      setAnalyzing(false);
    }
  };

  const toggleSelect = (idx) => {
    setSelectedMeds((prev) =>
      prev.includes(idx) ? prev.filter((i) => i !== idx) : [...prev, idx]
    );
  };

  const updateMedField = (idx, field, val) => {
    if (!parsedData) return;
    const nextMeds = [...parsedData.medications];
    nextMeds[idx] = { ...nextMeds[idx], [field]: val };
    setParsedData({ ...parsedData, medications: nextMeds });
  };

  const handleConfirm = () => {
    if (!parsedData || selectedMeds.length === 0) return;

    const invalid = selectedMeds.find((idx) => {
      const m=parsedData.medications[idx];
      return !m.name?.trim() || !m.dose?.trim() || !m.days || m.scheduleType === 'unknown' ||
        (m.scheduleType === 'interval' && (![6,8,12,24].includes(Number(m.freq)) || !m.start)) ||
        (m.scheduleType === 'times' && (!Array.isArray(m.times) || m.times.length === 0));
    });
    if (invalid !== undefined) {
      setError('Revise os campos obrigatórios do medicamento selecionado. Nome, dose, frequência/horário e duração precisam estar confirmados.');
      return;
    }

    const medsToAdd = selectedMeds.map((idx) => {
      const m = parsedData.medications[idx];
      return {
        name: m.name.trim(),
        dose: m.dose.trim(),
        scheduleType: m.scheduleType || 'interval',
        freq: m.scheduleType === 'asNeeded' ? 'prn' : String(m.freq || ''),
        times: Array.isArray(m.times) ? m.times : [],
        start: m.start || '',
        days: String(m.days || ''),
        date: localDateKey(),
        notes: [m.notes, m.confidenceNotes ? `[IA: ${m.confidenceNotes}]` : '']
          .filter(Boolean)
          .join(' • '),
        status: 'active'
      };
    });

    onAddMedications(medsToAdd);
    onClose();
  };

  return (
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="aiModal" role="dialog" aria-modal="true">
        <div className="modalHead">
          <div className="aiHeadTitle">
            <span className="tag purple">
              <Sparkles size={14} /> M.A.R.I.A.
            </span>
            <h2>Ler receituário com a M.A.R.I.A.</h2>
            <p>Ela transcreve o que está visível. Você confere tudo antes de cadastrar.</p>
          </div>
          <button type="button" className="closeBtn" onClick={onClose} aria-label="Fechar">
            <X size={20} />
          </button>
        </div>

        {!imagePreview && (
          <div className="aiUploadZone">
            <div className="aiUploadPrompt">
              <div className="aiIconCircle">
                <Sparkles size={36} />
              </div>
              <h3>Fotografe ou envie a imagem da receita</h3>
              <p>A M.A.R.I.A. procurará nome, dose, frequência e duração sem completar dados ausentes.</p>

              <div className="aiUploadButtons">
                <button
                  type="button"
                  className="primary"
                  onClick={() => cameraInputRef.current?.click()}
                >
                  <Camera size={18} /> Tirar Foto
                </button>
                <button
                  type="button"
                  className="softBtn"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Upload size={18} /> Selecionar Arquivo
                </button>
              </div>

              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hiddenFileInput"
                onChange={(e) => handleFile(e.target.files?.[0])}
              />
              <input
                ref={cameraInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hiddenFileInput"
                onChange={(e) => handleFile(e.target.files?.[0])}
              />
            </div>
          </div>
        )}

        {imagePreview && (
          <div className="aiPreviewLayout">
            <div className="aiImageSidebar">
              <div className="aiThumbnailBox">
                <img src={imagePreview} alt="Receita médica para análise" />
              </div>
              <button
                type="button"
                className="smallBtn"
                disabled={analyzing}
                onClick={() => {
                  setImagePreview(null);
                  setParsedData(null);
                  setError('');
                }}
              >
                <RefreshCw size={14} /> Trocar imagem
              </button>
            </div>

            <div className="aiResultsArea">
              {analyzing && (
                <div className="aiLoadingState">
                  <Loader2 size={40} className="spinner" />
                  <h4>A M.A.R.I.A. está lendo o receituário...</h4>
                  <p>Transcrevendo os dados visíveis para você conferir.</p>
                </div>
              )}

              {error && (
                <div className="aiErrorNotice">
                  <AlertCircle size={20} />
                  <div style={{ flex: 1 }}>
                    <strong>Atenção</strong>
                    <p style={{ margin: '4px 0 10px' }}>{error}</p>
                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                      <button
                        type="button"
                        className="smallBtn"
                        onClick={() => processImage(imagePreview, mimeType)}
                        style={{ background: '#fff', border: '1px solid #fecaca', color: '#991b1b' }}
                      >
                        <RefreshCw size={14} /> Tentar novamente
                      </button>
                      <button
                        type="button"
                        className="smallBtn"
                        onClick={() => {
                          setImagePreview(null);
                          setError('');
                        }}
                        style={{ background: 'transparent', border: '1px solid #e2e8f0', color: '#475569' }}
                      >
                        Escolher outra imagem
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {parsedData && !analyzing && (
                <div className="aiMedList">
                  <div className="aiListHeader">
                    <div>
                      <h3>Medicamentos Identificados ({parsedData.medications.length})</h3>
                      <p>Revise cada detalhe. Itens com dúvida começam desmarcados.</p>
                    </div>
                  </div>

                  {parsedData.medications.map((med, idx) => {
                    const isSelected = selectedMeds.includes(idx);
                    return (
                      <div
                        key={idx}
                        className={`aiMedItemCard ${isSelected ? 'selected' : 'unselected'}`}
                      >
                        <div className="aiMedCardHeader">
                          <label className="checkboxLabel">
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => toggleSelect(idx)}
                            />
                            <strong>{med.name}</strong>
                          </label>
                          <span className={`tag ${med.needsReview ? 'amber' : 'green'}`}>
                            {med.needsReview ? 'Precisa de revisão' : `${med.days} dias`}
                          </span>
                        </div>

                        <div className="aiMedForm">
                          <div className="aiField">
                            <label>Nome do Remédio</label>
                            <input
                              type="text"
                              value={med.name}
                              onChange={(e) => updateMedField(idx, 'name', e.target.value)}
                            />
                          </div>

                          <div className="aiField">
                            <label>Dosagem / Posologia</label>
                            <input
                              type="text"
                              value={med.dose}
                              onChange={(e) => updateMedField(idx, 'dose', e.target.value)}
                            />
                          </div>

                          <div className="aiFieldRow">
                            <div className="aiField">
                              <label>Tipo</label>
                              <select
                                value={med.scheduleType}
                                onChange={(e) => updateMedField(idx, 'scheduleType', e.target.value)}
                              >
                                <option value="unknown">Selecione após conferir</option>
                                <option value="interval">Intervalo de horas</option>
                                <option value="times">Horários fixos</option>
                                <option value="asNeeded">Se necessário (SOS)</option>
                              </select>
                            </div>

                            {med.scheduleType === 'interval' && (
                              <div className="aiField">
                                <label>Intervalo</label>
                                <select
                                  value={med.freq || ''}
                                  onChange={(e) => updateMedField(idx, 'freq', e.target.value)}
                                >
                                  <option value="">Selecione</option>
                                  <option value="6">A cada 6 horas</option>
                                  <option value="8">A cada 8 horas</option>
                                  <option value="12">A cada 12 horas</option>
                                  <option value="24">Uma vez ao dia (24h)</option>
                                </select>
                              </div>
                            )}

                            <div className="aiField">
                              <label>Duração (dias)</label>
                              <input
                                type="number"
                                min="1"
                                max="365"
                                value={med.days || ''}
                                onChange={(e) => updateMedField(idx, 'days', e.target.value)}
                              />
                            </div>
                          </div>

                          {med.scheduleType === 'interval' && (
                            <div className="aiField">
                              <label>Primeiro horário</label>
                              <input type="time" value={med.start || ''} onChange={(e) => updateMedField(idx, 'start', e.target.value)} />
                            </div>
                          )}

                          {med.scheduleType === 'times' && (
                            <div className="aiField">
                              <label>Horários separados por vírgula</label>
                              <input
                                type="text"
                                value={(med.times || []).join(', ')}
                                placeholder="08:00, 14:00, 20:00"
                                onChange={(e) => updateMedField(idx, 'times', e.target.value.split(',').map(v => v.trim()).filter(Boolean))}
                              />
                            </div>
                          )}

                          {med.notes && (
                            <div className="aiNotesBox">
                              <span>Instrução da receita: {med.notes}</span>
                            </div>
                          )}
                          {(med.confidenceNotes || med.sourceText) && (
                            <div className="aiNotesBox warning">
                              {med.sourceText && <span>Trecho lido: “{med.sourceText}”</span>}
                              {med.confidenceNotes && <span>Confira: {med.confidenceNotes}</span>}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        <div className="modalActions">
          <button type="button" className="cancel" onClick={onClose}>
            Cancelar
          </button>
          {parsedData && !analyzing && (
            <button
              type="button"
              className="primary"
              disabled={selectedMeds.length === 0}
              onClick={handleConfirm}
            >
              <Check size={18} />
              Conferi e quero cadastrar {selectedMeds.length}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
