import { routeAllConnectors } from '@/lib/engine';
import { diagramToSvgString } from '@/lib/editor/renderSvg';
import { safeDecodeDiagram } from '@/lib/share/codec';
import { themeFromSearch } from '@/lib/share/links';
import { observe } from '@/server/observability/request';

/**
 * Server-rendered diagram image.
 *
 * The engine has been kept free of browser APIs from the first commit precisely
 * so this route could exist: the same renderer the editor uses produces the
 * embed, with no headless browser and no drift between the two.
 */
export function GET(request: Request) {
  return observe(request, { route: '/api/embed' }, () => render(request));
}

async function render(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const payload = url.searchParams.get('d');

  if (!payload) {
    return new Response('Missing diagram payload.', { status: 400 });
  }

  const model = await safeDecodeDiagram(payload);
  if (!model) {
    return new Response('That link does not contain a readable diagram.', { status: 400 });
  }

  // Waypoints are stripped from the payload to keep links short; the router
  // rebuilds them from the shape positions.
  routeAllConnectors(model);

  const svg = await diagramToSvgString({
    model,
    dark: themeFromSearch(url.searchParams) === 'dark',
    brand: 'none',
  });

  return new Response(svg, {
    headers: {
      'content-type': 'image/svg+xml; charset=utf-8',
      // The diagram is inside the URL, so a given URL is immutable.
      'cache-control': 'public, max-age=31536000, immutable',
      'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'",
      'x-content-type-options': 'nosniff',
    },
  });
}
