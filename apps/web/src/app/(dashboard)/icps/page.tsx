'use client';

import { Target, Plus, Edit2, Loader2, Info, X, Trash2, Sliders, AlertTriangle, ArrowLeft } from 'lucide-react';
import { useEffect, useState, useCallback } from 'react';
import { icpsQueries } from '@/lib/queries';
import type { ICP } from '@/lib/queries';
import { useAuthStore } from '@/store/auth-store';
import { toast, Tooltip } from '@prospix/ui';
import Link from 'next/link';

const CRITERION_LABELS: Record<string, { label: string; icon: string; desc: string }> = {
  profession_match: { label: 'Segmento Bate', icon: '🎯', desc: 'Dá preferência ao lead do nicho correto.' },
  whatsapp_valid: { label: 'WhatsApp Válido', icon: '📱', desc: 'Pontua maior se o número for validado.' },
  is_owner: { label: 'Sócio/Proprietário', icon: '👤', desc: 'Prioriza cargos de decisão da empresa.' },
  high_value_area: { label: 'Bairro Premium', icon: '📍', desc: 'Dá peso extra em bairros ricos definidos.' },
  cnpj_years: { label: 'Tempo de Atuação', icon: '📅', desc: 'Favorece CNPJs com maior idade.' },
  google_reputation: { label: 'Reputação Google', icon: '⭐', desc: 'Pontua baseado nas notas do Google Maps.' },
};

export default function ICPsPage() {
  const tenantId = useAuthStore(state => state.tenantId);
  const [icps, setIcps] = useState<ICP[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [editingIcp, setEditingIcp] = useState<ICP | null>(null);
  
  // Form state
  const [name, setName] = useState('');
  const [minFitScore, setMinFitScore] = useState(3);
  const [highValueAreas, setHighValueAreas] = useState('');
  const [minGoogleRating, setMinGoogleRating] = useState(4.0);
  const [minReviews, setMinReviews] = useState(5);
  
  // Weight states (0 to 5)
  const [weights, setWeights] = useState<Record<string, number>>({
    profession_match: 3,
    whatsapp_valid: 2,
    is_owner: 2,
    high_value_area: 1,
    cnpj_years: 1,
    google_reputation: 1,
  });

  const [icpToDelete, setIcpToDelete] = useState<ICP | null>(null);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const fetchIcps = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true);
    try {
      const result = await icpsQueries.list(tenantId);
      if (result.error) throw new Error(result.error.message);
      setIcps(result.data || []);
    } catch (err) {
      console.error(err);
      toast.error('Erro ao carregar', 'Não foi possível carregar os perfis de cliente ideal (ICP).');
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    fetchIcps();
  }, [fetchIcps]);

  const resetForm = () => {
    setName('');
    setMinFitScore(3);
    setHighValueAreas('');
    setMinGoogleRating(4.0);
    setMinReviews(5);
    setWeights({
      profession_match: 3,
      whatsapp_valid: 2,
      is_owner: 2,
      high_value_area: 1,
      cnpj_years: 1,
      google_reputation: 1,
    });
    setEditingIcp(null);
  };

  const handleOpenCreate = () => {
    resetForm();
    setIsModalOpen(true);
  };

  const handleEdit = (icp: ICP) => {
    setEditingIcp(icp);
    setName(icp.name);
    setMinFitScore(icp.min_fit_score);
    setHighValueAreas((icp.high_value_areas || []).join(', '));
    setMinGoogleRating(Number(icp.min_google_rating || 4.0));
    setMinReviews(icp.min_reviews || 5);
    
    const w = (icp.weights as Record<string, number>) || {};
    setWeights({
      profession_match: w.profession_match ?? 3,
      whatsapp_valid: w.whatsapp_valid ?? 2,
      is_owner: w.is_owner ?? 2,
      high_value_area: w.high_value_area ?? 1,
      cnpj_years: w.cnpj_years ?? 1,
      google_reputation: w.google_reputation ?? 1,
    });
    
    setIsModalOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      toast.error('Nome obrigatório', 'Dê um nome amigável ao perfil ICP.');
      return;
    }
    if (!tenantId) return;

    setIsSaving(true);
    const payload = {
      name: name.trim(),
      minFitScore,
      weights,
      highValueAreas: highValueAreas.split(',').map(a => a.trim()).filter(Boolean),
      minGoogleRating,
      minReviews,
    };

    try {
      if (editingIcp) {
        const res = await icpsQueries.update(tenantId, editingIcp.id, payload);
        if (res.error) throw new Error(res.error.message);
        toast.success('ICP Atualizado', 'As alterações foram salvas com sucesso.');
      } else {
        const res = await icpsQueries.create(tenantId, payload);
        if (res.error) throw new Error(res.error.message);
        toast.success('ICP Criado', 'Novo perfil de cliente ideal cadastrado com sucesso.');
      }
      setIsModalOpen(false);
      resetForm();
      await fetchIcps();
    } catch (err) {
      console.error(err);
      toast.error('Erro ao salvar', editingIcp ? 'Não foi possível atualizar o ICP.' : 'Não foi possível criar o ICP.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = (icp: ICP) => {
    setIcpToDelete(icp);
    setDeleteConfirmText('');
  };

  const handleConfirmDelete = async () => {
    if (!icpToDelete || !tenantId) return;
    if (deleteConfirmText !== 'EXCLUIR') {
      toast.error('Confirmação inválida', 'Digite EXCLUIR para confirmar a exclusão.');
      return;
    }

    const icpId = icpToDelete.id;
    setActionLoading(icpId);
    setIcpToDelete(null);

    try {
      const res = await icpsQueries.delete(tenantId, icpId);
      if (res.error) {
        // Se houver restrição de FK (está em uso por alguma campanha)
        if (res.error.code === '23503' || res.error.message.includes('violates foreign key constraint')) {
          toast.error('ICP em Uso', 'Não é possível deletar este ICP pois existem campanhas vinculadas a ele. Desvincule-o primeiro.');
        } else {
          throw new Error(res.error.message);
        }
      } else {
        toast.success('ICP Excluído', 'O perfil de cliente ideal foi removido.');
        await fetchIcps();
      }
    } catch (err) {
      console.error(err);
      toast.error('Erro ao excluir', 'Ocorreu um problema ao remover o ICP.');
    } finally {
      setActionLoading(null);
    }
  };

  if (loading) {
    return (
      <div className="space-y-4 animate-fadeIn">
        <div className="h-12 bg-white animate-pulse rounded-xl border border-[#E5E7EB]" />
        <div className="h-10 bg-white animate-pulse rounded-lg border border-[#E5E7EB]" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[1, 2].map(i => <div key={i} className="h-64 bg-white animate-pulse rounded-xl border border-[#E5E7EB]" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5 animate-fadeIn">
      {/* Voltar e Header */}
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <Link href="/campanhas" className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-[#1B3A6B] hover:underline mb-1">
            <ArrowLeft className="w-3.5 h-3.5" /> Voltar para Campanhas
          </Link>
          <h1 className="text-[20px] font-bold text-[#0F172A] flex items-center gap-2">
            <Target className="w-5 h-5 text-[#1B3A6B]" /> Perfis de Cliente Ideal (ICP)
          </h1>
          <p className="text-[12.5px] text-[#64748B]">
            Gerencie os critérios de pontuação automática e qualificação de leads do seu negócio.
          </p>
        </div>
        <button
          onClick={handleOpenCreate}
          className="h-9 px-4 rounded-lg text-[13px] font-semibold bg-[#1B3A6B] text-white flex items-center gap-1.5 hover:bg-[#142C52] transition-all shadow-sm shrink-0"
        >
          <Plus className="w-4 h-4" /> Novo Perfil
        </button>
      </div>

      {/* Explicativo */}
      <div className="flex items-start gap-3 p-4 bg-gradient-to-r from-[rgba(27,58,107,0.04)] to-[rgba(232,152,28,0.06)] border border-[rgba(27,58,107,0.08)] rounded-xl text-[12.5px] text-[#0F172A] leading-relaxed">
        <Sliders className="w-4 h-4 text-[#1B3A6B] shrink-0 mt-0.5" />
        <div>
          <strong>Como funciona a qualificação da IA?</strong> O enriquecedor atribui pontos ao lead para cada critério que ele atende, multiplicados pelo respectivo peso configurado no ICP. Leads que atingirem a pontuação mínima configurada são marcados como <strong>Qualificados (Fit Score alto)</strong> e passam automaticamente para a esteira de prospecção e mensagens.
        </div>
      </div>

      {/* Grid de ICPs */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {icps.map(icp => {
          const w = (icp.weights as Record<string, number>) || {};
          const highAreas = icp.high_value_areas || [];
          return (
            <div
              key={icp.id}
              className="bg-white border border-[#E5E7EB] rounded-xl overflow-hidden shadow-sm hover:shadow-md transition-all flex flex-col justify-between"
            >
              <div className="p-5 space-y-4">
                {/* Header Card */}
                <div className="flex items-start justify-between gap-3 border-b border-[#F1F3F6] pb-3">
                  <div className="min-w-0">
                    <h3 className="text-[15px] font-bold text-[#0F172A] truncate" title={icp.name}>
                      {icp.name}
                    </h3>
                    <p className="text-[11px] text-[#64748B] mt-0.5">
                      Criado em {new Date(icp.created_at).toLocaleDateString('pt-BR')}
                    </p>
                  </div>
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[#EFF6FF] text-[#1B3A6B] border border-[#DBEAFE] text-[11.5px] font-bold shrink-0">
                    ⚡ Score Mín: {icp.min_fit_score}
                  </span>
                </div>

                {/* Pesos dos Critérios */}
                <div>
                  <div className="text-[10px] text-[#64748B] font-bold uppercase tracking-wider mb-2">
                    Pesos dos Critérios
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-[12px]">
                    {Object.entries(CRITERION_LABELS).map(([key, item]) => {
                      const weightVal = w[key] ?? 0;
                      return (
                        <div key={key} className="flex items-center justify-between p-2 bg-[#F8FAFC] border border-[#E5E7EB] rounded-lg">
                          <span className="flex items-center gap-1.5 min-w-0">
                            <span className="text-[13px] shrink-0">{item.icon}</span>
                            <span className="font-medium text-[#475569] truncate">{item.label}</span>
                          </span>
                          <span className="text-[12px] font-bold text-[#1B3A6B] font-mono bg-[#E0E7FF] px-1.5 py-0.5 rounded">
                            {weightVal}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Localidade e Google */}
                <div className="grid grid-cols-2 gap-3 text-[12px] border-t border-[#F1F3F6] pt-3">
                  <div>
                    <span className="text-[10px] text-[#64748B] font-bold uppercase block mb-1">
                      Min. Reputação Google
                    </span>
                    <span className="font-semibold text-[#0F172A] flex items-center gap-1">
                      ⭐ {Number(icp.min_google_rating || 0).toFixed(1)} / 💬 {icp.min_reviews || 0} reviews
                    </span>
                  </div>
                  <div>
                    <span className="text-[10px] text-[#64748B] font-bold uppercase block mb-1">
                      Bairros Premium ({highAreas.length})
                    </span>
                    <div className="truncate font-semibold text-[#0F172A]" title={highAreas.join(', ')}>
                      {highAreas.length > 0 ? highAreas.join(', ') : 'Nenhum'}
                    </div>
                  </div>
                </div>
              </div>

              {/* Ações */}
              <div className="px-5 py-3.5 bg-[#FAFBFC] border-t border-[#EEF0F3] flex justify-end gap-2">
                <button
                  onClick={() => handleEdit(icp)}
                  className="h-8 px-3 rounded-lg text-[12px] font-semibold bg-white border border-[#E5E7EB] hover:bg-[#F8FAFC] text-[#475569] transition-all flex items-center gap-1"
                >
                  <Edit2 className="w-3.5 h-3.5" /> Editar
                </button>
                <button
                  onClick={() => handleDelete(icp)}
                  disabled={actionLoading === icp.id}
                  className="h-8 px-3 rounded-lg text-[12px] font-semibold bg-[#FEF3F2] text-[#D92D20] border border-[#FEE4E2] hover:bg-[#FEE4E2] transition-all flex items-center gap-1 disabled:opacity-50"
                >
                  {actionLoading === icp.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />} Excluir
                </button>
              </div>
            </div>
          );
        })}

        {/* Card Criar Novo */}
        <div
          onClick={handleOpenCreate}
          className="bg-white border-2 border-dashed border-[#D0D5DD] rounded-xl p-8 flex flex-col items-center justify-center cursor-pointer transition-all hover:border-[#1B3A6B] hover:bg-[rgba(27,58,107,0.04)] text-[#64748B] hover:text-[#1B3A6B] min-h-[260px]"
        >
          <Plus className="w-10 h-10 mb-2" />
          <h4 className="text-[14px] font-semibold text-[#0F172A]">Criar novo perfil ICP</h4>
          <p className="text-[12px] text-[#64748B] mt-1 text-center max-w-[280px]">
            Defina uma nova estratégia de pesos e bairros nobres para segmentar seus leads.
          </p>
        </div>
      </div>

      {icps.length === 0 && !loading && (
        <div className="flex items-center gap-2 px-4 py-3 bg-[rgba(27,58,107,0.04)] rounded-lg text-[12px] text-[#475569]">
          <Info className="w-4 h-4 text-[#1B3A6B] shrink-0" />
          Nenhum perfil cadastrado. Crie um novo ICP para habilitar a criação de campanhas.
        </div>
      )}

      {/* ═══ Drawer / Modal de Criação e Edição ═══ */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setIsModalOpen(false)}>
          <form onSubmit={handleSave} onClick={e => e.stopPropagation()} className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-6 space-y-4 animate-fadeIn">
            <div className="flex items-center justify-between mb-2 border-b border-[#F1F3F6] pb-3">
              <h3 className="text-[16px] font-bold text-[#0F172A] flex items-center gap-2">
                <Target className="w-4.5 h-4.5 text-[#1B3A6B]" />
                {editingIcp ? 'Editar Perfil ICP' : 'Novo Perfil ICP'}
              </h3>
              <button type="button" onClick={() => setIsModalOpen(false)} className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-[#F1F3F6] text-[#64748B]">
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Nome */}
            <div>
              <label className="text-[11px] font-semibold text-[#475569] uppercase tracking-wider block mb-1">
                Nome do Perfil ICP
              </label>
              <input
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="Ex: Clínicas Médicas VIP SP"
                className="w-full h-9 px-3 rounded-lg bg-[#F9FAFB] border border-[#E5E7EB] text-[13px] focus:border-[#1B3A6B] focus:ring-1 focus:ring-[#1B3A6B] outline-none font-medium"
                autoFocus
              />
            </div>

            {/* Score Mínimo (Slider) */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-[11px] font-semibold text-[#475569] uppercase tracking-wider flex items-center gap-1">
                  Score Mínimo de Qualificação
                </label>
                <span className="text-[12.5px] font-bold text-[#1B3A6B] font-mono bg-[#EEF2F6] px-2 py-0.5 rounded">
                  {minFitScore} pontos
                </span>
              </div>
              <input
                type="range"
                min="0"
                max="15"
                step="1"
                value={minFitScore}
                onChange={e => setMinFitScore(Number(e.target.value))}
                className="w-full h-2 rounded-full appearance-none cursor-pointer accent-[#1B3A6B] bg-[#E5E7EB]"
              />
              <div className="flex justify-between text-[9px] text-[#94A3B8] mt-0.5">
                <span>0 — aceita todos</span>
                <span>15 — super restritivo</span>
              </div>
            </div>

            {/* Pesos (Sliders de 0 a 5) */}
            <div>
              <label className="text-[11px] font-semibold text-[#475569] uppercase tracking-wider block mb-2">
                Definição de Pesos dos Critérios
              </label>
              <div className="space-y-2.5 p-3.5 bg-[#F9FAFB] border border-[#E5E7EB] rounded-xl">
                {Object.entries(CRITERION_LABELS).map(([key, item]) => {
                  const weightVal = weights[key] ?? 0;
                  return (
                    <div key={key} className="space-y-1">
                      <div className="flex items-center justify-between text-[12px]">
                        <span className="flex items-center gap-1 text-[#0F172A] font-semibold">
                          <span>{item.icon}</span>
                          <span>{item.label}</span>
                          <Tooltip content={item.desc}>
                            <Info className="w-3 h-3 text-[#CBD5E1] hover:text-[#64748B] cursor-help ml-1" />
                          </Tooltip>
                        </span>
                        <span className="font-bold text-[#1B3A6B] font-mono">{weightVal}</span>
                      </div>
                      <input
                        type="range"
                        min="0"
                        max="5"
                        step="1"
                        value={weightVal}
                        onChange={e => setWeights(p => ({ ...p, [key]: Number(e.target.value) }))}
                        className="w-full h-1.5 rounded-full appearance-none cursor-pointer accent-[#1B3A6B] bg-[#E5E7EB]"
                      />
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Bairros de alto valor */}
            <div>
              <label className="text-[11px] font-semibold text-[#475569] uppercase tracking-wider block mb-1">
                Bairros de Alto Valor (separados por vírgula)
              </label>
              <input
                value={highValueAreas}
                onChange={e => setHighValueAreas(e.target.value)}
                placeholder="Jardins, Pinheiros, Itaim Bibi"
                className="w-full h-9 px-3 rounded-lg bg-[#F9FAFB] border border-[#E5E7EB] text-[13px] focus:border-[#1B3A6B] outline-none"
              />
            </div>

            {/* Google rating e reviews */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-[11px] font-semibold text-[#475569] uppercase tracking-wider block mb-1">
                  Nota Google Mínima (0 a 5)
                </label>
                <input
                  type="number"
                  min="0"
                  max="5"
                  step="0.1"
                  value={minGoogleRating}
                  onChange={e => setMinGoogleRating(Number(e.target.value))}
                  className="w-full h-9 px-3 rounded-lg bg-[#F9FAFB] border border-[#E5E7EB] text-[13px] focus:border-[#1B3A6B] outline-none font-medium"
                />
              </div>
              <div>
                <label className="text-[11px] font-semibold text-[#475569] uppercase tracking-wider block mb-1">
                  Mín. de Avaliações
                </label>
                <input
                  type="number"
                  min="0"
                  max="1000"
                  value={minReviews}
                  onChange={e => setMinReviews(Number(e.target.value))}
                  className="w-full h-9 px-3 rounded-lg bg-[#F9FAFB] border border-[#E5E7EB] text-[13px] focus:border-[#1B3A6B] outline-none font-medium"
                />
              </div>
            </div>

            {/* Botão de Envio */}
            <button
              type="submit"
              disabled={isSaving}
              className="w-full h-10 rounded-lg text-[13px] font-semibold bg-[#1B3A6B] text-white hover:bg-[#142C52] transition-all disabled:opacity-50 flex items-center justify-center gap-2 shadow-sm"
            >
              {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : editingIcp ? <Edit2 className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
              {isSaving ? 'Salvando...' : editingIcp ? 'Salvar Alterações' : 'Criar Perfil ICP'}
            </button>
          </form>
        </div>
      )}

      {/* ═══ Safe Delete Modal ═══ */}
      {icpToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setIcpToDelete(null)}>
          <div onClick={e => e.stopPropagation()} className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 space-y-4 animate-fadeIn">
            <div className="flex items-center justify-between">
              <h3 className="text-[16px] font-bold text-[#D92D20] flex items-center gap-2">
                <AlertTriangle className="w-4 h-4" />
                Excluir Perfil ICP
              </h3>
              <button onClick={() => setIcpToDelete(null)} className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-[#F1F3F6] text-[#64748B]">
                <X className="w-4 h-4" />
              </button>
            </div>
            
            <p className="text-[13px] text-[#475569] leading-relaxed">
              Tem certeza que deseja excluir o perfil <strong>&quot;{icpToDelete.name}&quot;</strong>? Esta ação é irreversível e só é permitida se nenhuma campanha ativa estiver utilizando este perfil.
            </p>
            
            <div>
              <label className="text-[11px] font-semibold text-[#475569] uppercase tracking-wider block mb-1">
                Para confirmar, digite <strong>EXCLUIR</strong>
              </label>
              <input 
                type="text" 
                value={deleteConfirmText}
                onChange={e => setDeleteConfirmText(e.target.value.toUpperCase())}
                placeholder="EXCLUIR"
                className="w-full h-9 px-3 rounded-lg bg-[#F9FAFB] border border-[#E5E7EB] text-[13px] focus:border-[#D92D20] focus:ring-1 focus:ring-[#D92D20] outline-none font-bold text-center"
                autoFocus
              />
            </div>
            
            <div className="flex gap-3 mt-4">
              <button onClick={() => setIcpToDelete(null)} className="flex-1 h-10 rounded-lg text-[13px] font-semibold bg-[#F1F3F6] text-[#0F172A] hover:bg-[#E5E7EB] transition-all">
                Cancelar
              </button>
              <button 
                onClick={handleConfirmDelete}
                disabled={deleteConfirmText !== 'EXCLUIR'}
                className="flex-1 h-10 rounded-lg text-[13px] font-semibold bg-[#D92D20] text-white hover:bg-[#B42318] transition-all disabled:opacity-50"
              >
                Confirmar Exclusão
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
