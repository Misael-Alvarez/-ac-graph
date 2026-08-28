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
