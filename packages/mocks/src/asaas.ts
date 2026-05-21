import { http, HttpResponse } from 'msw';

export const asaasHandlers = [
  // Criar cliente
  http.post('*/customers', async ({ request }) => {
    const body = (await request.json()) as { name: string; email: string };
    return HttpResponse.json({
      id: `cus_mock_${Date.now()}`,
      ...body,
      object: 'customer',
    });
  }),
  // Criar cobrança recorrente
  http.post('*/subscriptions', async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    return HttpResponse.json({
      id: `sub_mock_${Date.now()}`,
      ...body,
      status: 'ACTIVE',
      object: 'subscription',
    });
  }),
  // Criar cobrança avulsa (setup)
  http.post('*/payments', async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    return HttpResponse.json({
      id: `pay_mock_${Date.now()}`,
      ...body,
      status: 'PENDING',
      object: 'payment',
    });
  }),
];

export const asaasFixtures = {
  paymentConfirmedWebhook: {
    event: 'PAYMENT_CONFIRMED',
    payment: {
      id: 'pay_mock_001',
      customer: 'cus_mock_001',
      value: 490,
      status: 'CONFIRMED',
      dueDate: '2026-06-01',
      billingType: 'PIX',
    },
  },
};
