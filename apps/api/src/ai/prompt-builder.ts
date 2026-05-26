export interface VoiceProfile {
  tone_description?: string;
  examples?: string[];
  signature_phrases?: string[];
  custom_rules?: string[];
}

export interface PromptBuilderParams {
  user: {
    name: string;
    years_career?: number;
    bio?: string;
  };
  tenant: {
    id: string;
    name: string;
    aiVoiceProfile?: VoiceProfile | null;
  };
  lead: {
    name: string;
    profession: string;
    address?: any; // String or Object { city, neighborhood }
    fit_score?: number;
  };
  conversation: {
    messages: Array<{
      sender: 'AI' | 'USER' | 'LEAD';
      content: string;
      createdAt: Date;
    }>;
  };
  script: {
    name: string;
    baseMessage?: string;
  };
  currentNode: {
    id: string;
    type: string;
    next_expected_action?: string;
  };
  suggestedTimes?: {
    horario1?: string;
    horario2?: string;
  };
}

export function replaceVariables(
  text: string,
  data: {
    leadName?: string;
    leadProfession?: string;
    leadCity?: string;
    horario1?: string;
    horario2?: string;
  }
): string {
  if (!text) return '';
  
  let result = text;
  
  const replacements: Record<string, string> = {
    '{{NOME}}': data.leadName || '',
    '{{PROFISSAO}}': data.leadProfession || '',
    '{{CIDADE}}': data.leadCity || '',
    '{{HORARIO_1}}': data.horario1 || 'amanhã às 10h',
    '{{HORARIO_2}}': data.horario2 || 'amanhã às 15h',
  };

  for (const [key, val] of Object.entries(replacements)) {
    // Replace all occurrences
    result = result.replace(new RegExp(key.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&'), 'g'), val);
  }

  return result;
}

export function buildSystemPrompt(params: PromptBuilderParams): string {
  const { user, tenant, lead, conversation, script, currentNode, suggestedTimes } = params;

  // Resolve lead city
  let leadCity = '';
  if (lead.address) {
    if (typeof lead.address === 'string') {
      leadCity = lead.address;
    } else if (typeof lead.address === 'object') {
      leadCity = lead.address.city || lead.address.cidade || '';
    }
  }

  const voiceProfile: VoiceProfile = tenant.aiVoiceProfile || {};
  const toneDesc = voiceProfile.tone_description || 'Tom amigável, profissional e direto ao ponto.';
  const examples = voiceProfile.examples || [];
  const signatures = voiceProfile.signature_phrases || [];

  const historyLines = conversation.messages.map((msg) => {
    const timeStr = msg.createdAt instanceof Date ? msg.createdAt.toISOString() : new Date(msg.createdAt).toISOString();
    return `[${timeStr}] ${msg.sender}: ${msg.content}`;
  }).join('\n');

  // Suggested times
  const h1 = suggestedTimes?.horario1 || 'amanhã às 10h';
  const h2 = suggestedTimes?.horario2 || 'amanhã às 15h';

  let prompt = `Você é assistente do corretor ${user.name} (que atua há ${user.years_career || 5} anos no mercado de seguros).

== LINGUAGEM E TOM (extraída no discovery) ==
${toneDesc}`;

  if (examples.length > 0) {
    prompt += `\n\nExemplos do ${user.name} falando (replique o estilo, não o conteúdo literal):`;
    examples.forEach((ex) => {
      prompt += `\n- "${ex}"`;
    });
  }

  if (signatures.length > 0) {
    prompt += `\n\nFinalize suas mensagens usando ocasionalmente uma das seguintes frases de assinatura:`;
    signatures.forEach((sig) => {
      prompt += `\n- "${sig}"`;
    });
  }

  prompt += `

== CONTEXTO DO LEAD ==
- Nome: ${lead.name}
- Profissão: ${lead.profession}
- Cidade: ${leadCity}
- Fit Score: ${lead.fit_score || 0}/10

== HISTÓRICO DA CONVERSA ==
${historyLines || 'Nenhuma mensagem trocada ainda.'}

== ROTEIRO ATUAL: ${script.name} ==
Etapa atual: ${currentNode.id} (${currentNode.type})
Próxima ação esperada: ${currentNode.next_expected_action || 'Responder o lead e dar sequência na conversa'}

== REGRAS ABSOLUTAS (nunca quebrar) ==
1. NUNCA cite valor de prêmio específico (depende de cotação SUSEP).
2. NUNCA prometa cobertura específica (avaliação da seguradora).
3. NUNCA fale como "vou te aprovar" — é a seguradora que aprova.
4. Sempre que detectar pedido de ligação direta → encaminhe pro ${user.name} usando a tool escalate_to_human.
5. Sempre que detectar SAIR/PARAR/NÃO QUERO → confirme opt-out e marque opt-out usando mark_optout.
6. Mantenha tom consultivo, nunca pressão.
7. Máximo 4 linhas por mensagem. WhatsApp não tolera blocos longos.
8. Se não souber responder com certeza, escalone pro ${user.name} usando escalate_to_human.
9. Não alucine horários que não sejam sugeridos. Quando for agendar, sugira ${h1} ou ${h2}.

== OBJETIVOS (ordem de prioridade) ==
1. Entender se o lead tem fit (sócio/profissional liberal com renda da própria atuação).
2. Educar sobre proteção de renda (DIH, doença grave) sem jargão técnico excessivo.
3. Marcar reunião de 30min consultando a agenda.

== FERRAMENTAS DISPONÍVEIS ==
- check_calendar(start, end): retorna horários livres do ${user.name}
- schedule_meeting(datetime, lead_id, location): cria evento no Google Calendar
- send_pdf(material_id): envia PDF institucional
- escalate_to_human(reason): pausa IA e notifica ${user.name}
- mark_optout(): registra opt-out

Responda apenas com JSON de forma estruturada:
{
  "intent_detected": "<categoria>",
  "tool_calls": [],
  "message_to_send": "<texto da mensagem contendo no máximo 4 linhas e sem placeholders>",
  "should_transition_to": "<lead_status_target>"
}
`;

  return prompt;
}
