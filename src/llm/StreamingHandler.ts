/**
 * Minimal SSE reader for progressive responses from streaming endpoints.
 * Used when a real streaming image/text endpoint is plugged in.
 */
export async function readSSE(
  response: Response,
  onEvent: (data: string) => void,
): Promise<void> {
  if (!response.body) return;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split('\n\n');
    buffer = parts.pop() ?? '';
    for (const part of parts) {
      const line = part.split('\n').find((l) => l.startsWith('data:'));
      if (line) {
        const data = line.slice(5).trim();
        if (data && data !== '[DONE]') onEvent(data);
      }
    }
  }
}
