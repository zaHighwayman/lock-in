import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../db/seed';

vi.mock('../db/repo', () => ({
  getMeta: async (key: string) => ({ 'key:groq': 'gsk_test', 'key:gemini': 'gem_test' } as Record<string, string>)[key] ?? '',
}));

const { getProvider, providerById, AiError } = await import('./provider');

type Call = { url: string; body: Record<string, unknown>; headers: Record<string, string> };
let calls: Call[] = [];

function mockFetch(responses: (Response | (() => Response))[]) {
  calls = [];
  let i = 0;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init.body ?? '{}')), headers: init.headers as Record<string, string> });
    const r = responses[Math.min(i++, responses.length - 1)];
    return typeof r === 'function' ? r() : r.clone();
  }));
}

const ok = (content: string) => new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
const geminiOk = (text: string) => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }), { status: 200 });

beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout'] }));
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('Groq (OpenAI-compatible)', () => {
  const settings = { ...DEFAULT_SETTINGS, aiProvider: 'groq' as const };

  it('sends chat completions with the text model and JSON mode, strips <think>', async () => {
    mockFetch([ok('<think>hmm</think>{"a":1}')]);
    const ai = await providerById('groq', settings);
    const out = await ai.generate('sys', [{ role: 'user', text: 'hi' }], { json: true });
    expect(out).toBe('{"a":1}');
    expect(calls[0].url).toBe('https://api.groq.com/openai/v1/chat/completions');
    expect(calls[0].headers.Authorization).toBe('Bearer gsk_test');
    expect(calls[0].body).toMatchObject({ model: 'openai/gpt-oss-120b', response_format: { type: 'json_object' } });
    expect((calls[0].body.messages as unknown[])[0]).toEqual({ role: 'system', content: 'sys' });
  });

  it('switches to the vision model and image_url parts when there are photos', async () => {
    mockFetch([ok('{}')]);
    const ai = await providerById('groq', settings);
    await ai.generate('sys', [{ role: 'user', text: 'label', images: [{ mimeType: 'image/jpeg', base64: 'AAAA' }] }]);
    expect(calls[0].body.model).toBe('qwen/qwen3.8-27b');
    const content = (calls[0].body.messages as { content: unknown }[])[1].content;
    expect(content).toEqual([{ type: 'text', text: 'label' }, { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,AAAA' } }]);
  });

  it('marks busy / rate-limited responses retryable and bad keys not', async () => {
    const ai = await providerById('groq', settings);
    mockFetch([new Response('', { status: 503 })]);
    await expect(ai.generate('s', [{ role: 'user', text: 'x' }])).rejects.toMatchObject({ retryable: true });
    mockFetch([new Response('', { status: 401 })]);
    await expect(ai.generate('s', [{ role: 'user', text: 'x' }])).rejects.toMatchObject({ retryable: false });
  });
});

describe('retry and fallback', () => {
  it('retries a busy provider once, then succeeds', async () => {
    mockFetch([new Response('', { status: 503 }), geminiOk('fine')]);
    const ai = await getProvider({ ...DEFAULT_SETTINGS, aiProvider: 'gemini' });
    const p = ai.generate('s', [{ role: 'user', text: 'x' }]);
    await vi.runAllTimersAsync();
    expect(await p).toBe('fine');
    expect(calls).toHaveLength(2);
  });

  it('falls back to the second provider when the first stays busy', async () => {
    mockFetch([new Response('', { status: 503 }), new Response('', { status: 503 }), ok('from groq')]);
    const ai = await getProvider({ ...DEFAULT_SETTINGS, aiProvider: 'gemini', aiFallback: 'groq' });
    const p = ai.generate('s', [{ role: 'user', text: 'x' }]);
    await vi.runAllTimersAsync();
    expect(await p).toBe('from groq');
    expect(calls.map((c) => new URL(c.url).hostname)).toEqual(['generativelanguage.googleapis.com', 'generativelanguage.googleapis.com', 'api.groq.com']);
    expect(ai.name).toContain('fallback');
  });

  it('does not retry a non-retryable error but still falls back', async () => {
    mockFetch([new Response('bad', { status: 400 }), ok('from groq')]);
    const ai = await getProvider({ ...DEFAULT_SETTINGS, aiProvider: 'gemini', aiFallback: 'groq' });
    expect(await ai.generate('s', [{ role: 'user', text: 'x' }])).toBe('from groq');
    expect(calls).toHaveLength(2);
  });

  it('reports both errors when the fallback fails too', async () => {
    mockFetch([new Response('', { status: 503 }), new Response('', { status: 503 }), new Response('', { status: 429 })]);
    const ai = await getProvider({ ...DEFAULT_SETTINGS, aiProvider: 'gemini', aiFallback: 'groq' });
    const p = ai.generate('s', [{ role: 'user', text: 'x' }]).catch((e) => e);
    await vi.runAllTimersAsync();
    const e = await p;
    expect(e).toBeInstanceOf(AiError);
    expect(e.message).toMatch(/Gemini is busy.*Fallback also failed: Groq rate limit/);
  });

  it('ignores a fallback that has no key and reports the main error', async () => {
    mockFetch([new Response('bad', { status: 400 })]);
    const ai = await getProvider({ ...DEFAULT_SETTINGS, aiProvider: 'gemini', aiFallback: 'anthropic' });
    await expect(ai.generate('s', [{ role: 'user', text: 'x' }])).rejects.toThrow(/Gemini error 400/);
  });
});
