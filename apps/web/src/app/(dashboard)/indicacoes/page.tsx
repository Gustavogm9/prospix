'use client';

import { Star, Copy, Users, Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { apiClient } from '@/lib/api-client';
import { toast } from '@prospix/ui';

interface Referral {
  id: string;
  name: string;
  status: string;
  phone: string;
  createdAt: string;
}

const REFERRAL_STEPS = [
  { step: '1', title: 'Indique um corretor', desc: 'Compartilhe seu link de indicação' },
  { step: '2', title: 'Ele se cadastra', desc: 'E começa a usar o Prospix' },
  { step: '3', title: 'Vocês ganham', desc: 'Ambos recebem 30 dias grátis' },
  { step: '4', title: 'Upgrade', desc: 'A cada 5 indicações, ganhe mais benefícios' },
];

import { useAuthStore } from '@/store/auth-store';

export default function Referrals() {
  const [referrals, setReferrals] = useState<Referral[]>([]);
  const [loading, setLoading] = useState(true);
  const { tenantId, user } = useAuthStore();
  const refCode = tenantId ? tenantId.substring(0, 8) : (user?.id?.substring(0, 8) || 'default');
  const referralLink = `${window.location.origin}/ref/${refCode}`;
  const [stats, setStats] = useState<{ totalClicks: number; totalSignups: number; conversionRate: number }>({ totalClicks: 0, totalSignups: 0, conversionRate: 0 });
  const [rewardTier, setRewardTier] = useState<string>('bronze');

  useEffect(() => {
    const fetchReferrals = async () => {
      try {
        // Register our refCode mapping first
        await apiClient.post('/tenant/referrals/register-code').catch(() => {});

        // Fetch real referral stats
        const response = await apiClient.get('/tenant/referrals');
        const data = response.data?.data;
        
        if (data) {
          setStats(data.stats || { totalClicks: 0, totalSignups: 0, conversionRate: 0 });
          setRewardTier(data.rewards?.currentTier || 'bronze');

          // Map recent activity as referrals list
          const activity = (data.recentActivity || [])
            .filter((a: any) => a.type === 'signup')
            .map((a: any, i: number) => ({
              id: `ref-${i}`,
              name: `Corretor indicado #${i + 1}`,
              status: 'QUALIFIED',
              phone: '',
              createdAt: a.timestamp ? new Date(a.timestamp).toLocaleDateString('pt-BR') : '-',
            }));
          setReferrals(activity);
        }
      } catch (err) {
        console.error('Failed to fetch referrals', err);
        toast.error('Erro ao carregar', 'Não foi possível carregar indicações.');
        setReferrals([]);
      } finally {
        setLoading(false);
      }
    };
    fetchReferrals();
  }, []);

  const handleCopyLink = () => {
    navigator.clipboard.writeText(referralLink);
    toast.success('Link copiado!', 'Compartilhe com corretores que você conhece.');
  };

  const statusBadge = (status: string) => {
    switch (status) {
      case 'CONTACTED': return { label: 'Contatado', cls: 'bg-[rgba(232,152,28,0.14)] text-[#A56B0A]' };
      case 'QUALIFIED': return { label: 'Qualificado', cls: 'bg-[#ECFDF3] text-[#027A48]' };
      case 'CLOSED_WON': return { label: 'Fechado!', cls: 'bg-[#ECFDF3] text-[#027A48]' };
      default: return { label: 'Pendente', cls: 'bg-[#F1F3F6] text-[#475569]' };
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-60">
        <Loader2 className="w-6 h-6 text-[#1B3A6B] animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-5 animate-fadeIn">
      {/* Info */}
      <div className="flex items-center gap-3 px-4 py-3 bg-gradient-to-r from-[rgba(27,58,107,0.04)] to-[rgba(232,152,28,0.06)] border border-[rgba(27,58,107,0.08)] rounded-xl text-[12.5px] text-[#0F172A]">
        <Star className="w-4 h-4 text-[#E8981C] shrink-0" />
        <div><strong>Programa de Indicações.</strong> Indique colegas corretores e ganhe benefícios exclusivos no Prospix.</div>
      </div>

      {/* How it works */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {REFERRAL_STEPS.map(s => (
          <div key={s.step} className="bg-white border border-[#E5E7EB] rounded-xl p-4 text-center hover:-translate-y-0.5 transition-all shadow-sm">
            <div className="w-8 h-8 rounded-full bg-[rgba(27,58,107,0.08)] text-[#1B3A6B] font-bold text-[13px] flex items-center justify-center mx-auto mb-2">{s.step}</div>
            <div className="text-[12.5px] font-semibold text-[#0F172A]">{s.title}</div>
            <div className="text-[11px] text-[#64748B] mt-0.5">{s.desc}</div>
          </div>
        ))}
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-white border border-[#E5E7EB] rounded-xl p-4 shadow-sm">
          <div className="text-[11px] text-[#64748B] font-medium">Cliques no link</div>
          <div className="text-[22px] font-bold text-[#0F172A] mt-1">{stats.totalClicks}</div>
        </div>
        <div className="bg-white border border-[#E5E7EB] rounded-xl p-4 shadow-sm">
          <div className="text-[11px] text-[#64748B] font-medium">Cadastros</div>
          <div className="text-[22px] font-bold text-[#027A48] mt-1">{stats.totalSignups}</div>
        </div>
        <div className="bg-white border border-[#E5E7EB] rounded-xl p-4 shadow-sm">
          <div className="text-[11px] text-[#64748B] font-medium">Conversão</div>
          <div className="text-[22px] font-bold text-[#1B3A6B] mt-1">{stats.conversionRate}%</div>
        </div>
        <div className="bg-white border border-[#E5E7EB] rounded-xl p-4 shadow-sm">
          <div className="text-[11px] text-[#64748B] font-medium">Seu tier</div>
          <div className={`text-[22px] font-bold mt-1 capitalize ${rewardTier === 'gold' ? 'text-[#E8981C]' : rewardTier === 'silver' ? 'text-[#475569]' : 'text-[#B8740E]'}`}>{rewardTier}</div>
        </div>
      </div>

      {/* Referral link */}
      <div className="bg-white border border-[#E5E7EB] rounded-xl p-4 shadow-sm">
        <div className="text-[13px] font-semibold text-[#0F172A] mb-2">Seu link de indicação</div>
        <div className="flex flex-col sm:flex-row gap-2">
          <input readOnly value={referralLink} className="flex-1 h-9 px-3 rounded-lg bg-[#F9FAFB] border border-[#E5E7EB] text-[12px] text-[#475569] font-mono" />
          <button onClick={handleCopyLink} className="h-9 px-3 rounded-lg text-[12px] font-medium bg-[#F1F3F6] text-[#0F172A] hover:bg-[#E5E7EB] flex items-center gap-1.5 transition-all">
            <Copy className="w-3.5 h-3.5" />
            Copiar
          </button>
          <button 
            className="h-9 px-3 rounded-lg text-[12px] font-medium bg-[#25D366] text-white hover:bg-[#1FAD54] flex items-center gap-1.5 transition-colors"
            onClick={() => window.open(`https://wa.me/?text=${encodeURIComponent(`Conheça o Prospix! Use meu link: ${referralLink}`)}`, '_blank')}
          >
            <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/></svg>
            WhatsApp
          </button>
        </div>
      </div>

      {/* Referrals list */}
      <div className="bg-white border border-[#E5E7EB] rounded-xl overflow-hidden shadow-sm">
        <div className="px-4 py-3 border-b border-[#EEF0F3] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-[#1B3A6B]" />
            <span className="text-[14px] font-semibold text-[#0F172A]">Suas indicações</span>
            <span className="text-[11px] font-mono text-[#64748B]">· {referrals.length}</span>
          </div>
        </div>

        {referrals.length > 0 ? (
          <div className="divide-y divide-[#EEF0F3]">
            {referrals.map(ref => {
              const badge = statusBadge(ref.status);
              return (
                <div key={ref.id} className="px-4 py-3 flex items-center gap-3 hover:bg-[#F9FAFB] transition-colors">
                  <div className="w-8 h-8 rounded-full bg-[rgba(232,152,28,0.14)] text-[#A56B0A] flex items-center justify-center text-[11px] font-bold shrink-0">
                    {ref.name.split(' ').map(w => w[0]).join('').substring(0,2).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-semibold text-[#0F172A]">{ref.name}</div>
                    <div className="text-[11px] text-[#64748B]">{ref.createdAt} · {ref.phone || 'Sem telefone'}</div>
                  </div>
                  <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${badge.cls}`}>{badge.label}</span>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="px-4 py-8 text-center">
            <Star className="w-8 h-8 text-[#E5E7EB] mx-auto mb-2" />
            <div className="text-[13px] font-semibold text-[#0F172A]">Nenhuma indicação ainda</div>
            <div className="text-[11px] text-[#64748B] mt-1">Compartilhe seu link acima para começar a indicar corretores!</div>
          </div>
        )}
      </div>
    </div>
  );
}
