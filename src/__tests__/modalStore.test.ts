import { useModalStore } from '../modalStore';

// Reset store before each test for isolation
beforeEach(() => {
  useModalStore.setState({ activeQueue: [] });
});

describe('modalStore', () => {
  describe('Initial State', () => {
    test('activeQueue starts as empty array', () => {
      const state = useModalStore.getState();
      expect(state.activeQueue).toEqual([]);
    });
  });

  describe('show action', () => {
    test('adds modal to the queue', () => {
      const { show } = useModalStore.getState();

      show('modal-1', 0, false);

      const state = useModalStore.getState();
      expect(state.activeQueue).toHaveLength(1);
      expect(state.activeQueue[0]).toMatchObject({
        id: 'modal-1',
        priority: 0,
        stackable: false,
      });
      expect(state.activeQueue[0].openedAt).toBeDefined();
    });

    test('does not add duplicate modal with same id', () => {
      const { show } = useModalStore.getState();

      show('modal-1', 0, false);
      show('modal-1', 5, true); // Try to add again with different params

      const state = useModalStore.getState();
      expect(state.activeQueue).toHaveLength(1);
      expect(state.activeQueue[0].priority).toBe(0); // Original values preserved
    });

    test('sorts modals by priority DESC', () => {
      const { show } = useModalStore.getState();

      show('low-priority', 1, false);
      show('high-priority', 10, false);
      show('medium-priority', 5, false);

      const state = useModalStore.getState();
      expect(state.activeQueue.map(m => m.id)).toEqual([
        'high-priority',
        'medium-priority',
        'low-priority',
      ]);
    });

    test('sorts modals with same priority by FIFO (openedAt)', () => {
      const { show } = useModalStore.getState();

      // Mock Date.now to control openedAt values
      const originalDateNow = Date.now;
      let mockTime = 1000;
      Date.now = jest.fn(() => mockTime++);

      show('first', 5, false);
      show('second', 5, false);
      show('third', 5, false);

      Date.now = originalDateNow;

      const state = useModalStore.getState();
      expect(state.activeQueue.map(m => m.id)).toEqual([
        'first',
        'second',
        'third',
      ]);
    });

    test('combines priority and FIFO sorting correctly', () => {
      const { show } = useModalStore.getState();

      const originalDateNow = Date.now;
      let mockTime = 1000;
      Date.now = jest.fn(() => mockTime++);

      show('low-first', 1, false);
      show('high-first', 10, false);
      show('low-second', 1, false);
      show('high-second', 10, false);

      Date.now = originalDateNow;

      const state = useModalStore.getState();
      expect(state.activeQueue.map(m => m.id)).toEqual([
        'high-first',
        'high-second',
        'low-first',
        'low-second',
      ]);
    });
  });

  describe('hide action', () => {
    test('removes modal from the queue by id', () => {
      const { show, hide } = useModalStore.getState();

      show('modal-1', 0, false);
      show('modal-2', 0, false);

      hide('modal-1');

      const state = useModalStore.getState();
      expect(state.activeQueue).toHaveLength(1);
      expect(state.activeQueue[0].id).toBe('modal-2');
    });

    test('does nothing when hiding non-existent modal', () => {
      const { show, hide } = useModalStore.getState();

      show('modal-1', 0, false);

      hide('non-existent');

      const state = useModalStore.getState();
      expect(state.activeQueue).toHaveLength(1);
    });

    test('can hide all modals', () => {
      const { show, hide } = useModalStore.getState();

      show('modal-1', 0, false);
      show('modal-2', 0, false);

      hide('modal-1');
      hide('modal-2');

      const state = useModalStore.getState();
      expect(state.activeQueue).toHaveLength(0);
    });
  });

  describe('getVisibleModals', () => {
    test('returns empty array when queue is empty', () => {
      const { getVisibleModals } = useModalStore.getState();

      expect(getVisibleModals()).toEqual([]);
    });

    test('returns single modal when only one in queue', () => {
      const { show, getVisibleModals } = useModalStore.getState();

      show('only-modal', 0, false);

      const visible = getVisibleModals();
      expect(visible).toHaveLength(1);
      expect(visible[0].id).toBe('only-modal');
    });

    test('returns only first modal when it is non-stackable', () => {
      const { show, getVisibleModals } = useModalStore.getState();

      show('non-stackable', 10, false);
      show('blocked-modal', 5, true);

      const visible = getVisibleModals();
      expect(visible).toHaveLength(1);
      expect(visible[0].id).toBe('non-stackable');
    });

    test('returns multiple modals when first is stackable', () => {
      const { show, getVisibleModals } = useModalStore.getState();

      show('stackable-1', 10, true);
      show('stackable-2', 5, true);

      const visible = getVisibleModals();
      expect(visible).toHaveLength(2);
      expect(visible.map(m => m.id)).toEqual(['stackable-1', 'stackable-2']);
    });

    test('skip non-stackable modal in sequence', () => {
      const { show, getVisibleModals } = useModalStore.getState();

      show('stackable-first', 10, true);
      show('non-stackable', 5, false);
      show('stackable-after', 1, true);

      // Non-stackable modal doesn't block the chain - only stackable modals are visible
      const visible = getVisibleModals();
      expect(visible).toHaveLength(2);
      expect(visible.map(m => m.id)).toEqual([
        'stackable-first',
        'stackable-after',
      ]);
    });

    test('handles mixed stackable sequence correctly', () => {
      const { show, getVisibleModals } = useModalStore.getState();

      show('s1', 10, true);
      show('s2', 9, true);
      show('s3', 8, true);
      show('us1', 7, false);
      show('s4', 6, true);

      // Only stackable modals are visible
      const visible = getVisibleModals();
      expect(visible.map(m => m.id)).toEqual(['s1', 's2', 's3', 's4']);
    });
  });
});
