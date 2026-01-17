import * as React from 'react';
import { Modal as RNModal } from 'react-native';
import { useModalStore } from './modalStore';
import { AppModalProps } from './types';

function AppModalComponent({
  visible,
  priority = 0,
  name: modalId = `modal-${Date.now().toString(36)}`,
  stackable = false,
  unmountOnHide = true,
  children,
  onRequestClose: onRequestCloseProp,
  ...props
}: AppModalProps) {
  const show = useModalStore(s => s.show);
  const hide = useModalStore(s => s.hide);

  // Only re-render when this specific modal's visibility changes
  const isVisible = useModalStore(s =>
    s.getVisibleModals().some(m => m.id === modalId)
  );

  React.useEffect(() => {
    if (visible) {
      show(modalId, priority, stackable);
    } else {
      hide(modalId);
    }

    return () => {
      hide(modalId);
    };
  }, [visible, modalId, priority, stackable, show, hide]);

  const onRequestClose = React.useCallback(
    (e: any) => {
      if (onRequestCloseProp) {
        onRequestCloseProp(e);
      }
      hide(modalId);
    },
    [modalId, hide, onRequestCloseProp]
  );

  if (unmountOnHide && !isVisible) {
    return null;
  }

  return (
    <RNModal
      {...props}
      visible={isVisible}
      onRequestClose={onRequestClose}
      testID={modalId}
    >
      {children}
    </RNModal>
  );
}

export const AppModal = React.memo(AppModalComponent);
// Test change
