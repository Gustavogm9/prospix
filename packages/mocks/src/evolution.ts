/**
 * Mock da Evolution API (WhatsApp gateway self-hosted).
 * Endpoints espelham https://doc.evolution-api.com.
 */

import { http, HttpResponse } from 'msw';

export const evolutionHandlers = [
  // Enviar texto
  http.post('*/message/sendText/:instance', async ({ request, params }) => {
    const body = (await request.json()) as { number: string; text: string };
    return HttpResponse.json({
      key: {
        remoteJid: `${body.number}@s.whatsapp.net`,
        fromMe: true,
        id: `mock_${Date.now()}`,
      },
      message: { conversation: body.text },
      messageTimestamp: Math.floor(Date.now() / 1000),
      status: 'PENDING',
      instance: params.instance,
    });
  }),

  // Checar se número tem WhatsApp
  http.post('*/chat/whatsappNumbers/:instance', async ({ request }) => {
    const body = (await request.json()) as { numbers: string[] };
    return HttpResponse.json(
      body.numbers.map((n) => ({
        exists: n.length >= 12, // só "valida" números longos no mock
        jid: `${n}@s.whatsapp.net`,
        number: n,
      })),
    );
  }),

  // Status da instância
  http.get('*/instance/connectionState/:instance', () =>
    HttpResponse.json({
      instance: { state: 'open' },
    }),
  ),
];

export const evolutionFixtures = {
  inboundMessageWebhook: {
    event: 'messages.upsert',
    instance: 'tenant_giovane',
    data: {
      key: {
        remoteJid: '5517998764422@s.whatsapp.net',
        fromMe: false,
        id: 'mock_inbound_001',
      },
      pushName: 'Rodrigo Maluf',
      message: { conversation: 'Pode explicar sim, já tenho seguro de vida' },
      messageTimestamp: Math.floor(Date.now() / 1000),
    },
  },
  statusWebhook: {
    event: 'messages.update',
    instance: 'tenant_giovane',
    data: {
      key: { id: 'mock_001', fromMe: true, remoteJid: '5517998764422@s.whatsapp.net' },
      status: 'DELIVERED',
    },
  },
};
