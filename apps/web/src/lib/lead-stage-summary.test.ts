import { describe, expect, it } from 'vitest';
import { leadStageSummary } from './lead-stage-summary';

describe('etapas registradas dos leads', () => {
  it('não transforma descartes ou resultados de venda em comprovantes de mensagem ou reunião', () => {
    const stages = leadStageSummary({ CAPTURED: 4, CONTACTED: 2, CONVERSING: 1, QUALIFIED: 1,
      MEETING_SCHEDULED: 1, CLOSED_WON: 3, INVALID_NUMBER: 5, COMMERCIAL_LEAD_SKIPPED: 6, OPTED_OUT: 7 }, 8);
    expect(stages.map(stage => stage.value)).toEqual([30, 8, 2, 1, 1, 1]);
  });
  it('exibe zero quando não existe lead na etapa', () => {
    expect(leadStageSummary({}, 0).map(stage => stage.value)).toEqual([0, 0, 0, 0, 0, 0]);
  });
});
