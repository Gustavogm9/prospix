# Checklist pós-sessão · Discovery Prospix

> Para o PM (Gustavo) executar nas **15 dias** após a sessão.
> Output final: `voice_profile.json` + 3 roteiros aprovados formalmente.

---

## D+0 · Imediato (dia da sessão · antes de dormir)

- [ ] **Backup do áudio** em R2 path `tenant_giovane/discovery/audio.mp3`
- [ ] **Backup do vídeo** (se houver) em `tenant_giovane/discovery/video.mp4`
- [ ] **Backup das notas** preenchidas em `tenant_giovane/discovery/notas.md`
- [ ] Mensagem de agradecimento enviada via WhatsApp ([whatsapp-confirmacao.md](whatsapp-confirmacao.md) seção 3)
- [ ] Atualizar `docs/auditoria/matriz-execucao-multiagente.md` (nova linha com status "Em execucao · consolidando voice_profile")

## D+1 · Transcrição

- [ ] Gerou transcrição automática do áudio (Whisper local · ferramenta interna ou serviço pago)
- [ ] Salvou em R2: `tenant_giovane/discovery/transcript.md`
- [ ] Revisão rápida da transcrição (corrige nomes/termos que IA errou)

## D+2 a D+3 · Consolidação do `voice_profile.json`

- [ ] Copiou [voice-profile-template.json](voice-profile-template.json) para `tenant_giovane/voice_profile.json`
- [ ] Preencheu cada campo com **frase literal** da transcrição (não parafraseia)
- [ ] Marcou campos com lacuna real como `"..."` (não inventa)
- [ ] Lista de objeções completa (8+ esperadas · se < 6 sai fraca)
- [ ] Validou via grep que não tem `"..."` em campo crítico (`objections`, `products.protecao_renda.client_language`, `key_arguments_ranked`)

## D+3 a D+5 · 3 Roteiros draft

- [ ] `script_medicos_v1` montado seguindo [PRD anexo D / flow JSON](../PRD.md)
- [ ] `script_advogados_v1` montado
- [ ] `script_empresarios_v1` montado
- [ ] Cada roteiro tem 3 variações (A/B/C) da mensagem inicial
- [ ] Cada nó referencia objeção do `voice_profile.objections`
- [ ] Compliance: nenhum roteiro promete valor / aprovação / cobertura específica
- [ ] **Test de guardrails** rodado nos drafts (`pnpm --filter @prospix/api test prompt-validation`)

## D+5 · Envio para validação

- [ ] PDF/Notion com os 3 roteiros gerado (legível pelo Giovane, sem JSON cru)
- [ ] Enviado via WhatsApp ([whatsapp-confirmacao.md](whatsapp-confirmacao.md) seção 4)
- [ ] SLA combinado: 5 dias úteis pra ele devolver com marcações

## D+5 a D+10 · Aguardando Giovane

- [ ] Recebeu feedback do Giovane (marcações ✅/⚠️/❌)
- [ ] Se demorou mais de 5 dias úteis: **ping educado no WhatsApp** (não muda cronograma)
- [ ] Se demorou mais de 8 dias úteis: **escalation pro Gustavo · cronograma de go-live afeta**

## D+10 a D+13 · Rodada de ajustes (1ª)

- [ ] Para cada ⚠️ ou ❌, ajustou a frase
- [ ] Manteve fidelidade ao voice profile (não substitui frase do Giovane por SaaS-speak)
- [ ] Enviou versão atualizada
- [ ] **Limite:** máximo 2 rodadas de ajuste (senão estoura cronograma)

## D+13 a D+15 · Rodada de ajustes (2ª · se necessária)

- [ ] Últimos ajustes
- [ ] Confirmação informal do Giovane ("Tá bom assim")

## D+15 · Aprovação formal

- [ ] Enviou mensagem ([whatsapp-confirmacao.md](whatsapp-confirmacao.md) seção 5)
- [ ] Recebeu "Aprovo os 3 roteiros" por escrito (WhatsApp serve)
- [ ] Salvou print da aprovação em R2: `tenant_giovane/discovery/aprovacao-roteiros.png`
- [ ] Atualizou `docs/auditoria/matriz-execucao-multiagente.md` ("Concluido")
- [ ] Marcou marco D+25 no cronograma do PRD seção 9

---

## Entrega para a Frente C (IA + WhatsApp)

Quando aprovação formal estiver dentro:

- [ ] Insert dos 3 roteiros como `Script` records no DB do tenant (via admin API ou seed)
- [ ] Insert do `voice_profile` em `Tenant.aiVoiceProfile` (JSONB)
- [ ] Insert das objections como nodes no `Script.flow`
- [ ] Subir 50 contatos de teste no Tenant #1 pra calibrar
- [ ] Rodar suite `prompt-validation.test.ts` contra o novo voice profile
- [ ] Validar que `confidence` médio nos testes está ≥ 0.8

---

## Métricas de qualidade do discovery (PM avalia)

Depois do voice_profile pronto, **antes de mandar pra Frente C**, autoavalia:

| Critério | Bom | Médio | Ruim |
|---|---|---|---|
| Objeções capturadas | 8+ | 5-7 | < 5 |
| Frases literais (não paráfrases) | 80%+ | 50-79% | < 50% |
| Argumentos campeões ranqueados | 3 com analogia | 3 sem analogia | < 3 |
| Tom claramente identificável | Sim · 5+ assinaturas | Sim · 2-4 | Vago |
| Materiais MetLife coletados | Todos | Parcial | Nenhum |
| Aprovação formal do Giovane | Sim · por escrito | Verbal | Tácita |

Se 3+ critérios estão em "Ruim": **considera rodar uma 2ª sessão de 1h** focando nos gaps antes de mandar pra Frente C.

---

## Em caso de churn do Giovane antes da aprovação

Se Giovane desistir do contrato antes de aprovar os roteiros:

- [ ] Notifica Gustavo imediatamente
- [ ] Pausa Frente C (não trabalha com voice profile não aprovado)
- [ ] Mantém material em R2 conforme cláusula 4 do [NDA](nda-template.md)
- [ ] Reverte status do tenant para `CHURNING` no admin
- [ ] **NÃO** usa material derivado pra outros tenants (cláusula 5 do NDA)
