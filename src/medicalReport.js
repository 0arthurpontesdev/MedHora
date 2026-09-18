const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[char]));

const dateTime=value=>new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'short'}).format(new Date(value));

export function openMedicalReport({personName,medications=[],items=[],taken={},records={},from,until,title='Relatório de medicamentos'}){
  const popup=window.open('','medhora-medical-report','width=980,height=760');
  if(!popup)throw new Error('O navegador bloqueou a janela do relatório. Permita pop-ups para gerar o PDF.');
  const active=medications.filter(med=>med.status==='active');
  const rows=items.map(item=>{
    const record=records[item.doseKey];
    const status=record?.outOfSchedule?'Administrado fora do horário':taken[item.doseKey]?'Administrado':item.at>Date.now()?'Previsto':'Sem confirmação';
    const actual=record?.takenAt?dateTime(record.takenAt):'-';
    return `<tr><td>${escapeHtml(dateTime(item.at))}</td><td><strong>${escapeHtml(item.name)}</strong><br><small>${escapeHtml(item.dose||'Dose não informada')}</small></td><td>${escapeHtml(actual)}</td><td>${escapeHtml(status)}${record?.scheduleAdjusted?'<br><small>Agenda reajustada</small>':''}</td></tr>`;
  }).join('');
  const meds=active.map(med=>`<li><strong>${escapeHtml(med.name)}</strong> - ${escapeHtml(med.dose||'Dose não informada')} - ${escapeHtml(med.scheduleType==='times'?(med.times||[]).join(', '):med.scheduleType==='asNeeded'?'Quando necessário':`a cada ${med.freq} hora(s)`)}</li>`).join('');
  const administered=items.filter(item=>taken[item.doseKey]).length;
  const missed=items.filter(item=>!taken[item.doseKey]&&item.at<=Date.now()).length;
  const outside=items.filter(item=>records[item.doseKey]?.outOfSchedule).length;
  popup.document.write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>@page{size:A4;margin:16mm}*{box-sizing:border-box}body{font-family:Arial,sans-serif;color:#14213d;margin:0;font-size:11px}header{border-bottom:3px solid #0f6654;padding-bottom:14px;margin-bottom:18px}h1{margin:0;color:#0f6654;font-size:24px}h2{font-size:15px;margin:22px 0 8px}.meta{margin-top:8px;color:#4b5563}.summary{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin:16px 0}.summary div{padding:12px;border:1px solid #d7e5e0;border-radius:8px}.summary strong{display:block;font-size:20px;color:#0f6654}ul{padding-left:20px;line-height:1.6}table{width:100%;border-collapse:collapse}th,td{padding:8px;border-bottom:1px solid #e5e7eb;text-align:left;vertical-align:top}th{background:#eff7f4;color:#0f6654}small{color:#64748b}footer{margin-top:22px;border-top:1px solid #d7e5e0;padding-top:10px;color:#64748b}.actions{position:fixed;right:18px;top:18px}@media print{.actions{display:none}}button{padding:10px 14px;border:0;border-radius:8px;background:#0f6654;color:white;font-weight:700}</style></head><body><button class="actions" onclick="window.print()">Salvar como PDF</button><header><h1>${escapeHtml(title)}</h1><div class="meta"><strong>Paciente:</strong> ${escapeHtml(personName)}<br><strong>Período:</strong> ${escapeHtml(new Date(from).toLocaleDateString('pt-BR'))} a ${escapeHtml(new Date(until).toLocaleDateString('pt-BR'))}<br><strong>Gerado em:</strong> ${escapeHtml(dateTime(new Date()))}</div></header><section class="summary"><div><strong>${administered}</strong>administradas</div><div><strong>${missed}</strong>sem confirmação</div><div><strong>${outside}</strong>fora do horário</div></section><h2>Medicamentos ativos</h2>${meds?`<ul>${meds}</ul>`:'<p>Nenhum medicamento ativo.</p>'}<h2>Registros do período</h2>${rows?`<table><thead><tr><th>Horário previsto</th><th>Medicamento</th><th>Horário real</th><th>Situação</th></tr></thead><tbody>${rows}</tbody></table>`:'<p>Nenhum registro no período.</p>'}<footer>Documento gerado pelo MedHora Família. Este relatório reproduz registros da agenda e não substitui avaliação médica.</footer><script>setTimeout(()=>window.print(),350)<\/script></body></html>`);
  popup.document.close();
}
