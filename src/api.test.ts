import { describe, expect, it, vi } from 'vitest';
import { postApiStream, readApiJson } from './api';

describe('API response diagnostics', () => {
  it('reads normal JSON responses', async () => {
    await expect(readApiJson<{ text: string }>(Response.json({ text: 'ready' }), 'OpenRouter'))
      .resolves.toEqual({ text: 'ready' });
  });

  it('explains empty proxy errors without leaking a JSON parser exception', async () => {
    await expect(readApiJson(new Response('', { status: 502, statusText: 'Bad Gateway' }), 'OpenRouter'))
      .rejects.toThrow('OpenRouter returned an empty HTTP 502 Bad Gateway response. Check that the local API server is running.');
  });

  it('surfaces structured API errors', async () => {
    await expect(readApiJson(new Response(JSON.stringify({ error: 'Model unavailable' }), { status: 503 }), 'OpenRouter'))
      .rejects.toThrow('Model unavailable');
  });

  it('explains non-JSON gateway output', async () => {
    await expect(readApiJson(new Response('<html>proxy error</html>', { status: 502 }), 'Market data'))
      .rejects.toThrow('Market data returned an invalid response (HTTP 502). Check the API server logs.');
  });

  it('assembles streamed OpenRouter deltas across network chunks', async () => {
    const encoder = new TextEncoder();
    const chunks = [
      'data: {"choices":[{"delta":{"content":"Hello "}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"world"}}]}\n\n',
      'data: [DONE]\n\n',
    ];
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(new ReadableStream({
      start(controller) { for (const chunk of chunks) controller.enqueue(encoder.encode(chunk)); controller.close(); },
    }), { headers: { 'Content-Type': 'text/event-stream' } }));
    const seen: string[] = [];
    try {
      await expect(postApiStream('/api/ai', { messages: [] }, 'OpenRouter', (_chunk, full) => seen.push(full)))
        .resolves.toBe('Hello world');
      expect(seen).toEqual(['Hello ', 'Hello world']);
    } finally { fetchMock.mockRestore(); }
  });

  it('handles CRLF event boundaries split across network chunks', async () => {
    const encoder = new TextEncoder();
    const chunks = ['data: {"choices":[{"delta":{"content":"Hello"}}]}\r', '\n\r', '\ndata: [DONE]\r', '\n\r', '\n'];
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(new ReadableStream({
      start(controller) { chunks.forEach(chunk => controller.enqueue(encoder.encode(chunk))); controller.close(); },
    })));
    try {
      await expect(postApiStream('/api/ai', {}, 'OpenRouter', () => undefined)).resolves.toBe('Hello');
    } finally { fetchMock.mockRestore(); }
  });

  it('rejects a stream that closes before the completion marker', async () => {
    const encoder = new TextEncoder();
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"Partial"}}]}\n\n'));
        controller.close();
      },
    }), { headers: { 'Content-Type': 'text/event-stream' } }));
    try {
      await expect(postApiStream('/api/ai', { messages: [] }, 'OpenRouter', () => undefined))
        .rejects.toThrow('connection ended before the response was complete');
    } finally { fetchMock.mockRestore(); }
  });
});
