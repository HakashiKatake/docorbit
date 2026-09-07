import type { BenchmarkTaskDef } from './types.ts';

/**
 * Semantically evaluates whether retrieved documentation content matches
 * the target version requirements of a benchmark task.
 *
 * Rather than looking for an arbitrary literal version string (e.g. "16.12" in HTTP API docs
 * which only use date versions, or "2.6" in tutorial prose on GitHub main), this inspects
 * whether the retrieved documentation teaches the correct version-specific API signatures,
 * syntax, and conventions — and does not teach fatal breaking-change anti-patterns.
 */
export function isVersionContentMatch(task: BenchmarkTaskDef, content: string): boolean {
  if (!content || content.trim().length === 0) return false;
  const lower = content.toLowerCase();

  switch (task.id) {
    case 'train_nextjs_14_route_sync':
      // Next.js 14: route params are synchronous. If doc teaches "await params" or "Promise<{", it's Next.js 15+!
      if (lower.includes('await params') || lower.includes('params: promise') || lower.includes('promise<{')) {
        return false;
      }
      return lower.includes('14') || lower.includes('params.id') || lower.includes('{ params }') || lower.includes('route handler');

    case 'eval_nextjs_15_async_params':
      // Next.js 15: route params are asynchronous Promises.
      return lower.includes('await params') || lower.includes('params: promise') || lower.includes('promise<{') || lower.includes('next.js 15');

    case 'train_stripe_v1_charges':
      // Legacy Stripe: direct charges endpoint /v1/charges
      if (lower.includes('payment_intents') && !lower.includes('/v1/charges') && !lower.includes('charges.create')) {
        return false;
      }
      return lower.includes('/v1/charges') || lower.includes('charges.create');

    case 'eval_stripe_payment_intents_2024':
      // Modern Stripe: PaymentIntents endpoint
      return lower.includes('payment_intents') || lower.includes('paymentintents');

    case 'train_pydantic_v1_validator':
      // Pydantic v1: uses @validator. If doc teaches @field_validator, it's Pydantic v2!
      if (lower.includes('field_validator')) {
        return false;
      }
      return lower.includes('@validator') || lower.includes('validator(');

    case 'eval_pydantic_v2_field_validator':
      // Pydantic v2: uses @field_validator
      return lower.includes('field_validator');

    case 'train_fastapi_095_sync_dep':
      // FastAPI 0.95 dependency injection with Depends
      return lower.includes('depends(') || lower.includes('depends');

    case 'eval_fastapi_100_lifespan':
      // FastAPI 0.100+: uses lifespan async context manager
      return lower.includes('lifespan');

    case 'eval_tokio_postgres_07':
      // tokio-postgres 0.7: connect + spawn connection task
      return lower.includes('connect') && (lower.includes('tokio::spawn') || lower.includes('spawn') || lower.includes('connection'));

    case 'eval_gin_gonic_v19':
      // Gin 1.9+: ShouldBindJSON
      return lower.includes('shouldbindjson');

    default: {
      // Fallback: check SemVer major/minor string
      const parts = task.targetVersion.split('.');
      const majorMinor = parts.slice(0, 2).join('.');
      return lower.includes(majorMinor) || lower.includes(`v${parts[0]}`);
    }
  }
}
