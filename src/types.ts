import type { ComponentType } from 'react';

/** Native lifecycle of a modal. `exiting` only exists for bindings with `exitMs`. */
export type ModalPhase =
  | 'idle'
  | 'waiting'
  | 'presenting'
  | 'shown'
  | 'exiting'
  | 'dismissing';

/** An exact route name, or a regex (or regex source wrapped in slashes: "/Checkout/"). */
export type RoutePattern = string | RegExp;

/**
 * Shipped policy for an automatic prompt. Any id with a policy is an automatic
 * prompt: on top of the one-presentation-at-a-time rule it waits for the app to be ready, an
 * active app, an allowed route, its delay and its priority turn.
 */
export interface ModalPolicy {
  priority: number;
  delayMs?: number;
  /**
   * Defaults to true: hold the prompt while the `appReady` signal is false (a
   * splash, onboarding or login gate).
   */
  waitForAppReady?: boolean;
  allowedRoutes?: RoutePattern[];
  blockedRoutes?: RoutePattern[];
}

export type ModalPolicies = Record<string, ModalPolicy>;

/** Per-prompt server override (snake_case, as it comes from the API). */
export interface ServerModalPolicyOverride {
  enabled?: boolean;
  priority?: number;
  delay_ms?: number;
  wait_for_app_ready?: boolean;
  /** @deprecated The customer app's original key; `wait_for_app_ready` wins. */
  wait_for_splash?: boolean;
  allowed_routes?: RoutePattern[];
  blocked_routes?: RoutePattern[];
}

/**
 * Server-side policy. `enabled: false` at the top level is the kill switch: the
 * controller stops serialising and gating and every open/close is honoured at once.
 */
export interface ServerModalPolicy {
  enabled?: boolean;
  modals?: Record<string, ServerModalPolicyOverride>;
}

/** A policy merged with its server override. */
export interface ResolvedModalPolicy {
  /** The id has a shipped policy, i.e. it is an automatic prompt. */
  known: boolean;
  enabled: boolean;
  priority: number;
  delayMs: number;
  waitForAppReady: boolean;
  allowedRoutes: RoutePattern[] | null;
  blockedRoutes: RoutePattern[] | null;
}

/** What React reads for one modal. Frozen; identity changes only when it does. */
export interface ModalView<P = unknown> {
  readonly id: string | null;
  readonly baseId: string | null;
  readonly phase: ModalPhase;
  readonly wanted: boolean;
  /** Its owner wants it open (it may still be waiting for its turn). */
  readonly isOpen: boolean;
  /** Actually on screen: phase `shown` or `exiting`. */
  readonly isShown: boolean;
  /** Something should render it: open, or still on its way off screen. */
  readonly mounted: boolean;
  readonly params: P | undefined;
  readonly openedAt: number;
  /** Screen parent key of the native modal route whose host renders it, if any. */
  readonly hostScope: string | null;
}

export interface OpenOptions {
  /** Free-form origin of the request, for breadcrumbs. */
  source?: string;
}

export interface CloseOptions {
  /** Runs once the modal is fully off screen (after the native dismiss). */
  then?: () => void;
  /** Free-form reason, for breadcrumbs. */
  reason?: string;
}

/**
 * What a component holds for a modal: its state plus the actions on it. Pass it as
 * `modal` to `<Modal>` (or to your own sheet component) instead of `visible`.
 */
export interface ModalHandle<P = unknown> {
  readonly id: string;
  /** The base id (`delete_address` for `delete_address#3`). */
  readonly name: string;
  readonly phase: ModalPhase;
  readonly isOpen: boolean;
  readonly isShown: boolean;
  readonly mounted: boolean;
  readonly params: P | undefined;
  open(params?: P, options?: OpenOptions): void;
  close(options?: CloseOptions): void;
  /** Alias of `close`, so host-rendered components share one contract. */
  closeModal(options?: CloseOptions): void;
  /** Closes this modal and opens `toId` once it is off screen. */
  replaceWith<Q = unknown>(
    toId: string,
    params?: Q,
    options?: OpenOptions
  ): void;
}

/** A handle or a bare id. */
export type ModalRef = { readonly id: string } | string | null | undefined;

/** Signals the app feeds the controller. */
export interface ModalSignals {
  /**
   * Whether automatic prompts may present yet. Starts true; an app with a splash or
   * other launch gate sets it false in `configure({ signals })` and true once ready.
   */
  appReady: boolean;
  appActive: boolean;
  routeName: string | undefined;
  nativeModalRouteActive: boolean;
  /** Name of the native modal route on top, if any. */
  nativeModalRoute: string | null;
}

/** Argument of `markNavigationChange` / what `readNavigationState` returns. */
export interface NavigationChange {
  routeName?: string;
  /** Key of the focused route; only a change of key (or modal route) counts as moving. */
  routeKey?: string;
  /** Name of the native modal route on top, or null. */
  nativeModalRoute?: string | null;
  /** Legacy flag for a modal route on top whose name is unknown. */
  nativeModalRouteActive?: boolean;
}

export type ModalReporterData = Record<string, unknown>;

/** Where breadcrumbs and watchdog issues go (e.g. Sentry). */
export interface ModalReporter {
  breadcrumb: (message: string, data: ModalReporterData) => void;
  issue: (type: string, data: ModalReporterData) => void;
}

export interface ModalEvent {
  at: number;
  type: string;
  id: string | null;
  [key: string]: unknown;
}

export interface ModalTimings {
  /** A present that never reports `onShow` is retried once, then released. */
  presentTimeoutMs: number;
  /** iOS: a dismiss that never reports `onDismiss` is released. */
  dismissTimeoutMs: number;
  /** Extra time an owner's exit animation gets beyond its `exitMs`. */
  exitGraceMs: number;
  /** Root presents wait this long after a navigation change. */
  navigationSettleMs: number;
  /** Fallback for a native-stack screen transition whose `transitionEnd` never arrives. */
  screenTransitionMaxMs: number;
  /** A user-opened modal stuck this long is reported. */
  userStallMs: number;
  /** An automatic prompt stuck this long is reported. */
  promptStallMs: number;
}

/**
 * Focus of the navigation screen a `<Modal>` renders in. Structurally what React
 * Navigation's `navigation` object provides.
 */
export interface ScreenFocusSource {
  isFocused?: () => boolean;
  addListener?: (type: 'focus' | 'blur', callback: () => void) => () => void;
}

/**
 * A React hook returning the focus source of the screen it is called in (or
 * undefined outside screens). With React Navigation:
 * `() => useContext(NavigationContext)`.
 */
export type UseScreenFocus = () => ScreenFocusSource | null | undefined;

export interface ModalControllerConfig {
  /** The automatic prompts and their policies. Replaces the previous set. */
  policies?: ModalPolicies;
  reporter?: Partial<ModalReporter>;
  /** Initial signal values, e.g. `{ appReady: false }` for an app with a splash gate. */
  signals?: Partial<ModalSignals>;
  /** See `UseScreenFocus`. Set once, before the first `<Modal>` renders. */
  useScreenFocus?: UseScreenFocus | null;
  timings?: Partial<ModalTimings>;
}

export interface ModalBinding {
  setNativeVisible: (visible: boolean) => void;
  animationType?: string;
  parentKey: string | null;
  exitMs: number;
  name: string;
}

export interface BindOptions {
  setNativeVisible?: (visible: boolean) => void;
  animationType?: string;
  parentKey?: string | null;
  exitMs?: number;
  name?: string;
}

export interface InspectEntry {
  id: string;
  phase: ModalPhase;
  wanted: boolean;
  bound: boolean;
  parent: string | null;
  auto: boolean;
  /** The prompt's policy priority; null for a modal the user opened. */
  priority: number | null;
  focused: boolean;
}

/**
 * The queue as attached to reporter issues (`data.queue`): flat, so error reporters
 * don't truncate it. `entries` lists every entry that is not idle as
 * `id:phase[:wanted][:unbound][:unfocused][:in:<parent>]`.
 */
export interface ModalQueueSummary {
  signals: ModalSignals & { navigationBusy: boolean; enabled: boolean };
  entries: string[];
  idle: number;
  waiters: number;
}

export interface InspectResult {
  signals: ModalSignals & { navigationBusy: boolean; enabled: boolean };
  entries: InspectEntry[];
  waiters: number;
}

/** Props of a component rendered by `ModalHost`. */
export interface ModalComponentProps<P = unknown> {
  modal: ModalHandle<P>;
  params: P | undefined;
}

/**
 * `bottom`: anchored to the bottom, slides up. `screen`: full-screen takeover,
 * slides up. `center`: centred card, fades and scales up.
 */
export type ModalPreset = 'bottom' | 'screen' | 'center';

// `never` keeps any `ModalComponentProps<P>` component assignable here.
type RegistryComponent = ComponentType<ModalComponentProps<never>>;

/**
 * A modal `ModalHost` renders by id. With a `preset` the component only provides
 * content inside the host's shell; without one it renders its own sheet bound to
 * the `modal` handle it receives.
 */
export type ModalRegistryEntry =
  | { component: RegistryComponent; preset?: ModalPreset }
  | { load: () => RegistryComponent; preset?: ModalPreset };

export type ModalRegistry = Record<string, ModalRegistryEntry>;
