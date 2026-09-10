import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { DiagramConflictError } from '@/lib/store/localRepository';
import { DiagramNotFoundError, VersionNotFoundError } from './diagrams/errors';
import {
  HttpError,
  error,
  errorResponse,
  json,
  noContent,
  readJsonBody,
  serverModeOff,
} from './http';

describe('responses', () => {
  it('json() is JSON and never cached', async () => {
    const response = json({ ok: true }, { status: 201 });
    expect(response.status).toBe(201);
    expect(response.headers.get('content-type')).toBe('application/json');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ ok: true });
  });

  it('noContent() is an empty 204', async () => {
    const response = noContent({ headers: { 'Set-Cookie': 'a=; Max-Age=0' } });
    expect(response.status).toBe(204);
    expect(response.headers.get('set-cookie')).toBe('a=; Max-Age=0');
    expect(await response.text()).toBe('');
  });

  it('error() carries a code, a message and any details', async () => {
    const response = error(412, 'conflict', 'stale', { current: { id: 'x' } });
    expect(response.status).toBe(412);
    expect(await response.json()).toEqual({
      code: 'conflict',
      message: 'stale',
      current: { id: 'x' },
    });
  });

  it('serverModeOff() is a 404 with its own code', async () => {
    const response = serverModeOff();
    expect(response.status).toBe(404);
    expect((await response.json()).code).toBe('server_mode_off');
  });
});

describe('errorResponse', () => {
  it('maps HttpError to its status and code', async () => {
    const response = errorResponse(new HttpError(401, 'unauthenticated', 'Sign in'));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ code: 'unauthenticated', message: 'Sign in' });
  });

  it('maps a revision conflict to 412', async () => {
    const response = errorResponse(new DiagramConflictError());
    expect(response.status).toBe(412);
    expect((await response.json()).code).toBe('conflict');
  });

  it('maps missing diagrams and versions to 404', async () => {
    expect(errorResponse(new DiagramNotFoundError('dgm_x')).status).toBe(404);
    expect(errorResponse(new VersionNotFoundError('ver_x')).status).toBe(404);
  });

  it('maps a Zod failure to 400 with the issues', async () => {
    const result = z.object({ n: z.number() }).safeParse({ n: 'x' });
    const response = errorResponse(result.error);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.code).toBe('bad_request');
    expect(body.issues[0].path).toEqual(['n']);
  });

  it('hides anything unexpected behind a generic 500, logging only name and message', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const response = errorResponse(new Error('connection string postgres://user:secret@db'));
      expect(response.status).toBe(500);
      const text = await response.text();
      expect(text).not.toContain('secret');
      expect(JSON.parse(text).code).toBe('internal');
      expect(log).toHaveBeenCalledTimes(1);
      expect(log.mock.calls[0][1]).toBe('Error: connection string postgres://user:secret@db');
    } finally {
      log.mockRestore();
    }
  });
});

describe('readJsonBody', () => {
  const post = (body: BodyInit | null, headers: Record<string, string> = {}) =>
    new Request('http://localhost/api/x', { method: 'POST', body, headers });

  it('parses a JSON body', async () => {
    expect(await readJsonBody(post(JSON.stringify({ a: 1 })))).toEqual({ a: 1 });
  });

  it('refuses a declared oversized body before reading it', async () => {
    const request = post('{}', { 'content-length': String(6 * 1024 * 1024) });
    await expect(readJsonBody(request)).rejects.toMatchObject({ status: 413 });
  });

  it('refuses an oversized body even without Content-Length', async () => {
    const chunk = new Uint8Array(1024).fill(0x20);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let i = 0; i < 12; i++) controller.enqueue(chunk);
        controller.close();
      },
    });
    const request = new Request('http://localhost/api/x', {
      method: 'POST',
      body: stream,
      // @ts-expect-error duplex is required by undici for streaming bodies but missing from lib.dom
      duplex: 'half',
    });
    await expect(readJsonBody(request, 10 * 1024)).rejects.toMatchObject({
      status: 413,
      code: 'payload_too_large',
    });
  });

  it('refuses malformed JSON and an empty body as 400', async () => {
    await expect(readJsonBody(post('{nope'))).rejects.toMatchObject({ status: 400 });
    await expect(readJsonBody(post(null))).rejects.toMatchObject({ status: 400 });
  });
});
