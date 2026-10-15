import { AccessibilityInfo, Animated, Modal as RNModal } from 'react-native';
import renderer, { act, type ReactTestRenderer } from 'react-test-renderer';
import { DEFAULT_MODAL_MOTION, ModalHost } from '../ModalHost';
import modalController from '../modalController';
import { testing } from '../testing';
import type { ModalComponentProps, ModalRegistry } from '../types';

function Content(_: ModalComponentProps) {
  return null;
}

const registry: ModalRegistry = {
  Card: { component: Content, preset: 'center' },
  Sheet: { component: Content, preset: 'bottom' },
};

const nativeModal = (tree: ReactTestRenderer) =>
  tree.root.findAllByType(RNModal)[0];
const flush = () =>
  act(() => {
    jest.advanceTimersByTime(50);
  });
const reduceMotionSetting =
  AccessibilityInfo.isReduceMotionEnabled as jest.Mock;

describe('ModalHost motion', () => {
  let timing: jest.SpyInstance;

  beforeEach(() => {
    jest.useFakeTimers();
    modalController.__reset();
    timing = jest.spyOn(Animated, 'timing');
    reduceMotionSetting.mockImplementation(() => Promise.resolve(false));
  });

  afterEach(() => {
    timing.mockRestore();
    jest.useRealTimers();
  });

  const durations = () =>
    timing.mock.calls.map(
      ([, config]: [unknown, Animated.TimingAnimationConfig]) => config.duration
    );

  const showThenClose = (tree: ReactTestRenderer, id: string) => {
    act(() => modalController.open(id));
    flush();
    act(() => nativeModal(tree).props.onShow());
    act(() => modalController.close(id));
    flush();
  };

  it('uses the default motion', async () => {
    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<ModalHost registry={registry} />);
    });
    showThenClose(tree, 'Card');
    expect(durations()).toEqual([
      DEFAULT_MODAL_MOTION.centerInMs,
      DEFAULT_MODAL_MOTION.exitMs,
    ]);
    expect(modalController.getView('Card').phase).toBe('exiting');
    act(() => {
      jest.advanceTimersByTime(DEFAULT_MODAL_MOTION.exitMs);
    });
    expect(modalController.getView('Card').phase).toBe('dismissing');
  });

  it('takes motion overrides: durations, exit hold and the centre scale', async () => {
    const motion = { sheetInMs: 500, exitMs: 600, centerScaleFrom: 0.8 };
    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<ModalHost registry={registry} motion={motion} />);
    });
    act(() => modalController.open('Card'));
    flush();
    const card = tree.root.findAll(
      node =>
        (node.type as unknown) === 'Animated.View' &&
        Array.isArray(node.props.style) &&
        !!node.props.style[1]?.transform
    )[0];
    expect(
      card.props.style[1].transform[0].scale.interpolation.outputRange
    ).toEqual([0.8, 1]);
    act(() => {
      modalController.close('Card');
      testing.completeTransitions();
    });
    expect(modalController.getView('Card').phase).toBe('idle');
    timing.mockClear();

    showThenClose(tree, 'Sheet');
    expect(durations()).toEqual([500, 600]);
    act(() => {
      jest.advanceTimersByTime(550);
    });
    expect(modalController.getView('Sheet').phase).toBe('exiting');
    act(() => {
      jest.advanceTimersByTime(60);
    });
    expect(modalController.getView('Sheet').phase).toBe('dismissing');
  });

  it('follows the OS reduce-motion setting by default', async () => {
    reduceMotionSetting.mockImplementation(() => Promise.resolve(true));
    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<ModalHost registry={registry} />);
    });
    showThenClose(tree, 'Sheet');
    expect(durations()).toEqual([
      DEFAULT_MODAL_MOTION.reducedMs,
      DEFAULT_MODAL_MOTION.reducedMs,
    ]);
  });

  it('lets the reduceMotion prop override the OS setting', async () => {
    reduceMotionSetting.mockImplementation(() => Promise.resolve(true));
    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(
        <ModalHost registry={registry} reduceMotion={false} />
      );
    });
    showThenClose(tree, 'Sheet');
    expect(durations()).toEqual([
      DEFAULT_MODAL_MOTION.sheetInMs,
      DEFAULT_MODAL_MOTION.exitMs,
    ]);
  });
});
