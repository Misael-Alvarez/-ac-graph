import { describe, expect, it } from 'vitest';
import { compile } from '@/lib/dsl';
import { fromTerraform } from './terraform';
import { ImportError } from './shared';

const HCL = `
resource "aws_api_gateway_rest_api" "public" {
  name = "public-api"
}

resource "aws_lambda_function" "checkout" {
  function_name = "checkout"
  role          = aws_iam_role.lambda.arn
  environment {
    variables = {
      TABLE = aws_dynamodb_table.orders.name
    }
  }
}

resource "aws_dynamodb_table" "orders" {
  name     = "orders"
  hash_key = "id"
}

resource "aws_iam_role" "lambda" {
  name = "lambda-role"
}

data "aws_caller_identity" "current" {}
`;

const PLAN = JSON.stringify({
  format_version: '1.2',
  planned_values: {
    root_module: {
      resources: [
        { address: 'aws_lambda_function.checkout', type: 'aws_lambda_function', name: 'checkout' },
        { address: 'aws_dynamodb_table.orders', type: 'aws_dynamodb_table', name: 'orders' },
        { address: 'data.aws_ami.base', type: 'aws_ami', name: 'base', mode: 'data' },
      ],
      child_modules: [
        {
          address: 'module.networking',
          resources: [{ address: 'aws_vpc.main', type: 'aws_vpc', name: 'main' }],
        },
      ],
    },
  },
  configuration: {
    root_module: {
      resources: [
        {
          address: 'aws_lambda_function.checkout',
          type: 'aws_lambda_function',
          name: 'checkout',
          expressions: { environment: { variables: { TABLE: 'aws_dynamodb_table.orders.name' } } },
        },
      ],
    },
  },
});

const specOf = (r: ReturnType<typeof fromTerraform>, key: string) => {
  const entry = r.document.nodes[key];
  return typeof entry === 'string' ? { service: entry } : entry;
};

describe('a plan, which is the truthful input', () => {
  it('takes the resources it will actually create', () => {
    const result = fromTerraform(PLAN);
    expect(Object.keys(result.document.nodes).sort()).toEqual(['checkout', 'main', 'orders']);
  });

  it('leaves data sources out, since nobody deployed them', () => {
    expect(Object.keys(fromTerraform(PLAN).document.nodes)).not.toContain('base');
  });

  it('flattens child modules and keeps them as boundaries', () => {
    const result = fromTerraform(PLAN);
    expect(specOf(result, 'main').in).toBeDefined();
    expect(result.document.boundaries?.networking?.label).toBe('Networking');
  });

  it('reads a dependency out of an expression, not only out of depends_on', () => {
    // Almost nobody writes `depends_on`; the dependency is the reference inside
    // the expression, which is where the plan actually records it.
    expect(fromTerraform(PLAN).document.edges).toContainEqual({
      from: 'checkout',
      to: 'orders',
      label: '',
      style: 'solid',
    });
  });

  it('names the cloud most of the resources are in', () => {
    expect(fromTerraform(PLAN).document.cloud).toBe('aws');
  });
});

describe('HCL, which is the file people have open', () => {
  it('finds every resource block', () => {
    const result = fromTerraform(HCL);
    expect(Object.keys(result.document.nodes).sort()).toEqual([
      'checkout',
      'lambda',
      'orders',
      'public',
    ]);
  });

  it('ignores data blocks', () => {
    expect(Object.keys(fromTerraform(HCL).document.nodes)).not.toContain('current');
  });

  it('draws an arrow wherever one resource names another', () => {
    const edges = fromTerraform(HCL).document.edges;
    expect(edges).toContainEqual({ from: 'checkout', to: 'orders', label: '', style: 'solid' });
    expect(edges).toContainEqual({ from: 'checkout', to: 'lambda', label: '', style: 'solid' });
  });

  it('never draws a resource depending on itself', () => {
    const edges = fromTerraform(HCL).document.edges as { from: string; to: string }[];
    expect(edges.every((e) => e.from !== e.to)).toBe(true);
  });

  it('admits what reading HCL this way cannot see', () => {
    // count, for_each and conditionals all change how many of a thing exist, and
    // a regex cannot know. Saying so beats quietly drawing one of each.
    expect(fromTerraform(HCL).warnings).toContainEqual({ kind: 'readFromHcl' });
  });
});

describe('resources this does not recognise', () => {
  const EXOTIC = `
resource "aws_lambda_function" "known" {}
resource "acme_widget_factory" "unknown" {}
`;

  it('keeps them, because they are still part of the architecture', () => {
    const result = fromTerraform(EXOTIC);
    expect(specOf(result, 'unknown').service).toBe('gen-server');
  });

  it('says which ones it had to guess at', () => {
    const result = fromTerraform(EXOTIC);
    expect(result.warnings).toContainEqual({
      kind: 'unknownResourceTypes',
      values: { types: 'acme_widget_factory' },
    });
  });

  it('keeps the resource type on the node, so it is greppable in the code', () => {
    expect(specOf(fromTerraform(EXOTIC), 'known').technology).toBe('aws_lambda_function');
  });
});

describe('refusing', () => {
  it('rejects an empty paste', () => {
    expect(() => fromTerraform('  ')).toThrow(ImportError);
  });

  it('rejects JSON that will not parse', () => {
    expect(() => fromTerraform('{ "planned_values": ')).toThrow(
      expect.objectContaining({ code: 'unreadable' }),
    );
  });

  it('rejects a file with no resources in it', () => {
    expect(() => fromTerraform('variable "region" {\n  default = "us-east-1"\n}')).toThrow(
      expect.objectContaining({ code: 'unrecognised' }),
    );
  });
});

describe('what comes out compiles', () => {
  it('becomes a laid-out diagram with no errors', () => {
    const { model, diagnostics } = compile(fromTerraform(HCL).document);
    expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(model.shapes.filter((s) => s.type === 'group')).toHaveLength(4);
    expect(model.connectors.length).toBeGreaterThan(0);
  });

  it('resolves the services the catalogue knows', () => {
    const { model } = compile(fromTerraform(HCL).document);
    const keys = model.shapes.filter((s) => s.type === 'item').map((s) => s.icon?.key);
    expect(keys).toContain('aws-lambda');
    expect(keys).toContain('aws-dynamodb');
    expect(keys).toContain('aws-apigateway');
  });
});
