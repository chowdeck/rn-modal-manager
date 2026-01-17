import * as React from 'react';
import { render, fireEvent, screen } from '@testing-library/react-native';
import { Text, View } from 'react-native';
import { AppModal } from '../AppModal';
import { useModalStore } from '../modalStore';

// Reset store before each test for isolation
beforeEach(() => {
  useModalStore.setState({ activeQueue: [] });
});

describe('AppModal', () => {
  describe('Rendering', () => {
    test('does not render children when visible is false', () => {
      render(
        <AppModal name="test-modal" visible={false}>
          <Text>Modal Content</Text>
        </AppModal>
      );

      expect(screen.queryByText('Modal Content')).toBeNull();
    });

    test('renders children when visible is true', () => {
      const { rerender } = render(
        <AppModal name='' visible>
          <Text>Unnamed Modal</Text>
        </AppModal>
      );

      expect(screen.getByText('Unnamed Modal')).toBeTruthy();

      rerender(
        <AppModal name='' visible={false}>
          <Text>Unnamed Modal</Text>
        </AppModal>
      );

      expect(screen.queryByText('Unnamed Modal')).toBeNull();

    });

    test('renders children when visible is true and modal is visible in queue', () => {
      render(
        <AppModal name="test-modal" visible={true}>
          <Text>Modal Content</Text>
        </AppModal>
      );

      expect(screen.getByText('Modal Content')).toBeTruthy();
    });

    test('renders with custom children content', () => {
      render(
        <AppModal name="custom-modal" visible={true}>
          <View testID="custom-view">
            <Text>Custom Title</Text>
            <Text>Custom Description</Text>
          </View>
        </AppModal>
      );

      expect(screen.getByText('Custom Title')).toBeTruthy();
      expect(screen.getByText('Custom Description')).toBeTruthy();
      expect(screen.getByTestId('custom-view')).toBeTruthy();
    });
  });

  describe('onRequestClose', () => {
    test('calls custom onRequestClose handler when provided', () => {
        const mockOnRequestClose = jest.fn();

        render(
          <AppModal
            name="custom-close-modal"
            visible={true}
            onRequestClose={mockOnRequestClose}
          >
            <Text>Modal Content</Text>
          </AppModal>
        );

        const modal = screen.getByTestId('custom-close-modal');
        fireEvent(modal, 'requestClose');

        expect(mockOnRequestClose).toHaveBeenCalledTimes(1);
      });

      test('hides modal when onRequestClose is not provided', () => {
        render(
          <AppModal name="auto-close-modal" visible={true}>
            <Text>Modal Content</Text>
          </AppModal>
        );

        expect(useModalStore.getState().activeQueue).toHaveLength(1);

        const modal = screen.getByTestId('auto-close-modal');
        fireEvent(modal, 'requestClose');

        expect(useModalStore.getState().activeQueue).toHaveLength(0);
      });


      test('should auto hide modal when custom onRequestClose is provided as well', () => {
        const mockOnRequestClose = jest.fn();

        render(
          <AppModal
            name="no-auto-hide-modal"
            visible={true}
            onRequestClose={mockOnRequestClose}
          >
            <Text>Modal Content</Text>
          </AppModal>
        );

        const modal = screen.getByTestId('no-auto-hide-modal');
        fireEvent(modal, 'requestClose');


        // Modal should be removed from queue and mock handler called
        expect(useModalStore.getState().activeQueue).toHaveLength(0);
        expect(mockOnRequestClose).toHaveBeenCalled();
      });
  });

  describe('Store Integration', () => {
    test('registers modal in store when visible becomes true', () => {
      render(
        <AppModal name="register-modal" visible={true} priority={5}>
          <Text>Content</Text>
        </AppModal>
      );

      const state = useModalStore.getState();
      expect(state.activeQueue).toHaveLength(1);
      expect(state.activeQueue[0].id).toBe('register-modal');
      expect(state.activeQueue[0].priority).toBe(5);
    });

    test('removes modal from store when visible becomes false', () => {
      const { rerender } = render(
        <AppModal name="toggle-modal" visible={true}>
          <Text>Content</Text>
        </AppModal>
      );

      expect(useModalStore.getState().activeQueue).toHaveLength(1);

      rerender(
        <AppModal name="toggle-modal" visible={false}>
          <Text>Content</Text>
        </AppModal>
      );

      expect(useModalStore.getState().activeQueue).toHaveLength(0);
    });

    test('removes modal from store on unmount', () => {
      const { unmount } = render(
        <AppModal name="unmount-modal" visible={true}>
          <Text>Content</Text>
        </AppModal>
      );

      expect(useModalStore.getState().activeQueue).toHaveLength(1);

      unmount();

      expect(useModalStore.getState().activeQueue).toHaveLength(0);
    });

    test('does not add duplicate modal with same name', () => {
      render(
        <>
          <AppModal name="duplicate-modal" visible={true}>
            <Text>First</Text>
          </AppModal>
          <AppModal name="duplicate-modal" visible={true}>
            <Text>Second</Text>
          </AppModal>
        </>
      );

      const state = useModalStore.getState();
      expect(state.activeQueue).toHaveLength(1);
    });
  });

  describe('Priority Ordering', () => {
    test('higher priority modal appears first in queue', () => {
      render(
        <>
          <AppModal name="low-priority" visible={true} priority={1}>
            <Text>Low</Text>
          </AppModal>
          <AppModal name="high-priority" visible={true} priority={10}>
            <Text>High</Text>
          </AppModal>
        </>
      );

      const state = useModalStore.getState();
      expect(state.activeQueue[0].id).toBe('high-priority');
      expect(state.activeQueue[1].id).toBe('low-priority');
    });
  });

  describe('Stackable Behavior', () => {
    test('non-stackable modal blocks other modals from being visible', () => {
      render(
        <>
          <AppModal name="blocking-modal" visible={true} priority={10} stackable={false}>
            <Text>Blocking</Text>
          </AppModal>
          <AppModal name="blocked-modal" visible={true} priority={5} stackable={true}>
            <Text>Blocked</Text>
          </AppModal>
        </>
      );

      const visibleModals = useModalStore.getState().getVisibleModals();
      expect(visibleModals).toHaveLength(1);
      expect(visibleModals[0].id).toBe('blocking-modal');
    });

    test('stackable modals allow multiple visible modals', () => {
      render(
        <>
          <AppModal name="stackable-1" visible={true} priority={10} stackable={true}>
            <Text>First</Text>
          </AppModal>
          <AppModal name="stackable-2" visible={true} priority={5} stackable={true}>
            <Text>Second</Text>
          </AppModal>
        </>
      );

      const visibleModals = useModalStore.getState().getVisibleModals();
      expect(visibleModals).toHaveLength(2);
      expect(visibleModals[0].id).toBe('stackable-1');
    });
  });

  describe('unmountOnHide prop', () => {
    test('unmounts content when unmountOnHide is true (default) and not visible', () => {
      // First modal is visible, second is not
      render(
        <>
          <AppModal name="visible-modal" visible={true} priority={10} stackable={false}>
            <Text>Visible</Text>
          </AppModal>
          <AppModal name="hidden-modal" visible={true} priority={5} unmountOnHide={true}>
            <Text>Hidden Content</Text>
          </AppModal>
        </>
      );

      expect(screen.getByText('Visible')).toBeTruthy();
      expect(screen.queryByText('Hidden Content')).toBeNull();
    });
  });
});
