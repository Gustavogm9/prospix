# Termo de Confidencialidade e Consentimento de Uso de Imagem/Voz · Discovery Prospix

> Modelo simples · LGPD-friendly. Não é parecer jurídico — antes de usar pra qualquer tenant após o Giovane, **revisar com advogado especializado** (item da revisão jurídica de AUD-P1-030/031/032 da auditoria).

---

**TERMO DE CONFIDENCIALIDADE E CONSENTIMENTO**
**Sessão de Discovery · Plataforma Prospix**

Pelo presente instrumento, **{{NOME_COMPLETO}}**, portador(a) do CPF nº **{{CPF}}**, doravante denominado **PARTICIPANTE**, e a **Guilds Tecnologia e Marketing Digital Ltda.**, inscrita no CNPJ nº **{{CNPJ_GUILDS}}**, doravante denominada **GUILDS**, firmam o presente termo nos seguintes termos:

## 1. Objeto

A sessão de discovery tem por objeto **extrair conhecimento operacional, vocabulário e abordagem comercial** do PARTICIPANTE, com o objetivo exclusivo de treinar o agente de IA da plataforma **Prospix**, contratada pelo PARTICIPANTE em **{{DATA_CONTRATO}}**.

## 2. Confidencialidade mútua

2.1. A GUILDS compromete-se a tratar como **CONFIDENCIAL** toda informação técnica, comercial, financeira, de clientes ou estratégica do PARTICIPANTE compartilhada durante a sessão, sem divulgação a terceiros que não estejam diretamente envolvidos na execução do contrato.

2.2. O PARTICIPANTE compromete-se a tratar como **CONFIDENCIAL** toda informação técnica, arquitetural, comercial ou operacional da plataforma Prospix e da GUILDS recebida durante a sessão e a execução do contrato.

2.3. A obrigação de confidencialidade subsiste por **5 (cinco) anos** após o término do contrato.

## 3. Consentimento de gravação (LGPD · art. 7, I)

3.1. O PARTICIPANTE **AUTORIZA EXPRESSAMENTE** a gravação em áudio e vídeo da sessão de discovery, agendada para **{{DATA_SESSAO}}**, com duração estimada de 3 (três) horas.

3.2. A gravação será utilizada exclusivamente para:

- Extração de conteúdo operacional para treinar o agente de IA da plataforma Prospix
- Arquivo interno da GUILDS para fins de auditoria e melhoria contínua
- Composição do `voice_profile.json` e dos roteiros customizados do PARTICIPANTE

3.3. A gravação **NÃO** será utilizada para:

- Material de marketing público sem autorização específica adicional
- Divulgação em redes sociais
- Compartilhamento com outros clientes da GUILDS
- Treinamento de IA de terceiros (somente do tenant do PARTICIPANTE)

3.4. Armazenamento: a gravação fica em **storage privado** (Cloudflare R2, paths prefixados com `tenant_{id}/discovery/`), com acesso restrito ao time da GUILDS designado ao projeto.

## 4. Direitos do titular (LGPD · art. 18)

O PARTICIPANTE pode, a qualquer momento, mediante solicitação por escrito a **dpo@guilds.com.br**:

- Solicitar **cópia** da gravação
- Solicitar **exclusão** da gravação (no caso, sem prejuízo aos roteiros já derivados, que são propriedade conjunta conforme cláusula 5)
- Revisar e corrigir transcrições
- Revogar este consentimento (com efeito não-retroativo · LGPD art. 8, §5)

## 5. Propriedade intelectual

5.1. O **conteúdo bruto** da gravação (frases exatas, exemplos, casos) permanece propriedade do PARTICIPANTE.

5.2. Os **roteiros derivados** (`voice_profile.json`, `script_medicos_v1`, `script_advogados_v1`, `script_empresarios_v1`) são licenciados ao PARTICIPANTE em **uso exclusivo** dentro da plataforma Prospix, vinculados ao contrato vigente.

5.3. A GUILDS **NÃO PODE** comercializar, vender ou compartilhar os roteiros derivados com outros tenants. Templates genéricos por segmento (sem voice profile específico) ficam fora dessa restrição.

## 6. Limitações

Este termo:

- **NÃO** transfere a propriedade da gravação à GUILDS
- **NÃO** autoriza uso comercial além do treinamento da IA do próprio PARTICIPANTE
- **NÃO** afeta os direitos da MetLife sobre material institucional MetLife que aparecer na gravação

## 7. Lei aplicável

Este termo é regido pela legislação da República Federativa do Brasil, em especial a Lei nº 13.709/2018 (LGPD), o Código Civil (Lei nº 10.406/2002) e demais normas aplicáveis.

## 8. Foro

Eventuais disputas serão resolvidas no foro da Comarca de **{{COMARCA}}**, Estado de São Paulo, com renúncia expressa a qualquer outro, por mais privilegiado que seja.

---

**Data:** {{DATA}}
**Local:** {{LOCAL}}

**PARTICIPANTE**
_________________________________
{{NOME_COMPLETO}}
CPF: {{CPF}}

**GUILDS TECNOLOGIA E MARKETING DIGITAL LTDA.**
_________________________________
{{NOME_RESPONSAVEL_GUILDS}}
CPF/CNPJ: {{CNPJ_GUILDS}}

---

## Notas operacionais

- **Quando enviar:** 2-3 dias antes da sessão (e-mail + WhatsApp · pedir assinatura digital via DocuSign/D4Sign)
- **Quem assina pela GUILDS:** Gustavo Macedo
- **Idioma:** PT-BR (este é o oficial · não enviar versão em outro idioma)
- **Onde fica:** PDF assinado armazenado em `tenant_{id}/legal/discovery-nda.pdf` no R2
- **Revisão jurídica antes de uso massivo:** sim — esse template é "good enough" pro Tenant #1 mas precisa parecer com advogado antes de virar padrão (AUD-P1-030/031/032)
