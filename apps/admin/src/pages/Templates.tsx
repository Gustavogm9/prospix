import { useState } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, Button, toast, Badge, Modal } from '@prospix/ui';
import { Plus, Edit3, Trash2, Layers, AlertTriangle } from 'lucide-react';

interface ScriptNode {
  id: string;
  type: 'greeting' | 'question' | 'condition' | 'action' | 'appointment' | 'fallback';
  label: string;
  messageText: string;
  intentTrigger?: string;
}

interface Template {
  id: string;
  title: string;
  description: string;
  category: string;
  activeVariantsCount: number;
  nodes: ScriptNode[];
}

export default function Templates() {
  const [templates, setTemplates] = useState<Template[]>([
    {
      id: '1',
      title: 'Seguro Saúde Empresarial B2B',
      description: 'Template otimizado para prospectar pequenas e médias empresas (PMEs) pelo WhatsApp com inibidor de IA sob recusa.',
      category: 'Saúde',
      activeVariantsCount: 3,
      nodes: [
        { id: 'node_1', type: 'greeting', label: 'Saudação & Apresentação', messageText: 'Olá! Sou a consultora virtual da Prospix. Identificamos que a sua empresa possui potencial de otimização fiscal contratando seguro saúde estruturado. Gostaria de 2 minutos?' },
        { id: 'node_2', type: 'question', label: 'Coleta de Colaboradores', messageText: 'Excelente! Quantos colaboradores ativos vocês possuem no regime CLT atualmente?', intentTrigger: 'prosseguir_saude' },
        { id: 'node_3', type: 'condition', label: 'Validação de CNPJ', messageText: 'Entendido. Para calcularmos o enquadramento de grupo, qual é o CNPJ ativo da corretora/empresa?' },
        { id: 'node_4', type: 'appointment', label: 'Agendamento Direto', messageText: 'Perfeito! Encontrei slots vagos com nosso especialista em saúde amanhã. Qual dos horários abaixo fica melhor para você?' }
      ]
    },
    {
      id: '2',
      title: 'Seguro Automotivo Simplificado',
      description: 'Fluxo rápido para cotação expressa de apólices veiculares, gerando fit score com base no CEP de pernoite.',
      category: 'Automotivo',
      activeVariantsCount: 2,
      nodes: [
        { id: 'node_1', type: 'greeting', label: 'Saudação Veicular', messageText: 'Olá, percebemos que o seguro do seu veículo está próximo do vencimento. Que tal cotar uma redução de até 30% em menos de 1 minuto?' },
        { id: 'node_2', type: 'question', label: 'Modelo do Veículo', messageText: 'Qual o ano e modelo do carro que você deseja proteger hoje?', intentTrigger: 'cotacao_auto' },
        { id: 'node_3', type: 'appointment', label: 'Call de Fechamento', messageText: 'Tenho os valores aqui! Nosso consultor quer te passar os termos e fechar o PIX. Podemos ligar agora?' }
      ]
    }
  ]);

  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null);
  const [isEditingJson, setIsEditingJson] = useState(false);
  const [jsonString, setJsonString] = useState('');

  // Delete Modal States
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [templateToDelete, setTemplateToDelete] = useState<string | null>(null);

  const handleEditNodes = (tpl: Template) => {
    setSelectedTemplate(tpl);
    setJsonString(JSON.stringify(tpl.nodes, null, 2));
    setIsEditingJson(true);
  };

  const handleSaveNodes = () => {
    if (!selectedTemplate) return;

    try {
      const parsedNodes = JSON.parse(jsonString);
      if (!Array.isArray(parsedNodes)) {
        throw new Error('Os nós do roteiro precisam ser um Array de objetos JSON.');
      }

      setTemplates(templates.map(t => t.id === selectedTemplate.id ? { ...t, nodes: parsedNodes } : t));
      setIsEditingJson(false);
      setSelectedTemplate(null);
      
      toast.success('Estrutura Salva!', 'Os nós do template master foram compilados e atualizados.');
    } catch (e: any) {
      toast.error('Erro de Sintaxe JSON', e.message || 'Verifique se o JSON de grafos e nós está válido.');
    }
  };

  const handleDeleteClick = (id: string) => {
    setTemplateToDelete(id);
    setDeleteModalOpen(true);
  };

  const confirmDelete = () => {
    if (templateToDelete) {
      setTemplates(templates.filter(t => t.id !== templateToDelete));
      toast.success('Template Removido', 'Arquivo de fluxo master apagado com sucesso.');
    }
    setDeleteModalOpen(false);
    setTemplateToDelete(null);
  };

  const handleCreateNew = () => {
    const newTpl: Template = {
      id: (templates.length + 1).toString(),
      title: 'Roteiro Master Novo',
      description: 'Abordagem geral B2B pronta para clonagem.',
      category: 'Geral',
      activeVariantsCount: 1,
      nodes: [
        { id: 'node_1', type: 'greeting', label: 'Boas vindas', messageText: 'Olá! Como posso ajudar você hoje?' }
      ]
    };
    setTemplates([...templates, newTpl]);
    toast.success('Template Inicializado', 'Novo template master adicionado à biblioteca de clones.');
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-200 h-full flex flex-col">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 shrink-0">
        <div>
          <h2 className="text-3xl font-bold font-heading text-text tracking-tight">Roteiros e Templates Master</h2>
          <p className="text-text-secondary text-sm mt-1">
            Biblioteca de fluxos em grafos de IA. Novos tenants clonam esses templates durante o onboarding.
          </p>
        </div>
        {!isEditingJson && (
          <Button
            onClick={handleCreateNew}
            className="bg-primary hover:bg-primary/95 text-white font-bold text-xs px-4 h-10 rounded-xl flex items-center gap-2 self-start sm:self-auto shadow-sm transition-all"
          >
            <Plus className="w-4 h-4 text-white font-bold" />
            <span>Novo Template Master</span>
          </Button>
        )}
      </div>

      {!isEditingJson ? (
        /* Template List */
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 flex-1 overflow-y-auto">
          {templates.map((tpl) => (
            <Card key={tpl.id} className="bg-surface border-border flex flex-col justify-between shadow-sm hover:shadow-md transition-all duration-200">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-surface-sunken text-text-secondary border border-border/60 font-heading">
                        {tpl.category}
                      </span>
                      <span className="text-[10px] text-primary font-mono font-semibold">ID: {tpl.id}</span>
                    </div>
                    <CardTitle className="text-lg font-bold text-text leading-tight mt-1">{tpl.title}</CardTitle>
                  </div>
                  <Badge variant="warning" className="text-[10px] shrink-0 font-bold font-heading">
                    {tpl.nodes.length} nós de decisão
                  </Badge>
                </div>
                <CardDescription className="text-text-secondary text-xs mt-3 leading-relaxed">
                  {tpl.description}
                </CardDescription>
              </CardHeader>
              
              <CardContent className="pt-3 border-t border-border mt-4 flex items-center justify-between gap-3 bg-surface-sunken/20 rounded-b-xl">
                <span className="text-[10px] text-text-muted font-medium font-heading">
                  {tpl.activeVariantsCount} variações A/B ativas por nó
                </span>
                
                <div className="flex items-center gap-2">
                  <Button
                    onClick={() => handleEditNodes(tpl)}
                    className="bg-surface hover:bg-surface-sunken text-text border border-border/80 text-[10px] px-3 py-1.5 h-8 rounded-lg font-bold flex items-center gap-1 shadow-sm transition-all"
                  >
                    <Edit3 className="w-3.5 h-3.5 text-primary" />
                    <span>Editar Nós</span>
                  </Button>
                  <Button
                    onClick={() => handleDeleteClick(tpl.id)}
                    className="bg-surface hover:bg-error-soft text-text-secondary hover:text-error border border-border/80 hover:border-error-soft text-[10px] px-3 py-1.5 h-8 rounded-lg font-bold flex items-center gap-1 shadow-sm transition-all"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        /* Grafo / Node JSON Editor */
        <Card className="bg-surface border-border flex-1 overflow-hidden flex flex-col shadow-md animate-in slide-in-from-bottom-4 duration-300">
          <CardHeader className="border-b border-border py-4 px-6 shrink-0 flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-base font-bold text-text">
                Editando Roteiro: <span className="text-primary font-mono font-semibold">{selectedTemplate?.title}</span>
              </CardTitle>
              <CardDescription className="text-xs text-text-secondary">
                Estrutura de grafos em JSON. Respeite as propriedades id, type, label e messageText.
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Button
                onClick={() => {
                  setIsEditingJson(false);
                  setSelectedTemplate(null);
                }}
                className="bg-surface-sunken hover:bg-border/60 text-text text-xs px-4 h-9 rounded-xl font-semibold border border-border/40 transition-all"
              >
                Cancelar
              </Button>
              <Button
                onClick={handleSaveNodes}
                className="bg-primary hover:bg-primary/95 text-white font-bold text-xs px-4 h-9 rounded-xl flex items-center gap-1.5 shadow-sm transition-all"
              >
                <Layers className="w-4 h-4 text-white font-bold" />
                <span>Salvar & Compilar</span>
              </Button>
            </div>
          </CardHeader>
          <CardContent className="p-0 flex-1 overflow-hidden flex flex-col md:flex-row">
            {/* JSON Code Area */}
            <div className="flex-1 border-r border-border p-6 flex flex-col h-full bg-surface-sunken/40">
              <label className="text-[10px] text-text-secondary uppercase tracking-widest font-mono font-bold block mb-2">
                Especificação de nós (Prisma JSON format)
              </label>
              <textarea
                value={jsonString}
                onChange={(e) => setJsonString(e.target.value)}
                className="w-full flex-1 bg-white border border-border rounded-xl p-4 font-mono text-[11px] text-text focus:outline-none focus:ring-2 focus:ring-primary/10 focus:border-primary resize-none h-[420px] leading-relaxed shadow-inner"
              />
            </div>
            
            {/* Visual Node Tree Preview Side */}
            <div className="w-full md:w-[280px] p-6 bg-surface-sunken/20 overflow-y-auto h-full space-y-4">
              <h4 className="text-[10px] text-text-secondary uppercase tracking-widest font-bold font-mono">
                Visualização do Grafo
              </h4>
              
              <div className="space-y-3">
                {selectedTemplate?.nodes.map((node, index) => (
                  <div key={node.id} className="relative flex items-start gap-3">
                    <div className="flex flex-col items-center">
                      <div className="h-6 w-6 rounded-full bg-white text-text-secondary border border-border flex items-center justify-center text-[10px] font-mono font-bold shadow-sm">
                        {index + 1}
                      </div>
                      {index < selectedTemplate.nodes.length - 1 && (
                        <div className="w-0.5 h-16 bg-border my-1" />
                      )}
                    </div>
                    
                    <div className="flex-1 bg-white border border-border p-3 rounded-xl space-y-1 shadow-sm">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[10px] font-bold text-text truncate max-w-[120px]">{node.label}</span>
                        <Badge variant="neutral" className="text-[8px] uppercase tracking-wider py-0 px-1.5 font-bold font-heading">
                          {node.type}
                        </Badge>
                      </div>
                      <p className="text-[9px] text-text-muted line-clamp-2 mt-1 leading-snug">{node.messageText}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Custom Confirmation Modal for Deleting */}
      <Modal
        isOpen={deleteModalOpen}
        onClose={() => setDeleteModalOpen(false)}
        title="Confirmar Exclusão"
        footer={
          <div className="flex justify-end gap-2">
            <Button
              onClick={() => setDeleteModalOpen(false)}
              className="bg-surface-sunken hover:bg-border/60 text-text font-semibold text-xs px-4 h-9 rounded-xl border border-border/40 transition-all"
            >
              Cancelar
            </Button>
            <Button
              onClick={confirmDelete}
              className="bg-error hover:bg-error-soft text-white hover:text-error-text font-bold text-xs px-4 h-9 rounded-xl transition-all shadow-sm"
            >
              Excluir Permanente
            </Button>
          </div>
        }
      >
        <div className="flex items-start gap-3 py-1">
          <div className="p-2 rounded-xl bg-error-soft text-error shrink-0">
            <AlertTriangle className="w-5 h-5" />
          </div>
          <div>
            <p className="font-semibold text-text text-sm mb-1">Apagar Template Master?</p>
            <p className="text-text-secondary text-xs leading-relaxed">
              Você tem certeza de que deseja deletar este template master permanente? 
              Novos inquilinos (tenants) não poderão mais clonar este fluxo durante o onboarding. 
              Esta ação não pode ser desfeita.
            </p>
          </div>
        </div>
      </Modal>
    </div>
  );
}
