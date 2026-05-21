import { http, HttpResponse } from 'msw';

export const openaiHandlers = [
  http.post('https://api.openai.com/v1/chat/completions', async ({ request }) => {
    const body = (await request.json()) as {
      model: string;
      messages: Array<{ role: string; content: string }>;
    };
    const lastUserMsg = [...body.messages]
      .reverse()
      .find((m: { role: string; content: string }) => m.role === 'user')?.content ?? '';

    // Simulação minimalista — detecta opt-out e classifier vs system
    const isClassifier = body.messages[0]?.content?.includes('classificador');
    const isOptout = /sair|parar|não quero/i.test(lastUserMsg);

    const reply = isClassifier
      ? JSON.stringify({
          intent: isOptout ? 'optout_request' : 'unclear',
          confidence: 0.9,
          rationale: 'mock',
        })
      : 'Olá! Obrigado pelo retorno. Quando podemos conversar 30 minutos?';

    return HttpResponse.json({
      id: `chatcmpl-mock-${Date.now()}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: body.model,
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: reply },
          finish_reason: 'stop',
        },
      ],
      usage: { prompt_tokens: 320, completion_tokens: 48, total_tokens: 368 },
    });
  }),
];
