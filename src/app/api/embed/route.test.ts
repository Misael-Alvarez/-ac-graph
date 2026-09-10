import { describe, expect, it } from 'vitest';
import { parseDsl } from '@/lib/dsl';
import { encodeDiagram } from '@/lib/share/codec';
import { GET } from './route';

const sample = parseDsl(
  'cloud: aws\nnodes:\n  fn: lambda\n  db: dynamodb\nedges:\n  - fn -> db: R/W\n',
).model!;

const request = (query: string) => new Request(`http://localhost/api/embed${query}`);

describe('GET /api/embed', () => {
  it('renders the diagram as SVG', async () => {
    const response = await GET(request(`?d=${await encodeDiagram(sample)}`));
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('image/svg+xml');

    const svg = await response.text();
    expect(svg).toContain('<svg');
    expect(svg).toContain('Lambda');
    expect(svg).toContain('DynamoDB');
  });

  it('routes the connectors the payload leaves out', async () => {
    const svg = await (await GET(request(`?d=${await encodeDiagram(sample)}`))).text();
    // A routed connector produces a path and its label chip.
    expect(svg).toContain('marker-end="url(#arrowhead)"');
    expect(svg).toContain('R/W');
  });

  it('inlines the icon sprite so the image stands alone', async () => {
    const svg = await (await GET(request(`?d=${await encodeDiagram(sample)}`))).text();
    expect(svg).toContain('id="i-aws-lambda"');
    const externals = svg.match(/(?:href|src)="(?!#|data:)[^"]*"/g) ?? [];
    expect(externals).toEqual([]);
  });

  it('honours the dark theme', async () => {
    const payload = await encodeDiagram(sample);
    const light = await (await GET(request(`?d=${payload}`))).text();
    const dark = await (await GET(request(`?d=${payload}&theme=dark`))).text();
    expect(light).toContain('#ffffff');
    expect(dark).toContain('#0e1526');
  });

  it('caches immutably, because the diagram is in the URL', async () => {
    const response = await GET(request(`?d=${await encodeDiagram(sample)}`));
    expect(response.headers.get('cache-control')).toContain('immutable');
  });

  it('locks the image down so it cannot fetch anything', async () => {
    const response = await GET(request(`?d=${await encodeDiagram(sample)}`));
    expect(response.headers.get('content-security-policy')).toContain("default-src 'none'");
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('rejects a missing payload', async () => {
    expect((await GET(request(''))).status).toBe(400);
  });

  it('rejects a payload that is not a diagram', async () => {
    const response = await GET(request('?d=not-a-real-payload'));
    expect(response.status).toBe(400);
    expect(await response.text()).toContain('readable diagram');
  });

  it('never carries brand chrome into an embed', async () => {
    const svg = await (await GET(request(`?d=${await encodeDiagram(sample)}`))).text();
    expect(svg).not.toContain('AION Cloud');
  });
});
