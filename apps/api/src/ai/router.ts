import { prisma } from '../lib/prisma.js';
import { redis } from '../lib/redis.js';
import { logger } from '../lib/logger.js';
import { getDecryptedSecrets } from '../tenant/secrets-vault.js';
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';

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

const PRICING: Record<string, { inputRate: number; outputRate: number }> = {
  'gpt-4o-mini': { inputRate: 0.00000015, outputRate: 0.00000060 },
  'claude-3-5-haiku-20241022': { inputRate: 0.00000080, outputRate: 0.00000400 },
  'gemini-1.5-flash': { inputRate: 0.000000075, outputRate: 0.00000030 },
};

const DEFAULT_MODELS = {
  openai: 'gpt-4o-mini',
  anthropic: 'claude-3-5-haiku-20241022',
  google: 'gemini-1.5-flash',
};

const DEFAULT_FALLBACK_CHAIN = ['openai', 'anthropic', 'google'];

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

    let config = await prisma.tenantAIConfig.findUnique({
      where: { tenantId },
    });

    if (!config) {
      // Create defaults
      config = await prisma.tenantAIConfig.create({
        data: {
          tenantId,
          systemProvider: 'openai',
          systemModel: 'gpt-4o-mini',
          classifierProvider: 'openai',
          classifierModel: 'gpt-4o-mini',
          guardrailProvider: 'openai',
          guardrailModel: 'gpt-4o-mini',
          fallbackChain: DEFAULT_FALLBACK_CHAIN,
          systemTemperature: 0.4,
          classifierTemperature: 0.0,
          maxOutputTokens: 1024,
        },
      });
    }

    try {
      await redis.set(cacheKey, JSON.stringify(config), 'EX', 300); // 5 minutes cache
    } catch (err) {
      logger.warn({ err, tenantId }, '⚠️ Failed to save AI Config to Redis cache');
    }

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
      primaryProvider = config.systemProvider || 'openai';
      primaryModel = config.systemModel || DEFAULT_MODELS[primaryProvider as keyof typeof DEFAULT_MODELS];
      temp = temp !== undefined ? temp : Number(config.systemTemperature || 0.4);
    } else if (useCase === 'classifier') {
      primaryProvider = config.classifierProvider || 'openai';
      primaryModel = config.classifierModel || DEFAULT_MODELS[primaryProvider as keyof typeof DEFAULT_MODELS];
      temp = temp !== undefined ? temp : Number(config.classifierTemperature || 0.0);
    } else if (useCase === 'guardrail') {
      primaryProvider = config.guardrailProvider || 'openai';
      primaryModel = config.guardrailModel || DEFAULT_MODELS[primaryProvider as keyof typeof DEFAULT_MODELS];
      temp = temp !== undefined ? temp : 0.0;
    }

    const fallbackChain = (config.fallbackChain as string[]) || DEFAULT_FALLBACK_CHAIN;
    const providersToTry = [primaryProvider, ...fallbackChain.filter((p) => p !== primaryProvider)];

    let lastError: any;

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
            max_tokens: maxTokens || config.maxOutputTokens || 1024,
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
            max_tokens: maxTokens || config.maxOutputTokens || 1024,
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
                maxOutputTokens: maxTokens || config.maxOutputTokens || 1024,
                responseMimeType: responseFormat === 'json' ? 'application/json' : 'text/plain',
              },
            }),
            signal: controller.signal,
          });

          clearTimeout(timeoutId);

          if (!response.ok) {
            const errText = await response.text();
            throw new Error(`Google API returned ${response.status}: ${errText}`);
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
        const pricing = PRICING[model] || { inputRate: 0, outputRate: 0 };
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
        lastError = err;
        logger.warn(
          { tenantId, provider, useCase, err: err.message },
          `⚠️ AI Call failed on ${provider}, trying next fallback...`
        );
      }
    }

    logger.error({ tenantId, useCase, lastError: lastError?.message }, '❌ All AI Providers failed in fallback chain');
    throw new Error(`AI Router failed: ${lastError?.message || 'Unknown error'}`);
  }
}
