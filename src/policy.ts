import type {
  ModalPolicies,
  ResolvedModalPolicy,
  RoutePattern,
  ServerModalPolicy,
} from './types';

/**
 * A suggested priority scale for automatic prompts. It only orders prompts among
 * themselves: a modal the user opened always presents before any prompt.
 */
export const MODAL_PRIORITY = Object.freeze({
  blocking: 100,
  onboarding: 90,
  required: 80,
  orderCritical: 70,
  default: 50,
  feedback: 35,
  marketing: 20,
});

const toPattern = (pattern: RoutePattern): RoutePattern | null => {
  if (pattern instanceof RegExp) return pattern;
  if (
    typeof pattern === 'string' &&
    pattern.length > 2 &&
    pattern.startsWith('/') &&
    pattern.endsWith('/')
  ) {
    try {
      return new RegExp(pattern.slice(1, -1));
    } catch {
      return null;
    }
  }
  return pattern;
};

/**
 * Whether `routeName` matches any pattern: an exact route name, a RegExp, or regex
 * source wrapped in slashes ("/Checkout/", as the server sends it).
 */
export const matchesRoute = (
  patterns: readonly RoutePattern[] | null | undefined,
  routeName: string | null | undefined
): boolean =>
  (patterns || []).some(raw => {
    const pattern = toPattern(raw);
    if (!pattern || !routeName) return false;
    return pattern instanceof RegExp
      ? pattern.test(routeName)
      : pattern === routeName;
  });

const pick = <T>(value: T | null | undefined, fallback: T): T =>
  value === undefined || value === null ? fallback : value;

// An empty route list means "no restriction", not "nowhere".
const routeList = (
  value: RoutePattern[] | null | undefined
): RoutePattern[] | null =>
  Array.isArray(value) && value.length ? value : null;

/**
 * Merges the shipped policy for `modalId` (from `policies`) with the server
 * override (snake_case). Ids without a shipped policy are not automatic prompts
 * (`known: false`) and get the default priority.
 */
export const resolveModalPolicy = (
  modalId: string,
  serverPolicy: ServerModalPolicy | null | undefined,
  policies: ModalPolicies = {}
): ResolvedModalPolicy => {
  const shipped = Object.prototype.hasOwnProperty.call(policies, modalId)
    ? policies[modalId]
    : undefined;
  const base = shipped || { priority: MODAL_PRIORITY.default };
  const override = serverPolicy?.modals?.[modalId] || {};
  return {
    known: !!shipped,
    enabled: override.enabled !== false,
    priority: Number(pick(override.priority, base.priority)) || 0,
    delayMs: Number(pick(override.delay_ms, base.delayMs || 0)) || 0,
    waitForAppReady: pick(
      override.wait_for_app_ready ?? override.wait_for_splash,
      base.waitForAppReady !== false
    ),
    allowedRoutes: routeList(pick(override.allowed_routes, base.allowedRoutes)),
    blockedRoutes: routeList(pick(override.blocked_routes, base.blockedRoutes)),
  };
};
