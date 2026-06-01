'use client';

import { useState } from 'react';
import { Button, toast } from '@prospix/ui';
import { Upload, Trash2, Download, Loader2, CheckCircle2, AlertCircle, FileAudio, FileVideo, FileText, ImageIcon } from 'lucide-react';
import { adminApiClient } from '@/lib/admin-api-client';
import { AxiosError } from 'axios';

export type MaterialKind = 'audio' | 'video' | 'transcript' | 'approval_proof';

interface MaterialSlotConfig {
  kind: MaterialKind;
  label: string;
  description: string;
  accept: string;
  icon: typeof FileAudio;
}

const SLOTS: MaterialSlotConfig[] = [
  { kind: 'audio', label: 'Áudio da sessão', description: 'Gravação .mp3/.m4a/.ogg', accept: 'audio/*', icon: FileAudio },
  { kind: 'video', label: 'Vídeo da sessão', description: 'Gravação .mp4/.webm (opcional)', accept: 'video/*', icon: FileVideo },
  { kind: 'transcript', label: 'Transcrição', description: 'Texto .txt/.md ou .pdf', accept: '.txt,.md,.pdf,text/*,application/pdf', icon: FileText },
  { kind: 'approval_proof', label: 'Prova de aprovação', description: 'Print do WhatsApp do owner aprovando', accept: 'image/*', icon: ImageIcon },
];

interface MaterialsUploaderProps {
  tenantId: string;
  presentMaterials: {
    hasAudio: boolean;
    hasVideo: boolean;
    hasTranscript: boolean;
    hasApprovalProof: boolean;
  };
  onMaterialChanged: () => void;
}

export function MaterialsUploader({ tenantId, presentMaterials, onMaterialChanged }: MaterialsUploaderProps) {
  const [uploadingKind, setUploadingKind] = useState<MaterialKind | null>(null);
  const [busyKind, setBusyKind] = useState<MaterialKind | null>(null);

  const hasMaterial = (kind: MaterialKind): boolean => {
    switch (kind) {
      case 'audio': return presentMaterials.hasAudio;
      case 'video': return presentMaterials.hasVideo;
      case 'transcript': return presentMaterials.hasTranscript;
      case 'approval_proof': return presentMaterials.hasApprovalProof;
    }
  };

  const handleUpload = async (kind: MaterialKind, file: File) => {
    if (!file) return;
    if (file.size > 200 * 1024 * 1024) {
      toast.error('Arquivo grande demais', 'Limite de 200MB. Comprima ou use link externo.');
      return;
    }
    setUploadingKind(kind);
    try {
      const presignResponse = await adminApiClient.post(
        `/admin/tenants/${tenantId}/discovery/materials/presign`,
        { kind, contentType: file.type || 'application/octet-stream', filename: file.name },
      );
      const { key, uploadUrl } = presignResponse.data?.data || {};
      if (!uploadUrl || !key) throw new Error('Resposta de presign inválida.');

      const putResponse = await fetch(uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': file.type || 'application/octet-stream' },
        body: file,
      });
      if (!putResponse.ok) throw new Error(`R2 PUT falhou (${putResponse.status})`);

      await adminApiClient.post(`/admin/tenants/${tenantId}/discovery/materials/confirm`, { kind, key });
      toast.success('Upload concluído', `${file.name} salvo.`);
      onMaterialChanged();
    } catch (err: unknown) {
      const message = err instanceof AxiosError
        ? err.response?.data?.message || 'Falha no upload.'
        : err instanceof Error
          ? err.message
          : 'Falha no upload.';
      toast.error('Erro de upload', message);
    } finally {
      setUploadingKind(null);
    }
  };

  const handleDelete = async (kind: MaterialKind) => {
    if (!confirm('Remover este material? A ação não pode ser desfeita.')) return;
    setBusyKind(kind);
    try {
      await adminApiClient.delete(`/admin/tenants/${tenantId}/discovery/materials/${kind}`);
      toast.success('Material removido');
      onMaterialChanged();
    } catch (err: unknown) {
      const message = err instanceof AxiosError
        ? err.response?.data?.message || 'Falha ao remover.'
        : 'Falha ao remover.';
      toast.error('Erro', message);
    } finally {
      setBusyKind(null);
    }
  };

  const handleDownload = async (kind: MaterialKind) => {
    setBusyKind(kind);
    try {
      const response = await adminApiClient.get(`/admin/tenants/${tenantId}/discovery/materials/${kind}/download`);
      const url = response.data?.data?.downloadUrl;
      if (!url) throw new Error('URL ausente.');
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (err: unknown) {
      const message = err instanceof AxiosError
        ? err.response?.data?.message || 'Falha ao baixar.'
        : 'Falha ao baixar.';
      toast.error('Erro', message);
    } finally {
      setBusyKind(null);
    }
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      {SLOTS.map((slot) => {
        const Icon = slot.icon;
        const present = hasMaterial(slot.kind);
        const isUploading = uploadingKind === slot.kind;
        const isBusy = busyKind === slot.kind;
        return (
          <div
            key={slot.kind}
            className={`p-3 rounded-lg border ${
              present ? 'bg-success-soft/40 border-success/30' : 'bg-surface-sunken border-border'
            }`}
          >
            <div className="flex items-start gap-3">
              <div className={`p-2 rounded-lg shrink-0 ${present ? 'bg-success/10' : 'bg-white border border-border'}`}>
                <Icon className={`w-4 h-4 ${present ? 'text-success-text' : 'text-text-secondary'}`} aria-hidden />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <h4 className="text-xs font-bold text-text">{slot.label}</h4>
                  {present ? (
                    <CheckCircle2 className="w-3.5 h-3.5 text-success-text shrink-0" aria-label="Carregado" />
                  ) : (
                    <AlertCircle className="w-3.5 h-3.5 text-text-secondary/60 shrink-0" aria-label="Pendente" />
                  )}
                </div>
                <p className="text-[10px] text-text-secondary mt-0.5">{slot.description}</p>

                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <label
                    htmlFor={`upload-${slot.kind}`}
                    className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded cursor-pointer transition-colors ${
                      isUploading
                        ? 'bg-surface-sunken text-text-secondary cursor-wait'
                        : 'bg-primary text-white hover:bg-primary-hover'
                    }`}
                  >
                    {isUploading ? (
                      <>
                        <Loader2 className="w-3 h-3 animate-spin" aria-hidden /> Enviando...
                      </>
                    ) : (
                      <>
                        <Upload className="w-3 h-3" aria-hidden /> {present ? 'Substituir' : 'Enviar'}
                      </>
                    )}
                    <input
                      id={`upload-${slot.kind}`}
                      type="file"
                      accept={slot.accept}
                      className="hidden"
                      disabled={isUploading || isBusy}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleUpload(slot.kind, file);
                        e.target.value = '';
                      }}
                    />
                  </label>
                  {present && (
                    <>
                      <Button
                        onClick={() => handleDownload(slot.kind)}
                        disabled={isBusy}
                        className="bg-white hover:bg-surface-sunken text-text border border-border text-[10px] font-semibold px-2 py-1 h-auto rounded flex items-center gap-1"
                      >
                        <Download className="w-3 h-3" aria-hidden /> Baixar
                      </Button>
                      <Button
                        onClick={() => handleDelete(slot.kind)}
                        disabled={isBusy}
                        className="bg-white hover:bg-red-50 text-red-600 border border-red-200 text-[10px] font-semibold px-2 py-1 h-auto rounded flex items-center gap-1"
                      >
                        <Trash2 className="w-3 h-3" aria-hidden /> Remover
                      </Button>
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default MaterialsUploader;
