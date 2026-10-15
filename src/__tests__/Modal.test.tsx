import { Modal as RNModal, Text } from 'react-native';
import renderer, { act, type ReactTestRenderer } from 'react-test-renderer';
import {
  Modal,
  ModalHost,
  ModalParentContext,
  modalController,
  useModal,
  useModalInstance,
} from '../../index';
import type { ModalComponentProps, ModalHandle, ModalRegistry } from '../types';

jest.mock('../useReduceMotion', () => ({
  __esModule: true,
  useReduceMotion: () => true,
  default: () => true,
}));

const nativeModals = (tree: ReactTestRenderer) =>
  tree.root.findAllByType(RNModal);
const flush = () =>
  act(() => {
    // Enough for the deferred scheduling, well short of the present watchdog.
    jest.advanceTimersByTime(50);
  });

describe('Modal (managed)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    modalController.__reset();
    modalController.setSignals({ splashComplete: true, routeName: 'Home' });
  });

  afterEach(() => {
    jest.useRealTimers();
    modalController.setPolicy({ enabled: false });
  });

  it('shows sibling modals one after another', () => {
    let tree!: ReactTestRenderer;
    const App = () => (
      <>
        <Modal modal="First">
          <Text>first</Text>
        </Modal>
        <Modal modal="Second">
          <Text>second</Text>
        </Modal>
      </>
    );
    act(() => {
      tree = renderer.create(<App />);
    });
    act(() => {
      modalController.open('First');
      modalController.open('Second');
    });
    flush();
    let [first, second] = nativeModals(tree);
    expect(first.props.visible).toBe(true);
    expect(second.props.visible).toBe(false);

    act(() => first.props.onShow());
    act(() => modalController.close('First'));
    flush();
    [first, second] = nativeModals(tree);
    expect(first.props.visible).toBe(false);
    expect(second.props.visible).toBe(false);

    act(() => first.props.onDismiss());
    [, second] = nativeModals(tree);
    expect(second.props.visible).toBe(true);
  });

  it('lets a modal rendered inside another one present over it', () => {
    let tree!: ReactTestRenderer;
    act(() => {
      tree = renderer.create(
        <Modal modal="Parent">
          <Modal modal="Child">
            <Text>child</Text>
          </Modal>
        </Modal>
      );
    });
    act(() => {
      modalController.open('Parent');
      modalController.open('Child');
    });
    flush();
    act(() => nativeModals(tree)[0].props.onShow());
    flush();
    const [parent, child] = nativeModals(tree);
    expect(parent.props.visible).toBe(true);
    expect(child.props.visible).toBe(true);
  });

  it('useModalInstance gives a component its own modal and removes it on unmount', () => {
    let handle!: ModalHandle<{ addressId: number }>;
    const Owner = () => {
      handle = useModalInstance<{ addressId: number }>('delete_address');
      return <Modal modal={handle} />;
    };
    let tree!: ReactTestRenderer;
    act(() => {
      tree = renderer.create(<Owner />);
    });
    expect(handle.id).toMatch(/^delete_address#/);
    act(() => handle.open({ addressId: 7 }));
    flush();
    expect(nativeModals(tree)[0].props.visible).toBe(true);
    expect(handle.isOpen).toBe(true);
    expect(handle.params).toEqual({ addressId: 7 });
    const { id } = handle;
    act(() => tree.unmount());
    act(() => jest.advanceTimersByTime(600));
    expect(
      modalController.inspect().entries.find(entry => entry.id === id)
    ).toBeUndefined();
  });

  it('kill switch: presents at once, with no serialisation', () => {
    modalController.setPolicy({ enabled: false });
    let tree!: ReactTestRenderer;
    act(() => {
      tree = renderer.create(
        <>
          <Modal modal="A" />
          <Modal modal="B" />
        </>
      );
    });
    act(() => {
      modalController.open('A');
      modalController.open('B');
    });
    expect(nativeModals(tree).map(modal => modal.props.visible)).toEqual([
      true,
      true,
    ]);
  });
});

describe('ModalHost', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    modalController.__reset();
    modalController.setSignals({ splashComplete: true, routeName: 'Home' });
  });

  afterEach(() => {
    jest.useRealTimers();
    modalController.setPolicy({ enabled: false });
  });

  function Greeting({ modal }: ModalComponentProps<{ name: string }>) {
    return (
      <Text onPress={() => modal.close()}>{`hello ${modal.params?.name}`}</Text>
    );
  }

  function OwnSheet({ modal }: ModalComponentProps<{ order: number }>) {
    return (
      <Modal modal={modal}>
        <Text>{`prompt ${modal.params?.order}`}</Text>
      </Modal>
    );
  }

  const registry: ModalRegistry = {
    Greeting: { component: Greeting, preset: 'center' },
    order_rating: { component: OwnSheet },
  };

  it('mounts a preset modal when opened, passes params, and unmounts it after close', () => {
    let tree!: ReactTestRenderer;
    act(() => {
      tree = renderer.create(<ModalHost registry={registry} />);
    });
    expect(nativeModals(tree)).toHaveLength(0);
    act(() => modalController.open('Greeting', { name: 'Ada' }));
    flush();
    expect(nativeModals(tree)[0].props.visible).toBe(true);
    expect(tree.root.findByType(Text).props.children).toBe('hello Ada');

    act(() => nativeModals(tree)[0].props.onShow());
    act(() => tree.root.findByType(Text).props.onPress());
    flush();
    expect(modalController.getView('Greeting').phase).toBe('exiting');
    act(() => jest.advanceTimersByTime(300));
    act(() => modalController.notifyExited('Greeting'));
    act(() => nativeModals(tree)[0].props.onDismiss());
    expect(nativeModals(tree)).toHaveLength(0);
  });

  it('renders an automatic prompt that owns its sheet', () => {
    let tree!: ReactTestRenderer;
    act(() => {
      tree = renderer.create(<ModalHost registry={registry} />);
    });
    let handle!: ModalHandle;
    const Reader = () => {
      handle = useModal('order_rating');
      return null;
    };
    act(() => {
      tree.update(
        <>
          <ModalHost registry={registry} />
          <Reader />
        </>
      );
    });
    act(() => modalController.open('order_rating', { order: 42 }));
    flush();
    expect(nativeModals(tree)[0].props.visible).toBe(true);
    expect(tree.root.findByType(Text).props.children).toBe('prompt 42');
    expect(handle.isOpen).toBe(true);
  });

  it('nests a preset modal opened from another one', () => {
    let tree!: ReactTestRenderer;
    act(() => {
      tree = renderer.create(<ModalHost registry={registry} />);
    });
    act(() => modalController.open('Greeting', { name: 'one' }));
    flush();
    act(() => nativeModals(tree)[0].props.onShow());
    const lowerRegistry: ModalRegistry = {
      ...registry,
      Second: { component: Greeting, preset: 'bottom' },
    };
    act(() => tree.update(<ModalHost registry={lowerRegistry} />));
    act(() => modalController.open('Second', { name: 'two' }));
    flush();
    const modals = nativeModals(tree);
    expect(modals).toHaveLength(2);
    expect(modals[1].props.visible).toBe(true);
    expect(
      modalController.inspect().entries.find(entry => entry.id === 'Second')
        ?.parent
    ).toBe('Greeting');
  });

  it('keeps a stack modal open when the one under it leaves', () => {
    let tree!: ReactTestRenderer;
    const stack: ModalRegistry = {
      ...registry,
      Second: { component: Greeting, preset: 'bottom' },
    };
    act(() => {
      tree = renderer.create(<ModalHost registry={stack} />);
    });
    act(() => modalController.open('Greeting', { name: 'one' }));
    flush();
    act(() => nativeModals(tree)[0].props.onShow());
    // Greeting hands over to Second (e.g. the BVN sheet to the PIN reset overlay).
    act(() => modalController.replace('Greeting', 'Second', { name: 'two' }));
    flush();
    act(() => modalController.notifyExited('Greeting'));
    act(() => nativeModals(tree)[0].props.onDismiss());
    act(() => jest.advanceTimersByTime(1000));
    expect(modalController.isOpen('Second')).toBe(true);
    const modals = nativeModals(tree);
    expect(modals).toHaveLength(1);
    expect(modals[0].props.visible).toBe(true);
    expect(tree.root.findByType(Text).props.children).toBe('hello two');
  });

  it('renders a modal opened over a native modal route in that screen, and closes it with the screen', () => {
    modalController.markNavigationChange({
      routeName: 'Plan',
      routeKey: 'plan',
      nativeModalRoute: 'Plan',
    });
    act(() => jest.advanceTimersByTime(500));
    let tree!: ReactTestRenderer;
    const Screen = ({ open }: { open: boolean }) => (
      <>
        <ModalHost registry={registry} />
        {open ? (
          <ModalParentContext.Provider value="screen:Plan">
            <ModalHost registry={registry} scope="screen:Plan" />
          </ModalParentContext.Provider>
        ) : null}
      </>
    );
    act(() => {
      tree = renderer.create(<Screen open />);
    });
    act(() => modalController.open('Greeting', { name: 'inside' }));
    flush();
    const modals = nativeModals(tree);
    expect(modals).toHaveLength(1);
    expect(modals[0].props.visible).toBe(true);
    expect(
      modalController.inspect().entries.find(entry => entry.id === 'Greeting')
        ?.parent
    ).toBe('screen:Plan');

    act(() => tree.update(<Screen open={false} />));
    expect(modalController.isOpen('Greeting')).toBe(false);
    act(() => jest.advanceTimersByTime(1000));
    expect(nativeModals(tree)).toHaveLength(0);
  });
});
