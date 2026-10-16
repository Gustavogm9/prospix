import { describe, expect, it } from 'vitest';

import {
  buildQualificationExtractionPrompt,
  buildQualificationResponseInstruction,
  evaluateQualification,
  mergeQualificationFacts,
  nextQualificationQuestion,
  normalizeQualificationAnswerSemantics,
  parseQualificationExtraction,
  type QualificationConfig,
} from '../../../../supabase/functions/_shared/qualification';

const config: QualificationConfig = {
  minimum_score: 70,
  collect_health_data: false,
  criteria: [
    { key: 'professional_profile_confirmed', required: true, weight: 20, values: [true, false], accepted: [true], question: 'Sua renda depende da sua atuacao?' },
    { key: 'decision_role', required: true, weight: 25, values: ['SELF', 'SHARED', 'OTHER', 'UNKNOWN'], accepted: ['SELF', 'SHARED'], question: 'Essa decisao passa por voce?' },
    { key: 'income_dependency', required: true, weight: 30, values: ['HIGH', 'MEDIUM', 'LOW', 'NONE', 'UNKNOWN'], accepted: ['HIGH', 'MEDIUM'], question: 'Um afastamento afetaria sua renda?' },
    { key: 'protection_gap', required: true, weight: 25, values: ['NONE', 'PARTIAL', 'FULL', 'UNKNOWN'], accepted: ['NONE', 'PARTIAL', 'UNKNOWN'], question: 'Voce ja tem protecao de renda?' },
  ],
};

describe('structured qualification', () => {
  it('accepts only configured, sufficiently confident facts', () => {
    const answers = parseQualificationExtraction(JSON.stringify({ answers: [
      { criterion_key: 'decision_role', value: 'self', confidence: 0.94 },
      { criterion_key: 'health_condition', value: 'anything', confidence: 0.99 },
      { criterion_key: 'income_dependency', value: 'HIGH', confidence: 0.4 },
    ] }));
    const merged = mergeQualificationFacts({ config, answers });
    expect(merged.facts).toEqual({ decision_role: 'SELF' });
    expect(merged.acceptedAnswers).toHaveLength(1);
  });

  it('qualifies only after every required criterion is known and accepted', () => {
    const evaluation = evaluateQualification(config, {
      professional_profile_confirmed: true,
      decision_role: 'SELF',
      income_dependency: 'HIGH',
      protection_gap: 'PARTIAL',
    });
    expect(evaluation).toEqual({ score: 100, status: 'QUALIFIED', missingFields: [] });
  });

  it('records a recognized negative answer and disqualifies instead of asking forever', () => {
    const merged = mergeQualificationFacts({
      config,
      currentFacts: {
        professional_profile_confirmed: true,
        decision_role: 'SELF',
        income_dependency: 'HIGH',
      },
      answers: [{ criterion_key: 'protection_gap', value: 'FULL', confidence: 0.96 }],
    });
    expect(evaluateQualification(config, merged.facts)).toEqual({
      score: 75,
      status: 'DISQUALIFIED',
      missingFields: [],
    });
  });

  it('stops immediately on a required negative answer even when other fields are missing', () => {
    expect(evaluateQualification(config, {
      professional_profile_confirmed: false,
    })).toEqual({
      score: 0,
      status: 'DISQUALIFIED',
      missingFields: ['decision_role', 'income_dependency', 'protection_gap'],
    });
  });

  it('selects exactly the next pending question and blocks agenda while incomplete', () => {
    const evaluation = evaluateQualification(config, { professional_profile_confirmed: true });
    const next = nextQualificationQuestion(config, evaluation.missingFields);
    const instruction = buildQualificationResponseInstruction({ evaluation, nextQuestion: next });
    expect(next?.key).toBe('decision_role');
    expect(instruction).toContain('no maximo UMA pergunta');
    expect(instruction).toContain('nao ofereca agenda');
  });

  it('anchors short replies to the question that was actually asked', () => {
    const prompt = buildQualificationExtractionPrompt({
      config,
      currentFacts: {},
      expectedCriterionKey: 'professional_profile_confirmed',
      lastOutboundMessage: 'Sua renda depende da sua atuacao?',
    });
    expect(prompt).toContain('professional_profile_confirmed');
    expect(prompt).toContain('resposta curta ou ambigua');
    expect(prompt).toContain('Sua renda depende da sua atuacao?');
  });

  it('converts a weekly lead volume into the configured monthly range', () => {
    const volumeConfig: QualificationConfig = {
      minimum_score: 70,
      criteria: [{
        key: 'monthly_lead_volume',
        required: true,
        weight: 100,
        values: ['UP_TO_100', 'FROM_101_TO_500', 'FROM_501_TO_2000', 'ABOVE_2000', 'UNKNOWN'],
        accepted: ['UP_TO_100', 'FROM_101_TO_500', 'FROM_501_TO_2000', 'ABOVE_2000'],
        question: 'Em média, quantos novos contatos vocês tentam trabalhar por mês?',
      }],
    };
    for (const extractedValue of [30, 120]) {
      const answers = normalizeQualificationAnswerSemantics({
        message: 'Não sei direito, mas uns 30 por semana',
        answers: [{ criterion_key: 'monthly_lead_volume', value: extractedValue, confidence: 0.95 }],
      });
      const merged = mergeQualificationFacts({ config: volumeConfig, answers });

      expect(merged.facts).toEqual({ monthly_lead_volume: 'FROM_101_TO_500' });
      expect(evaluateQualification(volumeConfig, merged.facts).missingFields).toEqual([]);
    }
  });
});
