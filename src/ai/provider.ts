// One interface, swappable backends. Calls go straight from the device to the provider
// with a key stored only on this device (IndexedDB "meta" table, never synced, never in the repo).
import type { Settings } from '../core/model';
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

export async function getProvider(settings: Settings): Promise<LlmProvider> {
  switch (settings.aiProvider) {
    case 'gemini': {
      const key = await getMeta<string>('key:gemini', '');
      if (!key) throw new AiError('Add your Gemini API key in Settings → AI coach.');
      return gemini(key, settings.geminiModel);
    }
    case 'anthropic': {
      const key = await getMeta<string>('key:anthropic', '');
      if (!key) throw new AiError('Add your Claude API key in Settings → AI coach.');
      return claude(key, settings.anthropicModel);
    }
    case 'ollama':
      return ollama(settings.ollamaUrl, settings.ollamaModel);
    default:
      throw new AiError('AI is turned off. Choose a provider in Settings → AI coach.');
  }
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
