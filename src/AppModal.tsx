import * as React from 'react';
import { Modal as RNModal } from 'react-native'
import { useModalStore } from './modalStore'
import { AppModalProps } from './types'
import { useShallow } from 'zustand/react/shallow'

export function AppModal({
  visible,
  priority = 0,
  name = '',
  unmountOnHide = true,
  children,
  ...props
}: AppModalProps) {
  const modalId = name.length ? name : `modal-${Math.random().toString(36).substr(2, 9)}`;

  const queue = useModalStore(useShallow(s => s.activeQueue))
  const show = useModalStore(s => s.show)
  const hide = useModalStore(s => s.hide)

  React.useEffect(() => {
    if (visible) {
      show(modalId, priority)
    } else {
      hide(modalId)
    }

    return () => {
      hide(modalId)
    }
  }, [visible, modalId, show, hide])

  const onRequestClose = React.useCallback((e: any) => {
      if(props?.onRequestClose){
        props.onRequestClose(e)
      } else {
        hide(modalId)
      }
  }, [modalId, hide])

  if (__DEV__ && queue?.length > 1) {
    console.log("--- [ModalSystem] Multiple modal active ---", queue.length, queue.map(m => m.id))
  }

  const isVisible = queue[0]?.id === modalId;

  if (__DEV__ && isVisible){
    console.log(`[ModalSystem] Modal ${modalId} isVisible:`, isVisible)
  }

  if (unmountOnHide && !isVisible) {
    return null
  }

  return (
    <RNModal {...props} visible={isVisible} onRequestClose={onRequestClose}>
      {children}
    </RNModal>
  )
}
