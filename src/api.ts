type ApiErrorBody = { error?: unknown; message?: unknown };

/** Read API responses defensively: reverse proxies and crashed dev servers often return no JSON. */
export async function readApiJson<T>(response: Response, service: string): Promise<T> {
  const body = await response.text();
  if (!body.trim()) {
    const status = `${response.status} ${response.statusText}`.trim();
    throw new Error(response.ok
      ? `${service} returned an empty response.`
      : `${service} returned an empty HTTP ${status} response. Check the Trading Vibes API or gateway status.`);
  }

  let data: T & ApiErrorBody;
  try {
    data = JSON.parse(body) as T & ApiErrorBody;
  } catch {
    const status = `${response.status} ${response.statusText}`.trim();
    throw new Error(`${service} returned an invalid response (HTTP ${status}). Check the API service status.`);
  }

  if (!response.ok) {
    const message = typeof data.error === 'string' ? data.error : typeof data.message === 'string' ? data.message : '';
    throw new Error(message || `${service} request failed (HTTP ${response.status}).`);
  }
  return data;
}

export async function postApiJson<T>(url: string, payload: unknown, service: string, signal?: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload),
      signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error;
    throw new Error(`${service}: the Trading Vibes API connection failed before a response arrived. Check your internet connection and retry; if the site otherwise loads, the API gateway may be temporarily unavailable.`);
  }
  return readApiJson<T>(response, service);
}

/** Preserve partial text when a free model reaches its completion quota.
 * The caller may request continuation; incomplete strategies must never be applied. */
export class AiOutputLimitError extends Error {
  readonly partialText: string;
  constructor(partialText: string) {
    super('OpenRouter reached the model output limit. The partial response is preserved.');
    this.name = 'AiOutputLimitError';
    this.partialText = partialText;
  }
}

/** Avoid duplicating boundary text when a model continues a truncated answer. */
export function joinAiContinuation(previous: string, next: string): string {
  if (!previous) return next;
  for (let overlap = Math.min(400, previous.length, next.length); overlap >= 16; overlap--) {
    if (previous.endsWith(next.slice(0, overlap))) return previous + next.slice(overlap);
  }
  return previous + next;
}

/** POST to an SSE endpoint and deliver each text delta as soon as it arrives. */
export async function postApiStream(
  url: string,
  payload: unknown,
  service: string,
  onText: (chunk: string, fullText: string) => void,
  signal?: AbortSignal,
  idToken?: string,
  onToolEvent?: (event: unknown) => void,
): Promise<string> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream, application/json', ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}) },
      body: JSON.stringify(payload),
      signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error;
    throw new Error(`${service}: the Trading Vibes API connection failed before a response arrived. Check your connection, VPN or browser network, then retry. This does not necessarily mean OpenRouter itself is offline.`);
  }

  if (!response.ok) {
    await readApiJson(response, service);
    throw new Error(`${service} request failed.`);
  }
  if (!response.body) throw new Error(`${service} returned no streaming response body.`);

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  let fullText = '';
  let finished = false;
  let truncated = false;

  const processEvent = (event: string) => {
    const data = event.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
    if (!data || data === '[DONE]') { if (data === '[DONE]') finished = true; return; }
    let item: any;
    try { item = JSON.parse(data); }
    catch { throw new Error(`${service} sent malformed streaming data.`); }
    if (item.tvTool && onToolEvent) onToolEvent(item.tvTool);
    if (item.error) throw new Error(typeof item.error === 'string' ? item.error : item.error.message || `${service} streaming failed.`);
    if (item.choices?.[0]?.finish_reason === 'length') truncated = true;
    const content = item.choices?.[0]?.delta?.content;
    const chunk = typeof content === 'string' ? content
      : Array.isArray(content) ? content.map((part: any) => typeof part?.text === 'string' ? part.text : '').join('') : '';
    if (chunk) {
      fullText += chunk;
      onText(chunk, fullText);
    }
  };

  try {
    while (!finished) {
      const { value, done } = await reader.read();
      pending = (pending + decoder.decode(value, { stream: !done })).replace(/\r\n/g, '\n');
      let boundary = pending.indexOf('\n\n');
      while (boundary >= 0) {
        processEvent(pending.slice(0, boundary));
        pending = pending.slice(boundary + 2);
        boundary = pending.indexOf('\n\n');
      }
      if (done) break;
    }
    if (pending.trim()) processEvent(pending);
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  }
  if (!finished) throw new Error(`${service} stream disconnected before completion. Your request may have reached the AI provider; retry only if needed. Check your network and Trading Vibes API connectivity.`);
  if (truncated) throw new AiOutputLimitError(fullText);
  if (!fullText.trim()) throw new Error(`${service} returned an empty assistant response.`);
  return fullText;
}

/** Keep an explicit build-time rollback switch for the original transport. */
export function chatStreamPath(flag: unknown): string {
  return flag === 'false' ? '/api/ai' : '/api/ai-sdk/stream';
}
