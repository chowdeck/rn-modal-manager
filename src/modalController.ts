import { Platform } from 'react-native';
import { matchesRoute, resolveModalPolicy } from './policy';
import type {
  BindOptions,
  CloseOptions,
  InspectResult,
  ModalBinding,
  ModalControllerConfig,
  ModalEvent,
  ModalPhase,
  ModalPolicies,
  ModalQueueSummary,
  ModalReporter,
  ModalReporterData,
  ModalSignals,
  ModalTimings,
  ModalView,
  NavigationChange,
  OpenOptions,
  ResolvedModalPolicy,
  ServerModalPolicy,
  UseScreenFocus,
} from './types';

/**
 * The single owner of modal state, and the scheduler for every native modal
 * presentation.
 *
 * Why: on iOS a React Native `<Modal>` is a UIViewController presented from the
 * nearest view controller. UIKit drops a presentation that starts while another
 * one is presenting/dismissing, while a navigation transition is running, or from
 * a controller that is already presenting a sibling. A dropped presentation leaves
 * JS believing a modal is up (or an empty transparent controller on screen), which
 * is the "frozen screen". This module makes those overlaps impossible:
 *
 * 1. One native transition at a time, app-wide. A present or dismiss only starts
 *    once the previous one has completed (`onShow` / `onDismiss`, or a settle
 *    timer on Android where RN has no `onDismiss`).
 * 2. One root-level modal on screen at a time. A modal rendered *inside* another
 *    modal (nested) presents from that modal's controller, which UIKit supports, so
 *    nested modals are allowed once their parent is shown. Sibling modals queue.
 * 3. Root-level presents wait for navigation transitions (until the native-stack
 *    screen reports `transitionEnd`) and native-stack modal routes to settle.
 * 4. Automatic prompts (ids with a policy, see `configure({ policies })`)
 *    additionally wait for the app to be ready, an active app, route rules and their
 *    priority turn, all overridable from the server (`setPolicy`).
 *
 * State model: one entry per modal, keyed by id. `open(id, params)` / `close(id)`
 * set the intent; the entry's `phase` is the native truth:
 *
 *   idle → waiting → presenting → shown → (exiting →) dismissing → idle
 *
 * `exiting` is the owner's JS exit animation (sheets slide down before the native
 * modal is hidden); it only exists for bindings that declare `exitMs`.
 *
 * A component shows a modal by binding to its entry (`<Modal modal={id}>`), never by
 * holding a `visible` boolean of its own. Registry ids are host-rendered automatic
 * prompts and named stack modals; `createInstance(baseId)` gives screen-local sheets
 * an id of their own.
 *
 * Watchdogs report (and recover from) presents that never complete, dismissals that
 * never report back, and user-opened modals stuck behind another modal, so a
 * regression shows up in the reporter instead of as a frozen screen. They stand down
 * while the app is inactive: iOS holds modal transitions until it is active again.
 *
 * Module-level external store: read in React through `useSyncExternalStore` (see
 * hooks.ts), called directly from sagas, push handlers and query callbacks.
 */

const DEFAULT_TIMINGS: Readonly<ModalTimings> = Object.freeze({
  presentTimeoutMs: 2500,
  dismissTimeoutMs: 1500,
  exitGraceMs: 400,
  navigationSettleMs: 450,
  screenTransitionMaxMs: 1500,
  userStallMs: 4000,
  promptStallMs: 15000,
});

/** Current timings (tunable through `configure({ timings })`). */
export const TIMINGS: ModalTimings = { ...DEFAULT_TIMINGS };

export const PHASES: readonly ModalPhase[] = [
  'idle',
  'waiting',
  'presenting',
  'shown',
  'exiting',
  'dismissing',
];
const USER_PRIORITY = 60;
const EVENT_BUFFER = 100;

const isDev = (): boolean => typeof __DEV__ !== 'undefined' && !!__DEV__;
const isIOS = (): boolean => Platform.OS === 'ios';
const animated = (animationType?: string): boolean =>
  !!animationType && animationType !== 'none';
// Android has no onDismiss: wait out the Dialog's exit animation instead.
const androidDismissSettleMs = (animationType?: string): number =>
  animated(animationType) ? 320 : 80;
// An unmounted Modal never reports onDismiss on either platform.
const unmountSettleMs = (animationType?: string): number =>
  animated(animationType) ? 420 : 120;
const SCREEN_PARENT_PREFIX = 'screen:';

/** Parent key of the modals hosted by a native modal screen (see Modal, ModalHost). */
export const screenParentKey = (routeName: string | null | undefined): string =>
  `${SCREEN_PARENT_PREFIX}${routeName}`;

const noop = (): void => {};
const defaultReporter: ModalReporter = {
  breadcrumb: noop,
  issue: (type, data) => {
    if (isDev()) {
      // eslint-disable-next-line no-console
      console.warn(`[modal] ${type}`, data);
    }
  },
};

const IDLE_VIEW: ModalView = Object.freeze({
  id: null,
  baseId: null,
  phase: 'idle',
  wanted: false,
  isOpen: false,
  isShown: false,
  mounted: false,
  params: undefined,
  openedAt: 0,
  hostScope: null,
});

const initialSignals = (): ModalSignals => ({
  appReady: true,
  appActive: true,
  routeName: undefined,
  nativeModalRouteActive: false,
  nativeModalRoute: null,
});

interface Entry {
  id: string;
  baseId: string;
  instance: boolean;
  wanted: boolean;
  params: unknown;
  phase: ModalPhase;
  binding: ModalBinding | null;
  focused: boolean;
  forcedDismiss: boolean;
  retried: boolean;
  failed: boolean;
  stallReported: boolean;
  heldByDesign: boolean;
  stallSince: number;
  waitingSince: number;
  presentStartedAt: number;
  openedAt: number;
  timer: ReturnType<typeof setTimeout> | null;
  thens: Array<() => void>;
  removeWhenIdle: boolean;
  hostScope: string | null;
}

interface Waiter {
  type: 'idle' | 'transitions';
  fn: () => void;
}

type Listener = () => void;
type EventListener = (event: ModalEvent) => void;

let sequence = 0;
let entries = new Map<string, Entry>();
let views = new Map<string, ModalView>();
let signals: ModalSignals = initialSignals();
let configuredSignals: Partial<ModalSignals> = {};
let navBusyUntil = 0;
// Route key → start time of a native-stack screen transition still running.
let screenTransitions = new Map<string, number>();
let lastRouteKey: string | undefined;
let serverPolicy: ServerModalPolicy | null = null;
let policies: ModalPolicies = {};
let reporter: ModalReporter = defaultReporter;
let screenFocusHook: UseScreenFocus | null = null;
let listeners = new Set<Listener>();
let eventListeners = new Set<EventListener>();
let events: ModalEvent[] = [];
let waiters: Waiter[] = [];
let pumpTimer: ReturnType<typeof setTimeout> | null = null;
let pumpTimerAt = 0;
let pumping = false;
let repump = false;

const now = (): number => Date.now();
const messageOf = (e: unknown): string =>
  String((e as { message?: unknown } | null)?.message || e);

// ---------------------------------------------------------------------------
// Views (what React reads) and events (what the reporter / devtools read)

function viewOf(entry: Entry): ModalView {
  return Object.freeze({
    id: entry.id,
    baseId: entry.baseId,
    phase: entry.phase,
    wanted: entry.wanted,
    isOpen: entry.wanted,
    isShown: entry.phase === 'shown' || entry.phase === 'exiting',
    mounted: entry.wanted || entry.phase !== 'idle',
    params: entry.params,
    openedAt: entry.openedAt,
    hostScope: entry.hostScope,
  });
}

let dirty = false;

function touch(entry: Entry): void {
  views.set(entry.id, viewOf(entry));
  dirty = true;
}

function forget(id: string): void {
  entries.delete(id);
  views.delete(id);
  dirty = true;
}

function notify(): void {
  if (!dirty) return;
  dirty = false;
  // New Map reference so useSyncExternalStore sees a change; per-entry views keep
  // their identity until that entry changes.
  views = new Map(views);
  listeners.forEach(listener => listener());
}

const describe = (
  entry: Entry | null | undefined,
  extra?: ModalReporterData
): ModalReporterData => ({
  modal_id: entry?.id || null,
  modal_base: entry?.baseId || null,
  modal_name: entry?.binding?.name || entry?.id || null,
  phase: entry?.phase,
  route: signals.routeName,
  platform: Platform.OS,
  ...extra,
});

function emit(
  type: string,
  entry: Entry | null | undefined,
  data?: ModalReporterData
): ModalEvent {
  const event: ModalEvent = {
    at: now(),
    type,
    id: entry?.id || null,
    ...data,
  };
  events.push(event);
  if (events.length > EVENT_BUFFER) events.shift();
  eventListeners.forEach(listener => {
    try {
      listener(event);
    } catch {
      // listeners must never break presentation
    }
  });
  return event;
}

function breadcrumb(
  message: string,
  entry: Entry | null | undefined,
  extra?: ModalReporterData
): void {
  emit(message, entry, extra);
  try {
    reporter.breadcrumb(message, describe(entry, extra));
  } catch {
    // reporting must never break presentation
  }
}

// Queue state for an issue report, flat enough to survive error reporters'
// normalisation depth (Sentry shows nested entry objects as "[Object]"): every entry
// that is not idle, as `id:phase[:flags]`, plus how many idle ones there are.
function queueSummary(): ModalQueueSummary {
  const active = values().filter(
    entry => entry.phase !== 'idle' || entry.wanted
  );
  return {
    signals: {
      ...signals,
      navigationBusy: navigationBusy(),
      enabled: !passThrough(),
    },
    entries: active.map(entry =>
      [
        entry.id,
        entry.phase,
        entry.wanted ? 'wanted' : null,
        bound(entry) ? null : 'unbound',
        entry.focused ? null : 'unfocused',
        parentKeyOf(entry) ? `in:${parentKeyOf(entry)}` : null,
      ]
        .filter(Boolean)
        .join(':')
    ),
    idle: entries.size - active.length,
    waiters: waiters.length,
  };
}

function issue(
  type: string,
  entry: Entry | null | undefined,
  extra?: ModalReporterData
): void {
  emit(type, entry, extra);
  try {
    reporter.issue(type, {
      ...describe(entry, extra),
      queue: queueSummary(),
    });
  } catch {
    // reporting must never break presentation
  }
}

// ---------------------------------------------------------------------------
// Entry helpers

const policyFor = (entry: Entry): ResolvedModalPolicy =>
  resolveModalPolicy(entry.baseId, serverPolicy, policies);
const isAuto = (entry: Entry): boolean =>
  !entry.instance && policyFor(entry).known;
const priorityOf = (entry: Entry): number =>
  isAuto(entry) ? policyFor(entry).priority : USER_PRIORITY;

const parentKeyOf = (entry: Entry): string | null =>
  entry.binding?.parentKey || null;
const isScreenParent = (parentKey: string | null): boolean =>
  typeof parentKey === 'string' && parentKey.startsWith(SCREEN_PARENT_PREFIX);
const isRoot = (entry: Entry): boolean => !parentKeyOf(entry);
const inTransition = (entry: Entry): boolean =>
  entry.phase === 'presenting' ||
  entry.phase === 'exiting' ||
  entry.phase === 'dismissing';
const onScreen = (entry: Entry): boolean =>
  entry.phase === 'shown' || inTransition(entry);
// A modal can only present once something renders it.
const bound = (entry: Entry): boolean => !!entry.binding;
// Screen-hosted modals wait while their screen is not focused: iOS only presents a
// modal whose host view is in the window, which a covered or inactive screen's isn't.
const ready = (entry: Entry): boolean => bound(entry) && entry.focused;

function parentOf(entry: Entry): Entry | null {
  const parentKey = parentKeyOf(entry);
  return parentKey && !isScreenParent(parentKey)
    ? entries.get(parentKey) || null
    : null;
}

function depth(entry: Entry): number {
  let level = 0;
  let parent = parentOf(entry);
  while (parent && level < 20) {
    level += 1;
    parent = parentOf(parent);
  }
  return level;
}

// An entry has to leave the screen when its owner closed it, or when anything it is
// nested in is leaving. UIKit dismissing a parent that still presents a child only
// dismisses the child, leaving the parent's empty controller over the app, so
// descendants always go first.
function mustLeave(entry: Entry): boolean {
  if (!entry.wanted) return true;
  let parent = parentOf(entry);
  let guard = 0;
  while (parent && guard < 20) {
    if (!parent.wanted || !parent.binding) return true;
    parent = parentOf(parent);
    guard += 1;
  }
  return false;
}

const values = (): Entry[] => Array.from(entries.values());
const anyTransition = (): boolean => values().some(inTransition);

// ms until navigation has settled: the settle window after a route change, or a
// native-stack screen transition that has not reported its end yet (capped).
function navigationBusyMs(): number {
  const at = now();
  let until = navBusyUntil;
  screenTransitions.forEach((startedAt, key) => {
    const end = startedAt + TIMINGS.screenTransitionMaxMs;
    if (end <= at) screenTransitions.delete(key);
    else until = Math.max(until, end);
  });
  return Math.max(0, until - at);
}
const navigationBusy = (): boolean => navigationBusyMs() > 0;
const rootOccupant = (): Entry | undefined =>
  values().find(entry => isRoot(entry) && onScreen(entry));
const passThrough = (): boolean => serverPolicy?.enabled === false;

function clearTimer(entry: Entry): void {
  if (entry.timer) {
    clearTimeout(entry.timer);
    entry.timer = null;
  }
}

function schedulePump(delayMs = 0): void {
  const at = now() + delayMs;
  if (pumpTimer && pumpTimerAt <= at) return;
  if (pumpTimer) clearTimeout(pumpTimer);
  pumpTimerAt = at;
  pumpTimer = setTimeout(() => {
    pumpTimer = null;
    pump();
  }, delayMs);
}

function ensureEntry(id: string, baseId?: string, instance?: boolean): Entry {
  let entry = entries.get(id);
  if (entry) return entry;
  entry = {
    id,
    baseId: baseId || id,
    instance: !!instance,
    wanted: false,
    params: undefined,
    phase: 'idle',
    binding: null,
    focused: true,
    forcedDismiss: false,
    retried: false,
    failed: false,
    stallReported: false,
    heldByDesign: false,
    stallSince: 0,
    waitingSince: now(),
    presentStartedAt: 0,
    openedAt: 0,
    timer: null,
    thens: [],
    removeWhenIdle: false,
    hostScope: null,
  };
  entries.set(id, entry);
  touch(entry);
  return entry;
}

function runThens(entry: Entry): void {
  const thens = entry.thens;
  entry.thens = [];
  thens.forEach(fn => {
    try {
      fn();
    } catch (e) {
      issue('then_error', entry, { message: messageOf(e) });
    }
  });
}

// Drops an entry nobody can reach any more: an unbound idle instance, or a host
// entry whose owner closed it and nothing renders.
function sweep(entry: Entry): boolean {
  if (entry.phase !== 'idle' || entry.wanted || entry.binding) return false;
  if (entry.removeWhenIdle || !entry.instance) {
    forget(entry.id);
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Native transitions

function beginPresent(entry: Entry): void {
  entry.phase = 'presenting';
  entry.presentStartedAt = now();
  entry.forcedDismiss = false;
  breadcrumb('present', entry, { waited_ms: now() - entry.waitingSince });
  entry.binding?.setNativeVisible(true);
  clearTimer(entry);
  // No watchdog in pass-through mode: there is nothing to serialise or recover.
  armWatchdog(entry);
  touch(entry);
}

function beginExit(entry: Entry): void {
  entry.phase = 'exiting';
  breadcrumb('exit', entry);
  clearTimer(entry);
  entry.timer = setTimeout(
    () => onExitTimeout(entry.id),
    (entry.binding?.exitMs || 0) + TIMINGS.exitGraceMs
  );
  touch(entry);
}

function beginDismiss(entry: Entry): void {
  entry.phase = 'dismissing';
  // Hidden by the controller (retry, or a parent leaving) rather than its owner: the
  // owner's onDismiss must not fire for it.
  entry.forcedDismiss = entry.wanted;
  breadcrumb('dismiss', entry);
  const animationType = entry.binding?.animationType;
  entry.binding?.setNativeVisible(false);
  clearTimer(entry);
  if (!entry.binding) {
    entry.timer = setTimeout(
      () => finishDismiss(entry.id),
      unmountSettleMs(animationType)
    );
  } else if (isIOS()) {
    armWatchdog(entry);
  } else {
    entry.timer = setTimeout(
      () => finishDismiss(entry.id),
      androidDismissSettleMs(animationType)
    );
  }
  touch(entry);
}

function finishDismiss(id: string): void {
  const entry = entries.get(id);
  if (!entry) return;
  clearTimer(entry);
  if (entry.wanted && !entry.failed && !entry.removeWhenIdle) {
    entry.phase = 'waiting';
    entry.waitingSince = now();
  } else {
    entry.phase = 'idle';
  }
  breadcrumb('closed', entry);
  touch(entry);
  if (entry.phase === 'idle') runThens(entry);
  sweep(entry);
  notify();
  pump();
}

// A present that failed (e.g. its screen was not in the window) gets another chance
// whenever the situation changes, instead of waiting for its owner to toggle it.
function requeueFailed(): void {
  values().forEach(entry => {
    if (entry.failed && entry.wanted && entry.phase === 'idle') {
      entry.failed = false;
      entry.retried = false;
      entry.phase = 'waiting';
      entry.waitingSince = now();
      touch(entry);
    }
  });
}

// (Re)starts the watchdog of a native transition in flight. Only presents, and iOS
// dismissals of a rendered modal, have one: the other dismissals settle on a timer.
function armWatchdog(entry: Entry): void {
  if (entry.phase === 'presenting' && !passThrough()) {
    clearTimer(entry);
    entry.timer = setTimeout(
      () => onPresentTimeout(entry.id),
      TIMINGS.presentTimeoutMs
    );
  } else if (entry.phase === 'dismissing' && entry.binding && isIOS()) {
    clearTimer(entry);
    entry.timer = setTimeout(
      () => onDismissTimeout(entry.id),
      TIMINGS.dismissTimeoutMs
    );
  }
}

function onPresentTimeout(id: string): void {
  const entry = entries.get(id);
  if (!entry || entry.phase !== 'presenting') return;
  entry.timer = null;
  // iOS finishes the transition (and calls onShow) once the app is active again:
  // the watchdog restarts then (see setSignals) instead of hiding a modal that is fine.
  if (!signals.appActive) return;
  if (!entry.retried) {
    // UIKit most likely dropped the presentation: hide and present once more.
    issue('present_timeout', entry, {
      action: 'retry',
      blocked_by: blockerName(entry),
    });
    entry.retried = true;
    beginDismiss(entry);
    notify();
    return;
  }
  // Give up so it can't hold the screen hostage; it re-queues on the next navigation
  // or focus change, or when the owner opens it again.
  issue('present_failed', entry, { action: 'released' });
  entry.failed = true;
  beginDismiss(entry);
  notify();
}

function onExitTimeout(id: string): void {
  const entry = entries.get(id);
  if (!entry || entry.phase !== 'exiting') return;
  breadcrumb('exit_timeout', entry);
  beginDismiss(entry);
  notify();
}

function onDismissTimeout(id: string): void {
  const entry = entries.get(id);
  if (!entry || entry.phase !== 'dismissing') return;
  entry.timer = null;
  // Same as a present: onDismiss arrives once the app is active again.
  if (!signals.appActive) return;
  issue('dismiss_timeout', entry);
  finishDismiss(id);
}

function blockerName(entry: Entry): string | null {
  const occupant = rootOccupant();
  if (occupant && occupant !== entry) return occupant.id;
  if (signals.nativeModalRouteActive) return `route:${signals.routeName}`;
  if (navigationBusy()) return 'navigation';
  if (!bound(entry)) return 'unbound';
  return null;
}

// An automatic prompt waiting its turn rather than starved: held by its own policy
// (route, app not ready, app in background, delay), or queued behind a modal the user has on
// screen or a native modal route. It presents once that is over.
function promptHeldByDesign(entry: Entry): boolean {
  if (autoPromptGate(entry) !== true) return true;
  const occupant = rootOccupant();
  if (occupant && occupant !== entry && occupant.phase === 'shown') return true;
  return signals.nativeModalRouteActive;
}

function checkStall(entry: Entry): void {
  if (
    entry.stallReported ||
    entry.phase !== 'waiting' ||
    !isRoot(entry) ||
    !entry.focused
  )
    return;
  const auto = isAuto(entry);
  if (auto && promptHeldByDesign(entry)) {
    entry.heldByDesign = true;
    return;
  }
  if (entry.heldByDesign) {
    // The stall clock starts when the hold is over, not when the prompt was opened.
    entry.heldByDesign = false;
    entry.stallSince = now();
  }
  const limit = auto ? TIMINGS.promptStallMs : TIMINGS.userStallMs;
  const waited = now() - Math.max(entry.waitingSince, entry.stallSince);
  if (waited < limit) {
    schedulePump(limit - waited);
    return;
  }
  entry.stallReported = true;
  // A user modal stuck behind another one: a sibling modal opened over a still-open
  // modal (close the first one before opening the next, or nest the second one).
  // A prompt stuck this long with nothing on screen in its way: navigation that never
  // settles, a host that never renders it, or a transition that never ends.
  issue(auto ? 'prompt_starved' : 'user_modal_blocked', entry, {
    waited_ms: waited,
    queued_ms: now() - entry.waitingSince,
    blocked_by: blockerName(entry),
  });
}

// Returns true when an automatic prompt may present now, or the ms until it may.
function autoPromptGate(entry: Entry): boolean | number {
  const policy = policyFor(entry);
  if (!policy.enabled) return false;
  if (policy.waitForAppReady && !signals.appReady) return false;
  if (!signals.appActive) return false;
  if (
    policy.allowedRoutes &&
    !matchesRoute(policy.allowedRoutes, signals.routeName)
  )
    return false;
  if (
    policy.blockedRoutes &&
    matchesRoute(policy.blockedRoutes, signals.routeName)
  )
    return false;
  const remaining = entry.waitingSince + policy.delayMs - now();
  return remaining > 0 ? remaining : true;
}

function selectNested(): Entry | undefined {
  return values().find(entry => {
    if (entry.phase !== 'waiting' || isRoot(entry) || !ready(entry))
      return false;
    const parentKey = parentKeyOf(entry);
    // A controller presents one child at a time: siblings under the same parent queue.
    const siblingOnScreen = values().some(
      other =>
        other !== entry && parentKeyOf(other) === parentKey && onScreen(other)
    );
    if (siblingOnScreen) return false;
    if (isScreenParent(parentKey)) return !navigationBusy();
    const parent = parentKey ? entries.get(parentKey) : undefined;
    return !!parent && parent.phase === 'shown' && !mustLeave(parent);
  });
}

function selectRoot(): { entry: Entry | null; wakeInMs: number | null } {
  if (rootOccupant() || signals.nativeModalRouteActive)
    return { entry: null, wakeInMs: null };
  if (navigationBusy()) return { entry: null, wakeInMs: navigationBusyMs() };
  let best: Entry | null = null;
  let wakeInMs: number | null = null;
  const contenders: Entry[] = [];
  values().forEach(entry => {
    if (entry.phase !== 'waiting' || !isRoot(entry) || !ready(entry)) return;
    if (isAuto(entry)) {
      const gate = autoPromptGate(entry);
      if (gate !== true) {
        if (typeof gate === 'number')
          wakeInMs = wakeInMs === null ? gate : Math.min(wakeInMs, gate);
        return;
      }
    }
    contenders.push(entry);
    if (
      !best ||
      priorityOf(entry) > priorityOf(best) ||
      (priorityOf(entry) === priorityOf(best) &&
        entry.waitingSince < best.waitingSince)
    ) {
      best = entry;
    }
  });
  const winner = best as Entry | null;
  if (winner && contenders.length > 1) {
    const others = contenders.filter(entry => entry !== winner);
    breadcrumb('contention', winner, {
      winner_priority: priorityOf(winner),
      waiting: others.map(entry => `${entry.id}@${priorityOf(entry)}`),
    });
    if (
      others.some(
        entry =>
          priorityOf(entry) === priorityOf(winner) &&
          isAuto(entry) &&
          isAuto(winner)
      )
    ) {
      // Two prompts at one priority present in arrival order, which is arbitrary from a
      // product view: give them distinct priorities.
      issue('priority_tie', winner, {
        tied_with: others.map(entry => entry.id),
      });
    }
  }
  return { entry: winner, wakeInMs };
}

function settleWaiters(): void {
  const idle = !anyTransition() && !navigationBusy();
  if (!idle) return;
  const screenFree = !rootOccupant() && !signals.nativeModalRouteActive;
  const due = waiters.filter(
    waiter => waiter.type === 'transitions' || screenFree
  );
  if (!due.length) return;
  waiters = waiters.filter(waiter => !due.includes(waiter));
  if (due.some(waiter => waiter.type === 'idle')) {
    // An idle waiter usually navigates or presents system UI: hold root presents
    // until the navigation helper reports what it did.
    navBusyUntil = now() + TIMINGS.navigationSettleMs;
    schedulePump(TIMINGS.navigationSettleMs);
  }
  due.forEach(waiter => {
    try {
      waiter.fn();
    } catch (e) {
      issue('waiter_error', null, { message: messageOf(e) });
    }
  });
}

function leave(entry: Entry): void {
  // The owner's own exit animation runs first unless the controller is forcing the
  // modal off (retry, parent leaving), in which case the native dismiss is immediate.
  if (entry.wanted || !entry.binding?.exitMs) beginDismiss(entry);
  else beginExit(entry);
}

function pumpPassThrough(): void {
  // Kill switch: no serialisation or gating, every request is honoured at once.
  values().forEach(entry => {
    if (
      (entry.phase === 'shown' || entry.phase === 'presenting') &&
      mustLeave(entry)
    )
      leave(entry);
    else if (entry.phase === 'waiting' && bound(entry)) beginPresent(entry);
  });
  settleWaiters();
}

function pumpOnce(): void {
  if (passThrough()) {
    pumpPassThrough();
    return;
  }
  if (anyTransition()) return;

  // 1. Dismissals first, deepest first, so a child never outlives its parent's dismiss.
  const leaving = values()
    .filter(entry => entry.phase === 'shown' && mustLeave(entry))
    .sort((a, b) => depth(b) - depth(a))[0];
  if (leaving) {
    leave(leaving);
    return;
  }

  // 2. Nested modals whose parent is on screen.
  const nested = selectNested();
  if (nested) {
    beginPresent(nested);
    return;
  }

  // 3. Root-level modals: highest priority that passes its gates.
  const { entry, wakeInMs } = selectRoot();
  if (entry) {
    beginPresent(entry);
    return;
  }
  if (navigationBusy()) schedulePump(navigationBusyMs());
  if (typeof wakeInMs === 'number') schedulePump(wakeInMs);

  values().forEach(checkStall);
  settleWaiters();
}

// Pass-through mode honours requests at once; otherwise a pump is deferred a tick.
function kick(): void {
  if (passThrough()) pump();
  else schedulePump(0);
}

function pump(): void {
  if (pumping) {
    repump = true;
    return;
  }
  pumping = true;
  try {
    do {
      repump = false;
      pumpOnce();
    } while (repump);
  } finally {
    pumping = false;
    notify();
  }
}

function addWaiter(type: Waiter['type'], fn: () => void): () => void {
  if (passThrough()) {
    fn();
    return noop;
  }
  const waiter: Waiter = { type, fn };
  waiters.push(waiter);
  schedulePump(0);
  return () => {
    waiters = waiters.filter(item => item !== waiter);
  };
}

// ---------------------------------------------------------------------------

export const modalController = {
  // -- Configuration ------------------------------------------------------------

  /**
   * Configures the controller. Call once at startup, before anything renders.
   * Only the fields given change; `policies` replaces the previous set.
   * Configuration survives `__reset()`, except `signals`, which are re-applied.
   */
  configure(config: ModalControllerConfig = {}): void {
    if (config.policies !== undefined) policies = { ...config.policies };
    if (config.reporter !== undefined)
      modalController.setReporter(config.reporter);
    if (config.timings !== undefined) Object.assign(TIMINGS, config.timings);
    if (config.useScreenFocus !== undefined)
      screenFocusHook = config.useScreenFocus;
    if (config.signals !== undefined) {
      configuredSignals = { ...configuredSignals, ...config.signals };
      signals = { ...signals, ...config.signals };
    }
    schedulePump(0);
  },

  /** The automatic prompts' shipped policies, as configured. */
  getPolicies(): Readonly<ModalPolicies> {
    return policies;
  },

  /** `id`'s configured policy merged with the current server override. */
  resolvePolicy(id: string): ResolvedModalPolicy {
    return resolveModalPolicy(id, serverPolicy, policies);
  },

  /** @internal The screen-focus hook `<Modal>` calls. */
  getScreenFocusHook(): UseScreenFocus | null {
    return screenFocusHook;
  },

  // -- Intent -----------------------------------------------------------------

  /**
   * Asks for `id` to be shown with `params`. Registry ids are rendered by the host;
   * instance ids by the component that created them. Re-opening an open modal only
   * updates its params.
   */
  open(id: string, params?: unknown, { source }: OpenOptions = {}): void {
    const entry = ensureEntry(id);
    entry.params = params;
    if (!entry.wanted) {
      entry.wanted = true;
      entry.openedAt = now();
      if (entry.thens.length) {
        // Re-opened before the close they waited for completed: that close is
        // cancelled, so its follow-ups must not fire on some later close.
        breadcrumb('thens_dropped', entry, { count: entry.thens.length });
        entry.thens = [];
      }
      // Opened by the user over a native modal screen: that screen's host renders it,
      // so it presents inside the screen (as an inline modal did) instead of queueing
      // behind it. Automatic prompts still wait for the screen to close. A modal still
      // leaving the host that renders it stays with that host.
      // Only registry modals have a host; screen-local instances render where they live.
      if (!entry.instance && (entry.phase === 'idle' || !entry.binding)) {
        entry.hostScope =
          signals.nativeModalRoute && !isAuto(entry)
            ? screenParentKey(signals.nativeModalRoute)
            : null;
      }
      entry.failed = false;
      entry.retried = false;
      entry.stallReported = false;
      entry.removeWhenIdle = false;
      if (entry.phase === 'idle') {
        entry.phase = 'waiting';
        entry.waitingSince = now();
      }
      breadcrumb('open', entry, {
        source: source || null,
        params_keys:
          params && typeof params === 'object' ? Object.keys(params) : [],
      });
    }
    touch(entry);
    notify();
    // Deferred so a navigation dispatched in the same tick lands first and marks
    // the navigator busy before anything is presented over it.
    kick();
  },

  /**
   * Closes `id`. `then` runs once the modal is fully off screen (after the native
   * dismiss), which is where navigation or the next modal belongs.
   */
  close(id: string, { then, reason }: CloseOptions = {}): void {
    const entry = entries.get(id);
    if (!entry || (!entry.wanted && entry.phase === 'idle')) {
      if (then) modalController.afterTransitions(then);
      return;
    }
    if (then) entry.thens.push(then);
    if (!entry.wanted) return;
    entry.wanted = false;
    breadcrumb('close', entry, { reason: reason || null });
    if (entry.phase === 'waiting') {
      entry.phase = 'idle';
      touch(entry);
      runThens(entry);
      sweep(entry);
    } else {
      touch(entry);
    }
    notify();
    kick();
  },

  /** Closes `fromId` and opens `toId` once it is off screen. */
  replace(
    fromId: string,
    toId: string,
    params?: unknown,
    options?: OpenOptions
  ): void {
    modalController.close(fromId, { reason: `replace:${toId}` });
    modalController.open(toId, params, options);
  },

  closeAll({
    except = [],
    reason = 'close_all',
  }: { except?: string[]; reason?: string } = {}): void {
    values().forEach(entry => {
      if (entry.wanted && !except.includes(entry.id))
        modalController.close(entry.id, { reason });
    });
  },

  isOpen(id: string): boolean {
    return !!entries.get(id)?.wanted;
  },

  /** Creates a unique id for a screen-local modal: `baseId#n`. */
  createInstance(baseId: string): string {
    sequence += 1;
    const id = `${baseId}#${sequence}`;
    // No notify: this runs while the owner renders (useModalInstance, a Modal without
    // a handle), and notifying would update every subscriber mid-render. A new
    // instance is idle and unbound, so nothing on screen changes; its view is already
    // readable through getView, and the next real change publishes it.
    ensureEntry(id, baseId, true);
    return id;
  },

  /** The owner of an instance unmounted: close it and drop the entry once off screen. */
  remove(id: string): void {
    const entry = entries.get(id);
    if (!entry) return;
    entry.removeWhenIdle = true;
    modalController.close(id, { reason: 'removed' });
    if (sweep(entry)) notify();
  },

  // -- Native binding (used by <Modal> only) ----------------------------------

  /** A `<Modal>` now renders `id`; presents go through `setNativeVisible`. */
  bind(
    id: string,
    {
      setNativeVisible,
      animationType,
      parentKey,
      exitMs,
      name,
    }: BindOptions = {}
  ): void {
    const entry = ensureEntry(id);
    entry.binding = {
      setNativeVisible: setNativeVisible || noop,
      animationType,
      parentKey: parentKey || null,
      exitMs: exitMs || 0,
      name: name || id,
    };
    if (
      isDev() &&
      !entry.instance &&
      !resolveModalPolicy(entry.baseId, null, policies).known &&
      !entry.baseId.includes('#')
    ) {
      // Fine for stack modals and constant-id leaf modals; worth a look if it was
      // meant to be an automatic prompt.
      emit('bind_unregistered', entry, {});
    }
    touch(entry);
    notify();
    kick();
  },

  updateBinding(id: string, patch: Partial<ModalBinding>): void {
    const entry = entries.get(id);
    if (!entry?.binding) return;
    Object.assign(entry.binding, patch);
  },

  /**
   * The `<Modal>` rendering `id` unmounted. `keepIntent`: the host is only moving the
   * modal to another place in the tree (a stack modal whose parent left), so it stays
   * open and presents again once the new `<Modal>` binds.
   */
  unbind(
    id: string,
    { keepIntent = false }: { keepIntent?: boolean } = {}
  ): void {
    const entry = entries.get(id);
    if (!entry) return;
    const animationType = entry.binding?.animationType;
    entry.binding = null;
    if (!keepIntent) entry.wanted = false;
    if (onScreen(entry)) {
      // Native dismisses it now, without an onDismiss we could wait for.
      clearTimer(entry);
      entry.phase = 'dismissing';
      entry.timer = setTimeout(
        () => finishDismiss(id),
        unmountSettleMs(animationType)
      );
      touch(entry);
      notify();
      return;
    }
    clearTimer(entry);
    if (entry.phase === 'waiting' && !entry.wanted) entry.phase = 'idle';
    touch(entry);
    if (entry.phase === 'idle') runThens(entry);
    sweep(entry);
    notify();
    schedulePump(0);
  },

  /** `onShow` from the native modal. */
  notifyShown(id: string): void {
    const entry = entries.get(id);
    if (!entry || entry.phase !== 'presenting') return;
    clearTimer(entry);
    entry.phase = 'shown';
    breadcrumb('shown', entry, {
      present_ms: now() - entry.presentStartedAt,
    });
    touch(entry);
    notify();
    pump();
  },

  /** The owner's exit animation finished (phase `exiting`). */
  notifyExited(id: string): void {
    const entry = entries.get(id);
    if (!entry || entry.phase !== 'exiting') return;
    clearTimer(entry);
    if (entry.wanted) {
      // Re-opened mid-exit: stay on screen; the owner replays its entrance.
      entry.phase = 'shown';
      touch(entry);
      notify();
      return;
    }
    beginDismiss(entry);
    notify();
  },

  /**
   * `onDismiss` from the native modal (iOS only). Returns false when the controller,
   * not the owner, hid the modal, so the owner's onDismiss is not called.
   */
  notifyDismissed(id: string): boolean {
    const entry = entries.get(id);
    if (!entry) return true;
    const ownerInitiated = !entry.forcedDismiss;
    if (entry.phase === 'dismissing') finishDismiss(id);
    return ownerInitiated;
  },

  /** Focus of the navigation screen hosting the modal (see `ready`). */
  setFocused(id: string, focused: boolean): void {
    const entry = entries.get(id);
    if (!entry || entry.focused === !!focused) return;
    entry.focused = !!focused;
    if (focused) requeueFailed();
    schedulePump(0);
  },

  // -- App signals -----------------------------------------------------------

  /**
   * A native modal screen's host went away (`onlyUnbound: false`, with the ids it
   * rendered), or its route is no longer on top (`onlyUnbound: true`). The modals the
   * screen rendered (on screen, still queued or failed to present) close with it; the
   * ones it never rendered (e.g. opened in the same tick as the screen's `goBack`,
   * before the navigation signal caught up) fall back to the app's host and present
   * once the route is gone, instead of waiting for a host that no longer exists.
   * Called by `ModalHost` and `markNavigationChange`.
   */
  releaseScope(
    scope: string | null | undefined,
    {
      onlyUnbound = false,
      rendered = [],
    }: { onlyUnbound?: boolean; rendered?: readonly string[] } = {}
  ): void {
    if (!scope) return;
    let changed = false;
    values().forEach(entry => {
      if (entry.hostScope !== scope || !entry.wanted || entry.instance) return;
      if (onlyUnbound) {
        // Still rendered by the screen's host (the route only got covered): leave it.
        if (entry.binding) return;
      } else if (
        rendered.includes(entry.id) ||
        entry.binding ||
        entry.failed ||
        onScreen(entry)
      ) {
        modalController.close(entry.id, { reason: 'host_unmounted' });
        return;
      }
      entry.hostScope = null;
      breadcrumb('scope_released', entry, { scope });
      touch(entry);
      changed = true;
    });
    if (changed) {
      notify();
      schedulePump(0);
    }
  },

  /**
   * Navigation state changed: hold root presents until the transition settles. Only a
   * change of focused route (`routeKey`) or of native modal route counts, so setParams
   * churn can't starve presents. `nativeModalRoute` is the name of the native modal
   * route on top, if any. Usually called through `syncModalNavigation`.
   */
  markNavigationChange({
    routeName,
    routeKey,
    nativeModalRoute,
    nativeModalRouteActive,
  }: NavigationChange = {}): void {
    const previousModalRoute = signals.nativeModalRoute;
    const modalRoute = nativeModalRoute || null;
    const modalRouteActive = !!modalRoute || !!nativeModalRouteActive;
    const moved =
      routeKey === undefined ||
      routeKey !== lastRouteKey ||
      modalRouteActive !== signals.nativeModalRouteActive ||
      modalRoute !== signals.nativeModalRoute;
    lastRouteKey = routeKey;
    signals = {
      ...signals,
      routeName: routeName === undefined ? signals.routeName : routeName,
      nativeModalRouteActive: modalRouteActive,
      nativeModalRoute: modalRoute,
    };
    if (previousModalRoute && previousModalRoute !== modalRoute) {
      // Anything scoped to the route that left but not rendered by its host goes back
      // to the app's host (the host itself releases what it rendered when it unmounts).
      modalController.releaseScope(screenParentKey(previousModalRoute), {
        onlyUnbound: true,
      });
    }
    if (!moved) {
      schedulePump(0);
      return;
    }
    navBusyUntil = now() + TIMINGS.navigationSettleMs;
    requeueFailed();
    notify();
    schedulePump(TIMINGS.navigationSettleMs);
  },

  /**
   * A native-stack screen started (`transitionStart`) or finished (`transitionEnd`)
   * its transition. Root presents wait for the end: the settle window after a route
   * change is shorter than a push onto a heavy screen, and a modal presented while
   * UIKit is still pushing may never report onShow / onDismiss. Usually fed by
   * `modalScreenListeners`.
   */
  markScreenTransition(
    routeKey: string | null | undefined,
    running: boolean
  ): void {
    if (!routeKey) return;
    if (running) {
      screenTransitions.set(routeKey, now());
      return;
    }
    if (screenTransitions.delete(routeKey)) schedulePump(0);
  },

  /** `appReady`, `appActive`, `routeName`… */
  setSignals(patch: Partial<ModalSignals>): void {
    const wasActive = signals.appActive;
    signals = { ...signals, ...patch };
    if (!wasActive && signals.appActive) {
      // Back in the foreground: transitions iOS held while the app was away resume
      // now, so their watchdogs get a full window again.
      values().forEach(armWatchdog);
    }
    schedulePump(0);
  },

  getSignals(): Readonly<ModalSignals> {
    return signals;
  },

  /**
   * The server override (snake_case), e.g. from a remote config. `enabled: false` is
   * the kill switch; `modals[id]` overrides one prompt's policy.
   */
  setPolicy(policy: ServerModalPolicy | null | undefined): void {
    serverPolicy = policy && typeof policy === 'object' ? policy : null;
    schedulePump(0);
  },

  /**
   * Kill switch: when false the controller stops serialising and gating, and every
   * open/close is honoured at once (plain React Native behaviour).
   */
  isEnabled(): boolean {
    return !passThrough();
  },

  setReporter(next: Partial<ModalReporter> | null | undefined): void {
    reporter = { ...defaultReporter, ...(next || {}) };
  },

  // -- Sequencing helpers for code outside modals -----------------------------

  /**
   * Runs `fn` once no modal is on screen or transitioning and navigation has settled.
   * Use before navigating to a native modal route or presenting system UI from
   * automatic code. Returns a cancel function.
   */
  whenIdle(fn: () => void): () => void {
    return addWaiter('idle', fn);
  },

  /**
   * Runs `fn` once no modal transition or navigation transition is in flight (a modal
   * may still be on screen). Use for navigation or Alerts right after closing a modal.
   * Returns a cancel function.
   */
  afterTransitions(fn: () => void): () => void {
    return addWaiter('transitions', fn);
  },

  // -- Reads ------------------------------------------------------------------

  /** Map of id → frozen view; a view's identity changes only when its entry does. */
  getSnapshot(): ReadonlyMap<string, ModalView> {
    return views;
  },

  getView(id: string | null | undefined): ModalView {
    return (id && views.get(id)) || IDLE_VIEW;
  },

  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },

  /** Every open/close/present/dismiss/hold as `{ at, type, id, ...data }`. */
  subscribeEvents(listener: EventListener): () => void {
    eventListeners.add(listener);
    return () => {
      eventListeners.delete(listener);
    };
  },

  getRecentEvents(): ModalEvent[] {
    return events.slice();
  },

  /** Debug view of the current state. */
  inspect(): InspectResult {
    return {
      signals: {
        ...signals,
        navigationBusy: navigationBusy(),
        enabled: !passThrough(),
      },
      entries: values().map(entry => ({
        id: entry.id,
        phase: entry.phase,
        wanted: entry.wanted,
        bound: bound(entry),
        parent: parentKeyOf(entry),
        auto: isAuto(entry),
        priority: priorityOf(entry),
        focused: entry.focused,
      })),
      waiters: waiters.length,
    };
  },

  /**
   * Test-only: drops every entry, timer, listener, signal, the server policy and
   * the reporter. Configured policies, timings and the focus hook are kept (they
   * are app configuration, not state); configured signals are re-applied.
   */
  __reset(): void {
    values().forEach(clearTimer);
    if (pumpTimer) clearTimeout(pumpTimer);
    pumpTimer = null;
    pumpTimerAt = 0;
    sequence = 0;
    entries = new Map();
    views = new Map();
    dirty = false;
    signals = { ...initialSignals(), ...configuredSignals };
    navBusyUntil = 0;
    screenTransitions = new Map();
    lastRouteKey = undefined;
    serverPolicy = null;
    reporter = defaultReporter;
    listeners = new Set();
    eventListeners = new Set();
    events = [];
    waiters = [];
    pumping = false;
    repump = false;
  },
};

export type ModalController = typeof modalController;

export default modalController;
