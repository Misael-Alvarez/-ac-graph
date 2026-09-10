import { describe, expect, it } from 'vitest';
import { createEmptyModel } from '@/lib/engine';
import { TEMPLATES } from '@/lib/editor/templates';
import { renderPreview } from './preview';

describe('renderPreview', () => {
  const microservices = TEMPLATES.find((t) => t.id === 'microservices')!.build('es');

  it('draws every service by name, with what it says about itself', () => {
    const svg = renderPreview(microservices);
    expect(svg).toContain('>API Service<');
    expect(svg).toContain('>PROD<');
    expect(svg).toContain('>PII<');
    expect(svg).toContain('stroke-dasharray="8 6"');
  });

  it('stays small enough to inline on the home page', () => {
    expect(renderPreview(microservices).length).toBeLessThan(24_000);
    expect(renderPreview(microservices, true).length).toBeLessThan(24_000);
  });

  it('escapes what a title could smuggle in', () => {
    const model = TEMPLATES[0].build('es');
    model.shapes.find((s) => s.type === 'item')!.title = '<img src=x onerror=alert(1)>';
    const svg = renderPreview(model);
    expect(svg).not.toContain('<img');
    expect(svg).toContain('&lt;img');
  });

  it('renders an empty sheet for an empty model', () => {
    expect(renderPreview(createEmptyModel())).toContain('<rect width="160" height="90"');
  });
});
