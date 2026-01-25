# rn-modal-manager

A tiny state-driven wrapper around the React Native `Modal` component that guarantees only one modal is visible at a time, based on priority. It is powered by a minimal [zustand](https://github.com/pmndrs/zustand) store so it stays framework-agnostic and side-effect free.

## Features
- Declarative `<AppModal/>` component that hooks into a centralized queue
- Priority-based scheduling to decide which modal should be visible
- Automatic cleanup when components unmount or lose visibility
- Opt-in `unmountOnHide` to skip rendering inactive modals for performance
- Store helpers that let you orchestrate modals from anywhere in your app logic

## Installation
```sh
# npm
npm install rn-modal-manager

# yarn
yarn add rn-modal-manager
```

This package lists `react` and `react-native` as peer dependencies, so make sure they are already installed in your project.

### Installing from GitHub Release tarball (recommended for git installs)
If you prefer to consume the built tarball (avoids bootstrapping devDependencies), install directly from a GitHub Release:

```sh
# Replace vX.Y.Z with the release tag you want
npm install https://github.com/chowdeck/rn-modal-manager/releases/download/vX.Y.Z/rn-modal-manager-X.Y.Z.tgz
```

### Compatibility
- Peer ranges: `react >=17 <19`, `react-native >=0.68`.
- React Native 0.68–0.70 typically uses React 17.x → ensure your app pins React 17.
- React Native 0.74 requires React 18.2.0 → pin `react@18.2.0` in your app.
- Newer RN versions should work within the open lower bound. If a breaking peer appears upstream, we’ll adjust ranges in a future release.

Note on git-based installs: If you must install directly from the repository source (not the Release tarball), consider omitting dev dependencies during install to avoid peer resolution issues:

```sh
# One-off
NPM_CONFIG_OMIT=dev npm install

# Or set in .npmrc of the consuming app
omit=dev
```

## Quick start
```tsx
import React from 'react'
import { View, Text, Button } from 'react-native'
import { AppModal } from 'rn-modal-manager'

export function ExampleScreen() {
  const [showA, setShowA] = React.useState(false)
  const [showB, setShowB] = React.useState(false)

  return (
    <View>
      <Button title="Open modal A" onPress={() => setShowA(true)} />
      <Button title="Open modal B" onPress={() => setShowB(true)} />

      <AppModal name="modal-a" visible={showA} priority={5} onRequestClose={() => setShowA(false)}>
        <Text>Modal A has higher priority and will win</Text>
      </AppModal>

      <AppModal name="modal-b" visible={showB} priority={1} onRequestClose={() => setShowB(false)}>
        <Text>Modal B only shows when A is hidden</Text>
      </AppModal>
    </View>
  )
}
```

## How it works

The modal manager operates through a centralized queue system powered by a Zustand store:

1. **Registration**: Each mounted `<AppModal/>` registers itself in a global queue through `useModalStore` when its `visible` prop becomes `true`.

2. **Priority-based ordering**: The queue is sorted by `priority` (descending order) and then by `openedAt` timestamp to maintain FIFO order when priorities tie.

3. **Single modal guarantee**: Only the modal at the top of the queue (highest priority, earliest if tied) is rendered with `visible=true`. All others remain hidden but mounted (unless `unmountOnHide=true`).

4. **Automatic cleanup**: When a modal's `visible` prop becomes `false` or the component unmounts, it automatically removes itself from the queue, allowing the next modal to become visible.

5. **Performance optimization**: With `unmountOnHide=true` (default), hidden modals are completely unmounted to save resources.

This design ensures predictable modal behavior without the complexity of manual state coordination between different parts of your app.

## How to use it

### Basic usage

1. **Wrap your modals with `AppModal`**: Replace React Native's `Modal` component with `AppModal` and add a `name` and `priority`.

```tsx
import { AppModal } from 'rn-modal-manager'

<AppModal 
  name="confirmation-dialog" 
  visible={isVisible} 
  priority={10}
  onRequestClose={() => setIsVisible(false)}
>
  <YourModalContent />
</AppModal>
```

2. **Set priorities wisely**: Higher numbers have precedence. Common priority patterns:
   - System alerts/errors: `100`
   - User confirmation dialogs: `50` 
   - Loading overlays: `30`
   - Regular modals: `10`
   - Background modals: `1`

### Advanced patterns

**Imperative control from business logic:**
```tsx
import { useModalStore } from 'rn-modal-manager'

// Show a modal programmatically
function triggerErrorModal() {
  const { show } = useModalStore.getState()
  show('error-modal', 100)
}

// Hide a specific modal
function closeModal(modalId: string) {
  const { hide } = useModalStore.getState()
  hide(modalId)
}
```

**Conditional modal chains:**
```tsx
function PaymentFlow() {
  const [step, setStep] = useState(1)
  
  return (
    <>
      <AppModal name="payment-form" visible={step === 1} priority={20}>
        <PaymentForm onNext={() => setStep(2)} />
      </AppModal>
      
      <AppModal name="payment-confirmation" visible={step === 2} priority={20}>
        <ConfirmationScreen onComplete={() => setStep(0)} />
      </AppModal>
    </>
  )
}
```

**Debug modal queue in development:**
```tsx
function ModalDebugger() {
  const queue = useModalStore(state => state.activeQueue)
  
  if (__DEV__) {
    console.log('Active modals:', queue.map(m => `${m.id} (priority: ${m.priority})`))
  }
  
  return null
}
```

## `AppModal` props
| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `name` | `string` | required | Stable identifier for the modal instance. Falls back to a random id when omitted, but giving it a name makes debugging easier. |
| `visible` | `boolean` | `false` | Whether the modal should try to enter the queue. |
| `priority` | `number` | `0` | Higher numbers show first. Two modals with the same priority resolve by mount order (FIFO). |
| `stackable` | `boolean` | `false` | Reserved for future nested-modal behavior. Currently unused but part of the public type. |
| `unmountOnHide` | `boolean` | `true` | If `true`, the component stops rendering its children when hidden. |
| `...ModalProps` | `ModalProps` | — | Any regular React Native `Modal` prop is forwarded. |

## Controlling modals from business logic
Because the queue lives in a zustand store, you can inspect or manipulate it without lifting state.

```tsx
import { useModalStore } from 'rn-modal-manager'

export function useModalQueueDebug() {
  return useModalStore(state => state.activeQueue)
}

export function closeModal(id: string) {
  const hide = useModalStore.getState().hide
  hide(id)
}
```

Common patterns:
- Trigger `show()` or `hide()` from async flows after API calls
- Log `activeQueue` in development to verify priority ordering
- Build custom UI (e.g., dev panel) that reads from the store to show current modals

## Type utilities
The library exports light-weight TypeScript helpers in case you want to extend the system:
- `AppModalProps` – prop contract for the component
- `ManagedModal`, `ModalEntry`, `ModalState` – useful for building bespoke modal registries atop the base store

## Development
```sh
npm install
npm test
```

This repository currently ships a minimal jest placeholder test. Feel free to replace it with your preferred testing setup.

## Troubleshooting
- **Multiple modals logging in dev:** The component logs when more than one modal competes for the queue, which is expected when different priorities overlap. Double-check priorities if the wrong modal wins.
- **Modals never show:** Ensure the `name` is unique per mounted modal and that `visible` actually toggles. The store ignores duplicates.
- **Portal requirements:** The component wraps React Native's built-in `Modal`, so platform requirements (status bar overlap, animation, etc.) follow the upstream API.
