'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, Button, toast } from '@prospix/ui';
import { Save, Loader2, AlertCircle, CheckCircle2, FileText, MessageSquare } from 'lucide-react';
import { adminApiClient } from '@/lib/admin-api-client';
import { AxiosError } from 'axios';

interface ObjectionEntry {
  trigger?: string;
  client_says_examples?: string[];
  giovane_response?: string;
  follow_up?: string;
}

interface VoiceProfileDraft {
  compliance_never?: string[];
  objections?: ObjectionEntry[];
  [key: string]: unknown;
}

interface ScriptSegment {
  initial_message_variations?: string[];
  nodes?: Array<{ id: string; message: string; next?: string[] }>;
}

interface ScriptsDraft {
  medicos?: ScriptSegment;
  advogados?: ScriptSegment;
  empresarios?: ScriptSegment;
}

const VOICE_PROFILE_PLACEHOLDER = `{
  "compliance_never": [
    "Nunca cite valor de prêmio específico (depende de cotação).",
    "Nunca prometa cobertura específica (avaliação seguradora).",
    "Nunca fale como 'vou te aprovar'."
  ],
  "objections": [
    {
      "trigger": "has_other_insurance",
      "client_says_examples": ["já tenho seguro", "tenho Bradesco"],
      "giovane_response": "...resposta literal...",
      "follow_up": "..."
    }
  ]
}`;

const SCRIPTS_PLACEHOLDER = `{
  "medicos": {
    "initial_message_variations": [
      "Mensagem inicial variação A",
      "Mensagem inicial variação B",
      "Mensagem inicial variação C"
    ],
    "nodes": [
      { "id": "saudacao", "message": "..." },
      { "id": "rapport", "message": "..." },
      { "id": "dor", "message": "..." },
      { "id": "solucao", "message": "..." },
      { "id": "fechamento", "message": "..." }
    ]
  },
  "advogados": { "initial_message_variations": [], "nodes": [] },
  "empresarios": { "initial_message_variations": [], "nodes": [] }
}`;

interface DraftsEditorProps {
  tenantId: string;
  onSaved: () => void;
}

export function DraftsEditor({ tenantId, onSaved }: DraftsEditorProps) {
  const [voiceProfileText, setVoiceProfileText] = useState('');
  const [scriptsText, setScriptsText] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSavingVoice, setIsSavingVoice] = useState(false);
  const [isSavingScripts, setIsSavingScripts] = useState(false);
  const [voiceParseError, setVoiceParseError] = useState<string | null>(null);
  const [scriptsParseError, setScriptsParseError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      setIsLoading(true);
      try {
        const response = await adminApiClient.get(`/admin/tenants/${tenantId}/discovery/drafts`);
        const data = response.data?.data;
        setVoiceProfileText(data?.voiceProfile ? JSON.stringify(data.voiceProfile, null, 2) : '');
        setScriptsText(data?.scripts ? JSON.stringify(data.scripts, null, 2) : '');
      } catch (err: unknown) {
        const message = err instanceof AxiosError
          ? err.response?.data?.message || 'Falha ao carregar drafts.'
          : 'Falha ao carregar drafts.';
        toast.error('Erro ao carregar', message);
      } finally {
        setIsLoading(false);
      }
    })();
  }, [tenantId]);

  const parsedVoice = (() => {
    if (!voiceProfileText.trim()) return null;
    try {
      const obj = JSON.parse(voiceProfileText) as VoiceProfileDraft;
      return obj;
    } catch {
      return null;
    }
  })();

  const parsedScripts = (() => {
    if (!scriptsText.trim()) return null;
    try {
      const obj = JSON.parse(scriptsText) as ScriptsDraft;
      return obj;
    } catch {
      return null;
    }
  })();

  const objectionsCount = parsedVoice?.objections?.length ?? 0;
  const complianceCount = parsedVoice?.compliance_never?.length ?? 0;
  const voiceGateOk = objectionsCount >= 6 && complianceCount >= 3;

  const segmentInfo = (seg?: ScriptSegment) => ({
    variations: seg?.initial_message_variations?.length ?? 0,
    nodes: seg?.nodes?.length ?? 0,
    ok: (seg?.initial_message_variations?.length ?? 0) >= 3 && (seg?.nodes?.length ?? 0) >= 5,
  });
  const medicosInfo = segmentInfo(parsedScripts?.medicos);
  const advogadosInfo = segmentInfo(parsedScripts?.advogados);
  const empresariosInfo = segmentInfo(parsedScripts?.empresarios);
  const scriptsGateOk = medicosInfo.ok && advogadosInfo.ok && empresariosInfo.ok;

  const handleSaveVoice = async () => {
    setVoiceParseError(null);
    let profile: VoiceProfileDraft;
    try {
      profile = JSON.parse(voiceProfileText || '{}') as VoiceProfileDraft;
    } catch (err) {
      setVoiceParseError(err instanceof Error ? err.message : 'JSON inválido.');
      return;
    }
    setIsSavingVoice(true);
    try {
      await adminApiClient.put(`/admin/tenants/${tenantId}/discovery/voice-profile`, { profile });
      toast.success('Voice profile salvo', `${objectionsCount} objeções · ${complianceCount} compliance`);
      onSaved();
    } catch (err: unknown) {
      const message = err instanceof AxiosError
        ? err.response?.data?.message || 'Falha ao salvar.'
        : 'Falha ao salvar.';
      toast.error('Erro', message);
    } finally {
      setIsSavingVoice(false);
    }
  };

  const handleSaveScripts = async () => {
    setScriptsParseError(null);
    let scripts: ScriptsDraft;
    try {
      scripts = JSON.parse(scriptsText || '{}') as ScriptsDraft;
    } catch (err) {
      setScriptsParseError(err instanceof Error ? err.message : 'JSON inválido.');
      return;
    }
    setIsSavingScripts(true);
    try {
      await adminApiClient.put(`/admin/tenants/${tenantId}/discovery/scripts`, { scripts });
      toast.success('Scripts salvos');
      onSaved();
    } catch (err: unknown) {
      const message = err instanceof AxiosError
        ? err.response?.data?.message || 'Falha ao salvar.'
        : 'Falha ao salvar.';
      toast.error('Erro', message);
    } finally {
      setIsSavingScripts(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-6" role="status">
        <Loader2 className="w-4 h-4 animate-spin text-text-secondary" aria-label="Carregando drafts" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card className="bg-white border-border shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-bold font-heading text-text flex items-center gap-2">
            <MessageSquare className="w-4 h-4 text-text-secondary" aria-hidden />
            Voice profile draft
          </CardTitle>
          <CardDescription className="text-text-secondary text-xs">
            JSON com voz do corretor · gates de promoção exigem <strong>≥6 objections</strong> e <strong>≥3 compliance_never</strong>.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2 text-[10px]">
            <GateBadge label={`objections: ${objectionsCount}/6`} ok={objectionsCount >= 6} />
            <GateBadge label={`compliance_never: ${complianceCount}/3`} ok={complianceCount >= 3} />
            <GateBadge label="JSON válido" ok={!!parsedVoice || !voiceProfileText.trim()} />
            <GateBadge label="Gate completo" ok={voiceGateOk} />
          </div>
          <textarea
            value={voiceProfileText}
            onChange={(e) => {
              setVoiceProfileText(e.target.value);
              if (voiceParseError) setVoiceParseError(null);
            }}
            placeholder={VOICE_PROFILE_PLACEHOLDER}
            rows={14}
            spellCheck={false}
            className={`w-full bg-surface-sunken border rounded-lg px-3 py-2 text-[11px] font-mono text-text focus:outline-none resize-y ${
              voiceParseError ? 'border-red-500' : 'border-border focus:border-border-strong'
            }`}
            aria-label="Voice profile draft JSON"
          />
          {voiceParseError && (
            <p className="text-[10px] text-red-600 flex items-center gap-1" role="alert">
              <AlertCircle className="w-3 h-3" aria-hidden /> {voiceParseError}
            </p>
          )}
          <Button
            onClick={handleSaveVoice}
            disabled={isSavingVoice}
            className="bg-primary hover:bg-primary-hover text-white font-semibold text-xs px-4 h-9 rounded-xl flex items-center gap-2 disabled:opacity-60"
          >
            {isSavingVoice ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            {isSavingVoice ? 'Salvando...' : 'Salvar voice profile'}
          </Button>
        </CardContent>
      </Card>

      <Card className="bg-white border-border shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-bold font-heading text-text flex items-center gap-2">
            <FileText className="w-4 h-4 text-text-secondary" aria-hidden />
            Scripts draft (3 segmentos)
          </CardTitle>
          <CardDescription className="text-text-secondary text-xs">
            Cada segmento (médicos/advogados/empresários) exige <strong>≥3 variações iniciais</strong> e <strong>≥5 nodes</strong> para promoção.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-[10px]">
            <ScriptSegmentBadge name="médicos" info={medicosInfo} />
            <ScriptSegmentBadge name="advogados" info={advogadosInfo} />
            <ScriptSegmentBadge name="empresários" info={empresariosInfo} />
          </div>
          <div className="flex flex-wrap gap-2 text-[10px]">
            <GateBadge label="JSON válido" ok={!!parsedScripts || !scriptsText.trim()} />
            <GateBadge label="Gate completo" ok={scriptsGateOk} />
          </div>
          <textarea
            value={scriptsText}
            onChange={(e) => {
              setScriptsText(e.target.value);
              if (scriptsParseError) setScriptsParseError(null);
            }}
            placeholder={SCRIPTS_PLACEHOLDER}
            rows={16}
            spellCheck={false}
            className={`w-full bg-surface-sunken border rounded-lg px-3 py-2 text-[11px] font-mono text-text focus:outline-none resize-y ${
              scriptsParseError ? 'border-red-500' : 'border-border focus:border-border-strong'
            }`}
            aria-label="Scripts draft JSON"
          />
          {scriptsParseError && (
            <p className="text-[10px] text-red-600 flex items-center gap-1" role="alert">
              <AlertCircle className="w-3 h-3" aria-hidden /> {scriptsParseError}
            </p>
          )}
          <Button
            onClick={handleSaveScripts}
            disabled={isSavingScripts}
            className="bg-primary hover:bg-primary-hover text-white font-semibold text-xs px-4 h-9 rounded-xl flex items-center gap-2 disabled:opacity-60"
          >
            {isSavingScripts ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            {isSavingScripts ? 'Salvando...' : 'Salvar scripts'}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function GateBadge({ label, ok }: { label: string; ok: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border ${
        ok ? 'bg-success-soft text-success-text border-success/30' : 'bg-amber-50 text-amber-800 border-amber-300'
      }`}
      role="status"
    >
      {ok ? <CheckCircle2 className="w-3 h-3" aria-hidden /> : <AlertCircle className="w-3 h-3" aria-hidden />}
      {label}
    </span>
  );
}

function ScriptSegmentBadge({ name, info }: { name: string; info: { variations: number; nodes: number; ok: boolean } }) {
  return (
    <div
      className={`px-2 py-1.5 rounded border text-[10px] ${
        info.ok ? 'bg-success-soft/40 border-success/30 text-success-text' : 'bg-amber-50 border-amber-300 text-amber-800'
      }`}
    >
      <div className="font-bold capitalize">{name}</div>
      <div>variações: {info.variations}/3 · nodes: {info.nodes}/5</div>
    </div>
  );
}

export default DraftsEditor;
