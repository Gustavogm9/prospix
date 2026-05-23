type LegalDocumentProps = {
  kind: 'terms' | 'privacy';
};

const documents = {
  terms: {
    title: 'Termos de Uso',
    updatedAt: 'Última atualização: 22 de Maio de 2026',
    intro:
      'Ao utilizar o Prospix, você concorda com estes Termos de Uso. O serviço é oferecido pela Guilds como uma plataforma SaaS de apoio à prospecção comercial, automação de mensagens e organização de agenda.',
    sections: [
      {
        title: '1. Objeto',
        body: 'O Prospix disponibiliza uma licença de uso de software por prazo determinado, com recursos para captura, qualificação, contato e acompanhamento comercial. Funcionalidades específicas podem variar conforme o plano contratado, integrações habilitadas e limites operacionais aplicáveis.',
      },
      {
        title: '2. Responsabilidades do usuário',
        body: 'O contratante é responsável pela origem, legalidade e adequação das bases de contatos utilizadas, bem como pela definição das hipóteses legais e permissões necessárias para abordagens comerciais. O Prospix atua como ferramenta tecnológica de apoio à execução desses fluxos.',
      },
      {
        title: '3. Uso aceitável',
        body: 'A plataforma não deve ser usada para envio de spam, coleta abusiva de dados, tentativa de burlar regras de terceiros ou qualquer atividade contrária à legislação aplicável, às políticas dos canais integrados ou aos direitos dos titulares de dados.',
      },
      {
        title: '4. Faturamento e suspensão',
        body: 'A cobrança pode ocorrer por boleto, PIX ou outro meio acordado comercialmente. Atrasos ou uso em desacordo com estes termos podem levar à limitação ou suspensão do acesso, mediante comunicação pelos canais de suporte disponíveis.',
      },
    ],
  },
  privacy: {
    title: 'Política de Privacidade',
    updatedAt: 'Última atualização: 22 de Maio de 2026',
    intro:
      'Esta Política de Privacidade descreve, em linhas gerais, como o Prospix trata dados pessoais para operar a plataforma, prestar suporte, melhorar a segurança e cumprir obrigações legais ou contratuais.',
    sections: [
      {
        title: '1. Dados tratados',
        body: 'Podemos tratar dados cadastrais, dados de contato, informações de convite, identificadores de conta, registros de uso, configurações de integrações e dados necessários para executar os fluxos comerciais configurados pelo cliente.',
      },
      {
        title: '2. Finalidades',
        body: 'Os dados são utilizados para autenticação, onboarding, operação da plataforma, suporte, auditoria, segurança, faturamento e execução das automações solicitadas pelo cliente. Não vendemos dados pessoais.',
      },
      {
        title: '3. Segurança e isolamento',
        body: 'Adotamos controles técnicos e organizacionais compatíveis com uma aplicação SaaS multi-tenant, incluindo segregação lógica por tenant, autenticação e proteção de credenciais quando aplicável. Nenhum controle elimina totalmente riscos, mas buscamos reduzi-los continuamente.',
      },
      {
        title: '4. Direitos dos titulares',
        body: 'Solicitações de acesso, correção, exclusão, portabilidade ou informações sobre tratamento de dados podem ser enviadas ao canal de privacidade. As respostas serão avaliadas conforme a LGPD, os contratos aplicáveis e a necessidade de preservação de registros legais.',
      },
    ],
  },
} as const;

export default function LegalDocument({ kind }: LegalDocumentProps) {
  const document = documents[kind];

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-50 px-4 py-12">
      <main className="mx-auto max-w-3xl rounded-2xl border border-zinc-800 bg-zinc-900/70 p-6 shadow-2xl sm:p-10">
        <a href="/login" className="text-xs font-semibold text-blue-400 hover:underline">
          Voltar para login
        </a>

        <div className="mt-6">
          <h1 className="font-heading text-2xl font-bold text-zinc-50">{document.title}</h1>
          <p className="mt-1 text-xs text-zinc-500">{document.updatedAt}</p>
        </div>

        <p className="mt-8 text-sm leading-7 text-zinc-300">{document.intro}</p>

        <div className="mt-8 space-y-6">
          {document.sections.map((section) => (
            <section key={section.title}>
              <h2 className="text-sm font-bold text-zinc-100">{section.title}</h2>
              <p className="mt-2 text-sm leading-7 text-zinc-400">{section.body}</p>
            </section>
          ))}
        </div>

        <div className="mt-10 border-t border-zinc-800 pt-6 text-xs leading-6 text-zinc-500">
          Para dúvidas sobre privacidade ou contratos, entre em contato pelo canal oficial de suporte da Prospix.
        </div>
      </main>
    </div>
  );
}
