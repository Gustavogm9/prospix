import { FastifyPluginAsync } from 'fastify';
import { prisma } from '../../lib/prisma.js';
import { logger } from '../../lib/logger.js';

const SCRIPT_TEMPLATES: Record<string, Record<string, { base: string; variations: { name: string; weight: number; content: string }[] }>> = {
  DOCTOR: {
    DIT: {
      base: 'Olá {{nome}}, tudo bem? Sou corretor especializado em seguros para médicos. Muitos colegas seus na região de {{cidade}} já utilizam o DIT (Doenças Incapacitantes por Trabalho) para proteger sua renda caso não possam exercer a medicina. Posso te mostrar como funciona?',
      variations: [
        { name: 'Variante A — Consultiva', weight: 50, content: 'Dr(a). {{nome}}, boa tarde! Trabalho com proteção patrimonial para médicos e notei que muitos profissionais da sua especialidade ainda não conhecem o DIT. É um seguro que garante sua renda caso uma doença impeça você de clinicar. Posso te enviar um material rápido de 2 min?' },
        { name: 'Variante B — Direta', weight: 50, content: '{{nome}}, você sabia que 1 em cada 4 médicos precisará acionar um seguro de incapacidade ao longo da carreira? O DIT protege exatamente isso. Estou disponível para uma conversa rápida de 10 min — quando seria melhor para você?' },
      ],
    },
    KEYMAN: {
      base: 'Olá {{nome}}, sou especialista em seguros para profissionais de saúde. Gostaria de conversar sobre o Key Man Insurance — uma proteção para clínicas que dependem de um sócio-chave. Posso explicar?',
      variations: [
        { name: 'Variante A — Consultiva', weight: 50, content: 'Dr(a). {{nome}}, muitas clínicas médicas dependem de um sócio principal. Se algo acontecer com essa pessoa, a operação pode parar. O Key Man Insurance protege a clínica nesses cenários. Posso agendar 10 minutos para explicar?' },
        { name: 'Variante B — Direta', weight: 50, content: '{{nome}}, sua clínica depende muito de você ou de um sócio? O Key Man Insurance garante a continuidade do negócio. Tenho cases de clínicas na região — posso compartilhar?' },
      ],
    },
    DEFAULT: {
      base: 'Olá {{nome}}, tudo bem? Trabalho com soluções de seguro personalizadas para médicos. Gostaria de entender suas necessidades e apresentar opções que fazem sentido para seu perfil.',
      variations: [
        { name: 'Variante A — Consultiva', weight: 50, content: 'Dr(a). {{nome}}, boa tarde! Como especialista em seguros para a classe médica, gostaria de oferecer uma análise gratuita do seu perfil de proteção. Muitos colegas seus ficam surpresos com as lacunas que encontramos. Posso agendar?' },
        { name: 'Variante B — Direta', weight: 50, content: '{{nome}}, você já revisou suas apólices de seguro este ano? Tenho ajudado médicos a economizar até 30% com coberturas mais inteligentes. Posso te mostrar?' },
      ],
    },
  },
  LAWYER: {
    DEFAULT: {
      base: 'Olá {{nome}}, sou corretor especializado em seguros para advogados. Muitos colegas seus na OAB {{cidade}} já contam com proteção profissional. Posso te apresentar?',
      variations: [
        { name: 'Variante A — Consultiva', weight: 50, content: 'Dr(a). {{nome}}, boa tarde! Trabalho exclusivamente com profissionais do Direito e noto que muitos advogados não têm proteção adequada contra responsabilidade civil profissional. Posso agendar 10 min para conversar?' },
        { name: 'Variante B — Direta', weight: 50, content: '{{nome}}, como advogado(a), você está coberto(a) contra processos de responsabilidade civil? Tenho soluções específicas para a advocacia — posso te enviar uma simulação?' },
      ],
    },
  },
  BUSINESS_OWNER: {
    DEFAULT: {
      base: 'Olá {{nome}}, sou corretor especializado em seguros empresariais. Empresas como a sua podem se beneficiar de proteção patrimonial e key man. Posso te mostrar?',
      variations: [
        { name: 'Variante A — Consultiva', weight: 50, content: '{{nome}}, boa tarde! Trabalho com proteção patrimonial para empresários. Muitos dos meus clientes ficam impressionados com as opções de seguro empresarial que existem hoje. Posso agendar uma conversa rápida?' },
        { name: 'Variante B — Direta', weight: 50, content: '{{nome}}, sua empresa tem seguro empresarial atualizado? Tenho ajudado empresários a proteger patrimônio e garantir a continuidade do negócio. 10 min para explicar — quando fica bom?' },
      ],
    },
  },
};

function generateScript(niche: string, product: string, tone: string) {
  const nicheTemplates = SCRIPT_TEMPLATES[niche] ?? SCRIPT_TEMPLATES['DOCTOR']!;
  const template = nicheTemplates![product] || nicheTemplates!['DEFAULT'] || Object.values(nicheTemplates!)[0];

  if (!template) {
    return {
      baseMessage: `Olá {{nome}}, sou corretor de seguros especializado na sua área. Gostaria de apresentar soluções personalizadas para o seu perfil profissional. Posso agendar uma conversa rápida?`,
      variations: [
        { name: 'Variante A', weight: 50, content: 'Versão consultiva da abordagem padrão — focada em entender necessidades.' },
        { name: 'Variante B', weight: 50, content: 'Versão direta da abordagem — focada em apresentar benefícios rapidamente.' },
      ],
    };
  }

  // Adjust tone
  let base = template.base;
  const vars = template.variations.map((v: { name: string; weight: number; content: string }) => ({ ...v }));

  if (tone === 'FORMAL') {
    base = base.replace('tudo bem?', 'como vai?').replace('Posso te', 'Posso lhe');
    vars.forEach((v: { content: string }) => { v.content = v.content.replace(/Posso te/g, 'Posso lhe'); });
  } else if (tone === 'DIRECT') {
    base = base.replace('Gostaria de conversar sobre', 'Vou direto ao ponto sobre');
  }

  return { baseMessage: base, variations: vars };
}

export const scriptRoutes: FastifyPluginAsync = async (app) => {
  // GET /tenant/scripts — list all scripts
  app.get('/', async (request, reply) => {
    const tenantId = (request as any).tenantId as string;
    try {
      const scripts = await prisma.script.findMany({
        where: { tenantId, archivedAt: null },
        include: { variations: { where: { active: true }, orderBy: { variantLetter: 'asc' } } },
        orderBy: { createdAt: 'desc' },
      });
      return reply.send({ data: scripts });
    } catch (err) {
      logger.error({ err }, 'Error fetching scripts');
      return reply.status(500).send({ message: 'Failed to fetch scripts' });
    }
  });

  // POST /tenant/scripts — create a new script
  app.post('/', async (request, reply) => {
    const tenantId = (request as any).tenantId as string;
    const body = request.body as any;
    try {
      const script = await prisma.script.create({
        data: {
          tenantId,
          name: body.name || 'Novo Roteiro',
          category: body.category || 'APPROACH',
          targetProfession: body.targetProfession || null,
          baseMessage: body.baseMessage || '',
          status: 'DRAFT',
          variables: body.variables || [],
        },
        include: { variations: true },
      });
      return reply.status(201).send({ data: script });
    } catch (err) {
      logger.error({ err }, 'Error creating script');
      return reply.status(500).send({ message: 'Failed to create script' });
    }
  });

  // POST /tenant/scripts/generate — AI generate script
  app.post('/generate', async (request, reply) => {
    const body = request.body as any;
    try {
      const niche = body.niche || 'DOCTOR';
      const product = body.product || 'DEFAULT';
      const tone = body.tone || 'CONSULTATIVE';
      const generated = generateScript(niche, product, tone);
      return reply.send({ data: generated });
    } catch (err) {
      logger.error({ err }, 'Error generating script');
      return reply.status(500).send({ message: 'Failed to generate script' });
    }
  });

  // PUT /tenant/scripts/:id — update a script
  app.put('/:id', async (request, reply) => {
    const tenantId = (request as any).tenantId as string;
    const { id } = request.params as { id: string };
    const body = request.body as any;
    try {
      const existing = await prisma.script.findFirst({ where: { id, tenantId } });
      if (!existing) return reply.status(404).send({ message: 'Script not found' });

      await prisma.script.update({
        where: { id },
        data: {
          ...(body.name !== undefined && { name: body.name }),
          ...(body.baseMessage !== undefined && { baseMessage: body.baseMessage }),
          ...(body.status !== undefined && { status: body.status }),
          ...(body.flow !== undefined && { flow: body.flow }),
        },
        include: { variations: true },
      });

      // Handle variations update if provided
      if (Array.isArray(body.variations)) {
        // Delete old variations and create new ones
        await prisma.scriptVariation.deleteMany({ where: { scriptId: id, tenantId } });
        for (let i = 0; i < body.variations.length; i++) {
          const v = body.variations[i];
          await prisma.scriptVariation.create({
            data: {
              tenantId,
              scriptId: id,
              variantLetter: String.fromCharCode(65 + i),
              message: v.content || v.message || '',
              weight: (v.weight || 50) / 100,
              active: true,
            },
          });
        }
      }

      const updated = await prisma.script.findUnique({
        where: { id },
        include: { variations: { where: { active: true } } },
      });
      return reply.send({ data: updated });
    } catch (err) {
      logger.error({ err }, 'Error updating script');
      return reply.status(500).send({ message: 'Failed to update script' });
    }
  });

  // DELETE /tenant/scripts/:id — archive script
  app.delete('/:id', async (request, reply) => {
    const tenantId = (request as any).tenantId as string;
    const { id } = request.params as { id: string };
    try {
      const existing = await prisma.script.findFirst({ where: { id, tenantId } });
      if (!existing) return reply.status(404).send({ message: 'Script not found' });

      await prisma.script.update({
        where: { id },
        data: { archivedAt: new Date(), status: 'ARCHIVED' },
      });
      return reply.status(204).send();
    } catch (err) {
      logger.error({ err }, 'Error deleting script');
      return reply.status(500).send({ message: 'Failed to delete script' });
    }
  });
};
