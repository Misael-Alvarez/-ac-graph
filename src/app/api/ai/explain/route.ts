import { NextResponse } from 'next/server';
import { z } from 'zod';
import { safeParseDiagramModel } from '@/lib/domain';
import { AI_MODEL, getClient } from '@/lib/ai/client';
import { describeError } from '@/lib/ai/errors';
import { RateLimiter, callerKey } from '@/lib/ai/rateLimit';
import { EXPLAIN_SYSTEM_PROMPT, buildExplainPrompt } from '@/lib/ai/prompt';
import { observe } from '@/server/observability/request';

const limiter = new RateLimiter({ capacity: 8, refillPerMinute: 6 });

const RequestSchema = z.object({
  question: z.string().min(3).max(2000),
  model: z.unknown(),
});

/**
 * Prose answers about the current diagram: what it does, what is missing.
 *
 * Streamed, unlike generation: this output is written for a person to read, so
 * showing it as it arrives is the difference between a two-second wait and a
 * blank panel.
 */
export function POST(request: Request) {
  return observe(request, { route: '/api/ai/explain' }, () => explain(request));
}

async function explain(request: Request): Promise<Response> {
  const client = getClient();
  if (!client) {
    return NextResponse.json(
      { code: 'not_configured', message: 'Set ANTHROPIC_API_KEY to enable AI review.' },
      { status: 503 },
    );
  }

  limiter.prune();
  const limit = limiter.take(callerKey(request.headers));
  if (!limit.allowed) {
    return NextResponse.json(
      { code: 'rate_limited', message: 'Too many requests. Give it a moment.' },
      { status: 429, headers: { 'retry-after': String(limit.retryAfter) } },
    );
  }

  const body = RequestSchema.safeParse(await request.json().catch(() => null));
  const diagram = body.success ? safeParseDiagramModel(body.data.model) : null;
  if (!body.success || !diagram?.success) {
    return NextResponse.json(
      { code: 'bad_request', message: 'Send a question and a valid diagram.' },
      { status: 400 },
    );
  }

  if (!diagram.data.shapes.length) {
    return NextResponse.json(
      { code: 'empty_diagram', message: 'There is nothing on the canvas to review yet.' },
      { status: 400 },
    );
  }

  try {
    const stream = client.messages.stream({
      model: AI_MODEL,
      max_tokens: 2000,
      thinking: { type: 'adaptive' },
      system: [{ type: 'text', text: EXPLAIN_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: buildExplainPrompt(body.data.question, diagram.data) }],
    });

    const encoder = new TextEncoder();
    const body_ = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          for await (const event of stream) {
            if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
              controller.enqueue(encoder.encode(event.delta.text));
            }
          }
          const final = await stream.finalMessage();
          if (final.stop_reason === 'refusal') {
            controller.enqueue(encoder.encode('\n\n_The model declined to answer this._'));
          }
        } catch (error) {
          controller.enqueue(encoder.encode(`\n\n_${describeError(error).message}_`));
        } finally {
          controller.close();
        }
      },
      cancel() {
        stream.abort();
      },
    });

    return new Response(body_, {
      headers: {
        'content-type': 'text/plain; charset=utf-8',
        'cache-control': 'no-store',
      },
    });
  } catch (error) {
    const failure = describeError(error);
    return NextResponse.json(
      { code: failure.code, message: failure.message },
      { status: failure.status },
    );
  }
}
