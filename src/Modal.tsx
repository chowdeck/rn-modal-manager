import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  Modal as RNModal,
  type ModalProps as RNModalProps,
  type NativeSyntheticEvent,
} from 'react-native';
import modalController, { screenParentKey } from './modalController';
import { modalIdOf } from './hooks';
import type { ModalRef, ScreenFocusSource } from './types';

/**
 * Id of the managed modal (or native modal screen) this subtree renders inside.
 * A Modal rendered inside another one presents from that modal's controller, which
 * iOS supports, so it may show while its parent is up. Root-level siblings queue.
 */
export const ModalParentContext = createContext<string | null>(null);

const useNoScreenFocus = (): ScreenFocusSource | null => null;

export interface ModalProps extends Omit<RNModalProps, 'visible'> {
  /** The handle (`useModal` / `useModalInstance`) or id this modal shows. */
  modal?: ModalRef;
  /** Base id of the throwaway instance used when no `modal` is given. */
  modalName?: string;
  /**
   * The owner plays its own exit animation for this long (phase `exiting`) before
   * the native dismiss, and calls `modalController.notifyExited(id)` when done.
   */
  exitMs?: number;
  /**
   * For hosts only: unmounting this Modal does not close the modal, because it is
   * moving to another place in the tree.
   */
  keepIntentOnUnmount?: boolean;
  children?: ReactNode;
}

/**
 * The native modal, bound to a controller entry. Same props as React Native's
 * `Modal` except that `visible` is gone: pass `modal` (a `useModal` /
 * `useModalInstance` handle, or an id) and the controller decides when the native
 * modal is actually presented.
 *
 * `onShow` still fires when the modal is actually on screen; `onDismiss` only when
 * the owner closed it (not for a controller-forced hide).
 */
export function Modal({
  modal,
  modalName,
  exitMs,
  keepIntentOnUnmount = false,
  onShow,
  onDismiss,
  animationType,
  children,
  ...rest
}: ModalProps) {
  const parentKey = useContext(ModalParentContext);
  // The configured focus hook is fixed at startup, so the hook order is stable.
  const useScreenFocus =
    modalController.getScreenFocusHook() || useNoScreenFocus;
  // Null outside navigator screens (global prompts, the modal host).
  const navigation = useScreenFocus();
  const [nativeVisible, setNativeVisible] = useState(false);
  const keepIntentRef = useRef(keepIntentOnUnmount);
  useEffect(function trackKeepIntent() {
    keepIntentRef.current = keepIntentOnUnmount;
  });
  // A Modal without a handle gets a throwaway instance.
  const fallbackIdRef = useRef<string | null>(null);
  let id = modalIdOf(modal);
  if (!id) {
    if (!fallbackIdRef.current)
      fallbackIdRef.current = modalController.createInstance(
        modalName || 'Modal'
      );
    id = fallbackIdRef.current;
  }
  const boundId = id;

  // Only `id` re-binds; the other binding fields are synced by syncBinding.
  useEffect(
    function bindToModalController() {
      modalController.bind(boundId, {
        setNativeVisible,
        animationType,
        parentKey,
        exitMs,
        name: modalName,
      });
      return () => {
        modalController.unbind(boundId, { keepIntent: keepIntentRef.current });
        // A re-run (Fast Refresh, StrictMode) binds afresh: start hidden again.
        setNativeVisible(false);
      };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [boundId]
  );

  useEffect(function removeFallbackInstance() {
    return () => {
      if (fallbackIdRef.current) modalController.remove(fallbackIdRef.current);
    };
  }, []);

  useEffect(
    function syncBinding() {
      modalController.updateBinding(boundId, {
        animationType,
        parentKey: parentKey || null,
        exitMs: exitMs || 0,
      });
    },
    [boundId, animationType, parentKey, exitMs]
  );

  useEffect(
    function syncScreenFocus() {
      if (!navigation?.addListener) return undefined;
      modalController.setFocused(boundId, navigation.isFocused?.() !== false);
      const unsubscribeFocus = navigation.addListener('focus', () =>
        modalController.setFocused(boundId, true)
      );
      const unsubscribeBlur = navigation.addListener('blur', () =>
        modalController.setFocused(boundId, false)
      );
      return () => {
        unsubscribeFocus?.();
        unsubscribeBlur?.();
      };
    },
    [navigation, boundId]
  );

  const handleShow = (event: NativeSyntheticEvent<unknown>) => {
    modalController.notifyShown(boundId);
    onShow?.(event);
  };

  const handleDismiss = () => {
    // Not forwarded when the controller hid it (retry, or a parent leaving).
    if (modalController.notifyDismissed(boundId)) onDismiss?.();
  };

  return (
    <RNModal
      {...rest}
      animationType={animationType}
      visible={nativeVisible}
      onShow={handleShow}
      onDismiss={handleDismiss}
    >
      <ModalParentContext.Provider value={boundId}>
        {children}
      </ModalParentContext.Provider>
    </RNModal>
  );
}

/**
 * `screenLayout` for native-stack groups presented as native modals
 * (`presentation: 'transparentModal' | 'modal'`): Modals opened from those screens
 * are nested in the screen's controller rather than queued behind it.
 */
export function NativeModalScreenLayout({
  route,
  children,
}: {
  route?: { name: string } | null;
  children?: ReactNode;
}) {
  return (
    <ModalParentContext.Provider value={screenParentKey(route?.name)}>
      {children}
    </ModalParentContext.Provider>
  );
}

/** What `modalScreenListeners` returns: native-stack transition listeners. */
export interface ModalScreenListeners {
  transitionStart: (event?: { data?: { closing?: boolean } }) => void;
  transitionEnd: (event?: { data?: { closing?: boolean } }) => void;
}

/**
 * `screenListeners` for every native-stack navigator: root-level presents wait for a
 * screen's native push or pop to finish, not just for a fixed settle window.
 *
 * ```tsx
 * <Stack.Navigator screenListeners={modalScreenListeners}>
 * ```
 */
export const modalScreenListeners = ({
  route,
}: {
  route?: { key?: string } | null;
}): ModalScreenListeners => ({
  transitionStart: event => {
    // The screen going away may never report its end (it unmounts); the one
    // appearing is what a modal would present over.
    if (!event?.data?.closing)
      modalController.markScreenTransition(route?.key, true);
  },
  transitionEnd: () => modalController.markScreenTransition(route?.key, false),
});

export default Modal;
