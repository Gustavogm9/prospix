/** Current CRM states are counts, not proof of provider delivery or calendar reservations. */
export function leadStageSummary(stages: Record<string, number>, whatsappValid: number) {
  return [
    { stage: 'Total de leads', value: Object.values(stages).reduce((sum, count) => sum + Number(count), 0), color: '#1B3A6B' },
    { stage: 'WhatsApp validado', value: whatsappValid, color: '#2C5282' },
    { stage: 'Em contato', value: stages.CONTACTED || 0, color: '#64748B' },
    { stage: 'Em diálogo', value: stages.CONVERSING || 0, color: '#E8981C' },
    { stage: 'Qualificados', value: stages.QUALIFIED || 0, color: '#F59E0B' },
    { stage: 'Marcados como agendados', value: stages.MEETING_SCHEDULED || 0, color: '#039855' },
  ];
}
