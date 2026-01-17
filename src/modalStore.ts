// modalStore.ts
import { create } from 'zustand';
import { ActiveModal } from './types';

type ModalState = {
  activeQueue: ActiveModal[];

  show: (id: string, priority: number, stackable: boolean) => void;
  hide: (id: string) => void;

  getVisibleModals: () => ActiveModal[];
};

export const useModalStore = create<ModalState>((set, get) => ({
  activeQueue: [],

  show: (id, priority, stackable) =>
    set(state => {
      // already active → no change
      if (state.activeQueue.some(m => m.id === id)) {
        return state;
      }

      const next = [
        ...state.activeQueue,
        {
          id,
          priority,
          openedAt: Date.now(),
          stackable,
        },
      ];

      // priority DESC → FIFO within same priority
      next.sort((a, b) => {
        if (b.priority !== a.priority) {
          return b.priority - a.priority;
        }
        return a.openedAt - b.openedAt;
      });

      return { activeQueue: next };
    }),

  hide: id =>
    set(state => ({
      activeQueue: state.activeQueue.filter(m => m.id !== id),
    })),

  getVisibleModals: () => {
    const state = get();
    const queue = state.activeQueue;

    if (queue.length === 0) return [];

    // First modal is always visible
    const visible: ActiveModal[] = [queue[0]];

    // If first modal is not stackable, only it is visible
    if (!queue[0].stackable) return visible;

    // If first modal is stackable, continue checking subsequent modals
    for (let i = 1; i < queue.length; i++) {
      // Skip a non-stackable modal and add next stackable ones
      if (!queue[i].stackable) continue;
      visible.push(queue[i]);
    }

    return visible;
  },
}));
