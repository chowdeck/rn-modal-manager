import { useContext } from 'react';
import { Modal as RNModal, Text } from 'react-native';
import renderer, { act, type ReactTestRenderer } from 'react-test-renderer';
import {
  NavigationContext,
  createNavigationContainerRef,
  type NavigationProp,
  type ParamListBase,
} from '@react-navigation/core';
import type {
  NavigationState,
  RouteProp,
  ScreenListeners,
} from '@react-navigation/core';
import { Modal, modalScreenListeners } from '../Modal';
import modalController, { TIMINGS } from '../modalController';
import {
  NativeModalScreenWithHost,
  createNativeModalScreenLayout,
  readNavigationState,
  syncModalNavigation,
} from '../navigation';
import type { ModalComponentProps, ModalRegistry } from '../types';

const nativeModals = (tree: ReactTestRenderer) =>
  tree.root.findAllByType(RNModal);
const flush = () =>
  act(() => {
    jest.advanceTimersByTime(50);
  });

// A stand-in for React Navigation's `navigation` object, with focus events.
const fakeNavigation = (focused: boolean) => {
  const listeners: Record<string, Array<() => void>> = { focus: [], blur: [] };
  let isFocused = focused;
  const navigation = {
    isFocused: () => isFocused,
    addListener: (type: 'focus' | 'blur', callback: () => void) => {
      listeners[type].push(callback);
      return () => {
        listeners[type] = listeners[type].filter(item => item !== callback);
      };
    },
    emit: (type: 'focus' | 'blur') => {
      isFocused = type === 'focus';
      listeners[type].forEach(callback => callback());
    },
  };
  return navigation;
};

describe('Modal without React Navigation', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    modalController.configure({ useScreenFocus: null });
    modalController.__reset();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('presents with no focus hook configured', () => {
    let tree!: ReactTestRenderer;
    act(() => {
      tree = renderer.create(<Modal modal="Plain" />);
    });
    act(() => modalController.open('Plain'));
    flush();
    expect(nativeModals(tree)[0].props.visible).toBe(true);
  });
});

describe('Modal with a screen focus hook', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    // What an app using React Navigation configures.
    modalController.configure({
      useScreenFocus: () => useContext(NavigationContext),
    });
    modalController.__reset();
  });

  afterEach(() => {
    modalController.configure({ useScreenFocus: null });
    jest.useRealTimers();
  });

  it('holds a modal while its screen is blurred and presents it on focus', () => {
    const navigation = fakeNavigation(false);
    let tree!: ReactTestRenderer;
    act(() => {
      tree = renderer.create(
        <NavigationContext.Provider
          value={navigation as unknown as NavigationProp<ParamListBase>}
        >
          <Modal modal="OnScreen" />
        </NavigationContext.Provider>
      );
    });
    act(() => modalController.open('OnScreen'));
    act(() => {
      jest.advanceTimersByTime(1000);
    });
    expect(nativeModals(tree)[0].props.visible).toBe(false);

    act(() => navigation.emit('focus'));
    flush();
    expect(nativeModals(tree)[0].props.visible).toBe(true);
  });

  it('treats a Modal outside any screen as focused', () => {
    let tree!: ReactTestRenderer;
    act(() => {
      tree = renderer.create(<Modal modal="Global" />);
    });
    act(() => modalController.open('Global'));
    flush();
    expect(nativeModals(tree)[0].props.visible).toBe(true);
  });
});

describe('navigation helpers', () => {
  const nativeModalRoutes = new Set(['Upgrade']);
  const container = (
    routes: string[],
    current: { name: string; key: string }
  ) => ({
    getRootState: () => ({
      index: routes.length - 1,
      routes: routes.map(name => ({ name, key: name })),
    }),
    getCurrentRoute: () => current,
  });

  beforeEach(() => {
    jest.useFakeTimers();
    modalController.__reset();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('reads the focused route and the native modal route on top', () => {
    expect(
      readNavigationState(
        container(['Main'], { name: 'Home', key: 'home-1' }),
        {
          nativeModalRoutes,
        }
      )
    ).toEqual({
      routeName: 'Home',
      routeKey: 'home-1',
      nativeModalRoute: null,
    });
    expect(
      readNavigationState(
        {
          current: container(['Main', 'Upgrade'], { name: 'Pay', key: 'pay' }),
        },
        { nativeModalRoutes: name => name === 'Upgrade' }
      )
    ).toEqual({
      routeName: 'Pay',
      routeKey: 'pay',
      nativeModalRoute: 'Upgrade',
    });
    expect(
      readNavigationState(container(['Upgrade'], { name: 'X', key: 'x' }), {
        nativeModalRoutes: ['Upgrade'],
        routeName: 'Tracked',
      })
    ).toMatchObject({ routeName: 'Tracked', nativeModalRoute: 'Upgrade' });
    expect(readNavigationState(null)).toEqual({
      routeName: undefined,
      routeKey: undefined,
      nativeModalRoute: null,
    });
  });

  it('accepts a React Navigation container ref', () => {
    const ref = createNavigationContainerRef();
    // Not ready yet: nothing to read, but nothing throws.
    expect(readNavigationState(ref, { nativeModalRoutes })).toMatchObject({
      nativeModalRoute: null,
    });
  });

  it('syncModalNavigation feeds the controller', () => {
    syncModalNavigation(
      container(['Main', 'Upgrade'], { name: 'Pay', key: 'pay' }),
      { nativeModalRoutes }
    );
    expect(modalController.getSignals()).toMatchObject({
      routeName: 'Pay',
      nativeModalRoute: 'Upgrade',
      nativeModalRouteActive: true,
    });
    expect(modalController.inspect().signals.navigationBusy).toBe(true);
    // A user-opened modal is now scoped to the native modal screen.
    modalController.open('picker');
    expect(modalController.getView('picker').hostScope).toBe('screen:Upgrade');
  });

  function Picker({ modal }: ModalComponentProps<{ label: string }>) {
    return <Text>{`pick ${modal.params?.label}`}</Text>;
  }
  const registry: ModalRegistry = {
    picker: { component: Picker, preset: 'bottom' },
  };

  it.each([
    [
      'NativeModalScreenWithHost',
      ({ name }: { name: string }) => (
        <NativeModalScreenWithHost
          registry={registry}
          route={{ name }}
          reduceMotion
        >
          <Text>screen</Text>
        </NativeModalScreenWithHost>
      ),
    ],
    [
      'createNativeModalScreenLayout',
      ({ name }: { name: string }) => {
        const Layout = createNativeModalScreenLayout(registry, {
          reduceMotion: true,
        });
        return (
          <Layout route={{ name }}>
            <Text>screen</Text>
          </Layout>
        );
      },
    ],
  ])('%s renders the scoped registry modals inside the screen', (_, Screen) => {
    syncModalNavigation(
      container(['Main', 'Upgrade'], { name: 'Upgrade', key: 'up' }),
      { nativeModalRoutes }
    );
    act(() => {
      jest.advanceTimersByTime(TIMINGS.navigationSettleMs);
    });
    let tree!: ReactTestRenderer;
    act(() => {
      tree = renderer.create(<Screen name="Upgrade" />);
    });
    act(() => modalController.open('picker', { label: 'bank' }));
    flush();
    const [modal] = nativeModals(tree);
    expect(modal.props.visible).toBe(true);
    expect(
      modalController.inspect().entries.find(entry => entry.id === 'picker')
        ?.parent
    ).toBe('screen:Upgrade');

    act(() => tree.unmount());
    expect(modalController.isOpen('picker')).toBe(false);
  });
});

describe('modalScreenListeners with React Navigation', () => {
  // The native-stack events it listens to, as @react-navigation/native-stack types them.
  type NativeStackEvents = {
    transitionStart: { data: { closing: boolean } };
    transitionEnd: { data: { closing: boolean } };
  };
  // Type-level: it is accepted as a navigator's `screenListeners`.
  const asScreenListeners: (props: {
    route: RouteProp<ParamListBase>;
  }) => ScreenListeners<NavigationState, NativeStackEvents> =
    modalScreenListeners;

  beforeEach(() => {
    jest.useFakeTimers();
    modalController.__reset();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('holds root presents until the appearing screen reports its end', () => {
    const visibility: Record<string, boolean> = {};
    modalController.bind('Root', {
      setNativeVisible: value => {
        visibility.Root = value;
      },
    });
    const listeners = asScreenListeners({
      route: { key: 'track-1', name: 'Track', params: undefined },
    });
    listeners.transitionStart?.({
      type: 'transitionStart',
      data: { closing: false },
      target: 'track-1',
    });
    modalController.open('Root');
    jest.advanceTimersByTime(TIMINGS.screenTransitionMaxMs - 100);
    expect(visibility.Root).toBeUndefined();
    listeners.transitionEnd?.({
      type: 'transitionEnd',
      data: { closing: false },
      target: 'track-1',
    });
    jest.advanceTimersByTime(0);
    expect(visibility.Root).toBe(true);
  });
});

describe('scoped modals when a native modal route leaves', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    modalController.__reset();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('hands a scoped modal no host rendered back to the app host', () => {
    const nativeModalRoutes = ['Upgrade'];
    const at = (routes: string[]) => ({
      getRootState: () => ({
        index: routes.length - 1,
        routes: routes.map(name => ({ name, key: name })),
      }),
      getCurrentRoute: () => ({
        name: routes[routes.length - 1],
        key: routes[routes.length - 1],
      }),
    });
    syncModalNavigation(at(['Main', 'Upgrade']), { nativeModalRoutes });
    modalController.open('picker');
    expect(modalController.getView('picker').hostScope).toBe('screen:Upgrade');
    syncModalNavigation(at(['Main']), { nativeModalRoutes });
    expect(modalController.getView('picker').hostScope).toBeNull();
    expect(modalController.isOpen('picker')).toBe(true);
  });
});
