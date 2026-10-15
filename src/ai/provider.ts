// One interface, swappable backends. Calls go straight from the device to the provider
// with a key stored only on this device (IndexedDB "meta" table, never synced, never in the repo).
import type { AiProviderId, Settings } from '../core/model';
import { getMeta } from '../db/repo';

export interface ImagePart {
  mimeType: string;
  base64: string;
}

export interface LlmMessage {
  role: 'user' | 'assistant';
  text: string;
  images?: ImagePart[];
}

export interface GenerateOpts {
  json?: boolean;
  temperature?: number;
}

export interface LlmProvider {
  name: string;
  generate(system: string, messages: LlmMessage[], opts?: GenerateOpts): Promise<string>;
}

export class AiError extends Error {
  constructor(message: string, readonly retryable = false) {
    super(message);
  }
}

function gemini(apiKey: string, model: string): LlmProvider {
  return {
    name: `Gemini (${model})`,
    async generate(system, messages, opts = {}) {
      const body = {
        systemInstruction: { parts: [{ text: system }] },
        contents: messages.map((m) => ({
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: [
            ...(m.images ?? []).map((i) => ({ inline_data: { mime_type: i.mimeType, data: i.base64 } })),
            { text: m.text },
          ],
        })),
        generationConfig: {
          temperature: opts.temperature ?? 0.4,
          ...(opts.json ? { responseMimeType: 'application/json' } : {}),
        },
      };
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify(body),
      });
      if (res.status === 429) throw new AiError('Gemini free-tier limit hit. Try again in a minute.', true);
      if (res.status >= 500) throw new AiError('Gemini is busy right now (high demand).', true);
      if (!res.ok) throw new AiError(`Gemini error ${res.status}: ${(await res.text()).slice(0, 300)}`);
      const data = await res.json();
      const cand = data.candidates?.[0];
      const text = cand?.content?.parts?.map((p: { text?: string }) => p.text ?? '').join('') ?? '';
      if (!text) throw new AiError(`Gemini returned no text (${cand?.finishReason ?? data.promptFeedback?.blockReason ?? 'unknown'}).`);
      return text;
    },
  };
}

function claude(apiKey: string, model: string): LlmProvider {
  return {
    name: `Claude (${model})`,
    async generate(system, messages) {
      // loaded on demand so the SDK isn't in the main bundle for Gemini/Ollama users
      const { default: Anthropic } = await import('@anthropic-ai/sdk');
      const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
      try {
        const res = await client.messages.create({
          model,
          max_tokens: 16000,
          system,
          messages: messages.map((m) => ({
            role: m.role,
            content: [
              ...(m.images ?? []).map((i) => ({
                type: 'image' as const,
                source: { type: 'base64' as const, media_type: i.mimeType as 'image/jpeg', data: i.base64 },
              })),
              { type: 'text' as const, text: m.text },
            ],
          })),
        });
        if (res.stop_reason === 'refusal') throw new AiError('Claude declined this request.');
        return res.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
      } catch (e) {
        if (e instanceof AiError) throw e;
        if (e instanceof Anthropic.RateLimitError) throw new AiError('Claude rate limit hit. Try again shortly.', true);
        if (e instanceof Anthropic.AuthenticationError) throw new AiError('Claude API key was rejected. Check it in Settings.');
        if (e instanceof Anthropic.APIError) throw new AiError(`Claude error ${e.status}: ${e.message}`);
        throw e;
      }
    },
  };
}

/** Groq, OpenRouter, Cerebras, Mistral… anything speaking the OpenAI chat-completions format. */
function openaiCompatible(label: string, baseUrl: string, apiKey: string, model: string, visionModel: string): LlmProvider {
  return {
    name: `${label} (${model})`,
    async generate(system, messages, opts = {}) {
      const hasImages = messages.some((m) => m.images?.length);
      const useModel = hasImages ? visionModel || model : model;
      if (!useModel) throw new AiError(`Pick a ${hasImages ? 'vision ' : ''}model for ${label} in Settings → AI coach.`);
      let res: Response;
      try {
        res = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({
            model: useModel,
            temperature: opts.temperature ?? 0.4,
            ...(opts.json ? { response_format: { type: 'json_object' } } : {}),
            messages: [
              { role: 'system', content: system },
              ...messages.map((m) => ({
                role: m.role,
                content: m.images?.length
                  ? [{ type: 'text', text: m.text }, ...m.images.map((i) => ({ type: 'image_url', image_url: { url: `data:${i.mimeType};base64,${i.base64}` } }))]
                  : m.text,
              })),
            ],
          }),
        });
      } catch {
        throw new AiError(`Could not reach ${label}.`, true);
      }
      if (res.status === 429) throw new AiError(`${label} rate limit hit.`, true);
      if (res.status >= 500) throw new AiError(`${label} is busy right now.`, true);
      if (res.status === 401 || res.status === 403) throw new AiError(`${label} rejected the API key. Check it in Settings.`);
      if (!res.ok) throw new AiError(`${label} error ${res.status}: ${(await res.text()).slice(0, 300)}`);
      const data = await res.json();
      const raw: string = data.choices?.[0]?.message?.content ?? '';
      // some open models think out loud inside <think> tags
      const text = raw.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
      if (!text) throw new AiError(`${label} returned no text.`, true);
      return text;
    },
  };
}

/** Model ids an OpenAI-compatible API offers (for the picker in Settings). */
export async function listModels(baseUrl: string, apiKey: string): Promise<string[]> {
  const res = await fetch(`${baseUrl.replace(/\/$/, '')}/models`, { headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {} });
  if (!res.ok) throw new AiError(`Could not load models (${res.status}).`);
  const data = await res.json();
  return ((data.data ?? []) as { id: string }[]).map((m) => m.id).sort();
}

export const GROQ_URL = 'https://api.groq.com/openai/v1';

function ollama(baseUrl: string, model: string): LlmProvider {
  return {
    name: `Ollama (${model})`,
    async generate(system, messages, opts = {}) {
      let res: Response;
      try {
        res = await fetch(`${baseUrl.replace(/\/$/, '')}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model,
            stream: false,
            ...(opts.json ? { format: 'json' } : {}),
            options: { temperature: opts.temperature ?? 0.4 },
            messages: [
              { role: 'system', content: system },
              ...messages.map((m) => ({ role: m.role, content: m.text, images: m.images?.map((i) => i.base64) })),
            ],
          }),
        });
      } catch {
        throw new AiError('Could not reach Ollama. It only works on the computer running it, with OLLAMA_ORIGINS set to this site.');
      }
      if (!res.ok) throw new AiError(`Ollama error ${res.status}: ${(await res.text()).slice(0, 300)}`);
      const data = await res.json();
      return data.message?.content ?? '';
    },
  };
}

export const PROVIDER_LABEL: Record<AiProviderId, string> = {
  gemini: 'Gemini',
  groq: 'Groq',
  openai: 'OpenAI-compatible',
  anthropic: 'Claude',
  ollama: 'Ollama',
};

/** One provider, no retries or fallback (used by "Test connection"). */
export async function providerById(id: AiProviderId, settings: Settings): Promise<LlmProvider> {
  const key = async (name: string, label: string) => {
    const k = await getMeta<string>(`key:${name}`, '');
    if (!k) throw new AiError(`Add your ${label} API key in Settings → AI coach.`);
    return k;
  };
  switch (id) {
    case 'gemini':
      return gemini(await key('gemini', 'Gemini'), settings.geminiModel);
    case 'groq':
      return openaiCompatible('Groq', GROQ_URL, await key('groq', 'Groq'), settings.groqModel, settings.groqVisionModel);
    case 'openai':
      return openaiCompatible(hostLabel(settings.openaiBaseUrl), settings.openaiBaseUrl, await key('openai', 'API'), settings.openaiModel, settings.openaiVisionModel);
    case 'anthropic':
      return claude(await key('anthropic', 'Claude'), settings.anthropicModel);
    case 'ollama':
      return ollama(settings.ollamaUrl, settings.ollamaModel);
  }
}

function hostLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^api\./, '');
  } catch {
    throw new AiError('The API base URL in Settings → AI coach is not a valid address.');
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * The provider the app uses: the main one, retried once when it's busy or rate-limited,
 * then the fallback provider (if one is set) for any failure.
 */
export async function getProvider(settings: Settings): Promise<LlmProvider> {
  if (settings.aiProvider === 'none') throw new AiError('AI is turned off. Choose a provider in Settings → AI coach.');
  const primary = await providerById(settings.aiProvider, settings);
  const fbId = settings.aiFallback !== 'none' && settings.aiFallback !== settings.aiProvider ? settings.aiFallback : null;
  const wrapper: LlmProvider = {
    name: primary.name,
    async generate(system, messages, opts) {
      let error: unknown;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          wrapper.name = primary.name;
          return await primary.generate(system, messages, opts);
        } catch (e) {
          error = e;
          if (!(e instanceof AiError && e.retryable) || attempt === 1) break;
          await sleep(2000);
        }
      }
      if (!fbId) throw error;
      let fallback: LlmProvider;
      try {
        fallback = await providerById(fbId, settings);
      } catch {
        throw error; // fallback not set up: report the main provider's problem
      }
      try {
        wrapper.name = `${fallback.name}, fallback`;
        return await fallback.generate(system, messages, opts);
      } catch (e2) {
        const m1 = error instanceof Error ? error.message : String(error);
        const m2 = e2 instanceof Error ? e2.message : String(e2);
        throw new AiError(`${m1} Fallback also failed: ${m2}`, true);
      }
    },
  };
  return wrapper;
}

/** Pull a JSON value out of a model reply (handles ```json fences and leading prose). */
export function parseJson<T>(text: string): T {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fenced ? fenced[1] : text;
  const start = raw.search(/[[{]/);
  if (start < 0) throw new AiError('The AI reply was not JSON.');
  const open = raw[start];
  const close = open === '{' ? '}' : ']';
  const end = raw.lastIndexOf(close);
  try {
    return JSON.parse(raw.slice(start, end + 1)) as T;
  } catch {
    throw new AiError('Could not read the AI reply. Try again.');
  }
}

/** Downscale a photo to keep requests small and fast (max side 1280 px, JPEG). */
export async function fileToImagePart(file: File, maxSide = 1280): Promise<ImagePart> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
  return { mimeType: 'image/jpeg', base64: dataUrl.split(',')[1] };
}
