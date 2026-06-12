"use client";

import { useEffect, useState } from "react";
import { Button, Input, Textarea, Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle, toast } from "@prospix/ui";
import { BrainCircuit, Save, User, Briefcase, MessagesSquare, Target, Mic } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuthStore } from "@/store/auth-store";

export default function AIContextPage() {
  const { tenantId } = useAuthStore();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  
  const [formData, setFormData] = useState({
    persona_name: "",
    persona_role: "",
    business_description: "",
    common_objections: "",
    standard_approaches: "",
    tone_of_voice: "",
  });

  useEffect(() => {
    if (tenantId) {
      loadContext();
    }
  }, [tenantId]);

  const loadContext = async () => {
    try {
      setLoading(true);
      
      const { data, error } = await supabase
        .from('tenant_business_context')
        .select('*')
        .eq('tenant_id', tenantId)
        .single();
        
      if (data) {
          setFormData({
            persona_name: data.persona_name || "",
            persona_role: data.persona_role || "",
            business_description: data.business_description || "",
            common_objections: data.common_objections || "",
            standard_approaches: data.standard_approaches || "",
            tone_of_voice: data.tone_of_voice || "",
          });
        }
      }
    } catch (error) {
      console.error("Error loading context:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      if (!tenantId) throw new Error("Tenant ID não encontrado");

      const { error } = await supabase
        .from('tenant_business_context')
        .upsert({
          tenant_id: tenantId,
          ...formData,
          updated_at: new Date().toISOString()
        }, { onConflict: 'tenant_id' });

      if (error) throw error;
      
      toast.success("Contexto da IA atualizado com sucesso!");
    } catch (error: any) {
      console.error("Error saving context:", error);
      toast.error("Erro ao salvar. Tem certeza que a tabela já existe no Supabase?");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="flex justify-center p-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div></div>;
  }

  return (
    <div className="space-y-6 max-w-5xl mx-auto pb-12">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Contexto do Negócio & IA</h1>
        <p className="text-muted-foreground mt-2">
          Configure a identidade, os argumentos de ouro e as regras de negócio para a IA da Prospix atuar exatamente como o seu melhor SDR.
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {/* Identidade da Persona */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <User className="h-5 w-5 text-primary" /> Identidade da Persona
            </CardTitle>
            <CardDescription>Quem é a IA quando estiver conversando com o lead?</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Nome do Atendente (SDR)</label>
              <Input 
                name="persona_name"
                placeholder="Ex: Giovane" 
                value={formData.persona_name}
                onChange={handleChange}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Cargo/Posição</label>
              <Input 
                name="persona_role"
                placeholder="Ex: Especialista em Seguros B2B" 
                value={formData.persona_role}
                onChange={handleChange}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Tom de Voz</label>
              <Textarea 
                name="tone_of_voice"
                placeholder="Ex: Consultivo, amigável, direto ao ponto. Usa emojis ocasionalmente mas sem exagerar." 
                value={formData.tone_of_voice}
                onChange={handleChange}
                className="h-20"
              />
            </div>
          </CardContent>
        </Card>

        {/* Sobre o Negócio */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Briefcase className="h-5 w-5 text-primary" /> Sobre o Negócio
            </CardTitle>
            <CardDescription>O que você vende e qual a proposta de valor única?</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Descrição do Negócio & Diferencial</label>
              <Textarea 
                name="business_description"
                placeholder="Ex: Vendemos Seguro Saúde Empresarial. Nosso grande diferencial é a gestão ativa da sinistralidade..." 
                value={formData.business_description}
                onChange={handleChange}
                className="h-44"
              />
            </div>
          </CardContent>
        </Card>

        {/* Objeções e Contornos */}
        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Target className="h-5 w-5 text-primary" /> Objeções Comuns & Como Contornar
            </CardTitle>
            <CardDescription>Ensine a IA a lidar com os \"nãos\" da mesma forma que você lida.</CardDescription>
          </CardHeader>
          <CardContent>
            <Textarea 
              name="common_objections"
              placeholder="Ex: &#10;- Objeção: 'Tá muito caro'. Contorno: Mostre que o custo do absenteísmo é maior que o plano.&#10;- Objeção: 'Já tenho corretor'. Contorno: Parabenize e diga que fazemos auditorias gratuitas nas apólices atuais." 
              value={formData.common_objections}
              onChange={handleChange}
              className="h-32 font-mono text-sm"
            />
          </CardContent>
        </Card>

        {/* Abordagens Padrão */}
        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <MessagesSquare className="h-5 w-5 text-primary" /> Argumentos de Ouro (Abordagens)
            </CardTitle>
            <CardDescription>Use este espaço para colar frameworks de vendas (ex: SPIN, BANT) ou regras rígidas que a IA deve seguir na conversa.</CardDescription>
          </CardHeader>
          <CardContent>
            <Textarea 
              name="standard_approaches"
              placeholder="Ex: Regra BANT: Antes de propor reunião, sempre pergunte qual a dor principal deles hoje com o RH." 
              value={formData.standard_approaches}
              onChange={handleChange}
              className="h-32 font-mono text-sm"
            />
          </CardContent>
          <CardFooter className="flex justify-end pt-4 border-t">
            <Button onClick={handleSave} disabled={saving} size="lg" className="gap-2">
              <Save className="h-4 w-4" />
              {saving ? "Salvando..." : "Salvar Configurações da IA"}
            </Button>
          </CardFooter>
        </Card>
      </div>
    </div>
  );
}
