import { describe, expect, it } from 'vitest';

import { validateQualification } from '../../../../supabase/functions/_shared/guardians/validators/qualification';
import type { EffectiveGuardian } from '../../../../supabase/functions/_shared/guardians/types';

const guardian = {
  guardian_key: 'G09_QUALIFICATION',
  name: 'Qualification',
  description: '',
  layer: 'GENERATION',
  execution_stage: 'POST_GENERATION',
  function_scope: 'webhook-evolution',
  enabled: true,
  mode: 'BLOCK',
  fail_policy: 'FAIL_CLOSED',
  is_system_critical: false,
  sort_order: 90,
  variables: [],
} satisfies EffectiveGuardian;

describe('G09 qualification guardian', () => {
  it('blocks stacked questions and premature agenda invitations', () => {
    const result = validateQualification(guardian, {
      tenantId: 'tenant',
      stage: 'POST_GENERATION',
      functionScope: 'webhook-evolution',
      output: { messages: [{ text: 'Como voce lida com isso hoje? Quer agendar uma reuniao?' }] },
      facts: { qualification_status: 'IN_PROGRESS', user_requested_human: false },
    });
    expect(result.decision).toBe('BLOCK');
    expect(result.evidence?.reasons).toEqual(expect.arrayContaining(['question_stack', 'premature_agenda']));
  });

  it('allows one consultative question while qualification is in progress', () => {
    const result = validateQualification(guardian, {
      tenantId: 'tenant',
      stage: 'POST_GENERATION',
      functionScope: 'webhook-evolution',
      output: { messages: [{ text: 'Entendi. Hoje sua renda depende diretamente da sua atuacao?' }] },
      facts: { qualification_status: 'IN_PROGRESS', user_requested_human: false },
    });
    expect(result.decision).toBe('PASS');
  });
});
