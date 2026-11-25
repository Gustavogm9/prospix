export const ONBOARDING_STEPS = [
  { id: 'whatsapp', title: 'Conecte seu WhatsApp', description: 'Abra as integrações, conecte seu número e aguarde a confirmação da conexão.', href: '/configuracoes?tab=integracoes', action: 'Conectar WhatsApp' },
  { id: 'firstLead', title: 'Cadastre o primeiro cliente', description: 'Adicione um contato autorizado em Meus Leads. O cadastro não envia mensagens.', href: '/leads/novo', action: 'Cadastrar cliente' },
  { id: 'icp', title: 'Defina seu cliente ideal (ICP)', description: 'Escolha o perfil e os critérios que ajudam a reconhecer uma boa oportunidade.', href: '/icps', action: 'Definir ICP' },
  { id: 'context', title: 'Apresente seu negócio', description: 'Informe o que você oferece, como atende e o tom de voz da assistente.', href: '/configuracoes?tab=contexto', action: 'Preencher perfil comercial' },
  { id: 'firstScript', title: 'Prepare e ative seu roteiro', description: 'Revise a abordagem, as perguntas e os limites da assistente. Ativar um roteiro não ativa uma campanha.', href: '/roteiros', action: 'Preparar roteiro' },
] as const;
export type StepId = typeof ONBOARDING_STEPS[number]['id'];
export type OnboardingProgress = Record<StepId, boolean>;
export function nextStep(progress: Partial<Record<string, boolean>>): StepId | null {
  return ONBOARDING_STEPS.find(step => progress[step.id] !== true)?.id ?? null;
}
export function onboardingKey(tenantId: string, userId: string) {
  return `prospix-onboarding:v2:${tenantId}:${userId}`;
}
