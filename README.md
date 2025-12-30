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
1. Each mounted `<AppModal/>` registers itself in the global queue through `useModalStore`.
2. The queue is sorted by `priority` (descending) and then by `openedAt` to keep FIFO order when priorities tie.
3. Only the modal at the top of the queue is rendered with `visible=true`. All others are hidden.
4. When the modal unmounts or `visible` flips to `false`, it removes itself from the queue automatically.

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
