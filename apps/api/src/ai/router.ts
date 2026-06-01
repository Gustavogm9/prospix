import { dbAdmin } from '../lib/db.js';
import { redis } from '../lib/redis.js';
import { logger } from '../lib/logger.js';
import { getDecryptedSecrets } from '../tenant/secrets-vault.js';
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { AI_MODEL_PRICING, AIQuotaExceededError, assertAIQuotaBeforeCall } from './quota.js';

export interface AICallParams {
  tenantId: string;
  useCase: 'system' | 'classifier' | 'guardrail';
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  temperature?: number;
  maxTokens?: number;
  responseFormat?: 'json' | 'text';
}

export interface AICallResult {
  content: string;
  model: string;
  provider: string;
  tokensInput: number;
  tokensOutput: number;
  costCents: number; // saved as integer or float cents
  latencyMs: number;
}

const DEFAULT_MODELS = {
  openai: 'gpt-4o-mini',
  anthropic: 'claude-3-5-haiku-20241022',
  google: 'gemini-1.5-flash',
};

const DEFAULT_FALLBACK_CHAIN = ['openai', 'anthropic', 'google'];

class AIProviderError extends Error {
  constructor(
    public readonly provider: string,
    public readonly status?: number
  ) {
    super(status ? `${provider} API returned ${status}` : `${provider} API failed`);
  }
}

export class AIRouter {
  private static async getAIConfig(tenantId: string) {
    const cacheKey = `tenant-ai-config:${tenantId}`;
    try {
      const cached = await redis.get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }
    } catch (err) {
      logger.warn({ err, tenantId }, '⚠️ Failed to get AI Config from Redis cache');
    }

    const { data: config, error } = await dbAdmin
      .from('tenant_ai_configs')
      .select('*')
      .eq('tenant_id', tenantId)
      .single();

    if (error || !config) {
      // Create defaults
      const { data: newConfig, error: createErr } = await dbAdmin
        .from('tenant_ai_configs')
        .insert({
          tenant_id: tenantId,
          system_provider: 'openai',
          system_model: 'gpt-4o-mini',
          classifier_provider: 'openai',
          classifier_model: 'gpt-4o-mini',
          guardrail_provider: 'openai',
          guardrail_model: 'gpt-4o-mini',
          system_temperature: 0.4,
          classifier_temperature: 0.0,
          max_output_tokens: 1024,
          fallback_chain: DEFAULT_FALLBACK_CHAIN,
        } as any)
        .select()
        .single();

      if (createErr) throw createErr;

      try {
        await redis.setex(cacheKey, 300, JSON.stringify(newConfig));
      } catch { /* ignore cache failures */ }

      return newConfig;
    }

    try {
      await redis.setex(cacheKey, 300, JSON.stringify(config));
    } catch { /* ignore cache failures */ }

    return config;
  }

  static async call(params: AICallParams): Promise<AICallResult> {
    const { tenantId, useCase, messages, temperature, maxTokens, responseFormat } = params;
    const config = await this.getAIConfig(tenantId);
    
    // Resolve provider + model for this usecase
    let primaryProvider = 'openai';
    let primaryModel = 'gpt-4o-mini';
    let temp = temperature;

    if (useCase === 'system') {
      primaryProvider = config.system_provider || 'openai';
      primaryModel = config.system_model || DEFAULT_MODELS[primaryProvider as keyof typeof DEFAULT_MODELS];
      temp = temp !== undefined ? temp : Number(config.system_temperature || 0.4);
    } else if (useCase === 'classifier') {
      primaryProvider = config.classifier_provider || 'openai';
      primaryModel = config.classifier_model || DEFAULT_MODELS[primaryProvider as keyof typeof DEFAULT_MODELS];
      temp = temp !== undefined ? temp : Number(config.classifier_temperature || 0.0);
    } else if (useCase === 'guardrail') {
      primaryProvider = config.guardrail_provider || 'openai';
      primaryModel = config.guardrail_model || DEFAULT_MODELS[primaryProvider as keyof typeof DEFAULT_MODELS];
      temp = temp !== undefined ? temp : 0.0;
    }

    const fallbackChain = (config.fallback_chain as string[]) || DEFAULT_FALLBACK_CHAIN;
    const providersToTry = [primaryProvider, ...fallbackChain.filter((p: string) => p !== primaryProvider)];

    let lastError: any;

    await assertAIQuotaBeforeCall({
      tenantId,
      model: primaryModel,
      messages,
      maxTokens: maxTokens || config.max_output_tokens || 1024,
    });

    const decryptedSecrets = await getDecryptedSecrets(tenantId);

    for (const provider of providersToTry) {
      const model = provider === primaryProvider
        ? primaryModel
        : DEFAULT_MODELS[provider as keyof typeof DEFAULT_MODELS];
      const start = Date.now();

      try {
        logger.info({ tenantId, useCase, provider, model }, `🤖 Routing AI Call (attempting ${provider})`);

        let result: {
          content: string;
          tokensInput: number;
          tokensOutput: number;
        };

        if (provider === 'openai') {
          // Resolve key
          const apiKey = decryptedSecrets?.openaiApiKey || process.env.OPENAI_API_KEY;
          if (!apiKey) throw new Error('OpenAI API Key is missing');

          const openai = new OpenAI({ apiKey, timeout: 10000 });
          const response = await openai.chat.completions.create({
            model: model,
            messages: messages as any,
            temperature: temp,
            max_tokens: maxTokens || config.max_output_tokens || 1024,
            response_format: responseFormat === 'json' ? { type: 'json_object' } : undefined,
          });

          result = {
            content: response.choices[0]?.message?.content || '',
            tokensInput: response.usage?.prompt_tokens || 0,
            tokensOutput: response.usage?.completion_tokens || 0,
          };
        } else if (provider === 'anthropic') {
          const apiKey = decryptedSecrets?.anthropicApiKey || process.env.ANTHROPIC_API_KEY;
          if (!apiKey) throw new Error('Anthropic API Key is missing');

          const anthropic = new Anthropic({ apiKey, timeout: 10000 });
          const systemMsg = messages.find((m) => m.role === 'system')?.content || '';
          const userMsgs = messages.filter((m) => m.role !== 'system');

          const response = await anthropic.messages.create({
            model: model,
            system: systemMsg,
            messages: userMsgs as any,
            temperature: temp,
            max_tokens: maxTokens || config.max_output_tokens || 1024,
          });

          const content = response.content
            .filter((c) => c.type === 'text')
            .map((c: any) => c.text)
            .join('\n');

          result = {
            content,
            tokensInput: response.usage?.input_tokens || 0,
            tokensOutput: response.usage?.output_tokens || 0,
          };
        } else if (provider === 'google') {
          const apiKey = decryptedSecrets?.googleAiApiKey || process.env.GOOGLE_AI_API_KEY || process.env.GEMINI_API_KEY;
          if (!apiKey) throw new Error('Google AI API Key is missing');

          // We use standard fetch to communicate with Gemini API
          const geminiModel = model;
          const url = `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${apiKey}`;

          // Format messages for Gemini
          const contents = messages.map((m) => {
            const role = m.role === 'assistant' ? 'model' : 'user';
            return {
              role,
              parts: [{ text: m.content }],
            };
          });

          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 10000);

          const response = await fetch(url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              contents,
              generationConfig: {
                temperature: temp,
                maxOutputTokens: maxTokens || config.max_output_tokens || 1024,
                responseMimeType: responseFormat === 'json' ? 'application/json' : 'text/plain',
              },
            }),
            signal: controller.signal,
          });

          clearTimeout(timeoutId);

          if (!response.ok) {
            await response.arrayBuffer();
            throw new AIProviderError('Google', response.status);
          }

          const data = await response.json() as any;
          const content = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
          
          // Estimate tokens roughly if not returned (Gemini returns metadata under usageMetadata)
          const tokensInput = data?.usageMetadata?.promptTokenCount || Math.floor(JSON.stringify(messages).length / 4);
          const tokensOutput = data?.usageMetadata?.candidatesTokenCount || Math.floor(content.length / 4);

          result = {
            content,
            tokensInput,
            tokensOutput,
          };
        } else {
          throw new Error(`Unsupported AI Provider: ${provider}`);
        }

        const latencyMs = Date.now() - start;
        const pricing = AI_MODEL_PRICING[model] || { inputRate: 0, outputRate: 0 };
        const rawCost = (result.tokensInput * pricing.inputRate) + (result.tokensOutput * pricing.outputRate);
        const costCents = Math.round(rawCost * 100 * 100) / 100; // stored as decimal cents

        logger.info(
          { tenantId, provider, model, latencyMs, costCents, tokensInput: result.tokensInput, tokensOutput: result.tokensOutput },
          '✅ AI Call routed and completed successfully'
        );

        return {
          content: result.content,
          model,
          provider,
          tokensInput: result.tokensInput,
          tokensOutput: result.tokensOutput,
          costCents,
          latencyMs,
        };
      } catch (err: any) {
        if (err instanceof AIQuotaExceededError) {
          throw err;
        }

        lastError = err;
        logger.warn(
          {
            tenantId,
            provider,
            useCase,
            errorName: err?.name,
            status: err instanceof AIProviderError ? err.status : undefined,
            message: err instanceof AIProviderError ? err.message : 'AI provider call failed',
          },
          `⚠️ AI Call failed on ${provider}, trying next fallback...`
        );
      }
    }

    logger.error(
      {
        tenantId,
        useCase,
        errorName: lastError?.name,
        status: lastError instanceof AIProviderError ? lastError.status : undefined,
      },
      '❌ All AI Providers failed in fallback chain'
    );
    throw new Error('AI Router failed');
  }
}
