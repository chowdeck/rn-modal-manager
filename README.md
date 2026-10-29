# rn-modal-manager

One controller owns every modal in a React Native app and schedules the native
presentations, so iOS never drops one.

```sh
npm install rn-modal-manager
```

Peer dependencies: `react >= 18` (the store is read through `useSyncExternalStore`)
and `react-native >= 0.69`. There are no runtime dependencies. React Navigation is
optional (see [Navigation](#navigation)).

## Why it exists

On iOS a React Native `<Modal>` is a `UIViewController` presented from the nearest
view controller. UIKit **silently drops** a presentation that starts while:

- another modal is still presenting or dismissing,
- a navigation transition is running, or
- the presenting controller is already presenting a sibling.

JS still believes the modal is up. What the user sees is an invisible overlay that
swallows every touch: the **frozen screen**.

v1 of this package (a priority queue in zustand) made this worse. It flipped
`visible` in a single render whenever the queue changed:

- A dismiss and the next present started in the same commit, so the second one was
  dropped.
- Priority preemption hid the current modal in that same commit too.
- "Stackable" modals were root-level siblings, which iOS can't present together.
- The default `name` was computed once at module scope, so every unnamed modal
  shared one id.

v2 makes those overlaps impossible. It schedules **native transitions**, not
`visible` flags:

1. One native transition at a time, app-wide. A present or dismiss only starts once
   the previous one finished: `onShow` / `onDismiss` on iOS, a settle timer on
   Android (which has no `onDismiss`).
2. One root-level modal on screen at a time. A modal rendered *inside* another one
   presents from that modal's controller, which UIKit supports, so it may show
   once its parent is shown. Root-level siblings queue, and a modal on screen is
   never interrupted for another one.
3. Root-level presents wait for navigation transitions (until the native-stack
   screen reports `transitionEnd`) and for native modal routes.
4. Automatic prompts also wait for the app to be ready, an active app, route rules, a delay
   and their priority turn. The server can change all of this.
5. Watchdogs report (and recover from) presents that never complete, dismissals
   that never report back, and modals stuck behind another one. A regression then
   shows up in your error reporter instead of as a frozen screen. They stand down
   while the app is inactive, because iOS holds modal transitions until it is
   active again.

## Vocabulary

| Term | Meaning |
| --- | --- |
| **entry** | The controller's record for one modal, keyed by id: `{ id, wanted, phase, params }`. |
| **handle** | What a component holds: `{ id, isOpen, isShown, phase, params, open(), close(), replaceWith() }`, from `useModal(id)` or `useModalInstance(baseId)`. |
| **instance** | A screen-local modal. `useModalInstance('delete_address')` gives it an id (`delete_address#12`) for the component's lifetime. |
| **registry modal** | A modal with a fixed id that `ModalHost` renders: automatic prompts and named stack modals. |
| **automatic prompt** | A registry id with a policy (`configure({ policies })`). It opens without a tap. |
| **phase** | `idle → waiting → presenting → shown → (exiting →) dismissing → idle`. `isShown` means `shown` or `exiting`. |

A component never holds a `visible` boolean for a modal. It binds a `<Modal>` to an
entry (`<Modal modal={handle}>`), and the controller decides when the native modal
is presented.

## Setup

Do this once, at startup, before anything renders:

```tsx
// modals.ts
import { useContext } from 'react';
import { NavigationContext } from '@react-navigation/native';
import { MODAL_PRIORITY, modalController } from 'rn-modal-manager';

modalController.configure({
  // Ids listed here are automatic prompts (see "Automatic prompts").
  policies: {
    force_update: { priority: MODAL_PRIORITY.blocking },
    select_address: { priority: MODAL_PRIORITY.required },
    order_rating: { priority: MODAL_PRIORITY.feedback, blockedRoutes: [/Checkout/] },
    in_app_message: { priority: MODAL_PRIORITY.marketing, delayMs: 1200 },
  },
  // Optional: an app with a splash or launch gate holds prompts until it is over
  // (see "App readiness"). Without this, prompts may present right away.
  signals: { appReady: false },
  // Optional: hold modals of unfocused screens (see "Navigation").
  useScreenFocus: () => useContext(NavigationContext),
  // Optional: where breadcrumbs and watchdog issues go. No Sentry dependency.
  reporter: {
    breadcrumb: (message, data) =>
      Sentry.addBreadcrumb({ category: 'modal', message, data }),
    issue: (type, data) =>
      Sentry.captureMessage(`modal.${type}`, { level: 'warning', extra: data }),
  },
});
```

```tsx
// App.tsx
import { AppState } from 'react-native';
import {
  ModalHost,
  modalController,
  modalScreenListeners,
  syncModalNavigation,
} from 'rn-modal-manager';
import { modalRegistry } from './modalRegistry';

const NATIVE_MODAL_ROUTES = new Set(['UpgradePlan', 'OrderIssue']);
const syncNavigation = () =>
  syncModalNavigation(navigationRef, { nativeModalRoutes: NATIVE_MODAL_ROUTES });

export function App() {
  useEffect(() => {
    // Automatic prompts wait for both signals; the watchdogs pause while the app
    // is not active ('inactive' too: iOS reports it while a system prompt is up).
    modalController.setSignals({ appReady: true }); // when your splash is gone
    const sub = AppState.addEventListener('change', state =>
      modalController.setSignals({ appActive: state === 'active' })
    );
    return () => sub.remove();
  }, []);

  return (
    <NavigationContainer ref={navigationRef} onReady={syncNavigation} onStateChange={syncNavigation}>
      {/* And screenListeners={modalScreenListeners} on every native-stack navigator. */}
      <RootStack />
      <ModalHost registry={modalRegistry} />
    </NavigationContainer>
  );
}
```

### App readiness

`appReady` says whether automatic prompts may present yet. It **starts `true`**, so
an app with no launch gate needs nothing.

An app with a splash, onboarding or login gate sets it `false` in `configure` (at
startup, before any prompt can open) and `true` when the gate is over. Prompts
opened meanwhile wait; user-opened modals don't. A policy with
`waitForAppReady: false` (a forced update, say) presents through the gate.

Set it in `configure`, not only with `setSignals`: configured signals survive
`__reset()` and `testing.reset()`, and a `setSignals({ appReady: false })` from an
effect runs after the first commit, so a prompt opened in that commit could
present over the splash.

## The three ways to use a modal

### 1. A sheet or popup that belongs to a screen: `useModalInstance`

```tsx
import { Modal, useModalInstance, type ModalHandle } from 'rn-modal-manager';

function AddressesScreen() {
  const deleteSheet = useModalInstance<{ addressId: string }>('delete_address');
  return (
    <>
      <Button title="Delete" onPress={() => deleteSheet.open({ addressId })} />
      <DeleteAddress modal={deleteSheet} />
    </>
  );
}

function DeleteAddress({ modal }: { modal: ModalHandle<{ addressId: string }> }) {
  const { addressId } = modal.params || {};
  return (
    <Modal modal={modal} transparent animationType="slide" onRequestClose={() => modal.close()}>
      <Button
        title="Confirm"
        onPress={() =>
          remove(addressId).then(() =>
            modal.close({ then: () => navigation.navigate('Home') })
          )
        }
      />
    </Modal>
  );
}
```

- The **parent** creates the handle and passes it down. The **modal component**
  binds a `<Modal>` (or your own sheet built on it) to it.
- `useState(false)` + `setOpen(true/false)` becomes `x.open(params)` /
  `x.close()`. A condition on `open` reads `x.isOpen`.
- Data the modal needs goes in `open(params)` and is read from `modal.params`.
- **Close, then navigate**: `modal.close({ then })`. `then` runs once the modal is
  fully off screen. Never navigate in the same tick as a close.
- **One modal into another**: `modal.replaceWith('wallet_topup', params)`. The
  second presents after the first is dismissed.
- The instance closes and is removed when the component unmounts.

### 2. An automatic prompt: registry + policy

A prompt opens without a tap: from a hook, a saga, a push handler or a query
callback.

```ts
modalController.open('order_rating', { order }, { source: 'orders_fetch' });
modalController.close('order_rating', { reason: 'rated' });
```

The id needs a **policy** (in `configure({ policies })`) and a **registry entry**
(the component `ModalHost` renders):

```tsx
// modalRegistry.ts
import type { ModalComponentProps, ModalRegistry } from 'rn-modal-manager';

function OrderRating({ modal, params }: ModalComponentProps<{ order: Order }>) {
  // Renders its own sheet, bound to the handle it receives.
  return (
    <Modal modal={modal} transparent onRequestClose={() => modal.close()}>
      <RatingForm order={params?.order} onDone={() => modal.close()} />
    </Modal>
  );
}

export const modalRegistry: ModalRegistry = {
  order_rating: { component: OrderRating },
  // Lazy: required on first render, keeps module graphs out of app start.
  select_address: { load: () => require('./SelectAddressModal').default },
};
```

Policy fields (all optional except `priority`):

| Field | Default | Meaning |
| --- | --- | --- |
| `priority` | — | Orders prompts among themselves: higher presents first. It never puts a prompt ahead of a modal the user opened (see below). Give each prompt a distinct priority: a tie presents in arrival order and is reported as `priority_tie`. |
| `delayMs` | `0` | Hold the prompt this long after it is opened. |
| `waitForAppReady` | `true` | Hold while the `appReady` signal is `false` (see [App readiness](#app-readiness)). |
| `allowedRoutes` | none | Only present on these routes. |
| `blockedRoutes` | none | Never present on these routes. |

Route patterns are exact route names, `RegExp`s, or regex source wrapped in
slashes (`"/Checkout/"`, as a server would send it).

**The user goes first.** Prompts always wait for modals the user opened:

- A prompt opened while the user has a modal on screen waits until that modal is
  fully dismissed. This holds even for `force_update`.
- When the screen frees up and a modal the user opened is waiting alongside
  prompts, it presents first, whatever the prompts' priorities.
- Modals the user opened go in the order they were opened. Prompts go by
  priority.

The code that decides "should this show now" only calls `open` / `close`. It does
**not** check whether other modals are visible: the controller gates on app readiness,
app state, route and priority.

### 3. Named stack modals: registry + `preset`

```ts
modalController.open('BankPickerModal', { onBankSelect });
```

```tsx
function BankPicker({ modal, params }: ModalComponentProps<{ onBankSelect: (b: Bank) => void }>) {
  return <BankList onSelect={bank => { params?.onBankSelect(bank); modal.close(); }} />;
}

export const modalRegistry: ModalRegistry = {
  BankPickerModal: { component: BankPicker, preset: 'bottom' },
};
```

With a `preset`, the component only provides content and `ModalHost` supplies the
shell (backdrop, animation, back button):

- `bottom`: anchored to the bottom, slides up.
- `screen`: full-screen takeover, slides up.
- `center`: centred card, fades and scales up.

Stack modals nest in the order they were opened, so one opened from another
presents on top of it. Closing the lower one does not close the upper one:
`replaceWith` between them works. The backdrop and back button close the top one
only. The component receives `{ modal, params }`; `modal.close()` and
`modal.closeModal()` both close it.

#### Shell motion

```tsx
<ModalHost
  registry={modalRegistry}
  motion={{ sheetInMs: 300, exitMs: 200, backdropOpacity: 0.5, easing: Easing.out(Easing.cubic) }}
/>
```

| `motion` field | Default |
| --- | --- |
| `sheetInMs` (`bottom`, `screen` entrance) | `340` |
| `centerInMs` (`center` entrance) | `280` |
| `exitMs` (every preset's exit, and the shell's `exitMs`) | `220` |
| `reducedMs` (entrance and exit with reduce motion on, fade only) | `180` |
| `easing` | cubic-bezier(0.23, 1, 0.32, 1) |
| `centerScaleFrom` | `0.95` |
| `backdropOpacity` / `backdropColor` | `0.6` / `'black'` |

Reduce motion follows the OS setting through `AccessibilityInfo`. Pass
`reduceMotion` to override it.

## `Modal`

`Modal` is a drop-in for React Native's `Modal`. It takes the same props, except
`visible`:

| Prop | Meaning |
| --- | --- |
| `modal` | The handle (`useModal` / `useModalInstance`) or an id. |
| `exitMs` | The owner plays its own exit animation for this long before the native dismiss (phase `exiting`), and calls `modalController.notifyExited(id)` when it's done. The controller forces the dismiss after `exitMs + 400 ms` if it never does. |
| `keepIntentOnUnmount` | For hosts only: unmounting this `Modal` doesn't close the modal, because it is only moving in the tree. |
| `onShow` | Fires when the modal is actually on screen. |
| `onDismiss` | Fires only when the owner closed it, not when the controller hid it (a retry, or a parent leaving). |

A `Modal` rendered inside another one (or inside a native modal screen) is
**nested**: it presents from its parent's controller once the parent is shown. A
parent never leaves before its children: they are dismissed first.

To build your own sheet component, take a `modal` prop and render `Modal` with it.
If the sheet animates out in JS, pass `exitMs`, run the exit animation while
`modal.phase === 'exiting'`, and call `modalController.notifyExited(modal.id)` when
it finishes.

## Navigation

React Navigation is not a dependency. The helpers only rely on the shape of a
navigation container ref.

- **`syncModalNavigation(navigationRef, { nativeModalRoutes })`**: call it from
  `NavigationContainer`'s `onReady` and `onStateChange`. It reports `routeName`,
  `routeKey` and `nativeModalRoute` (the name of the native modal route on top of
  the root stack, or null). Root presents wait out each route change, and route
  rules match `routeName`. `nativeModalRoutes` is a `Set`, an array or a
  predicate. `readNavigationState` returns the same data without sending it.
- **`modalScreenListeners`**: pass it as `screenListeners` on every native-stack
  navigator. Root presents then wait for a screen's native push or pop to report
  `transitionEnd` (at most `screenTransitionMaxMs`, 1.5 s), not only for the fixed
  settle window after a route change. A modal presented while UIKit is still
  pushing a heavy screen may never report `onShow`. The listeners feed
  `modalController.markScreenTransition(routeKey, running)`.

  ```tsx
  <Stack.Navigator screenListeners={modalScreenListeners}>
  ```
- **Screen focus**: `configure({ useScreenFocus: () => useContext(NavigationContext) })`.
  A `Modal` on a screen that isn't focused waits until the screen is focused,
  because iOS can't present from a view that isn't in the window. Any hook that
  returns `{ isFocused(), addListener('focus' | 'blur', cb) }` works. Without one,
  every `Modal` counts as focused.

### Native modal routes (`presentation: 'modal' | 'transparentModal'`)

A root-level modal cannot present over a native-stack modal screen. Give that
group the layout, and list its routes in `nativeModalRoutes`:

```tsx
import { createNativeModalScreenLayout } from 'rn-modal-manager';

const NativeModalLayout = createNativeModalScreenLayout(modalRegistry);

<Stack.Group
  screenLayout={NativeModalLayout}
  screenOptions={{ presentation: 'transparentModal' }}
>
  <Stack.Screen name="UpgradePlan" component={UpgradePlan} />
</Stack.Group>
```

Then:

- `Modal`s rendered by those screens nest inside the screen.
- Registry modals that the **user** opens while one of those routes is on top get a
  `hostScope`. The screen's own host renders them, so they present inside the
  screen.
- When the screen closes, every modal its host rendered closes with it: on screen,
  still queued, or failed to present.
- A scoped modal the screen's host never rendered (for example, opened in the same
  tick as the screen's `goBack()`) moves to the app's host and presents once the
  route is gone (`modalController.releaseScope`).
- **Automatic prompts and `useModalInstance` modals are never scoped.** Prompts
  wait until the screen closes; instances render where their owner lives.
- A modal still leaving the host that renders it stays with that host.

`NativeModalScreenWithHost` (a component taking `registry` and `route`) and
`NativeModalScreenLayout` (nesting only, no host) are also exported.

## Server policy and the kill switch

```ts
modalController.setPolicy(remoteConfig.modal_policy);
```

```jsonc
{
  "enabled": true,              // false = kill switch
  "modals": {
    "in_app_message": { "enabled": false },
    "survey_custom": { "priority": 15, "delay_ms": 5000, "blocked_routes": ["/Checkout/", "TrackOrder"] }
  }
}
```

- Each entry under `modals` overrides one prompt's `enabled`, `priority`,
  `delay_ms`, `wait_for_app_ready`, `allowed_routes` or `blocked_routes`. An empty
  route list lifts the shipped restriction. The customer app's older
  `wait_for_splash` key is still read; `wait_for_app_ready` wins when both are
  set.
- **`enabled: false` at the top level is the kill switch.** The controller stops
  serialising and gating, and honours every open and close at once, like plain
  React Native. The present watchdog is off. `modalController.isEnabled()`
  reports it.

Apply the policy before the first `Modal` mounts (during render rather than in an
effect, or from persisted config at startup), so the kill switch covers the first
commit.

`resolveModalPolicy(id, serverPolicy, policies)` and `matchesRoute(patterns,
routeName)` are exported for code that needs the same answers.

## Sequencing around modals

- `modal.close({ then })` / `modalController.close(id, { then })`: `then` runs once
  the modal is off screen. A reopen cancels the close, and its `then` is dropped.
- `modalController.afterTransitions(fn)`: runs `fn` once no modal or navigation
  transition is in flight (a modal may still be up). Use it for `Alert`s and for
  navigation right after a close.
- `modalController.whenIdle(fn)`: runs `fn` once no modal is on screen or in
  transition and navigation has settled. Use it before navigating to a native modal
  route, or before presenting system UI from automatic code.
- `modalController.closeAll({ except, reason })`: for logout or a navigation reset.

`whenIdle` and `afterTransitions` return a cancel function.

## Reading state

```ts
const rating = useModal('order_rating'); // any id: registry or instance
rating.isOpen; rating.isShown; rating.phase; rating.params;

modalController.isOpen('pay_online'); // outside React
modalController.getView(id);          // synchronous, frozen view
```

## Debugging

- `modalController.inspect()`: every entry with its phase, parent, priority and
  focus, plus the signals.
- `modalController.subscribeEvents(fn)` / `getRecentEvents()` (the last 100) return
  these events: `open`, `close`, `present`, `shown`, `exit`, `dismiss`, `closed`,
  `contention`, `thens_dropped`, `bind_unregistered`, and the reported issues.
- The reporter gets the events as breadcrumbs. It also gets the watchdog issues,
  each with a flat summary of the queue as `data.queue` (`ModalQueueSummary`): the
  signals, every entry that isn't idle as `id:phase[:wanted][:unbound][:unfocused][:in:<parent>]`,
  and a count of idle ones. It is flat so error reporters don't truncate it.
  `data.queue.signals.appActive` separates a transition iOS held while the app was
  away from one that really never reported back.
  - `present_timeout` / `present_failed`: iOS dropped a presentation. It is retried
    once, then released, then re-queued on the next navigation or focus change.
  - `dismiss_timeout`: `onDismiss` never came.

  Neither of those fires while the app is inactive. Their timers restart when it
  is active again.
  - `user_modal_blocked`: a modal the user opened is stuck behind another one.
    Close the first before opening the next, or nest the second inside it.
  - `prompt_starved`: a prompt is stuck with nothing on screen in its way:
    navigation that never settles, a host that never renders it, or a transition
    that never ends. A prompt held by its own policy (route, app readiness, delay,
    background) or queued behind a modal on screen or a native modal route is
    waiting its turn, not starved. Its stall clock starts when that hold ends.
    Issues carry `waited_ms` (since the hold ended) and `queued_ms` (since it was
    opened).
  - `priority_tie`: two prompts share a priority.
  - `then_error` / `waiter_error`: a callback threw.

Tune the watchdogs with `configure({ timings })` if you need to: see
`ModalTimings`.

## Testing (Jest)

Most app tests don't care about presentation order. Put the controller in
pass-through mode, the same as the kill switch, so every open and close is honoured
at once:

```js
// jest.setup.js
import { testing } from 'rn-modal-manager';

beforeEach(() => testing.reset({ passThrough: true }));
```

- `testing.reset({ passThrough, appReady })` calls `modalController.__reset()`.
  That clears every entry, timer, listener and signal, plus the server policy and
  the reporter. Configured policies, signals, timings and the focus hook are kept.
  Then it applies `appReady` if given, and pass-through mode.
- `testing.enablePassThrough()` is the same as `modalController.setPolicy({ enabled: false })`.
- `testing.completeTransitions()` finishes every transition in flight, as if the
  platform had called `onShow` / `onDismiss`. Useful with the controller enabled.

To test sequencing itself, keep the controller enabled, use `jest.useFakeTimers()`,
and fire `onShow` / `onDismiss` on the rendered React Native `Modal`. A close on
iOS waits for `onDismiss` (or a 1.5 s watchdog), so tests on real timers would
leave timers pending.

## Migrating from v1

v1's `AppModal`, `useModalStore` and the zustand dependency are gone.

| v1 | v2 |
| --- | --- |
| `const [show, setShow] = useState(false)` | `const sheet = useModalInstance('name')` |
| `<AppModal name="x" visible={show} priority={5}>` | `<Modal modal={sheet}>` |
| `setShow(true)` / `setShow(false)` | `sheet.open(params)` / `sheet.close()` |
| `onRequestClose={() => setShow(false)}` | `onRequestClose={() => sheet.close()}` |
| `useModalStore.getState().show(id, priority)` | `modalController.open(id, params)`, with a policy for `id` if it is an automatic prompt |
| `useModalStore.getState().hide(id)` | `modalController.close(id)` |
| `useModalStore(s => s.activeQueue)` | `useModalViews()` / `modalController.inspect()` |
| `priority` prop | A policy priority in `configure({ policies })`. It only applies to automatic prompts: user-opened modals present in the order they were opened. |
| `stackable` | Render the second `Modal` inside the first one (nested), or use preset registry modals. |
| `unmountOnHide` | Not needed. Children render while the modal is open or on its way off screen (`view.mounted`). |
| `name` | The `modal` id, or the base id of `useModalInstance`. Ids are always unique. |

Two behaviour changes to expect:

- **A modal no longer shows the moment you set state.** It waits for the previous
  modal to finish dismissing (a few hundred ms on iOS). That wait is what
  prevents the freeze.
- **Two root-level modals no longer stack.** The second one waits. If it must
  appear over the first, render it inside the first.

## API summary

| Export | Kind |
| --- | --- |
| `modalController` | The store and scheduler: `configure`, `open`, `close`, `replace`, `closeAll`, `isOpen`, `createInstance`, `remove`, `setSignals`, `markNavigationChange`, `markScreenTransition`, `releaseScope`, `setPolicy`, `isEnabled`, `setReporter`, `whenIdle`, `afterTransitions`, `getView`, `getSnapshot`, `subscribe`, `subscribeEvents`, `getRecentEvents`, `inspect`, `resolvePolicy`, `__reset` |
| `useModal`, `useModalInstance`, `useModalView`, `useModalViews`, `modalIdOf` | Hooks and helpers |
| `Modal`, `ModalParentContext`, `NativeModalScreenLayout`, `modalScreenListeners` | Native modal binding |
| `ModalHost`, `DEFAULT_MODAL_MOTION` | Registry renderer |
| `syncModalNavigation`, `readNavigationState`, `NativeModalScreenWithHost`, `createNativeModalScreenLayout`, `screenParentKey` | Navigation |
| `resolveModalPolicy`, `matchesRoute`, `MODAL_PRIORITY` | Policies |
| `useReduceMotion` | OS reduce-motion setting |
| `testing` | Jest helpers |
| `TIMINGS`, `PHASES` | Constants |

Types: `ModalHandle`, `ModalView`, `ModalPhase`, `ModalPolicy`, `ModalPolicies`,
`ServerModalPolicy`, `ServerModalPolicyOverride`, `ResolvedModalPolicy`,
`ModalRegistry`, `ModalRegistryEntry`, `ModalComponentProps`, `ModalPreset`,
`ModalMotion`, `ModalProps`, `ModalHostProps`, `ModalControllerConfig`,
`ModalReporter`, `ModalQueueSummary`, `ModalSignals`, `ModalTimings`, `UseScreenFocus` and more.

## Installing from a GitHub Release tarball

```sh
# Replace vX.Y.Z with the release tag you want
npm install https://github.com/chowdeck/rn-modal-manager/releases/download/vX.Y.Z/rn-modal-manager-X.Y.Z.tgz
```

## Development

```sh
npm install
npm test            # Jest
npm run lint        # ESLint
npm run typecheck   # tsc --noEmit, strict, tests included
npm run format:check
npm run build       # tsc -p tsconfig.build.json → dist/
```
