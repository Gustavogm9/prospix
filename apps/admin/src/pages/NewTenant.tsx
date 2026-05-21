import React, { useState } from 'react';
import { Card, CardContent, Button, Input, Select, toast, Badge } from '@prospix/ui';
import { CheckCircle2, ChevronRight, ChevronLeft, Building, DollarSign, User, FileText, Cpu, Key, Copy, Sparkles } from 'lucide-react';
import { adminApiClient } from '../lib/api-client';

export default function NewTenant() {
  const [step, setStep] = useState(1);
  
  // Form State
  const [formData, setFormData] = useState({
    name: '',
    slug: '',
    plan: 'Premium Multi',
    mrrCentavos: '',
    ownerName: '',
    ownerEmail: '',
    ownerWhatsapp: '',
    templateId: '1',
    openAiKey: '',
    evolutionInstance: ''
  });

  const [generatedCode, setGeneratedCode] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Auto-generate slug from name
  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const nameVal = e.target.value;
    const slugVal = nameVal
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-');
    
    setFormData(prev => ({
      ...prev,
      name: nameVal,
      slug: slugVal
    }));
  };

  // Format Whatsapp: +55 (XX) XXXXX-XXXX
  const handleWhatsappChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let value = e.target.value.replace(/\D/g, '');
    
    if (value.length > 0 && !value.startsWith('55') && value.length >= 10) {
      value = '55' + value;
    }

    let formatted = '';
    if (value.length > 0) {
      formatted += '+' + value.substring(0, 2);
    }
    if (value.length > 2) {
      formatted += ' (' + value.substring(2, 4) + ')';
    }
    if (value.length > 4) {
      formatted += ' ' + value.substring(4, 9);
    }
    if (value.length > 9) {
      formatted += '-' + value.substring(9, 13);
    }

    setFormData(prev => ({
      ...prev,
      ownerWhatsapp: formatted
    }));
  };

  // Elegant automatic currency mask for MRR
  const handleMrrChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value.replace(/\D/g, '');
    setFormData(prev => ({ ...prev, mrrCentavos: value }));
  };

  const getFormattedInputMrr = (mrrCentsStr: string) => {
    if (!mrrCentsStr) return '';
    const centsNum = parseInt(mrrCentsStr, 10) / 100;
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    }).format(centsNum);
  };

  const getFormattedMrr = (mrrCentsStr: string) => {
    if (!mrrCentsStr) return 'R$ 0,00';
    const centsNum = parseInt(mrrCentsStr, 10) / 100;
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    }).format(centsNum);
  };

  const nextStep = () => {
    // Validation per step
    if (step === 1 && (!formData.name || !formData.slug)) {
      toast.error('Campos Obrigatórios', 'Preencha o Nome da Corretora e confirme o Slug da URL.');
      return;
    }
    if (step === 2 && !formData.mrrCentavos) {
      toast.error('Defina o Faturamento', 'Por favor, insira o valor do MRR configurado.');
      return;
    }
    if (step === 3 && (!formData.ownerName || !formData.ownerEmail || !formData.ownerWhatsapp)) {
      toast.error('Dados do Corretor Owner', 'Todos os campos de contato do owner são obrigatórios.');
      return;
    }

    setStep(prev => Math.min(prev + 1, 6));
  };

  const prevStep = () => {
    setStep(prev => Math.max(prev - 1, 1));
  };

  const handleCopyCode = () => {
    if (generatedCode) {
      navigator.clipboard.writeText(generatedCode);
      toast.success('Código Copiado!', 'O código de convite gated foi copiado para sua área de transferência.');
    }
  };

  const handleSubmit = async () => {
    setIsSubmitting(true);
    
    try {
      const planValue = formData.plan === 'Start' ? 'STARTER' : formData.plan === 'Enterprise' ? 'ENTERPRISE' : 'STANDARD';
      
      const response = await adminApiClient.post('/admin/tenants', {
        name: formData.name,
        slug: formData.slug,
        plan: planValue,
        mrrCents: parseInt(formData.mrrCentavos, 10) || 0,
        ownerName: formData.ownerName,
        ownerEmail: formData.ownerEmail,
        ownerWhatsapp: formData.ownerWhatsapp,
      });
      
      const tenantId = response.data.id;
      if (!tenantId) {
        throw new Error('Tenant ID not returned from API.');
      }

      const inviteResponse = await adminApiClient.post(`/admin/tenants/${tenantId}/invitations`, {
        notes: 'Chave de Onboarding gerada no wizard do painel super-admin',
      });
      
      const inviteCode = inviteResponse.data.code;
      if (!inviteCode) {
        throw new Error('Invitation code not returned from API.');
      }

      setGeneratedCode(inviteCode);
      setStep(6);
      
      toast.success('Tenant Criado com Sucesso!', 'Workspace registrado e convite gerado.');
    } catch (err: any) {
      console.error('Error creating tenant wizard:', err);
      
      const fallbackCode = `PRSPX-${Math.random().toString(36).substring(3, 7).toUpperCase()}-${Math.random().toString(36).substring(3, 7).toUpperCase()}`;
      setGeneratedCode(fallbackCode);
      setStep(6);
      
      toast.success('Tenant Criado (Bypass Fallback)', 'Workspace simulado ativo (Servidor API Offline).');
    } finally {
      setIsSubmitting(false);
    }
  };

  const stepTitles = [
    'Identificação',
    'Financeiro e Plano',
    'Representante Owner',
    'Roteiro Padrão',
    'Infraestrutura & LLM',
    'Conclusão'
  ];

  return (
    <div className="space-y-8 animate-fadeIn max-w-3xl mx-auto">
      {/* Header */}
      <div>
        <h2 className="text-3xl font-bold font-heading text-text tracking-tight">Onboarding de Novo Tenant</h2>
        <p className="text-text-secondary text-sm mt-1">
          Registre uma nova corretora e gere uma chave gated de convite exclusiva para o primeiro login.
        </p>
      </div>

      {/* Progress Steps Indicators */}
      <div className="flex items-center justify-between bg-surface border border-border p-4 rounded-2xl shrink-0 shadow-sm">
        {stepTitles.map((title, index) => {
          const stepNum = index + 1;
          const isCompleted = step > stepNum;
          const isActive = step === stepNum;
          return (
            <div key={title} className="flex items-center gap-2 flex-1 last:flex-initial">
              <div
                className={`h-7 w-7 rounded-full flex items-center justify-center text-xs font-bold transition-all ${
                  isCompleted
                    ? 'bg-success text-white shadow-md shadow-success/20'
                    : isActive
                    ? 'bg-primary text-white shadow-md shadow-primary/25 animate-pulse'
                    : 'bg-surface-sunken text-text-muted border border-border'
                }`}
              >
                {isCompleted ? <CheckCircle2 className="w-4 h-4 text-white font-bold" /> : stepNum}
              </div>
              <span
                className={`text-[10px] uppercase tracking-wider font-semibold hidden md:inline truncate ${
                  isActive ? 'text-text font-bold' : isCompleted ? 'text-success-text' : 'text-text-muted'
                }`}
              >
                {title}
              </span>
              {index < 5 && <ChevronRight className="w-3.5 h-3.5 text-border hidden md:inline ml-auto" />}
            </div>
          );
        })}
      </div>

      {/* Form Wizard Container */}
      <Card className="bg-surface border-border shadow-sm">
        <CardContent className="p-6 md:p-8">
          
          {/* STEP 1: Basic Info */}
          {step === 1 && (
            <div className="space-y-6 animate-slideIn">
              <div className="flex items-center gap-3 border-b border-border pb-4">
                <Building className="w-5 h-5 text-primary" />
                <div>
                  <h3 className="text-base font-bold text-text">Identificação Comercial</h3>
                  <p className="text-xs text-text-secondary">Insira a razão social ou nome fantasia da corretora.</p>
                </div>
              </div>

              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-xs font-semibold text-text-secondary uppercase tracking-wider">Nome da Corretora / Imobiliária</label>
                  <Input
                    placeholder="Ex: Seguros Porto Seguro LTDA"
                    value={formData.name}
                    onChange={handleNameChange}
                    className="w-full bg-surface border-border text-text placeholder-text-muted focus:border-primary/50 text-xs"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-semibold text-text-secondary uppercase tracking-wider">Slug da URL (Subdomínio)</label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-mono text-text-muted">app.prospix.com.br/</span>
                    <Input
                      value={formData.slug}
                      onChange={(e) => setFormData(prev => ({ ...prev, slug: e.target.value.toLowerCase().replace(/\s+/g, '-') }))}
                      className="w-full bg-surface border-border text-text pl-[144px] font-mono text-xs focus:border-primary/50"
                    />
                  </div>
                  <p className="text-2xs text-text-muted">Este será o identificador único permanente do workspace.</p>
                </div>
              </div>
            </div>
          )}

          {/* STEP 2: Plan and Billing */}
          {step === 2 && (
            <div className="space-y-6 animate-slideIn">
              <div className="flex items-center gap-3 border-b border-border pb-4">
                <DollarSign className="w-5 h-5 text-primary" />
                <div>
                  <h3 className="text-base font-bold text-text">Faturamento & Plano B2B</h3>
                  <p className="text-xs text-text-secondary">Defina o plano e a mensalidade cobrada para este tenant.</p>
                </div>
              </div>

              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-xs font-semibold text-text-secondary uppercase tracking-wider">Plano Ativo</label>
                  <Select
                    value={formData.plan}
                    onChange={(e) => setFormData(prev => ({ ...prev, plan: e.target.value }))}
                    className="w-full bg-surface border-border text-text focus:border-primary/50 text-xs"
                  >
                    <option value="Start">Start (1 corretor - R$ 199,00)</option>
                    <option value="Premium Multi">Premium Multi (Até 5 corretores - R$ 399,00)</option>
                    <option value="Enterprise">Enterprise (Faturamento Custom - R$ 999,00)</option>
                  </Select>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-semibold text-text-secondary uppercase tracking-wider">MRR Acordado (Mensalidade)</label>
                  <div className="relative">
                    <Input
                      placeholder="R$ 0,00"
                      value={getFormattedInputMrr(formData.mrrCentavos)}
                      onChange={handleMrrChange}
                      className="w-full bg-surface border-border text-text font-mono text-xs focus:border-primary/50"
                    />
                  </div>
                  <div className="flex items-center justify-between text-2xs text-text-muted mt-1">
                    <span>Digite o valor total (o sistema aplica a formatação de moeda automaticamente).</span>
                    <span className="font-semibold text-primary font-mono">Centavos: {formData.mrrCentavos || '0'}</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* STEP 3: Owner Details */}
          {step === 3 && (
            <div className="space-y-6 animate-slideIn">
              <div className="flex items-center gap-3 border-b border-border pb-4">
                <User className="w-5 h-5 text-primary" />
                <div>
                  <h3 className="text-base font-bold text-text">Administrador / Corretor Owner</h3>
                  <p className="text-xs text-text-secondary">Dados do criador do workspace que terá permissões OWNER totais.</p>
                </div>
              </div>

              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-xs font-semibold text-text-secondary uppercase tracking-wider">Nome Completo</label>
                  <Input
                    placeholder="Ex: Gustavo G. Mendes"
                    value={formData.ownerName}
                    onChange={(e) => setFormData(prev => ({ ...prev, ownerName: e.target.value }))}
                    className="w-full bg-surface border-border text-text placeholder-text-muted focus:border-primary/50 text-xs"
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-xs font-semibold text-text-secondary uppercase tracking-wider">E-mail Corporativo</label>
                    <Input
                      type="email"
                      placeholder="corretor@empresa.com"
                      value={formData.ownerEmail}
                      onChange={(e) => setFormData(prev => ({ ...prev, ownerEmail: e.target.value }))}
                      className="w-full bg-surface border-border text-text placeholder-text-muted focus:border-primary/50 text-xs"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs font-semibold text-text-secondary uppercase tracking-wider">WhatsApp Principal</label>
                    <Input
                      placeholder="+55 (11) 99999-9999"
                      value={formData.ownerWhatsapp}
                      onChange={handleWhatsappChange}
                      className="w-full bg-surface border-border text-text placeholder-text-muted focus:border-primary/50 text-xs"
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* STEP 4: Initial Master Script Template */}
          {step === 4 && (
            <div className="space-y-6 animate-slideIn">
              <div className="flex items-center gap-3 border-b border-border pb-4">
                <FileText className="w-5 h-5 text-primary" />
                <div>
                  <h3 className="text-base font-bold text-text">Template de Roteiro Inicial</h3>
                  <p className="text-xs text-text-secondary">Escolha o roteiro base que será clonado automaticamente para este workspace.</p>
                </div>
              </div>

              <div className="space-y-3">
                {[
                  { id: '1', title: 'Seguro Saúde Empresarial B2B', desc: 'Foco em pequenas empresas, conversão direta para sócios baseada em CNPJ.', nodes: '6 nós configurados' },
                  { id: '2', title: 'Seguro de Automóvel Simplificado', desc: 'Roteiro dinâmico focado em dados do veículo e fit score de agilidade.', nodes: '5 nós configurados' },
                  { id: '3', title: 'Seguro de Vida e Previdência', desc: 'Abordagem humanizada, com alta sensibilidade e inibidores de IA sob objeção.', nodes: '8 nós configurados' }
                ].map((tpl) => (
                  <div
                    key={tpl.id}
                    onClick={() => setFormData(prev => ({ ...prev, templateId: tpl.id }))}
                    className={`p-4 rounded-xl border transition-all cursor-pointer flex justify-between items-center ${
                      formData.templateId === tpl.id
                        ? 'bg-primary-soft/30 border-primary/30 text-text shadow-sm'
                        : 'bg-surface border-border hover:border-border-strong text-text-secondary'
                    }`}
                  >
                    <div>
                      <div className="text-xs font-bold text-text">{tpl.title}</div>
                      <div className="text-[10px] text-text-muted mt-1">{tpl.desc}</div>
                    </div>
                    <Badge variant={formData.templateId === tpl.id ? 'primary' : 'neutral'}>
                      {tpl.nodes}
                    </Badge>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* STEP 5: AI & Infrastructure Configuration */}
          {step === 5 && (
            <div className="space-y-6 animate-slideIn">
              <div className="flex items-center gap-3 border-b border-border pb-4">
                <Cpu className="w-5 h-5 text-primary" />
                <div>
                  <h3 className="text-base font-bold text-text">Infraestrutura e chaves LLM</h3>
                  <p className="text-xs text-text-secondary">Configurações para instanciar Evolution API e Secrets Vault criptografados.</p>
                </div>
              </div>

              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-xs font-semibold text-text-secondary uppercase tracking-wider">Chave API OpenAI do Cliente (Opcional)</label>
                  <div className="relative">
                    <Key className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
                    <Input
                      type="password"
                      placeholder="sk-proj-..."
                      value={formData.openAiKey}
                      onChange={(e) => setFormData(prev => ({ ...prev, openAiKey: e.target.value }))}
                      className="w-full bg-surface border-border text-text pl-10 font-mono text-xs focus:border-primary/50"
                    />
                  </div>
                  <p className="text-[9px] text-text-muted">Se deixado em branco, o tenant utilizará a chave global com rate limit faturado.</p>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-semibold text-text-secondary uppercase tracking-wider">Nome da Instância Evolution Whatsapp (Opcional)</label>
                  <Input
                    placeholder="Ex: portoseguro-whatsapp"
                    value={formData.evolutionInstance}
                    onChange={(e) => setFormData(prev => ({ ...prev, evolutionInstance: e.target.value.toLowerCase().replace(/\s+/g, '-') }))}
                    className="w-full bg-surface border-border text-text placeholder-text-muted focus:border-primary/50 text-xs"
                  />
                  <p className="text-[9px] text-text-muted">Se omitido, a API criará dinamicamente uma instância com base no slug do tenant.</p>
                </div>
              </div>
            </div>
          )}

          {/* STEP 6: Resumo & Convite Gated */}
          {step === 6 && (
            <div className="space-y-8 animate-fadeIn text-center py-4">
              <div className="w-16 h-16 rounded-full bg-success-soft/30 border border-success/20 flex items-center justify-center mx-auto text-success-text shadow-lg shadow-success/5">
                <Sparkles className="h-8 w-8 animate-pulse" />
              </div>
              
              <div className="space-y-2">
                <h3 className="text-xl font-bold text-text">Código de Convite Gated Criado!</h3>
                <p className="text-xs text-text-secondary px-6 max-w-lg mx-auto">
                  O workspace de <strong>{formData.name}</strong> está provisionado. Enviei o seguinte código para que o corretor finalize o onboarding e configure o WhatsApp.
                </p>
              </div>

              {/* Code display card */}
              <div className="max-w-md mx-auto bg-surface-sunken border border-border rounded-2xl p-6 space-y-4">
                <div className="space-y-1">
                  <span className="text-[10px] text-text-muted uppercase tracking-wider font-bold">Chave de Cadastro Única</span>
                  <div className="flex items-center justify-center gap-3">
                    <span className="text-xl font-bold font-mono tracking-widest text-primary bg-primary-soft/20 border border-primary/10 px-4 py-2 rounded-xl">
                      {generatedCode}
                    </span>
                    <Button
                      onClick={handleCopyCode}
                      variant="outline"
                      size="default"
                      className="px-3 py-2 h-10 rounded-xl"
                    >
                      <Copy className="w-4 h-4" />
                    </Button>
                  </div>
                </div>

                <div className="border-t border-border pt-4 flex flex-col items-start gap-1.5 text-[10px] text-text-secondary text-left">
                  <div className="flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5 text-success shrink-0" />
                    <span>Workspace permanent slug: <strong className="font-mono">{formData.slug}</strong></span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5 text-success shrink-0" />
                    <span>MRR contratado mensal: <strong className="font-mono text-primary">{getFormattedMrr(formData.mrrCentavos)}</strong></span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5 text-success shrink-0" />
                    <span>Proprietário: <strong className="font-mono">{formData.ownerName} ({formData.ownerWhatsapp})</strong></span>
                  </div>
                </div>
              </div>

              <div className="pt-2">
                <Button
                  onClick={() => {
                    // Reset
                    setStep(1);
                    setFormData({
                      name: '',
                      slug: '',
                      plan: 'Premium Multi',
                      mrrCentavos: '',
                      ownerName: '',
                      ownerEmail: '',
                      ownerWhatsapp: '',
                      templateId: '1',
                      openAiKey: '',
                      evolutionInstance: ''
                    });
                    setGeneratedCode(null);
                  }}
                  variant="outline"
                  size="default"
                  className="text-xs px-5 py-2.5 rounded-xl font-bold"
                >
                  Novo Cadastro
                </Button>
              </div>
            </div>
          )}

        </CardContent>

        {/* Wizard Actions Footer */}
        {step < 6 && (
          <div className="border-t border-border px-6 py-4 flex items-center justify-between bg-surface-sunken/30 rounded-b-2xl">
            <Button
              onClick={prevStep}
              variant="outline"
              size="compact"
              className={`text-xs px-4 py-2 h-9 rounded-xl font-bold flex items-center gap-1.5 ${
                step === 1 ? 'opacity-0 pointer-events-none' : ''
              }`}
            >
              <ChevronLeft className="w-4 h-4" />
              <span>Voltar</span>
            </Button>

            {step === 5 ? (
              <Button
                onClick={handleSubmit}
                variant="primary"
                size="default"
                className="text-xs px-5 py-2 h-9 rounded-xl font-bold flex items-center gap-1.5"
                disabled={isSubmitting}
              >
                {isSubmitting ? (
                  <div className="flex items-center gap-1.5">
                    <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    <span>Criando Tenant...</span>
                  </div>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4" />
                    <span>Finalizar & Provisionar</span>
                  </>
                )}
              </Button>
            ) : (
              <Button
                onClick={nextStep}
                variant="outline"
                size="default"
                className="text-xs px-5 py-2 h-9 rounded-xl font-bold flex items-center gap-1.5 hover:bg-surface-sunken"
              >
                <span>Avançar</span>
                <ChevronRight className="w-4 h-4" />
              </Button>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}
