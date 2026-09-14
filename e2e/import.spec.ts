import { test, expect, type Page } from '@playwright/test';
import { openNewDiagram } from './helpers';

const MANIFESTS = `apiVersion: apps/v1
kind: Deployment
metadata: {name: checkout, namespace: pagos}
spec:
  template:
    metadata: {labels: {app: checkout}}
    spec: {containers: [{name: c, image: registry/checkout:2.4.1}]}
---
apiVersion: v1
kind: Service
metadata: {name: checkout-svc, namespace: pagos}
spec: {selector: {app: checkout}, ports: [{port: 8080}]}
`;

const HCL = `resource "aws_lambda_function" "checkout" {
  environment { variables = { TABLE = aws_dynamodb_table.orders.name } }
}
resource "aws_dynamodb_table" "orders" { name = "orders" }
`;

const SPEC = `openapi: 3.0.3
info: {title: Payments API, version: '2.1'}
paths:
  /orders: {get: {tags: [orders]}, post: {tags: [orders]}}
  /refunds: {post: {tags: [refunds]}}
`;

const SAM = `AWSTemplateFormatVersion: '2010-09-09'
Transform: AWS::Serverless-2016-10-31
Resources:
  OrdersApi:
    Type: AWS::Serverless::Api
    Properties: {StageName: prod}
  CheckoutFunction:
    Type: AWS::Serverless::Function
    Properties:
      Handler: checkout.handler
      Environment: {Variables: {TABLE: !Ref OrdersTable}}
      Events:
        Post: {Type: Api, Properties: {Path: /orders, Method: post, RestApiId: !Ref OrdersApi}}
  OrdersTable:
    Type: AWS::DynamoDB::Table
  FunctionRole:
    Type: AWS::IAM::Role
`;

const COMPOSE = `services:
  proxy:
    image: nginx:1.25
    depends_on: [app]
  app:
    build: .
    depends_on: [db, cache]
  db:
    image: postgres:16
  cache:
    image: redis:7
`;

const PULUMI = JSON.stringify({
  version: 3,
  deployment: {
    resources: [
      {
        urn: 'urn:pulumi:prod::shop::pulumi:pulumi:Stack::shop-prod',
        custom: false,
        type: 'pulumi:pulumi:Stack',
      },
      {
        urn: 'urn:pulumi:prod::shop::aws:s3/bucket:Bucket::assets',
        custom: true,
        type: 'aws:s3/bucket:Bucket',
      },
      {
        urn: 'urn:pulumi:prod::shop::aws:lambda/function:Function::thumbs',
        custom: true,
        type: 'aws:lambda/function:Function',
        dependencies: ['urn:pulumi:prod::shop::aws:s3/bucket:Bucket::assets'],
      },
    ],
  },
});

async function openImport(page: Page) {
  await page.keyboard.press('ControlOrMeta+k');
  await page.keyboard.type('Importar');
  await page.keyboard.press('Enter');
  await expect(page.locator('.dialog-textarea')).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await openNewDiagram(page);
  await openImport(page);
});

test('waits for something to read before claiming anything', async ({ page }) => {
  await expect(page.locator('.import-read')).toHaveText(/Esperando/);
  await expect(page.locator('.dialog .button.is-primary')).toBeDisabled();
});

test('works out that manifests are manifests, and says what it found', async ({ page }) => {
  await page.locator('.dialog-textarea').fill(MANIFESTS);
  await expect(page.locator('.import-read')).toContainText('Kubernetes');
  await expect(page.locator('.import-read')).toContainText('2 servicios');
});

test('works out Terraform from HCL', async ({ page }) => {
  await page.locator('.dialog-textarea').fill(HCL);
  await expect(page.locator('.import-read')).toContainText('Terraform');
  await expect(page.locator('.import-read')).toContainText('2 servicios');
});

test('works out an OpenAPI description', async ({ page }) => {
  await page.locator('.dialog-textarea').fill(SPEC);
  await expect(page.locator('.import-read')).toContainText('OpenAPI');
  // The API, its callers and its two tag areas — not one box per path.
  await expect(page.locator('.import-read')).toContainText('4 servicios');
});

test('works out a SAM template, plumbing left out', async ({ page }) => {
  await page.locator('.dialog-textarea').fill(SAM);
  await expect(page.locator('.import-read')).toContainText('CloudFormation');
  // The API, the function and the table; the IAM role is not architecture.
  await expect(page.locator('.import-read')).toContainText('3 servicios');
  await expect(page.locator('.import-read')).toContainText('2 conexiones');
});

test('works out a Compose file, and lands it with depends_on as the arrows', async ({ page }) => {
  await page.locator('.dialog-textarea').fill(COMPOSE);
  await expect(page.locator('.import-read')).toContainText('Docker Compose');
  await expect(page.locator('.import-read')).toContainText('4 servicios');
  await expect(page.locator('.import-read')).toContainText('3 conexiones');

  await page.locator('.dialog .button.is-primary').click();
  await expect(page.locator('[data-shape-id^="grp_"]')).toHaveCount(4);
  await expect(page.locator('.statusbar')).toContainText('3 conexiones');
});

test('works out a Pulumi stack export, which is JSON', async ({ page }) => {
  await page.locator('.dialog-textarea').fill(PULUMI);
  await expect(page.locator('.import-read')).toContainText('Pulumi');
  // The stack itself is bookkeeping, not a box.
  await expect(page.locator('.import-read')).toContainText('2 servicios');
});

test('falls back to a Markdown outline, which announces nothing', async ({ page }) => {
  await page
    .locator('.dialog-textarea')
    .fill('- CloudFront\n- Lambda\n\nCloudFront -> Lambda : call');
  await expect(page.locator('.import-read')).toContainText('Markdown');
});

test('says what it had to guess at, in the reader’s language', async ({ page }) => {
  await page.locator('.dialog-textarea').fill(HCL);
  await expect(page.locator('.import-warnings summary')).toContainText('Conviene saberlo');
  await page.locator('.import-warnings summary').click();
  await expect(page.locator('.import-warnings li').first()).toContainText('for_each');
});

test('refuses what it cannot read, without offering to import it', async ({ page }) => {
  await page.locator('.dialog-textarea').fill('{"openapi": "3.0.0", "paths": ');
  await expect(page.locator('.import-error')).toBeVisible();
  await expect(page.locator('.dialog .button.is-primary')).toBeDisabled();
});

test('lands the manifests on the canvas, with the arrows they implied', async ({ page }) => {
  await page.locator('.dialog-textarea').fill(MANIFESTS);
  await page.locator('.dialog .button.is-primary').click();

  await expect(page.locator('[data-shape-id^="grp_"]')).toHaveCount(2);
  // The namespace becomes a boundary, and the Service's selector becomes the
  // arrow — neither is stated anywhere in the file as such.
  await expect(page.locator('[data-shape-id^="bd_"]')).toHaveCount(1);
  await expect(page.locator('.statusbar')).toContainText('1 conexión');
});

test('what it produced is editable as code, like anything else', async ({ page }) => {
  await page.locator('.dialog-textarea').fill(HCL);
  await page.locator('.dialog .button.is-primary').click();
  await expect(page.locator('[data-shape-id^="grp_"]')).toHaveCount(2);

  await page.keyboard.press('ControlOrMeta+/');
  await expect(page.locator('.cm-content')).toContainText('checkout');
});
