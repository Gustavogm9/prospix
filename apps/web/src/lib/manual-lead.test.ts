import { describe, expect, it, vi } from 'vitest';
import { createManualLead } from './manual-lead';
const input = { name: 'Contato fictício', whatsapp: '5511999991234', address: {}, profession: 'OTHER' as const };
function database(responses: unknown[]) {
  const q = { select: vi.fn(() => q), eq: vi.fn(() => q), maybeSingle: vi.fn(() => Promise.resolve(responses.shift())), insert: vi.fn(() => q), single: vi.fn(() => Promise.resolve(responses.shift())), then: (resolve: (v: unknown) => unknown) => Promise.resolve(responses.shift()).then(resolve) };
  return { q, client: { from: vi.fn(() => q) } };
}
describe('serviço compartilhado de cadastro manual', () => {
  it('reenvio confirmado devolve o mesmo contato sem inserir novamente', async () => {
    const db = database([{ data: { id: 'operation-a', ...input, email: null }, error: null }]);
    const result = await createManualLead(db.client as any, 'tenant-a', input, 'operation-a');
    expect(result.data?.id).toBe('operation-a');
    expect(db.q.eq).toHaveBeenCalledWith('tenant_id', 'tenant-a');
    expect(db.q.insert).not.toHaveBeenCalled();
  });
  it('a mesma chave não pode representar outro cliente', async () => {
    const db = database([{ data: { id: 'operation-a', ...input, name: 'Outro' }, error: null }]);
    expect((await createManualLead(db.client as any, 'tenant-a', input, 'operation-a')).error?.code).toBe('CONFLICT');
    expect(db.q.insert).not.toHaveBeenCalled();
  });
  it('falha de consulta não é tratada como contato inexistente', async () => {
    const db = database([{ data: null, error: { code: 'unavailable', message: 'unavailable' } }]);
    expect((await createManualLead(db.client as any, 'tenant-a', input)).error?.code).toBe('unavailable');
    expect(db.q.insert).not.toHaveBeenCalled();
  });
});
