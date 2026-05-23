# Frente G · Discovery & Onboarding Automation

> **Status: ROADMAP (Fase 2 do produto · não ativada).**
> Esta frente productiza o processo de discovery do Giovane (manual hoje) num **hub no super-admin** que orquestra cada etapa, com possibilidade futura de **self-service assistido por IA** para tenants #6+.

## Objetivo

Transformar `docs/discovery/` (material operacional manual) em **fluxo orquestrado no painel super-admin Guilds**, com tracking, gating por etapa, e hooks para automação progressiva.

## Motivação

Modelo manual atual (Tenant #1 Giovane) é OK pra escala 1, mas quebra rápido:

- PM (Gustavo) gasta 8-12h por tenant entre sessão + transcrição + voice_profile + 3 roteiros
- Material vive em planilhas + R2 paths sem rastreabilidade no app
- Insert no DB é via SQL/admin manual · sem audit log estruturado
- Cliente não vê progresso do próprio onboarding
- Nenhum gate impede ativar tenant antes do discovery aprovado

Com Frente G, cronograma de cada tenant cai de **35 dias → ~21 dias** (Tenant #2 em diante).

## Níveis de produtização

| Nível | Tenant alvo | Quem faz | Esforço estimado |
|---|---|---|---|
| 0 · Manual hoje | Tenant #1 (Giovane) | PM presencial + planilhas | já feito |
| 1 · Hub no admin | Tenant #2 a #5 | PM ainda presencial · com UI orquestrando | ~5-7 dias-dev |
| 2 · Self-service IA-assistido | Tenant #6+ | Owner faz sozinho · IA conduz via WhatsApp/chat | ~3-4 semanas-dev |

## Escopo do Nível 1 (próximo passo recomendado)

### Schema

```prisma
model TenantDiscovery {
  tenantId           String              @id @map("tenant_id") @db.Uuid
  tenant             Tenant              @relation(fields: [tenantId], references: [id], onDelete: Cascade)

  status             DiscoveryStatus     @default(NOT_STARTED)

  scheduledFor       DateTime?           @map("scheduled_for") @db.Timestamptz()
  conductedAt        DateTime?           @map("conducted_at") @db.Timestamptz()

  // Materiais carregados
  audioR2Key         String?             @map("audio_r2_key")
  videoR2Key         String?             @map("video_r2_key")
  transcriptR2Key    String?             @map("transcript_r2_key")
  attachments        Json?               // [{ r2_key, kind, label, uploaded_at }]

  // Drafts e aprovacao
  voiceProfileDraft  Json?               @map("voice_profile_draft")
  scriptsDraft       Json?               @map("scripts_draft")    // { medicos, advogados, empresarios }

  validatedAt        DateTime?           @map("validated_at") @db.Timestamptz()
  validationRounds   Int                 @default(0) @map("validation_rounds")  // max 2

  approvedAt         DateTime?           @map("approved_at") @db.Timestamptz()
  approvalProofR2Key String?             @map("approval_proof_r2_key")   // print do WhatsApp

  pmUserId           String?             @map("pm_user_id") @db.Uuid    // responsavel
  pmUser             User?               @relation(fields: [pmUserId], references: [id])

  notes              String?             @db.Text

  createdAt          DateTime            @default(now()) @map("created_at") @db.Timestamptz()
  updatedAt          DateTime            @updatedAt @map("updated_at") @db.Timestamptz()

  @@map("tenant_discoveries")
}

enum DiscoveryStatus {
  NOT_STARTED
  SCHEDULED
  IN_SESSION
  CONSOLIDATING
  VALIDATING
  APPROVED
  CHURNED_BEFORE_APPROVAL
}
```

### Endpoints admin

```
GET    /v1/admin/tenants/:id/discovery                · estado atual + completude
PATCH  /v1/admin/tenants/:id/discovery                · update status/dates/notes
POST   /v1/admin/tenants/:id/discovery/materials      · upload R2 presigned URL
DELETE /v1/admin/tenants/:id/discovery/materials/:key · remove material
PUT    /v1/admin/tenants/:id/discovery/voice-profile  · editor JSON com validation
PUT    /v1/admin/tenants/:id/discovery/scripts        · 3 roteiros editor
POST   /v1/admin/tenants/:id/discovery/validate       · marca rodada de validacao (max 2)
POST   /v1/admin/tenants/:id/discovery/approve        · aprovacao formal + upload prova WhatsApp
POST   /v1/admin/tenants/:id/discovery/promote        · cria Script records + atualiza Tenant.aiVoiceProfile + audit
```

### UI no super-admin (`apps/admin`)

Nova tab "Discovery" no tenant detail page:

- **Header:** status atual (badge colorido) + barra de progresso 6 estágios
- **Materiais:** upload zone (drag-drop) + lista + remove
- **Voice profile draft:** editor JSON com schema validation contra template
- **3 roteiros draft:** 3 abas (médico/advogado/empresário) com editor de texto + variações A/B/C
- **Validação:** botão "Marcar rodada" (max 2) + checkbox "Giovane aprovou ⚠️/✅"
- **Aprovação:** upload do print + botão "PROMOVER PRA PRODUÇÃO" (com confirmação)
- **Timeline:** lateral mostrando histórico de mudanças (created_at, updated_at de cada mudança)

### Gates de qualidade (antes de "Promover")

- [ ] `voice_profile.objections.length >= 6`
- [ ] `voice_profile.compliance_never.length >= 3`
- [ ] 3 roteiros têm pelo menos 5 nodes cada
- [ ] Cada roteiro tem 3 variações da mensagem inicial
- [ ] `approvalProofR2Key` não-nulo
- [ ] `pmUserId` setado
- [ ] Status `APPROVED`
- [ ] Test de guardrails passou contra os roteiros (CI ou execução local marcada)

Falha em qualquer gate impede promoção · admin vê lista do que falta.

## Escopo do Nível 2 (futuro distante)

### Self-service IA-assistido

1. Owner abre `/onboarding/discovery` no app web
2. Chatbot guia através dos 8 blocos do roteiro
3. Owner responde por texto ou áudio (Whisper transcreve)
4. Após cada bloco, IA propõe estrutura do `voice_profile.json`
5. Owner revisa + edita inline
6. 3 roteiros gerados automaticamente a partir de templates de segmento + customizados
7. Owner aprova
8. PM **só valida** casos com:
   - `confidence < 0.8` em < 5 objections
   - < 6 objections respondidas substancialmente
   - Owner pediu revisão humana

### Heurísticas de detecção "precisa humano"

- Detecta sentido respostas vagas ("não sei", "depende") em > 30% dos blocos
- Detecta discurso muito SaaS-genérico (similaridade > 0.7 com template padrão)
- Detecta menção a sigla MetLife/seguros sem explicação própria
- Detecta < 3 frases assinatura claras

## Limites desta frente (NÃO TOCAR)

- Material operacional em `docs/discovery/` continua sendo a "fonte da verdade do método" — Frente G apenas **executa** o método
- Não substitui sessão humana presencial em casos complexos (corretor iniciante, corretor sem discurso estruturado)
- Não envia roteiros pra Frente C (DB) sem aprovação formal registrada

## Pré-requisitos para ativar

- [ ] Tenant #2 contratado e pagamento confirmado
- [ ] Decisão PM: vale investir 5-7 dias-dev agora ou esperar Tenant #3
- [ ] Cloudflare R2 com paths multi-tenant testados (ja existe, validar com upload real)
- [ ] Whisper integration ou serviço de transcrição (pra Nível 2 · Nível 1 pode ser manual)

## Métricas de sucesso (Nível 1)

- Cronograma de onboarding Tenant #2: de 35 dias → 21 dias úteis
- Tempo PM por tenant: de 8-12h → 4-6h (sessão continua manual; consolidação é apoiada pelo hub)
- Zero ativação de tenant sem discovery aprovado (gate operacional)
- 100% das aprovações têm prova registrada (vs 0% hoje · WhatsApp solto)

## Saúde da frente

- **Owner do roadmap:** Gustavo Macedo (PM)
- **Owner técnico ao ativar:** TBD
- **Decisão de ativar:** depende de pipeline comercial · não há urgência técnica
- **Atualizar este doc:** quando ativar, mover para spec executável com tarefas atômicas tipo Frente A-F

## Changelog

- **v0.1** (23/05/2026): roadmap inicial criado após pergunta estratégica do PM sobre productizar o discovery
