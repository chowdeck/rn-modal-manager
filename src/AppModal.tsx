import * as React from 'react';
import { Modal as RNModal } from 'react-native'
import { useModalStore } from './modalStore'
import { AppModalProps } from './types'
import { useShallow } from 'zustand/react/shallow'

function AppModalComponent({
  visible,
  priority = 0,
  name = '',
  stackable = false,
  unmountOnHide = true,
  children,
  ...props
}: AppModalProps) {
  const modalId =  React.useMemo(
    () => name.length ? name : `modal-${Math.random().toString(36).substr(2, 9)}`,
    [name]
  );

  const show = useModalStore(s => s.show)
  const hide = useModalStore(s => s.hide)
  
  // Only re-render when this specific modal's visibility changes
  const isVisible = useModalStore(
    useShallow(
      s => s.getVisibleModals().some(m => m.id === modalId)
    )
  )

  React.useEffect(() => {
    if (visible) {
      show(modalId, priority, stackable)
    } else {
      hide(modalId)
    }

    return () => {
      hide(modalId)
    }
  }, [visible, modalId, priority, stackable, show, hide])

  const onRequestClose = React.useCallback((e: any) => {
    if (props?.onRequestClose) {
      props.onRequestClose(e)
    } else {
      hide(modalId)
    }
  }, [modalId, hide, props])

  if (unmountOnHide && !isVisible) {
    return null
  }

  return (
    <RNModal {...props} visible={isVisible} onRequestClose={onRequestClose} testID={modalId}>
      {children}
    </RNModal>
  )
}

export const AppModal = React.memo(AppModalComponent);
