import { describe, expect, it } from 'vitest';
import { ImportError, detectFormat, importArchitecture } from './index';

describe('telling the three apart', () => {
  it('knows an OpenAPI description in either notation', () => {
    expect(detectFormat('openapi: 3.1.0\ninfo: {title: X}')).toBe('openapi');
    expect(detectFormat('{"swagger": "2.0", "info": {}}')).toBe('openapi');
  });

  it('knows a Terraform plan by the keys only Terraform writes', () => {
    expect(detectFormat('{"format_version":"1.2","planned_values":{}}')).toBe('terraform');
  });

  it('knows HCL by its block headers', () => {
    expect(detectFormat('resource "aws_s3_bucket" "logs" {}')).toBe('terraform');
    expect(detectFormat('module "vpc" {\n  source = "..."\n}')).toBe('terraform');
  });

  it('knows a manifest by the two fields every one of them carries', () => {
    expect(detectFormat('apiVersion: apps/v1\nkind: Deployment')).toBe('kubernetes');
  });

  // A manifest and a spec are both YAML with a `kind`-ish shape, so the order of
  // the checks is the thing that matters: OpenAPI announces itself first.
  it('does not mistake a spec for a manifest', () => {
    expect(detectFormat('openapi: 3.0.0\npaths:\n  /x:\n    get: {}')).toBe('openapi');
  });

  it('admits when it cannot tell, rather than guessing', () => {
    expect(detectFormat('hello there')).toBeNull();
    expect(detectFormat('')).toBeNull();
    expect(detectFormat('{"name": "package.json"}')).toBeNull();
  });
});

describe('importing whatever this is', () => {
  it('routes a manifest to the manifest reader', () => {
    const result = importArchitecture(`
apiVersion: apps/v1
kind: Deployment
metadata: {name: api}
spec:
  template:
    spec: {containers: [{name: api, image: acme/api}]}
`);
    expect(result.format).toBe('kubernetes');
  });

  it('takes a stated format over its own sniffing', () => {
    // For the plan somebody trimmed until the heuristic no longer recognises it.
    const result = importArchitecture('resource "aws_s3_bucket" "logs" {}', 'terraform');
    expect(result.format).toBe('terraform');
  });

  it('says what it accepts rather than failing inside the wrong reader', () => {
    expect(() => importArchitecture('just some prose')).toThrow(
      expect.objectContaining({ code: 'unrecognised' }),
    );
    expect(() => importArchitecture('just some prose')).toThrow(ImportError);
  });
});
