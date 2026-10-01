import { describe, expect, it } from 'vitest';

import {
  buildQualificationExtractionPrompt,
  buildQualificationResponseInstruction,
  evaluateQualification,
  mergeQualificationFacts,
  nextQualificationQuestion,
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
});
