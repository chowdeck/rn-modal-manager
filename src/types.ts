// types.ts
import * as React from 'react'
import { ModalProps } from 'react-native'

export type ManagedModal = {
  id: string
  priority: number
  stackable: boolean
  visible: boolean
  element: React.ReactNode
  onClose?: () => void
}

export type ActiveModal = {
  id: string
  priority: number
  openedAt: number
  stackable: boolean
}


export type ModalEntry = {
  id: string
  element: React.ReactNode
  priority: number
  stackable: boolean
  visible: boolean
}

export type ModalState = {
  getActiveModals(): unknown
  modals: ModalEntry[]
  register: (modal: ModalEntry) => void
  unregister: (id: string) => void
}

export type AppModalProps = ModalProps & {
  name: string
  priority?: number
  stackable?: boolean
  unmountOnHide?: boolean
}