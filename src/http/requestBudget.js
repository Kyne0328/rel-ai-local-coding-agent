const buckets = new Map();

function consumeRequestBudget(req, name, options = {}) {
  const now = Number(options.now?.() ?? Date.now());
  const windowMs = Math.max(1000, Number(options.windowMs || 60_000));
  const limit = Math.max(1, Number(options.limit || 60));
  const source = requestSource(req);
  const key = `${String(name || 'request')}:${source}`;
  const previous = buckets.get(key);
  const bucket = !previous || now >= previous.resetAt
    ? { count: 0, resetAt: now + windowMs }
    : previous;
  bucket.count += 1;
  buckets.set(key, bucket);
  pruneBuckets(now);
  if (bucket.count <= limit) return { ok: true, remaining: limit - bucket.count, resetAt: bucket.resetAt };
  return {
    ok: false,
    remaining: 0,
    resetAt: bucket.resetAt,
    retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))
  };
}

function requestSource(req) {
  const forwarded = String(req?.headers?.['x-forwarded-for'] || '').split(',', 1)[0].trim();
  return forwarded || String(req?.socket?.remoteAddress || 'unknown').slice(0, 200);
}

function pruneBuckets(now = Date.now()) {
  if (buckets.size < 1024) return;
  for (const [key, bucket] of buckets) if (now >= bucket.resetAt) buckets.delete(key);
}


export { consumeRequestBudget,   };
