// modalStore.ts
import { create } from 'zustand'

type ActiveModal = {
  id: string
  priority: number
  openedAt: number
}

type ModalState = {
  activeQueue: ActiveModal[]

  show: (id: string, priority: number) => void
  hide: (id: string) => void
}

export const useModalStore = create<ModalState>((set, get) => ({
  activeQueue: [],

  show: (id, priority) =>
    set(state => {
      // already active → no change
      if (state.activeQueue.some(m => m.id === id)) {
        return state
      }

      const next = [
        ...state.activeQueue,
        {
          id,
          priority,
          openedAt: Date.now(),
        },
      ]

      // priority DESC → FIFO within same priority
      next.sort((a, b) => {
        if (b.priority !== a.priority) {
          return b.priority - a.priority
        }
        return a.openedAt - b.openedAt
      })

      return { activeQueue: next }
    }),

  hide: id =>
    set(state => ({
      activeQueue: state.activeQueue.filter(m => m.id !== id),
    })),
}))
