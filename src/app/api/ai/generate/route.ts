import { NextResponse } from 'next/server';
import { z } from 'zod';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { safeParseDiagramModel } from '@/lib/domain';
import { compile } from '@/lib/dsl';
import { AI_MODEL, MAX_TOKENS, getClient } from '@/lib/ai/client';
import { describeError } from '@/lib/ai/errors';
import { RateLimiter, callerKey } from '@/lib/ai/rateLimit';
import { AiDiagramSchema, aiToDsl } from '@/lib/ai/schema';
import { LOCALES } from '@/lib/i18n/messages';
import { SYSTEM_PROMPT, buildUserPrompt } from '@/lib/ai/prompt';
import { observe } from '@/server/observability/request';

/** Generous enough for real use, tight enough that one visitor cannot run up a bill. */
const limiter = new RateLimiter({ capacity: 5, refillPerMinute: 3 });

const LocaleSchema = z.enum(LOCALES);

const RequestSchema = z.object({
  operation: z.enum(['generate', 'modify', 'retarget']).default('generate'),
  prompt: z.string().min(3).max(4000),
  /** The current diagram, for modify and retarget. */
  model: z.unknown().optional(),
  /* The language the subtitles come back in. The catalogue reaches the model
     in English either way — see lib/ai/prompt — so this only names what gets
     written onto the shapes, which is the author's diagram, not the prompt. */
  locale: LocaleSchema.default('en'),
});

export function POST(request: Request) {
  return observe(request, { route: '/api/ai/generate' }, () => generate(request));
}

async function generate(request: Request): Promise<Response> {
  const client = getClient();
  if (!client) {
    return NextResponse.json(
      { code: 'not_configured', message: 'Set ANTHROPIC_API_KEY to enable AI generation.' },
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
  if (!body.success) {
    return NextResponse.json(
      { code: 'bad_request', message: 'Send an operation and a prompt.' },
      { status: 400 },
    );
  }

  const current = body.data.model ? safeParseDiagramModel(body.data.model) : null;

  try {
    const response = await client.messages.parse({
      model: AI_MODEL,
      max_tokens: MAX_TOKENS,
      thinking: { type: 'adaptive' },
      system: [
        {
          type: 'text',
          text: SYSTEM_PROMPT,
          // The catalogue is large and never changes, so every repeat request
          // reads it from cache instead of paying for it again.
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: [
        {
          role: 'user',
          content: buildUserPrompt(
            body.data.operation,
            body.data.prompt,
            current?.success ? current.data : undefined,
          ),
        },
      ],
      output_config: { format: zodOutputFormat(AiDiagramSchema) },
    });

    if (response.stop_reason === 'refusal') {
      return NextResponse.json(
        {
          code: 'refused',
          message: 'The model declined this request.',
          detail: response.stop_details ?? null,
        },
        { status: 422 },
      );
    }

    const answer = response.parsed_output;
    if (!answer) {
      return NextResponse.json(
        { code: 'unparseable', message: 'The model returned something unusable.' },
        { status: 502 },
      );
    }

    const { document, dropped } = aiToDsl(answer);
    const compiled = compile(document, body.data.locale);

    return NextResponse.json({
      title: answer.title,
      summary: answer.summary,
      cloud: answer.cloud,
      model: compiled.model,
      dropped,
      diagnostics: compiled.diagnostics,
      usage: {
        input: response.usage.input_tokens,
        output: response.usage.output_tokens,
        cacheRead: response.usage.cache_read_input_tokens ?? 0,
      },
    });
  } catch (error) {
    const failure = describeError(error);
    return NextResponse.json(
      { code: failure.code, message: failure.message },
      {
        status: failure.status,
        headers: failure.retryAfter ? { 'retry-after': String(failure.retryAfter) } : undefined,
      },
    );
  }
}
