import type { DiagramModel } from '@/lib/domain';
import { findEquivalent, type CloudTarget } from '@/data/cloudEquivalents';
import { SERVICE_ICONS } from '@/data/serviceIcons';
import { serviceDescription } from '@/lib/i18n/serviceCopy';
import type { Locale } from '@/lib/i18n/messages';
import { getShape } from './model';
import { routeAllConnectors } from './routing';

const PREFIX: Record<CloudTarget, string> = {
  aws: 'aws-',
  azure: 'az-',
  gcp: 'gcp-',
  oci: 'oci-',
  ibm: 'ibm-',
};

/** Services with no cloud identity of their own are never rewritten. */
function isCloudNeutral(key: string): boolean {
  return key.startsWith('gen-') || key.startsWith('aion-');
}

function applyService(model: DiagramModel, shapeId: string, key: string, locale: Locale): void {
  const shape = getShape(model, shapeId);
  if (!shape) return;
  shape.icon = { kind: 'symbol', key };
  const svc = SERVICE_ICONS.find((s) => s.key === key);
  if (svc) {
    shape.title = svc.label;
    shape.subtitle = serviceDescription(svc, locale);
  }
}

export interface SwitchCloudResult {
  switched: number;
  /** Labels of services with no equivalent in the target cloud; left untouched. */
  skipped: string[];
}

/** Rewrites every cloud-specific service in the diagram to its target-cloud equivalent. */
export function switchCloud(
  model: DiagramModel,
  targetCloud: CloudTarget,
  locale: Locale = 'en',
): SwitchCloudResult {
  let switched = 0;
  const skipped: string[] = [];

  for (const shape of model.shapes) {
    if (shape.icon?.kind !== 'symbol') continue;
    const key = shape.icon.key;
    if (key.startsWith(PREFIX[targetCloud])) continue;
    if (isCloudNeutral(key)) continue;

    const equivalent = findEquivalent(key, targetCloud);
    if (equivalent) {
      applyService(model, shape.id, equivalent, locale);
      switched++;
    } else {
      skipped.push(SERVICE_ICONS.find((s) => s.key === key)?.label ?? key);
    }
  }

  routeAllConnectors(model);
  return { switched, skipped };
}

/** Same rewrite for a single shape. Returns false when no equivalent exists. */
export function switchShapeCloud(
  model: DiagramModel,
  shapeId: string,
  targetCloud: CloudTarget,
  locale: Locale = 'en',
): boolean {
  const shape = getShape(model, shapeId);
  if (shape?.icon?.kind !== 'symbol') return false;
  if (isCloudNeutral(shape.icon.key)) return false;

  const equivalent = findEquivalent(shape.icon.key, targetCloud);
  if (!equivalent) return false;
  applyService(model, shapeId, equivalent, locale);
  return true;
}
