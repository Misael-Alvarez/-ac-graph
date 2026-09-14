import { describe, expect, it } from 'vitest';
import { ImportError, detectFormat, importArchitecture } from './index';

describe('telling the six apart', () => {
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

  it('knows a CloudFormation template by its version line', () => {
    expect(detectFormat("AWSTemplateFormatVersion: '2010-09-09'\nResources: {}")).toBe(
      'cloudformation',
    );
    expect(detectFormat('{"AWSTemplateFormatVersion": "2010-09-09", "Resources": {}}')).toBe(
      'cloudformation',
    );
  });

  it('knows a template with no version line by its Resources of AWS:: types', () => {
    // SAM templates often skip the version and lead with the Transform.
    expect(
      detectFormat(
        'Transform: AWS::Serverless-2016-10-31\nResources:\n  Fn:\n    Type: AWS::Serverless::Function',
      ),
    ).toBe('cloudformation');
    expect(detectFormat('{"Resources":{"B":{"Type":"AWS::S3::Bucket"}}}')).toBe('cloudformation');
  });

  it('knows a Pulumi export by its URNs, and an empty one by its shape', () => {
    expect(
      detectFormat(
        '{"version":3,"deployment":{"resources":[{"urn":"urn:pulumi:dev::p::aws:s3/bucket:Bucket::b","type":"aws:s3/bucket:Bucket"}]}}',
      ),
    ).toBe('pulumi');
    expect(detectFormat('{"version": 3, "deployment": {"resources": []}}')).toBe('pulumi');
  });

  it('knows a Pulumi preview by its steps', () => {
    expect(
      detectFormat(
        '{"steps":[{"op":"create","urn":"urn:pulumi:dev::p::aws:s3/bucket:Bucket::b"}]}',
      ),
    ).toBe('pulumi');
  });

  it('knows a manifest by the two fields every one of them carries', () => {
    expect(detectFormat('apiVersion: apps/v1\nkind: Deployment')).toBe('kubernetes');
  });

  it('knows a Compose file by its top-level services map', () => {
    expect(detectFormat('services:\n  db:\n    image: postgres:16\n')).toBe('compose');
    expect(detectFormat('version: "3.9"\nservices:\n  web:\n    build: .\n')).toBe('compose');
    expect(detectFormat('name: shop\r\nservices:\r\n  web:\r\n    image: nginx\r\n')).toBe(
      'compose',
    );
  });

  it('lets the services line carry a comment', () => {
    expect(detectFormat('services: # everything that runs\n  db:\n    image: postgres\n')).toBe(
      'compose',
    );
  });

  it('reads a SAM template as a template, though it carries an OpenAPI description inside', () => {
    // An API's DefinitionBody is a whole spec, `openapi:` line and all; the
    // template has to be recognised before the spec inside it is.
    const body = `Resources:
  Api:
    Type: AWS::Serverless::Api
    Properties:
      StageName: prod
      DefinitionBody:
        openapi: 3.0.1
        info: {title: Orders, version: '1'}
        paths: {}
`;
    expect(detectFormat(`AWSTemplateFormatVersion: '2010-09-09'\n${body}`)).toBe('cloudformation');
    expect(detectFormat(`Transform: AWS::Serverless-2016-10-31\n${body}`)).toBe('cloudformation');
    expect(detectFormat(`Transform:\n  - AWS::Serverless-2016-10-31\n${body}`)).toBe(
      'cloudformation',
    );
    // Neither version nor transform: the top-level Resources still say so.
    expect(detectFormat(body)).toBe('cloudformation');
  });

  it('still reads HCL as HCL when a template rides inside it', () => {
    expect(
      detectFormat(
        'resource "aws_cloudformation_stack" "x" {\n  template_body = <<EOF\nAWSTemplateFormatVersion: "2010-09-09"\nResources:\n  B:\n    Type: AWS::S3::Bucket\nEOF\n}',
      ),
    ).toBe('terraform');
  });

  it('does not mistake a nested Resources block for a template', () => {
    // serverless.yml nests CloudFormation under `resources:`; a Compose file
    // can carry some under `x-aws-cloudformation:`. Neither is a template.
    expect(
      detectFormat(
        'service: orders\nprovider:\n  name: aws\nfunctions:\n  hello:\n    handler: handler.hello\nresources:\n  Resources:\n    OrdersTable:\n      Type: AWS::DynamoDB::Table\n',
      ),
    ).toBeNull();
    expect(
      detectFormat(
        'services:\n  web:\n    image: nginx\nx-aws-cloudformation:\n  Resources:\n    WebService:\n      Type: AWS::ECS::Service\n      Properties: {DesiredCount: 2}\n',
      ),
    ).toBe('compose');
  });

  // A manifest and a spec are both YAML with a `kind`-ish shape, so the order of
  // the checks is the thing that matters: OpenAPI announces itself first.
  it('does not mistake a spec for a manifest', () => {
    expect(detectFormat('openapi: 3.0.0\npaths:\n  /x:\n    get: {}')).toBe('openapi');
  });

  it('does not mistake a plan for a Pulumi export, though both list resources', () => {
    expect(
      detectFormat('{"format_version":"1.2","planned_values":{"root_module":{"resources":[]}}}'),
    ).toBe('terraform');
  });

  it('does not mistake a manifest for a Compose file', () => {
    // A `kind: Service` is a Kubernetes Service; `services:` never appears at
    // the top of a manifest.
    expect(
      detectFormat(
        'apiVersion: v1\nkind: Service\nmetadata: {name: web}\nspec: {ports: [{port: 80}]}',
      ),
    ).toBe('kubernetes');
  });

  it('does not mistake a DSL document for anything', () => {
    expect(
      detectFormat('cloud: aws\nnodes:\n  api: apigateway\n  fn: lambda\nedges: []'),
    ).toBeNull();
    // Even one with a node called `services`, which is indented and so not top-level.
    expect(detectFormat('nodes:\n  services: server\nedges: []')).toBeNull();
  });

  it('admits when it cannot tell, rather than guessing', () => {
    expect(detectFormat('hello there')).toBeNull();
    expect(detectFormat('')).toBeNull();
    expect(detectFormat('{"name": "package.json"}')).toBeNull();
    expect(detectFormat('{"name": "app", "scripts": {"services": "node svc.js"}}')).toBeNull();
    expect(detectFormat('services: none today')).toBeNull();
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

  it('routes each of the new three to its reader', () => {
    expect(importArchitecture('Resources:\n  B:\n    Type: AWS::S3::Bucket\n').format).toBe(
      'cloudformation',
    );
    expect(importArchitecture('services:\n  db:\n    image: postgres\n').format).toBe('compose');
    expect(
      importArchitecture(
        '{"deployment":{"resources":[{"urn":"urn:pulumi:dev::p::aws:s3/bucket:Bucket::b","type":"aws:s3/bucket:Bucket"}]}}',
      ).format,
    ).toBe('pulumi');
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
