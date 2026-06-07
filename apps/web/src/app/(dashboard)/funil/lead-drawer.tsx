'use client';

import React, { useState, useEffect, useRef } from 'react';
import { X, Phone, Mail, MapPin, Star, Building2, Users, Calendar, Globe, Hash, Clock, MessageCircle, FileText, Activity, History, ExternalLink, Briefcase, TrendingUp, Shield, AlertCircle, CheckCircle2, XCircle, User, Send, Check, CheckCheck, Bot } from 'lucide-react';
import { leadsQueries, conversationsQueries } from '@/lib/queries';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/store/auth-store';

interface LeadDrawerProps {
  leadId: string;
  onClose: () => void;
}

const PROFESSION_LABELS: Record<string, string> = {
  DOCTOR: 'Médico(a)', LAWYER: 'Advogado(a)', DENTIST: 'Dentista',
  ENTREPRENEUR: 'Empresário(a)', ENGINEER: 'Engenheiro(a)',
  ARCHITECT: 'Arquiteto(a)', ACCOUNTANT: 'Contador(a)', OTHER: 'Outro',
};

const STATUS_LABELS: Record<string, { label: string; color: string; bg: string }> = {
  CAPTURED: { label: 'Capturado', color: '#64748B', bg: '#F1F5F9' },
  ENRICHED: { label: 'Enriquecido', color: '#0EA5E9', bg: '#F0F9FF' },
  CONTACTED: { label: 'Contatado', color: '#8B5CF6', bg: '#F5F3FF' },
  CONVERSING: { label: 'Em conversa', color: '#E8981C', bg: '#FFF7ED' },
  QUALIFIED: { label: 'Qualificado', color: '#F59E0B', bg: '#FFFBEB' },
  MEETING_SCHEDULED: { label: 'Reunião agendada', color: '#039855', bg: '#ECFDF3' },
  ESCALATED_HUMAN: { label: 'Aguardando você', color: '#F79009', bg: '#FFF7ED' },
  CLOSED_WON: { label: 'Fechado', color: '#1B3A6B', bg: '#EFF6FF' },
  NOT_INTERESTED: { label: 'Sem interesse', color: '#DC2626', bg: '#FEF2F2' },
  ARCHIVED: { label: 'Arquivado', color: '#94A3B8', bg: '#F8FAFC' },
};

type Tab = 'ficha' | 'conversa' | 'saude' | 'historico';

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: 'ficha', label: 'Ficha', icon: <FileText className="w-3.5 h-3.5" /> },
  { id: 'conversa', label: 'Conversa', icon: <MessageCircle className="w-3.5 h-3.5" /> },
  { id: 'saude', label: 'Saúde', icon: <Activity className="w-3.5 h-3.5" /> },
  { id: 'historico', label: 'Histórico', icon: <History className="w-3.5 h-3.5" /> },
];

function Section({ title, children, icon }: { title: string; children: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <div className="space-y-2.5">
      <div className="flex items-center gap-2">
        {icon && <span className="text-[#64748B]">{icon}</span>}
        <h4 className="text-[11px] font-bold text-[#64748B] uppercase tracking-wider">{title}</h4>
      </div>
      {children}
    </div>
  );
}

function InfoRow({ icon, label, value, mono, badge }: { icon?: React.ReactNode; label?: string; value: React.ReactNode; mono?: boolean; badge?: { text: string; color: string; bg: string } }) {
  if (!value && value !== 0) return null;
  return (
    <div className="flex items-start gap-3 py-1.5">
      {icon && <span className="text-[#94A3B8] mt-0.5 shrink-0">{icon}</span>}
      <div className="flex-1 min-w-0">
        {label && <div className="text-[10px] text-[#94A3B8] font-medium uppercase tracking-wider mb-0.5">{label}</div>}
        <div className={`text-[13px] text-[#0F172A] ${mono ? 'font-mono' : ''} break-words`}>{value}</div>
      </div>
      {badge && (
        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0" style={{ color: badge.color, background: badge.bg }}>
          {badge.text}
        </span>
      )}
    </div>
  );
}

function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-[#F8FAFC] rounded-xl border border-[#E5E7EB] p-4 ${className || ''}`}>
      {children}
    </div>
  );
}

// ─── CNPJ formatting helper ────────────────────────────────────────
function formatCNPJ(cnpj: string): string {
  const digits = cnpj.replace(/\D/g, '');
  if (digits.length !== 14) return cnpj;
  return `${digits.slice(0,2)}.${digits.slice(2,5)}.${digits.slice(5,8)}/${digits.slice(8,12)}-${digits.slice(12,14)}`;
}

// ─── CNPJ source badge config ──────────────────────────────────────
const CNPJ_SOURCE_BADGES: Record<string, { label: string; color: string; bg: string }> = {
  cache: { label: 'Cache', color: '#64748B', bg: '#F1F5F9' },
  cnpja_commercial: { label: 'CNPJ.a', color: '#1B3A6B', bg: '#EFF6FF' },
  brasilapi: { label: 'BrasilAPI', color: '#027A48', bg: '#ECFDF3' },
};

// ─── Event type mapping ────────────────────────────────────────────
const EVENT_TYPE_MAP: Record<string, { label: string; emoji: string; color: string }> = {
  whatsapp_check:        { label: 'Verificação WhatsApp',   emoji: '📱', color: '#0EA5E9' },
  cnpj_found:            { label: 'CNPJ Localizado',        emoji: '🏢', color: '#027A48' },
  cnpj_not_found:        { label: 'CNPJ Não Encontrado',    emoji: '🔍', color: '#DC2626' },
  fit_score_calculated:  { label: 'Score Calculado',        emoji: '📊', color: '#8B5CF6' },
  status_changed:        { label: 'Status Alterado',        emoji: '🔄', color: '#0EA5E9' },
  message_sent:          { label: 'Mensagem Enviada',       emoji: '📤', color: '#027A48' },
  message_received:      { label: 'Resposta Recebida',      emoji: '📥', color: '#E8981C' },
  ai_response_generated: { label: 'IA Respondeu',           emoji: '🤖', color: '#8B5CF6' },
  intent_classified:     { label: 'Intenção Classificada',  emoji: '🎯', color: '#0EA5E9' },
  enrichment_failed:     { label: 'Falha no Enriquecimento',emoji: '❌', color: '#DC2626' },
  conversation_started:  { label: 'Conversa Iniciada',      emoji: '💬', color: '#027A48' },
  meeting_scheduled:     { label: 'Reunião Agendada',       emoji: '📅', color: '#039855' },
  captured:              { label: 'Lead Capturado',         emoji: '🎣', color: '#64748B' },
  deleted:               { label: 'Lead Removido',          emoji: '🗑️', color: '#DC2626' },
  optout:                { label: 'Opt-out',                emoji: '🚫', color: '#DC2626' },
};

function getEventInfo(eventType: string) {
  return EVENT_TYPE_MAP[eventType] || { label: eventType.replace(/_/g, ' '), emoji: '📌', color: '#64748B' };
}

function getEventColorClass(eventType: string): 'green' | 'red' | 'blue' {
  const red = ['cnpj_not_found', 'enrichment_failed', 'deleted', 'optout'];
  const green = ['cnpj_found', 'message_sent', 'conversation_started', 'meeting_scheduled', 'message_received', 'captured'];
  if (red.includes(eventType)) return 'red';
  if (green.includes(eventType)) return 'green';
  return 'blue';
}

// ─── Score component labels ─────────────────────────────────────────
const SCORE_COMPONENT_LABELS: Record<string, { label: string; points: string }> = {
  profissao_match:   { label: 'Profissão encontrada',  points: '+3' },
  whatsapp_valido:   { label: 'WhatsApp válido',       points: '+2' },
  socio_ou_dono:     { label: 'Sócio ou dono',         points: '+2' },
  rating_alto:       { label: 'Rating alto (≥4.5)',     points: '+1' },
  avaliacoes_50:     { label: '50+ avaliações',         points: '+1' },
  cnpj_ativo:        { label: 'CNPJ ativo',            points: '+1' },
  crm_oab:           { label: 'CRM/OAB encontrado',    points: '+1' },
  idade_empresa:     { label: 'Empresa madura (5+ anos)', points: '+1' },
};

export default function LeadDrawer({ leadId, onClose }: LeadDrawerProps) {
  const tenantId = useAuthStore(state => state.tenantId);
  const [lead, setLead] = useState<any>(null);
  const [events, setEvents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<Tab>('ficha');

  useEffect(() => {
    if (!tenantId || !leadId) return;
    setLoading(true);
    (async () => {
      try {
        const result = await leadsQueries.getById(tenantId, leadId);
        if (result.data) setLead(result.data);
        // Try to fetch events
        try {
          const evResult = await leadsQueries.getEvents?.(tenantId, leadId);
          if (evResult?.data) setEvents(evResult.data);
        } catch { /* events optional */ }
      } catch (e) {
        console.error('Error loading lead', e);
      } finally {
        setLoading(false);
      }
    })();
  }, [tenantId, leadId]);

  if (loading) {
    return (
      <DrawerShell onClose={onClose}>
        <div className="flex items-center justify-center h-64">
          <div className="w-8 h-8 border-2 border-[#1B3A6B] border-t-transparent rounded-full animate-spin" />
        </div>
      </DrawerShell>
    );
  }

  if (!lead) {
    return (
      <DrawerShell onClose={onClose}>
        <div className="flex flex-col items-center justify-center h-64 text-[#64748B]">
          <AlertCircle className="w-8 h-8 mb-2" />
          <p className="text-sm">Lead não encontrado</p>
        </div>
      </DrawerShell>
    );
  }

  const raw = lead.source_raw_data || {};
  const meta = lead.metadata || {};
  const cnpj = meta.cnpj_info || {};
  const partners = meta.partners || [];
  const addr = lead.address || {};
  const statusInfo = STATUS_LABELS[lead.status] ?? { label: lead.status || 'Desconhecido', color: '#64748B', bg: '#F1F5F9' };
  const profLabel = PROFESSION_LABELS[lead.profession] || lead.profession || '—';

  // Build full address
  const fullAddress = raw.formattedAddress || [addr.street, addr.neighborhood, addr.city].filter(Boolean).join(', ');

  // Google types
  const googleTypes = (raw.types || []).filter((t: string) => !['point_of_interest', 'establishment'].includes(t));

  // Score breakdown
  const scoreFactors = [];
  if (lead.google_rating >= 4.5) scoreFactors.push({ label: 'Rating ≥ 4.5', positive: true });
  else if (lead.google_rating) scoreFactors.push({ label: `Rating ${lead.google_rating}`, positive: lead.google_rating >= 4 });
  if (lead.google_reviews_count >= 50) scoreFactors.push({ label: `${lead.google_reviews_count} avaliações`, positive: true });
  else if (lead.google_reviews_count) scoreFactors.push({ label: `${lead.google_reviews_count} avaliações`, positive: lead.google_reviews_count >= 10 });
  if (lead.whatsapp_valid === true) scoreFactors.push({ label: 'WhatsApp válido', positive: true });
  if (lead.whatsapp_valid === false) scoreFactors.push({ label: 'WhatsApp inválido', positive: false });
  if (lead.registration_number) scoreFactors.push({ label: 'CRM/OAB encontrado', positive: true });
  if (cnpj.situacao === 'ATIVA') scoreFactors.push({ label: 'CNPJ Ativo', positive: true });
  if (cnpj.situacao && cnpj.situacao !== 'ATIVA') scoreFactors.push({ label: `CNPJ ${cnpj.situacao}`, positive: false });

  return (
    <DrawerShell onClose={onClose}>
      {/* Header */}
      <div className="sticky top-0 z-10 bg-white border-b border-[#E5E7EB]">
        <div className="px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3.5 min-w-0">
            <div className="w-11 h-11 rounded-full flex items-center justify-center text-white text-[14px] font-bold shrink-0 bg-gradient-to-br from-[#1B3A6B] to-[#2C5282]">
              {lead.name?.split(' ').map((n: string) => n[0]).filter(Boolean).slice(0, 2).join('').toUpperCase() || '?'}
            </div>
            <div className="min-w-0">
              <h3 className="text-[15px] font-bold text-[#0F172A] truncate">{lead.name}</h3>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-[12px] text-[#64748B]">{profLabel}</span>
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full" style={{ color: statusInfo.color, background: statusInfo.bg }}>
                  {statusInfo.label}
                </span>
              </div>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-[#F1F3F6] text-[#64748B] hover:text-[#0F172A] transition-colors shrink-0">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tabs */}
        <div className="px-6 flex gap-0.5 bg-[#F8FAFC]">
          {TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-1.5 px-3.5 py-2.5 text-[12px] font-semibold rounded-t-lg transition-all border-b-2 ${
                activeTab === tab.id
                  ? 'text-[#1B3A6B] border-[#1B3A6B] bg-white'
                  : 'text-[#64748B] border-transparent hover:text-[#0F172A] hover:bg-white/60'
              }`}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      <div className="p-6 space-y-6 overflow-y-auto flex-1">
        {activeTab === 'ficha' && <FichaTab lead={lead} raw={raw} cnpj={cnpj} partners={partners} fullAddress={fullAddress} googleTypes={googleTypes} profLabel={profLabel} />}
        {activeTab === 'conversa' && <ConversaTab lead={lead} tenantId={tenantId} />}
        {activeTab === 'saude' && <SaudeTab lead={lead} scoreFactors={scoreFactors} events={events} />}
        {activeTab === 'historico' && <HistoricoTab lead={lead} events={events} />}
      </div>
    </DrawerShell>
  );
}

function DrawerShell({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" />
      <div className="relative w-full max-w-[520px] bg-white shadow-2xl border-l border-[#E5E7EB] flex flex-col overflow-hidden animate-slideInRight" onClick={e => e.stopPropagation()}>
        {children}
      </div>
      <style jsx>{`
        @keyframes slideInRight {
          from { transform: translateX(100%); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
        .animate-slideInRight { animation: slideInRight 0.2s ease-out; }
      `}</style>
    </div>
  );
}

// ═══════════════════════════════════════════════════
// TAB: FICHA — All lead data
// ═══════════════════════════════════════════════════
function FichaTab({ lead, raw, cnpj, partners, fullAddress, googleTypes, profLabel }: any) {
  return (
    <>
      {/* Contact */}
      <Section title="Contato" icon={<Phone className="w-3.5 h-3.5" />}>
        <Card>
          <div className="space-y-0.5">
            <InfoRow
              icon={<Phone className="w-4 h-4" />}
              value={lead.whatsapp}
              mono
              badge={
                lead.whatsapp_valid === true ? { text: '✓ WhatsApp válido', color: '#027A48', bg: '#ECFDF3' } :
                lead.whatsapp_valid === false ? { text: '✗ Inválido', color: '#DC2626', bg: '#FEF2F2' } :
                { text: 'Não verificado', color: '#64748B', bg: '#F1F5F9' }
              }
            />
            {raw.nationalPhoneNumber && raw.nationalPhoneNumber !== lead.whatsapp && (
              <InfoRow icon={<Phone className="w-4 h-4" />} label="Telefone (Google)" value={raw.nationalPhoneNumber} mono />
            )}
            {lead.email && <InfoRow icon={<Mail className="w-4 h-4" />} value={lead.email} />}
            {fullAddress && <InfoRow icon={<MapPin className="w-4 h-4" />} value={fullAddress} />}
          </div>
        </Card>
      </Section>

      {/* Google Maps data */}
      <Section title="Dados do Google Maps" icon={<Globe className="w-3.5 h-3.5" />}>
        <Card>
          <div className="space-y-2">
            {lead.google_rating && (
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1">
                  {[1,2,3,4,5].map(s => (
                    <Star key={s} className={`w-4 h-4 ${s <= Math.round(lead.google_rating) ? 'text-[#F59E0B] fill-[#F59E0B]' : 'text-[#E5E7EB]'}`} />
                  ))}
                </div>
                <span className="text-[16px] font-bold text-[#0F172A]">{lead.google_rating}</span>
                <span className="text-[12px] text-[#64748B]">({lead.google_reviews_count || 0} avaliações)</span>
              </div>
            )}
            {raw.name && <InfoRow label="Nome no Google" value={raw.name} />}
            {raw.placeId && (
              <InfoRow
                label="Google Place ID"
                value={
                  <a href={`https://www.google.com/maps/place/?q=place_id:${raw.placeId}`} target="_blank" rel="noopener noreferrer" className="text-[#1B3A6B] hover:underline flex items-center gap-1">
                    {raw.placeId.slice(0, 20)}... <ExternalLink className="w-3 h-3" />
                  </a>
                }
                mono
              />
            )}
            {googleTypes.length > 0 && (
              <div>
                <div className="text-[10px] text-[#94A3B8] font-medium uppercase tracking-wider mb-1.5">Categorias Google</div>
                <div className="flex flex-wrap gap-1">
                  {googleTypes.map((t: string) => (
                    <span key={t} className="text-[10px] bg-[#EFF6FF] text-[#1B3A6B] px-2 py-0.5 rounded-full font-medium">{t.replace(/_/g, ' ')}</span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </Card>
      </Section>

      {/* Professional info */}
      <Section title="Informações Profissionais" icon={<Briefcase className="w-3.5 h-3.5" />}>
        <Card>
          <div className="space-y-0.5">
            <InfoRow icon={<Briefcase className="w-4 h-4" />} label="Profissão" value={profLabel} />
            {lead.registration_number && <InfoRow icon={<Hash className="w-4 h-4" />} label="CRM / OAB" value={lead.registration_number} mono />}
            {lead.partner_or_owner && <InfoRow icon={<User className="w-4 h-4" />} label="Responsável" value={lead.partner_or_owner} />}
            {lead.years_of_practice && <InfoRow icon={<Clock className="w-4 h-4" />} label="Anos de prática" value={`${lead.years_of_practice} anos`} />}
            {lead.age_estimate && <InfoRow label="Idade estimada" value={`~${lead.age_estimate} anos`} />}
          </div>
        </Card>
      </Section>

      {/* CNPJ / Company */}
      {(cnpj.razao_social || cnpj.razaoSocial || cnpj.cnpj) && (
        <Section title="Dados Empresariais (CNPJ)" icon={<Building2 className="w-3.5 h-3.5" />}>
          <Card>
            <div className="space-y-2">
              {(cnpj.razao_social || cnpj.razaoSocial) && (
                <InfoRow icon={<Building2 className="w-4 h-4" />} label="Razão Social" value={cnpj.razao_social || cnpj.razaoSocial} />
              )}
              {(cnpj.nome_fantasia || cnpj.nomeFantasia) && (
                <InfoRow label="Nome Fantasia" value={cnpj.nome_fantasia || cnpj.nomeFantasia} />
              )}
              {cnpj.cnpj && (
                <InfoRow
                  icon={<Hash className="w-4 h-4" />}
                  label="CNPJ"
                  value={
                    <div className="flex items-center gap-2">
                      <span className="font-mono">{formatCNPJ(cnpj.cnpj)}</span>
                      <a
                        href={`https://solucoes.receita.fazenda.gov.br/servicos/cnpjreva/cnpjreva_solicitacao.asp`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[10px] text-[#1B3A6B] hover:underline flex items-center gap-0.5"
                      >
                        Consultar Receita <ExternalLink className="w-2.5 h-2.5" />
                      </a>
                    </div>
                  }
                />
              )}
              {/* CNPJ Source Badge */}
              {(cnpj.cnpj_source || lead.metadata?.cnpj_source) && (() => {
                const src = cnpj.cnpj_source || lead.metadata?.cnpj_source;
                const badge = CNPJ_SOURCE_BADGES[src] || { label: src, color: '#64748B', bg: '#F1F5F9' };
                return (
                  <InfoRow
                    label="Fonte do CNPJ"
                    value={src}
                    badge={{ text: badge.label, color: badge.color, bg: badge.bg }}
                  />
                );
              })()}
              {cnpj.situacao && (
                <InfoRow
                  label="Situação"
                  value={cnpj.situacao}
                  badge={cnpj.situacao === 'ATIVA'
                    ? { text: '✓ Ativa', color: '#027A48', bg: '#ECFDF3' }
                    : { text: cnpj.situacao, color: '#DC2626', bg: '#FEF2F2' }
                  }
                />
              )}
              {cnpj.natureza_juridica && <InfoRow label="Natureza Jurídica" value={cnpj.natureza_juridica} />}
              {cnpj.porte && <InfoRow label="Porte" value={cnpj.porte} />}
              {cnpj.capital_social && <InfoRow label="Capital Social" value={`R$ ${Number(cnpj.capital_social).toLocaleString('pt-BR')}`} />}
              {/* Data de Abertura + Company Age */}
              {(cnpj.data_abertura || cnpj.data_inicio_atividade || cnpj.dataInicioAtividade) && (() => {
                const dateStr = cnpj.data_abertura || cnpj.data_inicio_atividade || cnpj.dataInicioAtividade;
                const years = Math.floor((Date.now() - new Date(dateStr).getTime()) / (365.25 * 24 * 60 * 60 * 1000));
                return (
                  <>
                    <InfoRow icon={<Calendar className="w-4 h-4" />} label="Data de Abertura" value={new Date(dateStr).toLocaleDateString('pt-BR')} />
                    {years > 0 && (
                      <div className="flex items-center gap-2 py-1.5 px-3 rounded-lg bg-[#F0F9FF] border border-[#BAE6FD]">
                        <span className="text-[18px] font-bold text-[#0EA5E9]">{years}</span>
                        <span className="text-[11px] text-[#0369A1] font-medium">anos de atividade</span>
                      </div>
                    )}
                  </>
                );
              })()}
              {/* CNAE with description */}
              {(cnpj.atividade_principal || cnpj.cnae_fiscal || cnpj.cnaeFiscal) && (
                <InfoRow label="Atividade Principal (CNAE)" value={
                  Array.isArray(cnpj.atividade_principal)
                    ? cnpj.atividade_principal.map((a: any) => `${a.code || ''} — ${a.text || a.descricao || ''}`).join(', ')
                    : typeof cnpj.atividade_principal === 'string' ? cnpj.atividade_principal
                    : cnpj.cnae_fiscal || cnpj.cnaeFiscal || '—'
                } />
              )}
            </div>
          </Card>

          {/* Partners */}
          {partners.length > 0 && (
            <div className="mt-3">
              <div className="flex items-center gap-2 mb-2">
                <Users className="w-3.5 h-3.5 text-[#64748B]" />
                <span className="text-[11px] font-bold text-[#64748B] uppercase tracking-wider">Quadro Societário ({partners.length})</span>
              </div>
              <div className="space-y-1.5">
                {partners.map((p: any, i: number) => (
                  <Card key={i} className="!p-3">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-full bg-[#E0E7FF] flex items-center justify-center text-[10px] font-bold text-[#1B3A6B] shrink-0">
                        {(p.nome || '?').split(' ').map((n: string) => n[0]).slice(0, 2).join('').toUpperCase()}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-[12.5px] font-semibold text-[#0F172A] truncate">{p.nome}</div>
                        {p.qualificacao && <div className="text-[10.5px] text-[#64748B]">{p.qualificacao}</div>}
                      </div>
                      {p.faixa_etaria && <span className="text-[10px] text-[#94A3B8] shrink-0">{p.faixa_etaria}</span>}
                    </div>
                  </Card>
                ))}
              </div>
            </div>
          )}
        </Section>
      )}

      {/* Tags */}
      {lead.tags && lead.tags.length > 0 && (
        <Section title="Tags">
          <div className="flex flex-wrap gap-1.5">
            {lead.tags.map((tag: string, i: number) => (
              <span key={i} className="text-[11px] font-medium px-2.5 py-1 rounded-full bg-[#F1F3F6] text-[#475569] border border-[#E5E7EB]">{tag}</span>
            ))}
          </div>
        </Section>
      )}

      {/* Source */}
      <Section title="Origem">
        <Card>
          <div className="space-y-0.5">
            <InfoRow label="Fonte" value={lead.source === 'GOOGLE_MAPS' ? 'Google Maps' : lead.source || '—'} />
            {lead.campaign_id && <InfoRow label="Campanha ID" value={lead.campaign_id} mono />}
            <InfoRow icon={<Calendar className="w-4 h-4" />} label="Capturado em" value={lead.created_at ? new Date(lead.created_at).toLocaleString('pt-BR') : '—'} />
            {lead.updated_at && <InfoRow label="Última atualização" value={new Date(lead.updated_at).toLocaleString('pt-BR')} />}
          </div>
        </Card>
      </Section>
    </>
  );
}

// ═══════════════════════════════════════════════════
// TAB: CONVERSA — Real chat messages
// ═══════════════════════════════════════════════════
function ConversaTab({ lead, tenantId }: { lead: any; tenantId: string | null }) {
  const [messages, setMessages] = useState<any[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [aiHandling, setAiHandling] = useState(true);
  const [loadingMsgs, setLoadingMsgs] = useState(true);
  const [newMessage, setNewMessage] = useState('');
  const [sending, setSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Fetch conversation + messages for this lead
  useEffect(() => {
    if (!tenantId || !lead?.id) { setLoadingMsgs(false); return; }
    (async () => {
      try {
        // Find active conversation for this lead
        const { data: convs } = await supabase
          .from('conversations')
          .select('id, ai_handling, status')
          .eq('tenant_id', tenantId)
          .eq('lead_id', lead.id)
          .order('started_at', { ascending: false })
          .limit(1);

        if (convs && convs.length > 0) {
          const conv = convs[0]!;
          setConversationId(conv.id);
          setAiHandling(conv.ai_handling);
          // Fetch messages
          const msgResult = await conversationsQueries.getMessages(conv.id, tenantId);
          if (msgResult.data) setMessages(msgResult.data);
        }
      } catch (e) {
        console.error('Error loading conversation', e);
      } finally {
        setLoadingMsgs(false);
      }
    })();
  }, [tenantId, lead?.id]);

  // Scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMessage.trim() || !conversationId || !tenantId || sending) return;
    setSending(true);
    try {
      const result = await conversationsQueries.sendMessage(tenantId, conversationId, newMessage.trim());
      if (result.data) {
        setMessages(prev => [...prev, result.data]);
        setNewMessage('');
      }
    } catch (e) {
      console.error('Error sending message', e);
    } finally {
      setSending(false);
    }
  };

  // Delivery status icon
  const DeliveryIcon = ({ status }: { status: string | null }) => {
    if (status === 'READ') return <CheckCheck className="w-3 h-3 text-[#0EA5E9]" />;
    if (status === 'DELIVERED') return <CheckCheck className="w-3 h-3 text-[#94A3B8]" />;
    if (status === 'SENT') return <Check className="w-3 h-3 text-[#94A3B8]" />;
    if (status === 'FAILED') return <XCircle className="w-3 h-3 text-[#DC2626]" />;
    return <Clock className="w-3 h-3 text-[#CBD5E1]" />; // QUEUED
  };

  if (loadingMsgs) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="w-6 h-6 border-2 border-[#1B3A6B] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  // No conversation exists at all
  if (!conversationId && !lead.contacted_at && !lead.first_response_at) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <div className="w-16 h-16 rounded-full bg-[#F1F5F9] flex items-center justify-center mb-4">
          <MessageCircle className="w-7 h-7 text-[#94A3B8]" />
        </div>
        <h4 className="text-[14px] font-semibold text-[#0F172A] mb-1">Nenhuma conversa ainda</h4>
        <p className="text-[12px] text-[#64748B] max-w-[280px]">
          Este lead ainda não foi contatado. A conversa aparecerá aqui assim que a IA enviar a primeira mensagem.
        </p>
        {!lead.whatsapp_valid && (
          <div className="mt-4 px-4 py-2.5 bg-[#FFF7ED] border border-[#FED7AA] rounded-xl text-[11px] text-[#9A3412] max-w-[300px]">
            ⚠️ O WhatsApp deste lead ainda não foi validado. Conecte o WhatsApp nas configurações.
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full -m-6">
      {/* Chat area - WhatsApp style */}
      <div className="flex-1 p-4 overflow-y-auto flex flex-col gap-2" style={{ background: '#ECE5DD', minHeight: '300px' }}>
        {/* Date separator */}
        <div className="self-center text-[10.5px] text-[#64748B] bg-white/85 px-3 py-1 rounded-full mb-1">
          {lead.contacted_at ? new Date(lead.contacted_at).toLocaleDateString('pt-BR') : 'Hoje'}
        </div>

        {messages.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center py-8">
            <MessageCircle className="w-10 h-10 text-[#64748B]/30 mb-2" />
            <p className="text-[12px] text-[#475569]">Nenhuma mensagem registrada.</p>
          </div>
        ) : (
          messages.map((msg: any) => {
            const isOutbound = msg.direction === 'OUTBOUND';
            const isAI = msg.sender === 'AI';
            return (
              <div
                key={msg.id}
                className={`max-w-[82%] px-3 py-2 text-[12.5px] leading-[1.5] text-[#0F172A] rounded-[9px] shadow-sm ${
                  isOutbound
                    ? 'bg-[#DCF8C6] self-end rounded-tr-[2px]'
                    : 'bg-white self-start rounded-tl-[2px]'
                } ${isAI ? 'border-l-[3px] border-l-[#E8981C]' : ''}`}
              >
                {isAI && (
                  <div className="text-[9px] uppercase tracking-wider text-[#A56B0A] font-bold mb-1 flex items-center gap-1">
                    <Bot className="w-3 h-3" /> IA Prospix
                  </div>
                )}
                {msg.content}
                <div className="flex items-center justify-end gap-1 mt-1">
                  <span className="text-[9.5px] text-[#64748B] font-mono">
                    {new Date(msg.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                  {isOutbound && <DeliveryIcon status={msg.delivery_status} />}
                </div>
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input area — only if ai_handling is false */}
      {conversationId && !aiHandling ? (
        <form onSubmit={handleSend} className="p-3 border-t border-[#E5E7EB] bg-white flex gap-2 shrink-0">
          <input
            value={newMessage}
            onChange={(e) => setNewMessage(e.target.value)}
            placeholder="Escreva sua mensagem..."
            className="flex-1 bg-white border border-[#E5E7EB] rounded-lg px-3 py-2 text-[12px] text-[#0F172A] placeholder-[#94A3B8] focus:outline-none focus:border-[#1B3A6B] transition-colors"
          />
          <button
            type="submit"
            disabled={sending || !newMessage.trim()}
            className="bg-[#1B3A6B] hover:bg-[#142C52] disabled:opacity-50 text-white p-2.5 rounded-lg shadow-md w-10 h-10 flex items-center justify-center shrink-0 transition-colors"
          >
            <Send className="w-4 h-4" />
          </button>
        </form>
      ) : conversationId && aiHandling ? (
        <div className="p-3 bg-[rgba(27,58,107,0.04)] border-t border-[rgba(27,58,107,0.12)] flex items-center gap-2.5 shrink-0">
          <div className="p-2 bg-[rgba(27,58,107,0.08)] text-[#1B3A6B] rounded-lg">
            <Bot className="w-4 h-4 animate-pulse" />
          </div>
          <div>
            <p className="text-[11px] font-semibold text-[#0F172A]">IA conduzindo conversa</p>
            <p className="text-[10px] text-[#64748B]">A IA está respondendo automaticamente no WhatsApp.</p>
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ═══════════════════════════════════════════════════
// TAB: SAÚDE — Score + lead quality assessment
// ═══════════════════════════════════════════════════
function SaudeTab({ lead, scoreFactors, events }: { lead: any; scoreFactors: { label: string; positive: boolean }[]; events: any[] }) {
  const maxScore = 10;
  const scorePercent = (lead.fit_score / maxScore) * 100;
  const scoreColor = lead.fit_score >= 8 ? '#027A48' : lead.fit_score >= 5 ? '#E8981C' : '#DC2626';

  // Find fit_score_calculated event for real breakdown
  const fitEvent = events.find((e: any) => e.eventType === 'fit_score_calculated');
  const breakdown: Record<string, number> = (fitEvent?.payload as any)?.breakdown || {};
  const hasBreakdown = Object.keys(breakdown).length > 0;
  const threshold = (fitEvent?.payload as any)?.threshold ?? 5;

  return (
    <div className="space-y-6">
      {/* Big score display */}
      <div className="text-center py-4">
        <div className="relative w-28 h-28 mx-auto mb-3">
          <svg viewBox="0 0 120 120" className="w-full h-full -rotate-90">
            <circle cx="60" cy="60" r="52" fill="none" stroke="#F1F3F6" strokeWidth="8" />
            <circle cx="60" cy="60" r="52" fill="none" stroke={scoreColor} strokeWidth="8"
              strokeDasharray={`${(scorePercent / 100) * 327} 327`}
              strokeLinecap="round" className="transition-all duration-700" />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-[32px] font-bold font-mono" style={{ color: scoreColor }}>{lead.fit_score}</span>
            <span className="text-[10px] text-[#94A3B8] font-medium">de {maxScore}</span>
          </div>
        </div>
        <h4 className="text-[14px] font-bold text-[#0F172A]">
          {lead.fit_score >= 8 ? '🔥 Lead Quente' : lead.fit_score >= 5 ? '🟡 Lead Morno' : '❄️ Lead Frio'}
        </h4>
        <p className="text-[12px] text-[#64748B] mt-0.5">
          {lead.fit_score >= 8 ? 'Alto potencial de conversão' : lead.fit_score >= 5 ? 'Potencial moderado' : 'Baixo potencial'}
        </p>
        {/* Threshold indicator */}
        {hasBreakdown && (
          <div className="mt-2 flex items-center justify-center gap-2">
            <span className="text-[10px] text-[#94A3B8]">Threshold: {threshold}</span>
            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${lead.fit_score >= threshold ? 'bg-[#ECFDF3] text-[#027A48]' : 'bg-[#FEF2F2] text-[#DC2626]'}`}>
              {lead.fit_score >= threshold ? '✓ Acima' : '✗ Abaixo'}
            </span>
          </div>
        )}
      </div>

      {/* Real breakdown from fit_score_calculated event */}
      {hasBreakdown && (
        <Section title="Composição do Score" icon={<TrendingUp className="w-3.5 h-3.5" />}>
          <div className="space-y-1.5">
            {Object.entries(breakdown).map(([key, value]) => {
              const comp = SCORE_COMPONENT_LABELS[key] || { label: key.replace(/_/g, ' '), points: `+${value}` };
              const scored = value > 0;
              return (
                <div key={key} className={`flex items-center gap-2.5 py-2 px-3 rounded-lg border transition-all ${
                  scored
                    ? 'bg-white border-[#E5E7EB]'
                    : 'bg-[#F8FAFC] border-[#F1F3F6] opacity-50'
                }`}>
                  {scored ? (
                    <CheckCircle2 className="w-4 h-4 text-[#027A48] shrink-0" />
                  ) : (
                    <div className="w-4 h-4 rounded-full border-2 border-[#D0D5DD] shrink-0" />
                  )}
                  <span className={`text-[12px] flex-1 ${scored ? 'text-[#0F172A] font-medium' : 'text-[#94A3B8]'}`}>
                    {comp.label}
                  </span>
                  <span className={`text-[11px] font-bold font-mono px-1.5 py-0.5 rounded ${
                    scored
                      ? 'bg-[#ECFDF3] text-[#027A48]'
                      : 'bg-[#F1F3F6] text-[#94A3B8]'
                  }`}>
                    {scored ? comp.points : '0'}
                  </span>
                  {/* Mini progress bar */}
                  <div className="w-16 h-1.5 bg-[#F1F3F6] rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${scored ? 'bg-[#027A48]' : 'bg-transparent'}`}
                      style={{ width: scored ? '100%' : '0%' }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </Section>
      )}

      {/* Fallback: heuristic factors if no real breakdown */}
      {!hasBreakdown && (
        <Section title="Fatores de Score" icon={<TrendingUp className="w-3.5 h-3.5" />}>
          <div className="space-y-1.5">
            {scoreFactors.length > 0 ? scoreFactors.map((f, i) => (
              <div key={i} className="flex items-center gap-2.5 py-1.5 px-3 rounded-lg bg-[#F8FAFC] border border-[#E5E7EB]">
                {f.positive ? (
                  <CheckCircle2 className="w-4 h-4 text-[#027A48] shrink-0" />
                ) : (
                  <XCircle className="w-4 h-4 text-[#DC2626] shrink-0" />
                )}
                <span className="text-[12px] text-[#0F172A] font-medium">{f.label}</span>
              </div>
            )) : (
              <p className="text-[12px] text-[#64748B] py-2">Dados insuficientes para análise detalhada.</p>
            )}
          </div>
        </Section>
      )}

      {/* Data completeness */}
      <Section title="Completude dos Dados" icon={<Shield className="w-3.5 h-3.5" />}>
        <Card>
          <div className="space-y-2">
            {[
              { label: 'Nome', has: !!lead.name },
              { label: 'WhatsApp', has: !!lead.whatsapp },
              { label: 'WhatsApp validado', has: lead.whatsapp_valid === true },
              { label: 'E-mail', has: !!lead.email },
              { label: 'Endereço', has: !!lead.address?.city },
              { label: 'Google Rating', has: !!lead.google_rating },
              { label: 'CRM/OAB', has: !!lead.registration_number },
              { label: 'Dados CNPJ', has: !!(lead.metadata?.cnpj_info?.cnpj) },
              { label: 'Sócios', has: (lead.metadata?.partners?.length || 0) > 0 },
            ].map((item, i) => (
              <div key={i} className="flex items-center justify-between py-1">
                <span className="text-[12px] text-[#475569]">{item.label}</span>
                {item.has ? (
                  <CheckCircle2 className="w-4 h-4 text-[#027A48]" />
                ) : (
                  <div className="w-4 h-4 rounded-full border-2 border-[#D0D5DD]" />
                )}
              </div>
            ))}
          </div>
        </Card>
      </Section>
    </div>
  );
}

// ═══════════════════════════════════════════════════
// TAB: HISTÓRICO — Rich timeline of events
// ═══════════════════════════════════════════════════
function HistoricoTab({ lead, events }: { lead: any; events: any[] }) {
  // Build timeline: combine lead lifecycle dates + real DB events
  interface TimelineItem {
    date: string;
    label: string;
    description?: string;
    icon: React.ReactNode;
    color: string;
    colorClass: 'green' | 'red' | 'blue';
    breakdown?: Record<string, number>;
    payload?: any;
  }

  const timeline: TimelineItem[] = [];

  // Lead lifecycle milestones
  if (lead.created_at) {
    timeline.push({
      date: lead.created_at,
      label: '🎣 Lead Capturado',
      description: lead.source === 'GOOGLE_MAPS' ? 'Capturado via Google Maps' : `Fonte: ${lead.source || 'Manual'}`,
      icon: <Globe className="w-3.5 h-3.5" />,
      color: '#64748B',
      colorClass: 'blue',
    });
  }
  if (lead.contacted_at) {
    timeline.push({
      date: lead.contacted_at,
      label: '📤 Primeiro Contato',
      description: 'Primeira mensagem enviada para o lead',
      icon: <MessageCircle className="w-3.5 h-3.5" />,
      color: '#8B5CF6',
      colorClass: 'green',
    });
  }
  if (lead.first_response_at) {
    timeline.push({
      date: lead.first_response_at,
      label: '📥 Lead Respondeu',
      description: 'Primeira resposta recebida do lead',
      icon: <MessageCircle className="w-3.5 h-3.5" />,
      color: '#E8981C',
      colorClass: 'green',
    });
  }
  if (lead.qualified_at) {
    timeline.push({
      date: lead.qualified_at,
      label: '🎯 Lead Qualificado',
      description: 'Lead qualificado pela IA com base na conversa',
      icon: <CheckCircle2 className="w-3.5 h-3.5" />,
      color: '#F59E0B',
      colorClass: 'green',
    });
  }
  if (lead.closed_at) {
    timeline.push({
      date: lead.closed_at,
      label: '🏆 Negócio Fechado',
      description: 'Lead convertido com sucesso',
      icon: <CheckCircle2 className="w-3.5 h-3.5" />,
      color: '#039855',
      colorClass: 'green',
    });
  }

  // Add real events from DB with rich labels
  for (const ev of events) {
    const info = getEventInfo(ev.eventType);
    const payload = ev.payload as any;
    const reason = payload?.reason || payload?.message || null;
    const colorCls = getEventColorClass(ev.eventType);

    // Build description from payload
    let description = reason || '';
    if (ev.eventType === 'status_changed' && payload?.from && payload?.to) {
      const fromLabel = STATUS_LABELS[payload.from]?.label || payload.from;
      const toLabel = STATUS_LABELS[payload.to]?.label || payload.to;
      description = `${fromLabel} → ${toLabel}`;
    }
    if (ev.eventType === 'fit_score_calculated' && payload?.score !== undefined) {
      description = `Score: ${payload.score}/10`;
    }
    if (ev.eventType === 'intent_classified' && payload?.intent) {
      description = `Intenção: ${payload.intent}${payload.confidence ? ` (${Math.round(payload.confidence * 100)}%)` : ''}`;
    }

    timeline.push({
      date: ev.createdAt,
      label: `${info.emoji} ${info.label}`,
      description: description || undefined,
      icon: <Activity className="w-3.5 h-3.5" />,
      color: info.color,
      colorClass: colorCls,
      breakdown: ev.eventType === 'fit_score_calculated' ? payload?.breakdown : undefined,
      payload,
    });
  }

  // Sort by date descending
  timeline.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  if (timeline.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <div className="w-16 h-16 rounded-full bg-[#F1F5F9] flex items-center justify-center mb-4">
          <History className="w-7 h-7 text-[#94A3B8]" />
        </div>
        <h4 className="text-[14px] font-semibold text-[#0F172A] mb-1">Sem histórico</h4>
        <p className="text-[12px] text-[#64748B]">Eventos aparecerão aqui conforme o lead avança no funil.</p>
      </div>
    );
  }


  return (
    <div className="relative">
      {/* Timeline connector line */}
      <div className="absolute left-[15px] top-4 bottom-4 w-[2px] bg-gradient-to-b from-[#E5E7EB] via-[#E5E7EB] to-transparent" />

      <div className="space-y-0">
        {timeline.map((item, i) => {
          return (
            <div key={i} className="flex items-start gap-3.5 py-3 relative">
              {/* Colored dot */}
              <div
                className="w-[31px] h-[31px] rounded-full border-[2.5px] flex items-center justify-center shrink-0 z-10"
                style={{ background: `${item.color}12`, borderColor: item.color, color: item.color }}
              >
                {item.icon}
              </div>
              <div className="flex-1 min-w-0 pt-0.5">
                <div className="text-[12.5px] font-semibold text-[#0F172A]">{item.label}</div>
                {item.description && (
                  <div className="text-[11.5px] text-[#475569] mt-0.5">{item.description}</div>
                )}
                {/* Score breakdown badges for fit_score_calculated */}
                {item.breakdown && Object.keys(item.breakdown).length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {Object.entries(item.breakdown).map(([key, val]) => {
                      const comp = SCORE_COMPONENT_LABELS[key];
                      const label = comp?.label || key.replace(/_/g, ' ');
                      return (
                        <span
                          key={key}
                          className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full ${
                            val > 0
                              ? 'bg-[#ECFDF3] text-[#027A48]'
                              : 'bg-[#F1F3F6] text-[#94A3B8]'
                          }`}
                        >
                          {label} {val > 0 ? `+${val}` : '0'}
                        </span>
                      );
                    })}
                  </div>
                )}
                <div className="text-[10px] text-[#94A3B8] mt-1 font-mono">
                  {new Date(item.date).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
