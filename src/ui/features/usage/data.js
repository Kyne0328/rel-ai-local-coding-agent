import { analyticsBounds, analyticsMonths, analyticsRangeScope, normalizeUsageSnapshot } from './range-model.js';

export async function loadAnalyticsModels({
  desktop,
  bounds = null,
  range = '24h',
  now = new Date(),
  customStart = '',
  customEnd = ''
} = {}) {
  if (!desktop?.getLocalUsage) throw new Error('Local analytics are available in the installed Rel.AI desktop app.');
  const resolvedBounds = bounds || analyticsBounds(range, { now, customStart, customEnd });
  const models = await Promise.all(
    analyticsMonths(resolvedBounds).map(async month => normalizeUsageSnapshot(await desktop.getLocalUsage(month), month))
  );
  return { bounds: resolvedBounds, models };
}

export async function loadAnalyticsData(options = {}) {
  const workspace = String(options.workspace || '');
  const { bounds, models } = await loadAnalyticsModels(options);
  const current = analyticsRangeScope(models, bounds, { workspace, monthlyFallback: true });
  const previous = analyticsRangeScope(models, {
    range: 'comparison',
    start: bounds.previousStart,
    end: bounds.previousEnd
  }, { workspace });
  const allCurrent = analyticsRangeScope(models, bounds, { monthlyFallback: true });
  const privacy = models.find(model => model?.privacy)?.privacy || null;
  return { bounds, models, current, previous, allCurrent, privacy };
}
