'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { Loader2, MapPin, ArrowRight, AlertCircle, X, Upload, Check, Copy, FileSpreadsheet, ClipboardCheck, Search } from 'lucide-react';
import { leadSourcesQueries, campaignsQueries } from '@/lib/queries';
import { useAuthStore } from '@/store/auth-store';
import { toast } from '@prospix/ui';
import { supabase } from '@/lib/supabase';

interface DBLeadSource {
  id: string;
  tenant_id: string;
  source_type: string;
  status: 'ACTIVE' | 'PAUSED' | 'DISABLED';
  config: any;
  addon_id: string | null;
}

interface SourceStats {
  total: number;
  last30Days: number;
  whatsappValid: number;
}

interface StaticSource {
  type: string;
  name: string;
  description: string;
  longDescription: string;
  isPremium: boolean;
  costText: string;
  icon: string;
  color: string;
  badgeColor: string;
  borderColor: string;
  isComingSoon?: boolean;
}

const STATIC_SOURCES: StaticSource[] = [
  {
    type: 'GOOGLE_MAPS',
    name: 'Google Maps Places',
    description: 'Busca por especialidade e localização.',
    longDescription: 'Varredura automática e em tempo real do Google Maps para extrair telefones, sites e avaliações de empresas e profissionais na região selecionada.',
    isPremium: false,
    costText: 'Grátis (Incluso)',
    icon: '🗺️',
    color: 'from-blue-50/50 to-indigo-50/30 text-blue-700',
    badgeColor: 'bg-blue-100/70 text-blue-800 border-blue-200/50',
    borderColor: 'border-blue-100 hover:border-blue-300'
  },
  {
    type: 'CNPJ_MINER',
    name: 'CNPJ Miner (Receita Federal)',
    description: 'Busca de empresas abertas recentemente.',
    longDescription: 'Varredura da base pública da Receita Federal em tempo real para encontrar novas empresas abertas no local selecionado.',
    isPremium: false,
    costText: 'Grátis (Incluso)',
    icon: '🔍',
    color: 'from-sky-50/50 to-cyan-50/30 text-sky-700',
    badgeColor: 'bg-sky-100/70 text-sky-800 border-sky-200/50',
    borderColor: 'border-sky-100 hover:border-sky-300'
  },
  {
    type: 'DOCTORALIA',
    name: 'Doctoralia Scraper',
    description: 'Especialistas de saúde e clínicas locais.',
    longDescription: 'Captura contatos e dados profissionais direto do maior diretório de saúde da América Latina na região selecionada.',
    isPremium: false,
    costText: 'Premium',
    icon: '🩺',
    color: 'from-teal-50/50 to-emerald-50/30 text-teal-700',
    badgeColor: 'bg-teal-100/70 text-teal-800 border-teal-200/50',
    borderColor: 'border-teal-100 hover:border-teal-300',
    isComingSoon: true
  },
  {
    type: 'COMPRASNET',
    name: 'Comprasnet Licitações',
    description: 'Empresas ganhadoras de licitações públicas.',
    longDescription: 'Identifica empresas contratadas pelo governo que necessitam de Seguro Garantia contratual na sua localidade.',
    isPremium: false,
    costText: 'Premium',
    icon: '⚖️',
    color: 'from-amber-50/50 to-yellow-50/30 text-amber-700',
    badgeColor: 'bg-amber-100/70 text-amber-800 border-amber-200/50',
    borderColor: 'border-amber-100 hover:border-amber-300',
    isComingSoon: true
  },
  {
    type: 'VIVAREAL',
    name: 'VivaReal Imóveis',
    description: 'Anúncios de aluguel comercial ativo.',
    longDescription: 'Varre anúncios comerciais e contatos de imobiliárias para oferecer Seguro Fiança Locatícia empresarial.',
    isPremium: false,
    costText: 'Premium',
    icon: '🏢',
    color: 'from-indigo-50/50 to-blue-50/30 text-indigo-700',
    badgeColor: 'bg-indigo-100/70 text-indigo-800 border-indigo-200/50',
    borderColor: 'border-indigo-100 hover:border-indigo-300',
    isComingSoon: true
  },
  {
    type: 'INSTAGRAM',
    name: 'Instagram Scraper',
    description: 'Perfis comerciais ativos com contatos expostos.',
    longDescription: 'Mapeia e analisa o perfil de Instagram de empresas na região de interesse, extraindo contatos comerciais e e-mails.',
    isPremium: false,
    costText: 'Premium',
    icon: '📸',
    color: 'from-pink-50/50 to-rose-50/30 text-pink-700',
    badgeColor: 'bg-pink-100/70 text-pink-800 border-pink-200/50',
    borderColor: 'border-pink-100 hover:border-pink-300',
    isComingSoon: true
  },
  {
    type: 'RECEITA_FEDERAL',
    name: 'Receita Federal - CNPJ',
    description: 'Validação cadastral de CNPJ ativo.',
    longDescription: 'Identifica o quadro de sócios (QSA), capital social, CNAE fiscal e situação cadastral oficial da clínica ou empresa associada ao lead.',
    isPremium: false,
    costText: 'Grátis (Incluso)',
    icon: '🏢',
    color: 'from-emerald-50/50 to-teal-50/30 text-emerald-700',
    badgeColor: 'bg-emerald-100/70 text-emerald-800 border-emerald-200/50',
    borderColor: 'border-emerald-100 hover:border-emerald-300'
  },
  {
    type: 'CRM_SP',
    name: 'CRM-SP (Médicos)',
    description: 'Base oficial de médicos ativos.',
    longDescription: 'Cruzamento com o conselho oficial de medicina para validar registro, especialidade declarada e regularidade dos profissionais capturados.',
    isPremium: false,
    costText: 'Premium',
    icon: '🏥',
    color: 'from-pink-50/50 to-rose-50/30 text-pink-700',
    badgeColor: 'bg-pink-100/70 text-pink-800 border-pink-200/50',
    borderColor: 'border-pink-100 hover:border-pink-300',
    isComingSoon: true
  },
  {
    type: 'OAB_SP',
    name: 'OAB-SP (Advogados)',
    description: 'Base oficial de advogados ativos.',
    longDescription: 'Cruzamento automático com os registros oficiais da OAB-SP para identificar advogados ativos e a situação das sociedades profissionais.',
    isPremium: false,
    costText: 'Premium',
    icon: '⚖️',
    color: 'from-amber-50/50 to-yellow-50/30 text-amber-700',
    badgeColor: 'bg-amber-100/70 text-amber-800 border-amber-200/50',
    borderColor: 'border-amber-100 hover:border-amber-300',
    isComingSoon: true
  },
  {
    type: 'CRO_SP',
    name: 'CRO-SP (Dentistas)',
    description: 'Base oficial de dentistas ativos.',
    longDescription: 'Identificação e validação de dentistas ativos por especialidade e local de atendimento junto ao Conselho Regional de Odontologia.',
    isPremium: false,
    costText: 'Premium',
    icon: '🦷',
    color: 'from-sky-50/50 to-blue-50/30 text-sky-700',
    badgeColor: 'bg-sky-100/70 text-sky-800 border-sky-200/50',
    borderColor: 'border-sky-100 hover:border-sky-300',
    isComingSoon: true
  },
  {
    type: 'LANDING_PAGE',
    name: 'Landing Pages & Formulários',
    description: 'Captura inbound de leads em tempo real.',
    longDescription: 'Captura automática quando um cliente preenche seu formulário de contato, calculadora de cotação ou link de indicação no seu site.',
    isPremium: false,
    costText: 'Grátis (Incluso)',
    icon: '🌐',
    color: 'from-purple-50/50 to-indigo-50/30 text-purple-700',
    badgeColor: 'bg-purple-100/70 text-purple-800 border-purple-200/50',
    borderColor: 'border-purple-100 hover:border-purple-300'
  },
  {
    type: 'IMPORTED',
    name: 'Importação CSV / Excel',
    description: 'Carregamento de listas prontas.',
    longDescription: 'Faça upload de planilhas de contatos em massa (CSV, XLSX) e o sistema higieniza os dados e valida o WhatsApp automaticamente.',
    isPremium: false,
    costText: 'Grátis (Incluso)',
    icon: '📊',
    color: 'from-gray-50/50 to-slate-50/30 text-gray-700',
    badgeColor: 'bg-gray-100/70 text-gray-800 border-gray-200/50',
    borderColor: 'border-gray-100 hover:border-gray-300'
  },
  {
    type: 'MANUAL',
    name: 'Inserção Manual',
    description: 'Criação direta pelo funil de vendas.',
    longDescription: 'Adição manual rápida de leads diretamente pelo CRM de vendas. Ideal para contatos capturados de forma offline ou em reuniões presenciais.',
    isPremium: false,
    costText: 'Grátis (Incluso)',
    icon: '➕',
    color: 'from-stone-50/50 to-neutral-50/30 text-stone-700',
    badgeColor: 'bg-stone-100/70 text-stone-800 border-stone-200/50',
    borderColor: 'border-stone-100 hover:border-stone-300'
  }
];

interface SwitchProps {
  checked: boolean;
  disabled?: boolean;
  onChange: () => void;
}

function Switch({ checked, disabled, onChange }: SwitchProps) {
  return (
    <button
      type="button"
      onClick={() => !disabled && onChange()}
      disabled={disabled}
      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
        checked ? 'bg-[#1B3A6B]' : 'bg-[#E5E7EB]'
      } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
    >
      <span
        aria-hidden="true"
        className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
          checked ? 'translate-x-4' : 'translate-x-0'
        }`}
      />
    </button>
  );
}

// ── Phone normalization helper (client-side) ─────────────────────────────────
function normalizePhoneClient(raw: string): string {
  const phone = raw.replace(/\D/g, '');
  if (phone.startsWith('55') && phone.length >= 12) return `+${phone}`;
  if (phone.length === 11 || phone.length === 10) return `+55${phone}`;
  if (phone.length >= 8) return `+55${phone}`;
  return phone;
}

// ── CSV parsing helper ───────────────────────────────────────────────────────
function parseCSV(text: string): { headers: string[]; rows: string[][] } {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length === 0) return { headers: [], rows: [] };

  // Auto-detect delimiter: semicolon or comma
  const firstLine = lines[0] ?? '';
  const delimiter = firstLine.includes(';') ? ';' : ',';

  const parseLine = (line: string): string[] => {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === delimiter && !inQuotes) {
        result.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    result.push(current.trim());
    return result;
  };

  const headers = parseLine(lines[0] ?? '');
  const rows = lines.slice(1).map(parseLine);
  return { headers, rows };
}

// ── CSV Upload Modal ─────────────────────────────────────────────────────────
const CSV_FIELD_OPTIONS = [
  { value: '', label: '— Ignorar —' },
  { value: 'name', label: 'Nome' },
  { value: 'phone', label: 'Telefone' },
  { value: 'email', label: 'Email' },
  { value: 'company', label: 'Empresa' },
  { value: 'city', label: 'Cidade' },
];

interface ImportResults {
  imported: number;
  skipped: number;
  errors: number;
}

function CSVUploadModal({
  open,
  onClose,
  tenantId,
}: {
  open: boolean;
  onClose: () => void;
  tenantId: string;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [csvData, setCsvData] = useState<string[][]>([]);
  const [csvColumns, setCsvColumns] = useState<string[]>([]);
  const [columnMapping, setColumnMapping] = useState<Record<string, string>>({});
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState(0);
  const [results, setResults] = useState<ImportResults | null>(null);
  const [fileName, setFileName] = useState('');

  const resetState = useCallback(() => {
    setCsvData([]);
    setCsvColumns([]);
    setColumnMapping({});
    setImporting(false);
    setImportProgress(0);
    setResults(null);
    setFileName('');
    setDragOver(false);
  }, []);

  const handleClose = useCallback(() => {
    if (importing) return;
    resetState();
    onClose();
  }, [importing, onClose, resetState]);

  const processFile = useCallback((file: File) => {
    setFileName(file.name);
    setResults(null);
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      const { headers, rows } = parseCSV(text);
      if (headers.length === 0 || rows.length === 0) {
        toast.error('Arquivo vazio', 'O arquivo não contém dados válidos.');
        return;
      }
      setCsvColumns(headers);
      setCsvData(rows);

      // Auto-map columns based on common header names
      const autoMap: Record<string, string> = {};
      headers.forEach((h) => {
        const lower = h.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        if (/^(nome|name|nome_completo|full_name)$/.test(lower)) autoMap[h] = 'name';
        else if (/^(telefone|phone|celular|whatsapp|tel|fone|numero)$/.test(lower)) autoMap[h] = 'phone';
        else if (/^(email|e_mail|e-mail|correo)$/.test(lower)) autoMap[h] = 'email';
        else if (/^(empresa|company|razao_social|organizacao)$/.test(lower)) autoMap[h] = 'company';
        else if (/^(cidade|city|municipio|localidade)$/.test(lower)) autoMap[h] = 'city';
      });
      setColumnMapping(autoMap);
    };
    reader.readAsText(file, 'UTF-8');
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) processFile(file);
  }, [processFile]);

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
  }, [processFile]);

  // Check if required mappings exist
  const mappedValues = Object.values(columnMapping);
  const hasName = mappedValues.includes('name');
  const hasPhone = mappedValues.includes('phone');
  const canImport = hasName && hasPhone && csvData.length > 0;

  const handleImport = async () => {
    if (!canImport || importing) return;
    setImporting(true);
    setImportProgress(0);
    setResults(null);

    // Build column index map
    const colIdx: Record<string, number> = {};
    for (const [colName, fieldKey] of Object.entries(columnMapping)) {
      if (fieldKey) {
        const idx = csvColumns.indexOf(colName);
        if (idx >= 0) colIdx[fieldKey] = idx;
      }
    }

    let imported = 0;
    let skipped = 0;
    let errors = 0;
    const total = csvData.length;
    const BATCH_SIZE = 10;

    for (let i = 0; i < total; i += BATCH_SIZE) {
      const batch = csvData.slice(i, i + BATCH_SIZE);
      const inserts = [];

      for (const row of batch) {
        const name = colIdx.name !== undefined ? row[colIdx.name]?.trim() : '';
        const rawPhone = colIdx.phone !== undefined ? row[colIdx.phone]?.trim() : '';
        const email = colIdx.email !== undefined ? row[colIdx.email]?.trim() : '';
        const company = colIdx.company !== undefined ? row[colIdx.company]?.trim() : '';
        const city = colIdx.city !== undefined ? row[colIdx.city]?.trim() : '';

        if (!name || !rawPhone) {
          skipped++;
          continue;
        }

        const phone = normalizePhoneClient(rawPhone);
        if (phone.replace(/\D/g, '').length < 10) {
          errors++;
          continue;
        }

        inserts.push({
          tenant_id: tenantId,
          name,
          whatsapp: phone,
          source: 'IMPORTED',
          status: 'CAPTURED',
          metadata: {
            email: email || undefined,
            company: company || undefined,
            city: city || undefined,
            imported_at: new Date().toISOString(),
          },
        });
      }

      if (inserts.length > 0) {
        const { data, error } = await supabase
          .from('leads')
          .upsert(inserts, { onConflict: 'tenant_id,whatsapp', ignoreDuplicates: true })
          .select('id');

        if (error) {
          console.error('Batch insert error:', error.message);
          errors += inserts.length;
        } else {
          const insertedCount = data?.length || 0;
          imported += insertedCount;
          skipped += inserts.length - insertedCount;
        }
      }

      setImportProgress(Math.min(100, Math.round(((i + batch.length) / total) * 100)));
    }

    setImportProgress(100);
    setResults({ imported, skipped, errors });
    setImporting(false);

    if (imported > 0) {
      toast.success('Importação concluída', `${imported} leads importados com sucesso.`);
    } else {
      toast.info('Importação finalizada', 'Nenhum novo lead importado (possíveis duplicatas).');
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm animate-fadeIn" onClick={handleClose}>
      <div
        className="bg-white rounded-xl shadow-xl border border-[#E2E8F0] w-full max-w-2xl mx-4 overflow-hidden transform transition-all animate-scaleUp max-h-[90vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#F1F3F9] bg-slate-50/50 shrink-0">
          <div className="flex items-center gap-2">
            <FileSpreadsheet className="w-5 h-5 text-[#1B3A6B]" />
            <h3 className="text-[14.5px] font-bold text-[#0F172A]">Importar CSV / Excel</h3>
          </div>
          <button
            onClick={handleClose}
            disabled={importing}
            className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-[#E2E8F0] text-[#64748B] transition-all disabled:opacity-50"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Content */}
        <div className="p-5 space-y-4 overflow-y-auto flex-1">
          {/* Step 1: File Upload */}
          {csvColumns.length === 0 ? (
            <div
              onDragOver={e => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`border-2 border-dashed rounded-xl p-10 flex flex-col items-center gap-3 cursor-pointer transition-all ${
                dragOver
                  ? 'border-[#1B3A6B] bg-blue-50/50'
                  : 'border-[#CBD5E1] hover:border-[#94A3B8] bg-[#F8FAFC]'
              }`}
            >
              <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-[#1B3A6B]/10 to-[#1B3A6B]/5 flex items-center justify-center">
                <Upload className="w-7 h-7 text-[#1B3A6B]" />
              </div>
              <div className="text-center">
                <p className="text-[13px] font-semibold text-[#0F172A]">Arraste seu arquivo aqui</p>
                <p className="text-[11px] text-[#64748B] mt-1">ou clique para selecionar • CSV, TXT</p>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.txt"
                onChange={handleFileInput}
                className="hidden"
              />
            </div>
          ) : (
            <>
              {/* File info badge */}
              <div className="flex items-center justify-between bg-[#F8FAFC] border border-[#E2E8F0] rounded-lg px-3 py-2">
                <div className="flex items-center gap-2">
                  <FileSpreadsheet className="w-4 h-4 text-[#1B3A6B]" />
                  <span className="text-[12px] font-medium text-[#0F172A]">{fileName}</span>
                  <span className="text-[11px] text-[#64748B]">{csvData.length} linhas</span>
                </div>
                {!importing && !results && (
                  <button
                    onClick={resetState}
                    className="text-[11px] text-[#64748B] hover:text-red-500 font-medium transition-colors"
                  >
                    Remover
                  </button>
                )}
              </div>

              {/* Step 2: Column Mapping */}
              {!results && (
                <div className="space-y-3">
                  <div>
                    <h4 className="text-[12.5px] font-bold text-[#0F172A] mb-1">Mapeamento de Colunas</h4>
                    <p className="text-[11px] text-[#64748B]">Associe as colunas do arquivo aos campos do sistema. <strong>Nome</strong> e <strong>Telefone</strong> são obrigatórios.</p>
                  </div>
                  <div className="grid grid-cols-2 gap-2.5">
                    {csvColumns.map((col) => (
                      <div key={col} className="flex items-center gap-2 bg-[#F8FAFC] border border-[#E5E7EB] rounded-lg px-3 py-2">
                        <span className="text-[11px] font-medium text-[#0F172A] truncate flex-1" title={col}>{col}</span>
                        <span className="text-[10px] text-[#94A3B8]">→</span>
                        <select
                          value={columnMapping[col] || ''}
                          onChange={e => setColumnMapping(prev => ({ ...prev, [col]: e.target.value }))}
                          className={`text-[11px] font-medium border rounded-md px-2 py-1 w-28 transition-colors ${
                            columnMapping[col]
                              ? 'border-[#1B3A6B]/30 bg-blue-50/50 text-[#1B3A6B]'
                              : 'border-[#E2E8F0] bg-white text-[#64748B]'
                          }`}
                        >
                          {CSV_FIELD_OPTIONS.map(opt => (
                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                          ))}
                        </select>
                      </div>
                    ))}
                  </div>

                  {/* Validation indicator */}
                  <div className="flex items-center gap-3 text-[11px]">
                    <span className={`flex items-center gap-1 ${hasName ? 'text-emerald-600' : 'text-red-500'}`}>
                      {hasName ? <Check className="w-3 h-3" /> : <AlertCircle className="w-3 h-3" />}
                      Nome {hasName ? 'mapeado' : 'obrigatório'}
                    </span>
                    <span className={`flex items-center gap-1 ${hasPhone ? 'text-emerald-600' : 'text-red-500'}`}>
                      {hasPhone ? <Check className="w-3 h-3" /> : <AlertCircle className="w-3 h-3" />}
                      Telefone {hasPhone ? 'mapeado' : 'obrigatório'}
                    </span>
                  </div>
                </div>
              )}

              {/* Step 3: Preview Table */}
              {!results && csvData.length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-[12px] font-bold text-[#0F172A]">Pré-visualização (primeiras 5 linhas)</h4>
                  <div className="overflow-x-auto border border-[#E2E8F0] rounded-lg">
                    <table className="w-full text-[10.5px]">
                      <thead>
                        <tr className="bg-[#F8FAFC] border-b border-[#E2E8F0]">
                          {csvColumns.map((col, i) => (
                            <th key={i} className="px-2.5 py-2 text-left font-semibold text-[#475569] whitespace-nowrap">
                              {col}
                              {columnMapping[col] && (
                                <span className="ml-1 text-[9px] text-[#1B3A6B] font-bold">({CSV_FIELD_OPTIONS.find(o => o.value === columnMapping[col])?.label})</span>
                              )}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {csvData.slice(0, 5).map((row, i) => (
                          <tr key={i} className="border-b border-[#F1F5F9] last:border-0 hover:bg-[#F8FAFC]">
                            {csvColumns.map((_, j) => (
                              <td key={j} className="px-2.5 py-1.5 text-[#0F172A] whitespace-nowrap max-w-[150px] truncate">
                                {row[j] || <span className="text-[#CBD5E1]">—</span>}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {csvData.length > 5 && (
                    <p className="text-[10px] text-[#94A3B8] text-right">... e mais {csvData.length - 5} linhas</p>
                  )}
                </div>
              )}

              {/* Progress Bar */}
              {importing && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="font-medium text-[#0F172A]">Importando leads...</span>
                    <span className="text-[#1B3A6B] font-bold">{importProgress}%</span>
                  </div>
                  <div className="w-full bg-[#E2E8F0] rounded-full h-2 overflow-hidden">
                    <div
                      className="bg-gradient-to-r from-[#1B3A6B] to-[#2E5894] h-full rounded-full transition-all duration-300"
                      style={{ width: `${importProgress}%` }}
                    />
                  </div>
                </div>
              )}

              {/* Results */}
              {results && (
                <div className="bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-lg bg-emerald-100 flex items-center justify-center">
                      <ClipboardCheck className="w-4 h-4 text-emerald-600" />
                    </div>
                    <h4 className="text-[13px] font-bold text-[#0F172A]">Importação Concluída</h4>
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <div className="bg-white border border-emerald-200/50 rounded-lg p-3 text-center">
                      <div className="text-[16px] font-bold text-emerald-600">{results.imported}</div>
                      <div className="text-[10px] text-[#64748B] font-medium">Importados</div>
                    </div>
                    <div className="bg-white border border-amber-200/50 rounded-lg p-3 text-center">
                      <div className="text-[16px] font-bold text-amber-600">{results.skipped}</div>
                      <div className="text-[10px] text-[#64748B] font-medium">Duplicados</div>
                    </div>
                    <div className="bg-white border border-red-200/50 rounded-lg p-3 text-center">
                      <div className="text-[16px] font-bold text-red-500">{results.errors}</div>
                      <div className="text-[10px] text-[#64748B] font-medium">Erros</div>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-5 py-4 border-t border-[#F1F3F9] bg-slate-50/50 flex items-center justify-end gap-3 shrink-0">
          <button
            onClick={handleClose}
            disabled={importing}
            className="h-8.5 px-4.5 rounded-lg border border-[#E2E8F0] text-[#475569] text-[12px] font-semibold hover:bg-white transition-all disabled:opacity-50"
          >
            {results ? 'Fechar' : 'Cancelar'}
          </button>
          {!results && csvData.length > 0 && (
            <button
              onClick={handleImport}
              disabled={!canImport || importing}
              className="h-8.5 px-5 rounded-lg bg-[#1B3A6B] hover:bg-[#142C52] text-white text-[12px] font-bold shadow-md transition-all flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {importing ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Importando...
                </>
              ) : (
                <>
                  <Upload className="w-3.5 h-3.5" />
                  Importar {csvData.length} leads
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Webhook URL Card Component ───────────────────────────────────────────────
function WebhookURLInfo({ tenantId }: { tenantId: string }) {
  const [copied, setCopied] = useState(false);
  const webhookURL = `https://yvbyplzfqfrlfujathii.supabase.co/functions/v1/webhook-inbound?tenant_id=${tenantId}`;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(webhookURL);
      setCopied(true);
      toast.success('URL Copiada', 'URL do webhook copiada para a área de transferência.');
      setTimeout(() => setCopied(false), 2500);
    } catch {
      toast.error('Erro', 'Não foi possível copiar a URL.');
    }
  };

  return (
    <div className="mt-3 bg-purple-50/50 border border-purple-200/40 rounded-lg p-3 space-y-2">
      <p className="text-[10.5px] text-[#475569] leading-relaxed">
        Configure esta URL no seu formulário externo (Typeform, Elementor, RD Station, etc.):
      </p>
      <div className="flex items-center gap-1.5">
        <code className="flex-1 text-[9.5px] bg-white border border-purple-200/50 rounded-md px-2 py-1.5 text-[#1B3A6B] font-mono truncate select-all">
          {webhookURL}
        </code>
        <button
          onClick={handleCopy}
          className={`shrink-0 h-7 px-2.5 rounded-md text-[10px] font-semibold flex items-center gap-1 transition-all ${
            copied
              ? 'bg-emerald-100 text-emerald-700 border border-emerald-200'
              : 'bg-white border border-purple-200 text-[#1B3A6B] hover:bg-purple-50'
          }`}
        >
          {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
          {copied ? 'Copiado!' : 'Copiar'}
        </button>
      </div>
    </div>
  );
}

export default function LeadSources() {
  const tenantId = useAuthStore(state => state.tenantId);
  const [dbSources, setDbSources] = useState<DBLeadSource[]>([]);
  const [stats, setStats] = useState<Record<string, SourceStats>>({});
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'active' | 'paused'>('all');
  const [showPremiumModal, setShowPremiumModal] = useState(false);
  const [selectedPremiumSource, setSelectedPremiumSource] = useState<StaticSource | null>(null);
  const [submittingPremium, setSubmittingPremium] = useState(false);
  const [togglingSource, setTogglingSource] = useState<string | null>(null);
  const [activeSegmentText, setActiveSegmentText] = useState('segmentos ativos');
  const [showCSVModal, setShowCSVModal] = useState(false);
  const [runningDiscovery, setRunningDiscovery] = useState<string | null>(null);

  // Fontes que são do tipo "descoberta ativa" (têm motor de busca)
  const DISCOVERY_SOURCES = new Set([
    'GOOGLE_MAPS', 'CNPJ_MINER', 'DOCTORALIA', 'COMPRASNET',
    'VIVAREAL', 'INSTAGRAM_SCRAPER', 'CRM_SP', 'OAB_SP', 'CRO_SP'
  ]);

  const fetchData = async () => {
    if (!tenantId) return;
    try {
      const [listResult, statsResult] = await Promise.all([
        leadSourcesQueries.list(tenantId),
        leadSourcesQueries.getStats(tenantId)
      ]);

      if (listResult.error) throw new Error(listResult.error.message);
      if (statsResult.error) throw new Error(statsResult.error.message);

      setDbSources(listResult.data || []);
      setStats(statsResult.data || {});
    } catch (err) {
      console.error('Failed to load lead sources', err);
      toast.error('Erro ao carregar', 'Não foi possível carregar as fontes e estatísticas.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [tenantId]);

  useEffect(() => {
    if (!tenantId) return;
    const fetchCampaigns = async () => {
      try {
        const result = await campaignsQueries.list(tenantId);
        if (result.data) {
          const activeCamps = result.data.filter((c: any) => c.status === 'ACTIVE');
          if (activeCamps.length > 0) {
            const professions = Array.from(new Set(activeCamps.map((c: any) => {
              if (c.profession === 'DOCTOR') return 'Médicos';
              if (c.profession === 'LAWYER') return 'Advogados';
              if (c.profession === 'DENTIST') return 'Dentistas';
              if (c.profession === 'ENTREPRENEUR') return 'Empresários';
              if (c.profession === 'ENGINEER') return 'Engenheiros';
              if (c.profession === 'ARCHITECT') return 'Arquitetos';
              if (c.profession === 'ACCOUNTANT') return 'Contadores';
              return 'Profissionais';
            })));
            const cities = Array.from(new Set(activeCamps.flatMap((c: any) => c.cities || [])));
            
            const profStr = professions.length > 0 ? professions.slice(0, 2).join(', ') : 'contatos';
            const cityStr = cities.length > 0 ? ` em ${cities.slice(0, 2).join(', ')}` : '';
            setActiveSegmentText(`${profStr}${cityStr}`);
          } else {
            setActiveSegmentText('contatos em cidades selecionadas');
          }
        }
      } catch (e) {
        console.error(e);
      }
    };
    fetchCampaigns();
  }, [tenantId]);

  const getSourceStatus = (type: string, isPremium: boolean): 'ACTIVE' | 'PAUSED' | 'DISABLED' => {
    const dbSrc = dbSources.find(s => s.source_type === type);
    if (dbSrc) return dbSrc.status;
    return isPremium ? 'DISABLED' : 'ACTIVE';
  };

  const handleToggle = async (type: string, currentStatus: 'ACTIVE' | 'PAUSED' | 'DISABLED') => {
    if (!tenantId) return;
    if (currentStatus === 'DISABLED') return;

    const newStatus = currentStatus === 'ACTIVE' ? 'PAUSED' : 'ACTIVE';
    setTogglingSource(type);

    try {
      const result = await leadSourcesQueries.toggle(tenantId, type, newStatus);
      if (result.error) throw new Error(result.error.message);

      toast.success(
        newStatus === 'ACTIVE' ? 'Fonte Ativada' : 'Fonte Pausada',
        `A fonte ${STATIC_SOURCES.find(s => s.type === type)?.name} foi ${newStatus === 'ACTIVE' ? 'ativada' : 'pausada'} com sucesso.`
      );
      
      setDbSources(prev => {
        const idx = prev.findIndex(s => s.source_type === type);
        if (idx >= 0) {
          const updated = [...prev];
          updated[idx] = { ...updated[idx], status: newStatus as 'ACTIVE' | 'PAUSED' | 'DISABLED' } as DBLeadSource;
          return updated;
        } else {
          return [...prev, { id: 'temp', tenant_id: tenantId, source_type: type, status: newStatus as 'ACTIVE' | 'PAUSED' | 'DISABLED', config: {}, addon_id: null } as DBLeadSource];
        }
      });
    } catch (err: any) {
      console.error('Failed to toggle source', err);
      toast.error('Erro ao atualizar', err.message || 'Ocorreu um erro ao atualizar o status da fonte.');
    } finally {
      setTogglingSource(null);
    }
  };

  const handleActivatePremium = async () => {
    if (!tenantId || !selectedPremiumSource) return;
    setSubmittingPremium(true);

    try {
      const result = await leadSourcesQueries.activatePremium(tenantId, selectedPremiumSource.type as any);
      if (result.error) throw new Error(result.error.message);

      toast.success(
        'Fonte Premium Contratada!',
        `A fonte premium ${selectedPremiumSource.name} foi contratada e integrada com sucesso.`
      );

      await fetchData();
      setShowPremiumModal(false);
      setSelectedPremiumSource(null);
    } catch (err: any) {
      console.error('Failed to activate premium source', err);
      toast.error('Erro na contratação', err.message || 'Não foi possível contratar a fonte premium.');
    } finally {
      setSubmittingPremium(false);
    }
  };

  // ── Executar Busca (Discovery Engine) ──────────────────────
  const [campaignPickerOpen, setCampaignPickerOpen] = useState(false);
  const [pendingDiscoverySource, setPendingDiscoverySource] = useState<string | null>(null);
  const [availableCampaigns, setAvailableCampaigns] = useState<any[]>([]);

  const handleRunDiscovery = async (sourceType: string) => {
    if (!tenantId || runningDiscovery) return;

    try {
      // Buscar campanhas ativas
      const campResult = await campaignsQueries.list(tenantId);
      const activeCampaigns = (campResult.data || []).filter((c: any) => c.status === 'ACTIVE');
      
      if (activeCampaigns.length === 0) {
        toast.error('Sem campanha ativa', 'Crie e ative uma campanha antes de executar a busca.');
        return;
      }

      // Se tem mais de 1 campanha ativa, pede pro usuário escolher
      if (activeCampaigns.length > 1) {
        setAvailableCampaigns(activeCampaigns);
        setPendingDiscoverySource(sourceType);
        setCampaignPickerOpen(true);
        return;
      }

      // Só tem 1 campanha — executa direto
      await executeDiscovery(sourceType, activeCampaigns[0]);
    } catch (err: any) {
      console.error('Discovery error:', err);
      toast.error('Erro na busca', err.message || 'Não foi possível executar a busca.');
    }
  };

  const executeDiscovery = async (sourceType: string, campaign: any) => {
    setRunningDiscovery(sourceType);
    setCampaignPickerOpen(false);

    try {
      // Resolver search_tags: se vazio, usar filters.search_terms da profissão
      let searchTags = campaign.search_tags || [];
      if (searchTags.length === 0 && campaign.filters?.search_terms) {
        const profTerms = campaign.filters.search_terms[campaign.profession] || [];
        // Fallback: juntar todas as search_terms
        if (profTerms.length > 0) {
          searchTags = profTerms;
        } else {
          searchTags = Object.values(campaign.filters.search_terms).flat() as string[];
        }
      }

      // Fallback final: usar o nome da profissão como tag
      if (searchTags.length === 0 && campaign.profession) {
        const profNames: Record<string, string[]> = {
          DOCTOR: ['médico', 'clínica médica', 'consultório'],
          LAWYER: ['advogado', 'escritório de advocacia'],
          DENTIST: ['dentista', 'consultório odontológico'],
          ENTREPRENEUR: ['empresa', 'comércio'],
        };
        searchTags = profNames[campaign.profession] || [campaign.name];
      }

      const response = await fetch('/api/discover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenant_id: tenantId,
          campaign_id: campaign.id,
          source_type: sourceType,
          config: {
            search_tags: searchTags,
            cities: campaign.cities || [],
            state: 'SP', // TODO: derivar do estado das cidades
            daily_limit: campaign.daily_limit || 20,
            profession: campaign.profession || null,
          },
        }),
      });

      const data = await response.json();

      if (data.ok) {
        toast.success(
          `Busca concluída! (${campaign.name})`,
          `${data.leads_inserted || 0} novos leads capturados de ${data.leads_found || 0} encontrados.`
        );
        await fetchData();
      } else {
        const errorMsg = data.error || data.errors?.join(', ') || 'Erro desconhecido';
        toast.error('Erro na busca', errorMsg);
      }
    } catch (err: any) {
      console.error('Discovery error:', err);
      toast.error('Erro na busca', err.message || 'Não foi possível executar a busca.');
    } finally {
      setRunningDiscovery(null);
    }
  };

  const mappedSources = STATIC_SOURCES.map(src => {
    const status = getSourceStatus(src.type, src.isPremium);
    const sourceStats = stats[src.type] || { total: 0, last30Days: 0, whatsappValid: 0 };
    return {
      ...src,
      status,
      stats: sourceStats
    };
  });

  const filtered = mappedSources.filter(src => {
    if (filter === 'active') return src.status === 'ACTIVE';
    if (filter === 'paused') return src.status === 'PAUSED' || src.status === 'DISABLED';
    return true;
  });

  const totalLeads = Object.values(stats).reduce((acc, curr) => acc + (curr.total || 0), 0);
  const activeCount = mappedSources.filter(s => s.status === 'ACTIVE').length;
  const pausedOrDisabledCount = mappedSources.filter(s => s.status !== 'ACTIVE').length;

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-80 gap-3">
        <Loader2 className="w-8 h-8 text-[#1B3A6B] animate-spin" />
        <span className="text-[13px] text-[#64748B] font-medium">Carregando fontes de leads...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fadeIn pb-10">
      {/* Header Info Banner */}
      <div className="flex items-center gap-3.5 px-4.5 py-4 bg-gradient-to-r from-[rgba(27,58,107,0.04)] to-[rgba(232,152,28,0.06)] border border-[rgba(27,58,107,0.08)] rounded-xl text-[12.5px] text-[#0F172A] shadow-sm">
        <MapPin className="w-5 h-5 text-[#1B3A6B] shrink-0" />
        <div>
          <strong className="text-[#1B3A6B]">Fontes de prospecção ativas.</strong> A IA combina e orquestra múltiplas fontes reais para capturar leads qualificados focando em <span className="font-semibold text-[#1B3A6B]">{activeSegmentText}</span>.
        </div>
      </div>

      {/* Toolbar & Stats Overview */}
      <div className="bg-white border border-[#E5E7EB] rounded-xl p-3.5 flex items-center justify-between gap-4 flex-wrap shadow-sm">
        <div className="flex items-center gap-2">
          <button 
            onClick={() => setFilter('all')} 
            className={`h-8.5 px-4 rounded-lg text-[12px] font-semibold transition-all ${
              filter === 'all' 
                ? 'bg-[#1B3A6B] text-white shadow-sm' 
                : 'text-[#475569] border border-[#E5E7EB] hover:bg-[#F8FAFC]'
            }`}
          >
            Todas · {mappedSources.length}
          </button>
          <button 
            onClick={() => setFilter('active')} 
            className={`h-8.5 px-4 rounded-lg text-[12px] font-semibold transition-all ${
              filter === 'active' 
                ? 'bg-[#1B3A6B] text-white shadow-sm' 
                : 'text-[#475569] border border-[#E5E7EB] hover:bg-[#F8FAFC]'
            }`}
          >
            Ativas · {activeCount}
          </button>
          <button 
            onClick={() => setFilter('paused')} 
            className={`h-8.5 px-4 rounded-lg text-[12px] font-semibold transition-all ${
              filter === 'paused' 
                ? 'bg-[#1B3A6B] text-white shadow-sm' 
                : 'text-[#475569] border border-[#E5E7EB] hover:bg-[#F8FAFC]'
            }`}
          >
            Pausadas/Desativadas · {pausedOrDisabledCount}
          </button>
        </div>
        
        <div className="flex items-center gap-4.5 text-[12px] text-[#475569] font-medium mr-1.5">
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-[#10B981] animate-pulse" />
            <span>Higienização Ativa</span>
          </div>
          <div className="h-4 w-px bg-[#E2E8F0]" />
          <span>Total de <strong className="text-[#0F172A] font-bold">{totalLeads}</strong> leads capturados</span>
        </div>
      </div>

      {/* Sources Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-2 xl:grid-cols-3 gap-5">
        {filtered.map(src => {
          const isActive = src.status === 'ACTIVE';
          const isDisabled = src.status === 'DISABLED';
          
          // Calculate WhatsApp Validity rate
          const whatsappRate = src.stats.total > 0 
            ? Math.round((src.stats.whatsappValid / src.stats.total) * 100)
            : 0;

          return (
            <div 
              key={src.type} 
              className={`bg-white border rounded-xl p-5 flex flex-col justify-between transition-all duration-300 hover:-translate-y-1 hover:shadow-lg ${src.borderColor} ${
                isDisabled ? 'opacity-85 border-dashed border-[#CBD5E1]' : ''
              }`}
            >
              <div>
                {/* Card Top: Icon & Toggle/Button */}
                <div className="flex items-start justify-between gap-4 mb-4">
                  <div className={`w-11 h-11 rounded-lg bg-gradient-to-br ${src.color} flex items-center justify-center text-[22px] shrink-0 shadow-sm border border-black/[0.03]`}>
                    {src.icon}
                  </div>
                  
                  <div className="flex items-center gap-2">
                    {src.isComingSoon ? (
                      <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-slate-100 text-slate-500 border border-slate-200">
                        Em Breve
                      </span>
                    ) : isDisabled ? (
                      <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200">
                        Premium
                      </span>
                    ) : isActive ? (
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200/50 flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                        Ativa
                      </span>
                    ) : (
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-slate-50 text-slate-600 border border-slate-200/50">
                        Pausada
                      </span>
                    )}
                  </div>
                </div>

                {/* Source Title & Descriptions */}
                <h3 className="text-[14.5px] font-bold text-[#0F172A] mb-1 flex items-center gap-1.5">
                  {src.name}
                </h3>
                <p className="text-[12px] text-[#475569] font-medium leading-tight mb-2.5">{src.description}</p>
                <p className="text-[11px] text-[#64748B] leading-relaxed mb-4 min-h-[50px]">{src.longDescription}</p>
              </div>

              {/* Card Footer: KPIs & Bottom Action */}
              <div className="border-t border-[#F1F3F9] pt-4 mt-2 space-y-4">
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="bg-[#F8FAFC] rounded-lg p-2 border border-[#F1F5F9]">
                    <div className="text-[13px] font-bold text-[#0F172A]">
                      {src.stats.total}
                    </div>
                    <div className="text-[9.5px] text-[#64748B] font-medium tracking-tight">Capturados</div>
                  </div>
                  
                  <div className="bg-[#F8FAFC] rounded-lg p-2 border border-[#F1F5F9]">
                    <div className="text-[13px] font-bold text-[#0F172A]">
                      {src.stats.total > 0 ? `${whatsappRate}%` : '—'}
                    </div>
                    <div className="text-[9.5px] text-[#64748B] font-medium tracking-tight">Whats Válido</div>
                  </div>
                  
                  <div className="bg-[#F8FAFC] rounded-lg p-2 border border-[#F1F5F9] flex flex-col justify-center">
                    <div className="text-[10px] font-bold text-[#0F172A] leading-tight">
                      {src.costText}
                    </div>
                    <div className="text-[9.5px] text-[#64748B] font-medium tracking-tight">Custo</div>
                  </div>
                </div>

                <div className="flex items-center justify-between pt-1">
                  <span className="text-[11px] text-[#64748B]">
                    {src.stats.last30Days > 0 ? `+${src.stats.last30Days} nos últimos 30 dias` : 'Sem capturas recentes'}
                  </span>
                  
                  {src.isComingSoon ? (
                    <button 
                      disabled
                      className="px-3.5 py-1.5 rounded-lg bg-slate-50 text-slate-400 text-[11px] font-bold cursor-not-allowed border border-slate-200"
                    >
                      Em Desenvolvimento
                    </button>
                  ) : src.type === 'IMPORTED' ? (
                    <button 
                      onClick={() => setShowCSVModal(true)} 
                      className="px-3.5 py-1.5 rounded-lg bg-gradient-to-r from-[#1B3A6B] to-[#2E5894] hover:from-[#142C52] hover:to-[#1B3A6B] text-white text-[11px] font-bold transition-all shadow-sm flex items-center gap-1.5"
                    >
                      <Upload className="w-3 h-3" />
                      Importar Arquivo
                    </button>
                  ) : isDisabled ? (
                    <button 
                      onClick={() => {
                        setSelectedPremiumSource(src);
                        setShowPremiumModal(true);
                      }} 
                      className="px-3.5 py-1.5 rounded-lg bg-gradient-to-r from-[#1B3A6B] to-[#2E5894] hover:from-[#142C52] hover:to-[#1B3A6B] text-white text-[11px] font-bold transition-all shadow-sm flex items-center gap-1"
                    >
                      Ativar Fonte
                    </button>
                  ) : (
                    <div className="flex items-center gap-2">
                      {/* Botão Executar Busca para fontes de descoberta ativa */}
                      {DISCOVERY_SOURCES.has(src.type) && isActive && (
                        <button
                          onClick={() => handleRunDiscovery(src.type)}
                          disabled={runningDiscovery !== null}
                          className={`px-2.5 py-1 rounded-lg text-[10px] font-bold transition-all flex items-center gap-1 ${
                            runningDiscovery === src.type
                              ? 'bg-amber-50 text-amber-600 border border-amber-200 cursor-wait'
                              : 'bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100'
                          } disabled:opacity-50`}
                        >
                          {runningDiscovery === src.type ? (
                            <>
                              <Loader2 className="w-3 h-3 animate-spin" />
                              Buscando...
                            </>
                          ) : (
                            <>
                              <Search className="w-3 h-3" />
                              Buscar
                            </>
                          )}
                        </button>
                      )}
                      <span className="text-[10.5px] text-[#64748B] font-medium">
                        {isActive ? 'Ativo' : 'Pausado'}
                      </span>
                      <Switch 
                        checked={isActive} 
                        disabled={togglingSource === src.type} 
                        onChange={() => handleToggle(src.type, src.status)} 
                      />
                    </div>
                  )}
                </div>

                {/* Webhook URL info for LANDING_PAGE */}
                {src.type === 'LANDING_PAGE' && !src.isComingSoon && tenantId && (
                  <WebhookURLInfo tenantId={tenantId} />
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* ═══ Add-on Premium Modal ═══ */}
      {showPremiumModal && selectedPremiumSource && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm animate-fadeIn" onClick={() => !submittingPremium && setShowPremiumModal(false)}>
          <div 
            className="bg-white rounded-xl shadow-xl border border-[#E2E8F0] w-full max-w-md mx-4 overflow-hidden transform transition-all animate-scaleUp"
            onClick={e => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-[#F1F3F9] bg-slate-50/50">
              <div className="flex items-center gap-2">
                <span className="text-[18px]">🚀</span>
                <h3 className="text-[14.5px] font-bold text-[#0F172A]">Contratar Fonte Premium</h3>
              </div>
              <button 
                onClick={() => !submittingPremium && setShowPremiumModal(false)} 
                disabled={submittingPremium}
                className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-[#E2E8F0] text-[#64748B] transition-all"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Modal Content */}
            <div className="p-6 space-y-4">
              <div className="flex items-start gap-4 bg-blue-50/50 p-4 border border-blue-100 rounded-xl">
                <div className="w-12 h-12 rounded-lg bg-blue-100/50 text-[#1B3A6B] flex items-center justify-center text-[24px] shrink-0 border border-blue-200/30">
                  {selectedPremiumSource.icon}
                </div>
                <div>
                  <h4 className="text-[13.5px] font-bold text-[#0F172A]">{selectedPremiumSource.name}</h4>
                  <p className="text-[11px] text-[#475569] leading-relaxed mt-0.5">
                    {selectedPremiumSource.longDescription}
                  </p>
                </div>
              </div>

              {/* Price details */}
              <div className="bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl p-4 space-y-2.5">
                <div className="flex justify-between items-center text-[12px]">
                  <span className="text-[#64748B] font-medium">Assinatura Mensal</span>
                  <span className="font-bold text-[#0F172A]">{selectedPremiumSource.costText}</span>
                </div>
                <div className="flex justify-between items-center text-[12px]">
                  <span className="text-[#64748B] font-medium">Integração da Base</span>
                  <span className="text-[#10B981] font-semibold">Inclusa</span>
                </div>
                <div className="h-px bg-[#E2E8F0] my-2" />
                <div className="flex justify-between items-center text-[12.5px]">
                  <span className="text-[#0F172A] font-bold">Total Adicional</span>
                  <span className="text-[#1B3A6B] font-extrabold text-[14px]">{selectedPremiumSource.costText}/mês</span>
                </div>
              </div>

              {/* Alerts and terms */}
              <div className="flex items-start gap-2 text-[10.5px] text-[#64748B] leading-normal bg-amber-50/40 border border-amber-100/60 p-3 rounded-lg">
                <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <div>
                  Ao confirmar, o add-on será adicionado à fatura mensal do seu tenant. A ativação é automática e você poderá desativar a qualquer momento nas configurações de plano.
                </div>
              </div>
            </div>

            {/* Modal Actions */}
            <div className="px-5 py-4 border-t border-[#F1F3F9] bg-slate-50/50 flex items-center justify-end gap-3.5">
              <button 
                onClick={() => setShowPremiumModal(false)}
                disabled={submittingPremium}
                className="h-8.5 px-4.5 rounded-lg border border-[#E2E8F0] text-[#475569] text-[12px] font-semibold hover:bg-white transition-all disabled:opacity-50"
              >
                Cancelar
              </button>
              <button 
                onClick={handleActivatePremium}
                disabled={submittingPremium}
                className="h-8.5 px-5 rounded-lg bg-[#1B3A6B] hover:bg-[#142C52] text-white text-[12px] font-bold shadow-md transition-all flex items-center gap-1.5 disabled:opacity-50"
              >
                {submittingPremium ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Contratando...
                  </>
                ) : (
                  <>
                    Confirmar Contratação
                    <ArrowRight className="w-3.5 h-3.5" />
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══ CSV Upload Modal ═══ */}
      {tenantId && (
        <CSVUploadModal
          open={showCSVModal}
          onClose={() => setShowCSVModal(false)}
          tenantId={tenantId}
        />
      )}

      {/* ═══ Campaign Picker Modal (quando há múltiplas campanhas) ═══ */}
      {campaignPickerOpen && pendingDiscoverySource && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm animate-fadeIn" onClick={() => setCampaignPickerOpen(false)}>
          <div
            className="bg-white rounded-xl shadow-xl border border-[#E2E8F0] w-full max-w-sm mx-4 overflow-hidden transform transition-all animate-scaleUp"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-[#F1F3F9] bg-slate-50/50">
              <div className="flex items-center gap-2">
                <Search className="w-4 h-4 text-[#1B3A6B]" />
                <h3 className="text-[14px] font-bold text-[#0F172A]">Escolha a campanha</h3>
              </div>
              <button
                onClick={() => setCampaignPickerOpen(false)}
                className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-[#E2E8F0] text-[#64748B] transition-all"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4 space-y-2">
              <p className="text-[11px] text-[#64748B] mb-3">
                Qual campanha usar para configurar a busca? (cidades, profissão, tags)
              </p>
              {availableCampaigns.map((camp: any) => (
                <button
                  key={camp.id}
                  onClick={() => executeDiscovery(pendingDiscoverySource, camp)}
                  className="w-full text-left p-3 rounded-lg border border-[#E2E8F0] hover:border-[#1B3A6B] hover:bg-blue-50/30 transition-all group"
                >
                  <div className="text-[12.5px] font-bold text-[#0F172A] group-hover:text-[#1B3A6B]">
                    {camp.name}
                  </div>
                  <div className="text-[10.5px] text-[#64748B] mt-0.5">
                    {(camp.cities || []).join(', ')} • {camp.profession || 'Geral'}
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
