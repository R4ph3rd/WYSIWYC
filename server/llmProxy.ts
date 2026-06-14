import type { Plugin, Connect } from 'vite';
import type { IncomingMessage, ServerResponse } from 'node:http';

/**
 * Dev/preview-only proxy for `/api/llm`. Holds the Anthropic API key
 * server-side (read from ANTHROPIC_API_KEY) so it never reaches client code,
 * and forwards one structured-outputs request to claude-opus-4-8.
 *
 * The client POSTs { system, user, schema, schemaName, maxTokens } and gets
 * back { data } — the schema-valid JSON parsed from the model's response.
 *
 * NOTE: this runs only under `vite dev` / `vite preview`. A static host
 * (GitHub Pages) has no backend, so Call A / Call B require running locally
 * (or porting this handler to a serverless function).
 */

const MODEL = 'claude-opus-4-8';

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c as Buffer));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function sendJSON(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(payload);
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    sendJSON(res, 503, { error: 'ANTHROPIC_API_KEY is not set on the server.' });
    return;
  }

  let parsed: { system: string; user: string; schema: unknown; schemaName?: string; maxTokens?: number };
  try {
    parsed = JSON.parse(await readBody(req));
  } catch {
    sendJSON(res, 400, { error: 'Invalid JSON body.' });
    return;
  }

  try {
    // Imported lazily so a missing dev dependency doesn't break the build.
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response: any = await client.messages.create({
      model: MODEL,
      max_tokens: parsed.maxTokens ?? 4000,
      system: parsed.system,
      messages: [{ role: 'user', content: parsed.user }],
      output_config: {
        format: {
          type: 'json_schema',
          name: parsed.schemaName ?? 'output',
          schema: parsed.schema,
        },
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    const textBlock = (response.content ?? []).find(
      (b: { type: string }) => b.type === 'text',
    );
    if (!textBlock?.text) {
      sendJSON(res, 502, { error: 'Model returned no structured output.' });
      return;
    }

    let data: unknown;
    try {
      data = JSON.parse(textBlock.text);
    } catch {
      sendJSON(res, 502, { error: 'Model output was not valid JSON.' });
      return;
    }
    sendJSON(res, 200, { data });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown LLM error.';
    sendJSON(res, 502, { error: message });
  }
}

function middleware(): Connect.NextHandleFunction {
  return (req, res, next) => {
    if (req.url === '/api/llm' && req.method === 'POST') {
      void handle(req, res);
      return;
    }
    next();
  };
}

export function llmProxy(): Plugin {
  return {
    name: 'wysiwyc-llm-proxy',
    configureServer(server) {
      server.middlewares.use(middleware());
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware());
    },
  };
}
