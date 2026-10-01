export type QualificationValue = string | number | boolean | null;

export type QualificationCriterion = {
  key: string;
  required?: boolean;
  weight?: number;
  values?: QualificationValue[];
  accepted?: QualificationValue[];
  question?: string;
};

export type QualificationConfig = {
  version?: number;
  framework?: string;
  minimum_score?: number;
  max_questions_per_message?: number;
  collect_health_data?: boolean;
  criteria?: QualificationCriterion[];
};

export type QualificationAnswer = {
  criterion_key: string;
  value: QualificationValue;
  confidence: number;
};

export type QualificationEvaluation = {
  score: number;
  status: "IN_PROGRESS" | "QUALIFIED" | "DISQUALIFIED";
  missingFields: string[];
};

const HEALTH_DATA_PATTERN =
  /\b(peso|altura|imc|doen[cç]a|diagn[oó]stico|tabag|fumante|hist[oó]rico familiar|medicamento|cirurgia)\b/i;

function cleanKey(value: unknown): string {
  return String(value || "").trim().replace(/[^a-z0-9_]/gi, "").slice(0, 80);
}

function normalizedComparable(value: QualificationValue): QualificationValue {
  return typeof value === "string" ? value.trim().toUpperCase() : value;
}

function hasKnownValue(
  facts: Record<string, QualificationValue>,
  key: string,
): boolean {
  return Object.prototype.hasOwnProperty.call(facts, key) &&
    facts[key] !== null && facts[key] !== "";
}

export function parseQualificationExtraction(
  raw: string,
): QualificationAnswer[] {
  try {
    const cleaned = String(raw || "").replace(/```json/gi, "").replace(
      /```/g,
      "",
    ).trim();
    const parsed = JSON.parse(cleaned);
    const rows = Array.isArray(parsed) ? parsed : parsed?.answers;
    if (!Array.isArray(rows)) return [];
    return rows.flatMap((row: unknown) => {
      if (!row || typeof row !== "object") return [];
      const item = row as Record<string, unknown>;
      const criterionKey = cleanKey(item.criterion_key);
      const confidence = Number(item.confidence);
      const value = item.value as QualificationValue;
      if (
        !criterionKey || !Number.isFinite(confidence) || confidence < 0 ||
        confidence > 1
      ) return [];
      if (
        !["string", "number", "boolean"].includes(typeof value) &&
        value !== null
      ) return [];
      return [{ criterion_key: criterionKey, value, confidence }];
    });
  } catch (_error) {
    return [];
  }
}

export function restrictQualificationAnswersToExpectedCriterion(params: {
  message: string;
  expectedCriterionKey?: string | null;
  answers: QualificationAnswer[];
  shortAnswerWordLimit?: number;
}): QualificationAnswer[] {
  const expectedCriterionKey = cleanKey(params.expectedCriterionKey);
  if (!expectedCriterionKey) return params.answers;

  const wordCount =
    String(params.message || "").trim().split(/\s+/).filter(Boolean).length;
  const wordLimit = Math.max(1, params.shortAnswerWordLimit ?? 12);
  if (wordCount > wordLimit) return params.answers;

  return params.answers.filter((answer) =>
    answer.criterion_key === expectedCriterionKey
  );
}

export function mergeQualificationFacts(params: {
  config: QualificationConfig;
  currentFacts?: Record<string, QualificationValue> | null;
  answers: QualificationAnswer[];
  minimumConfidence?: number;
}): {
  facts: Record<string, QualificationValue>;
  acceptedAnswers: QualificationAnswer[];
} {
  const facts = { ...(params.currentFacts || {}) };
  const criteria = new Map(
    (params.config.criteria || []).map((
      criterion,
    ) => [criterion.key, criterion]),
  );
  const acceptedAnswers: QualificationAnswer[] = [];
  const minimumConfidence = params.minimumConfidence ?? 0.72;

  for (const answer of params.answers) {
    const criterion = criteria.get(answer.criterion_key);
    if (
      !criterion || answer.confidence < minimumConfidence ||
      answer.value === null || answer.value === ""
    ) continue;
    const normalizedValue = normalizedComparable(answer.value);
    const recognizedValues = criterion.values?.length
      ? criterion.values
      : criterion.accepted?.length
      ? [...criterion.accepted, "NO", false]
      : [];
    if (recognizedValues.length) {
      const allowed = recognizedValues.map(normalizedComparable);
      if (!allowed.includes(normalizedValue)) continue;
    }
    facts[criterion.key] = normalizedValue;
    acceptedAnswers.push({ ...answer, value: normalizedValue });
  }
  return { facts, acceptedAnswers };
}

export function evaluateQualification(
  config: QualificationConfig,
  facts: Record<string, QualificationValue>,
): QualificationEvaluation {
  const criteria = config.criteria || [];
  const missingFields = criteria
    .filter((criterion) =>
      criterion.required && !hasKnownValue(facts, criterion.key)
    )
    .map((criterion) => criterion.key);
  let score = 0;
  for (const criterion of criteria) {
    if (!hasKnownValue(facts, criterion.key)) continue;
    const value = normalizedComparable(facts[criterion.key]!);
    const qualifies = criterion.accepted?.length
      ? criterion.accepted.map(normalizedComparable).includes(value)
      : value !== false && value !== "NO";
    if (qualifies) score += Math.max(0, Number(criterion.weight || 0));
  }
  score = Math.min(100, Math.round(score));
  const threshold = Math.min(
    100,
    Math.max(0, Number(config.minimum_score ?? 70)),
  );
  const hasRequiredDisqualifier = criteria.some((criterion) => {
    if (
      !criterion.required || !criterion.accepted?.length ||
      !hasKnownValue(facts, criterion.key)
    ) return false;
    const value = normalizedComparable(facts[criterion.key]!);
    return !criterion.accepted.map(normalizedComparable).includes(value);
  });
  return {
    score,
    missingFields,
    status: hasRequiredDisqualifier
      ? "DISQUALIFIED"
      : missingFields.length > 0
      ? "IN_PROGRESS"
      : score < threshold
      ? "DISQUALIFIED"
      : "QUALIFIED",
  };
}

export function nextQualificationQuestion(
  config: QualificationConfig,
  missingFields: string[],
): { key: string; question: string } | null {
  for (const key of missingFields) {
    const criterion = (config.criteria || []).find((item) => item.key === key);
    if (criterion?.question && !HEALTH_DATA_PATTERN.test(criterion.question)) {
      return { key, question: criterion.question.trim() };
    }
  }
  return null;
}

export function buildQualificationExtractionPrompt(params: {
  config: QualificationConfig;
  currentFacts?: Record<string, QualificationValue> | null;
  expectedCriterionKey?: string | null;
  lastOutboundMessage?: string | null;
}): string {
  const criteria = (params.config.criteria || []).map((criterion) => ({
    key: criterion.key,
    values: criterion.values || criterion.accepted || null,
  }));
  return `Voce extrai fatos objetivos de qualificacao de uma unica mensagem de WhatsApp.
Retorne SOMENTE JSON valido no formato {"answers":[{"criterion_key":"...","value":"...","confidence":0.0}]}.
Use somente estas chaves e valores reconhecidos: ${JSON.stringify(criteria)}.
Fatos ja confirmados: ${JSON.stringify(params.currentFacts || {})}.
Pergunta imediatamente anterior: ${
    JSON.stringify(String(params.lastOutboundMessage || "").slice(0, 500))
  }.
Criterio esperado para uma resposta curta ou ambigua: ${
    JSON.stringify(params.expectedCriterionKey || null)
  }.
Nao infira profissao, renda, cargo ou protecao. Se nao estiver explicito, omita.
Se a mensagem for apenas uma confirmacao ou negacao curta, associe-a somente ao criterio esperado.
Nao extraia nem registre dado de saude, peso, altura, doenca, tabagismo ou historico familiar.
Uma resposta pode confirmar mais de um criterio, mas cada item precisa de confianca entre 0 e 1.`;
}

export function buildQualificationResponseInstruction(params: {
  evaluation: QualificationEvaluation;
  nextQuestion: { key: string; question: string } | null;
  userRequestedHuman?: boolean;
}): string {
  const agendaAllowed = params.evaluation.status === "QUALIFIED" ||
    params.userRequestedHuman === true;
  return `\n\n### ESTADO ESTRUTURADO DE QUALIFICACAO
- Status: ${params.evaluation.status}
- Score interno: ${params.evaluation.score}/100 (nunca revele este score)
- Campos pendentes: ${params.evaluation.missingFields.join(", ") || "nenhum"}
- Proxima pergunta permitida: ${params.nextQuestion?.question || "nenhuma"}

Regras obrigatorias: responda primeiro ao que a pessoa perguntou; faca no maximo UMA pergunta nesta mensagem; ${
    params.nextQuestion
      ? `se fizer pergunta de qualificacao, use somente: "${params.nextQuestion.question}"`
      : "nao invente outra pergunta de qualificacao"
  }; nao colete dados de saude nesta etapa; ${
    agendaAllowed
      ? "pode oferecer encaminhamento humano se for natural"
      : "nao ofereca agenda, reuniao ou ligacao ainda"
  }.`;
}

function declarativeResponseText(text: string): string {
  return String(text || "")
    .split(/(?<=[.!?])\s+|\n+/)
    .map((part) => part.trim())
    .filter((part) => part && !part.includes("?"))
    .join(" ")
    .trim();
}

export function enforceQualificationResponse(params: {
  text: string;
  evaluation: QualificationEvaluation;
  nextQuestion?: { key: string; question: string } | null;
}): string {
  if (
    params.evaluation.status === "IN_PROGRESS" && params.nextQuestion?.question
  ) {
    const statement = declarativeResponseText(params.text);
    return [statement, params.nextQuestion.question.trim()].filter(Boolean)
      .join("\n\n");
  }

  if (params.evaluation.status === "DISQUALIFIED") {
    const statement = declarativeResponseText(params.text);
    return statement ||
      "Entendi. Obrigado por compartilhar seu cenário; neste momento, faz mais sentido não avançarmos. Se a situação mudar, fico à disposição.";
  }

  return params.text;
}
