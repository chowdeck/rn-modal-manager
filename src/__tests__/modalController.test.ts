import modalController, { TIMINGS } from '../modalController';
import type { BindOptions, CloseOptions } from '../types';
import { TEST_POLICIES, setPlatform } from './fixtures';

const setup = () => {
  const visibility: Record<string, boolean> = {};
  const issues: Array<Record<string, unknown> & { type: string }> = [];
  modalController.setReporter({
    issue: (type, data) => issues.push({ type, ...data }),
  });
  // A bound modal: what `<Modal modal={id}>` does on mount.
  const bind = (id: string, options: BindOptions = {}) => {
    modalController.bind(id, {
      setNativeVisible: value => {
        visibility[id] = value;
      },
      ...options,
    });
    return {
      id,
      open: (params?: unknown) => modalController.open(id, params),
      close: (options2?: CloseOptions) => modalController.close(id, options2),
      shown: () => modalController.notifyShown(id),
      exited: () => modalController.notifyExited(id),
      dismissed: () => modalController.notifyDismissed(id),
      unbind: () => modalController.unbind(id),
    };
  };
  return { visibility, issues, bind };
};

const tick = (ms = 0) => jest.advanceTimersByTime(ms);
const phase = (id: string) => modalController.getView(id).phase;

describe('modalController', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    modalController.configure({ policies: TEST_POLICIES });
    modalController.__reset();
    modalController.setSignals({ splashComplete: true, routeName: 'Home' });
    setPlatform('ios');
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('presents root-level siblings one at a time', () => {
    const { visibility, bind } = setup();
    const first = bind('First');
    const second = bind('Second');
    first.open();
    second.open();
    tick();
    expect(visibility).toEqual({ First: true });

    first.shown();
    tick();
    expect(visibility.Second).toBeUndefined();

    first.close();
    tick();
    expect(visibility.First).toBe(false);
    expect(visibility.Second).toBeUndefined();

    first.dismissed();
    expect(visibility.Second).toBe(true);
  });

  it('never starts a present while another modal is still dismissing', () => {
    const { visibility, bind } = setup();
    const sheet = bind('Sheet');
    sheet.open();
    tick();
    sheet.shown();
    sheet.close();
    tick();

    const next = bind('Next');
    next.open();
    tick(TIMINGS.dismissTimeoutMs - 10);
    expect(visibility.Next).toBeUndefined();
    sheet.dismissed();
    expect(visibility.Next).toBe(true);
  });

  it('runs the owner exit animation before the native dismiss, and `then` after it', () => {
    const { visibility, bind } = setup();
    const sheet = bind('Sheet', { exitMs: 220 });
    const then = jest.fn();
    sheet.open();
    tick();
    sheet.shown();
    sheet.close({ then });
    tick();
    expect(phase('Sheet')).toBe('exiting');
    expect(visibility.Sheet).toBe(true);
    sheet.exited();
    expect(phase('Sheet')).toBe('dismissing');
    expect(visibility.Sheet).toBe(false);
    expect(then).not.toHaveBeenCalled();
    sheet.dismissed();
    expect(phase('Sheet')).toBe('idle');
    expect(then).toHaveBeenCalledTimes(1);
  });

  it('forces the native dismiss when the exit animation never reports back', () => {
    const { visibility, bind } = setup();
    const sheet = bind('Sheet', { exitMs: 220 });
    sheet.open();
    tick();
    sheet.shown();
    sheet.close();
    tick(220 + TIMINGS.exitGraceMs);
    expect(visibility.Sheet).toBe(false);
  });

  it('stays on screen when re-opened mid-exit', () => {
    const { visibility, bind } = setup();
    const sheet = bind('Sheet', { exitMs: 220 });
    sheet.open();
    tick();
    sheet.shown();
    sheet.close();
    tick();
    sheet.open();
    sheet.exited();
    expect(phase('Sheet')).toBe('shown');
    expect(visibility.Sheet).toBe(true);
  });

  it('drops the `then` of a close that a re-open cancelled', () => {
    const { bind } = setup();
    const sheet = bind('Sheet');
    sheet.open();
    tick();
    sheet.shown();
    const then = jest.fn();
    sheet.close({ then });
    tick();
    expect(phase('Sheet')).toBe('dismissing');
    sheet.open();
    sheet.dismissed();
    tick();
    sheet.shown();
    sheet.close();
    tick();
    sheet.dismissed();
    tick();
    expect(phase('Sheet')).toBe('idle');
    expect(then).not.toHaveBeenCalled();
  });

  it('keeps a modal open when its host only moves it (unbind with keepIntent)', () => {
    const { visibility, bind } = setup();
    bind('Moved');
    modalController.open('Moved');
    modalController.unbind('Moved', { keepIntent: true });
    expect(modalController.isOpen('Moved')).toBe(true);
    bind('Moved');
    tick();
    expect(visibility.Moved).toBe(true);
  });

  it('replace() shows the next modal only after the first is off screen', () => {
    const { visibility, bind } = setup();
    const balance = bind('negative_balance');
    bind('wallet_topup');
    balance.open();
    tick();
    balance.shown();
    modalController.replace('negative_balance', 'wallet_topup', {
      amount: 500,
    });
    tick();
    expect(visibility.negative_balance).toBe(false);
    expect(visibility.wallet_topup).toBeUndefined();
    balance.dismissed();
    expect(visibility.wallet_topup).toBe(true);
    expect(modalController.getView('wallet_topup').params).toEqual({
      amount: 500,
    });
  });

  it('waits for a component to bind before presenting a host-rendered modal', () => {
    const { visibility, bind } = setup();
    modalController.open('order_rating', { order: 1 });
    tick();
    expect(modalController.getView('order_rating').mounted).toBe(true);
    const rating = bind('order_rating');
    tick();
    expect(visibility.order_rating).toBe(true);
    rating.shown();
  });

  it('drops an instance once its owner removes it', () => {
    const { bind } = setup();
    const id = modalController.createInstance('delete_address');
    expect(id).toMatch(/^delete_address#\d+$/);
    const sheet = bind(id);
    sheet.open();
    tick();
    sheet.shown();
    modalController.remove(id);
    sheet.unbind();
    tick();
    tick(500);
    expect(modalController.getView(id).phase).toBe('idle');
    expect(
      modalController.inspect().entries.find(entry => entry.id === id)
    ).toBeUndefined();
  });

  it('lets a nested modal present over its shown parent', () => {
    const { visibility, bind } = setup();
    const parent = bind('Parent');
    parent.open();
    tick();
    const child = bind('Child', { parentKey: 'Parent' });
    child.open();
    tick();
    expect(visibility.Child).toBeUndefined();

    parent.shown();
    expect(visibility.Child).toBe(true);
  });

  it('dismisses the deepest modal first', () => {
    const { visibility, bind } = setup();
    const parent = bind('Parent');
    parent.open();
    tick();
    parent.shown();
    const child = bind('Child', { parentKey: 'Parent' });
    child.open();
    tick();
    child.shown();

    parent.close();
    child.close();
    tick();
    expect(visibility.Child).toBe(false);
    expect(visibility.Parent).toBe(true);
    child.dismissed();
    expect(visibility.Parent).toBe(false);
  });

  it('dismisses a still-open nested child before its leaving parent, without telling the child owner', () => {
    const { visibility, bind } = setup();
    const parent = bind('Parent');
    parent.open();
    tick();
    parent.shown();
    const child = bind('Child', { parentKey: 'Parent' });
    child.open();
    tick();
    child.shown();

    parent.close();
    tick();
    expect(visibility.Child).toBe(false);
    expect(visibility.Parent).toBe(true);
    expect(child.dismissed()).toBe(false);
    expect(visibility.Parent).toBe(false);
    expect(parent.dismissed()).toBe(true);
  });

  it('serialises nested siblings under the same parent', () => {
    const { visibility, bind } = setup();
    const parent = bind('Parent');
    parent.open();
    tick();
    parent.shown();
    const loader = bind('Loader', { parentKey: 'Parent' });
    const picker = bind('Picker', { parentKey: 'Parent' });
    loader.open();
    picker.open();
    tick();
    expect(visibility.Loader).toBe(true);
    expect(visibility.Picker).toBeUndefined();
    loader.shown();
    expect(visibility.Picker).toBeUndefined();
    loader.close();
    tick();
    loader.dismissed();
    expect(visibility.Picker).toBe(true);
  });

  it('waits for a navigation transition to settle before presenting', () => {
    const { visibility, bind } = setup();
    modalController.markNavigationChange({ routeName: 'TrackOrder' });
    const modal = bind('PinInfo');
    modal.open();
    tick(TIMINGS.navigationSettleMs - 50);
    expect(visibility.PinInfo).toBeUndefined();
    tick(60);
    expect(visibility.PinInfo).toBe(true);
  });

  it('holds auto prompts until the splash is done and orders them by priority', () => {
    const { visibility, bind } = setup();
    modalController.setSignals({ splashComplete: false });
    const marketing = bind('in_app_message');
    const address = bind('select_address');
    marketing.open();
    address.open();
    tick(1000);
    expect(visibility).toEqual({});

    modalController.setSignals({ splashComplete: true });
    tick();
    expect(visibility).toEqual({ select_address: true });
  });

  it('treats an instance of a prompt id as a user modal', () => {
    const { visibility, bind } = setup();
    modalController.setSignals({
      splashComplete: false,
      routeName: 'RestaurantCheckout',
    });
    const id = modalController.createInstance('select_address');
    const picker = bind(id);
    picker.open();
    tick();
    expect(visibility[id]).toBe(true);
  });

  it('keeps auto prompts off blocked routes and on allowed routes only', () => {
    const { visibility, bind } = setup();
    modalController.setSignals({ routeName: 'RestaurantCheckout' });
    const inApp = bind('in_app_message');
    const segment = bind('segment_opt_in');
    inApp.open();
    segment.open();
    tick();
    expect(visibility).toEqual({});

    modalController.setSignals({ routeName: 'Restaurant' });
    tick();
    expect(visibility).toEqual({ in_app_message: true });
  });

  it('applies server policy overrides', () => {
    const { visibility, bind } = setup();
    modalController.setPolicy({
      modals: {
        in_app_message: { enabled: false },
        survey_custom: { delay_ms: 3000 },
      },
    });
    const inApp = bind('in_app_message');
    const survey = bind('survey_custom');
    inApp.open();
    survey.open();
    tick(2900);
    expect(visibility).toEqual({});
    tick(200);
    expect(visibility).toEqual({ survey_custom: true });
  });

  it('reports two prompts tied on priority', () => {
    const { issues, bind } = setup();
    modalController.setPolicy({ modals: { survey_custom: { priority: 20 } } });
    const inApp = bind('in_app_message');
    const survey = bind('survey_custom');
    inApp.open();
    survey.open();
    tick();
    expect(issues.map(item => item.type)).toContain('priority_tie');
  });

  it('kill switch: honours every request at once, with no serialisation', () => {
    const { visibility, bind } = setup();
    modalController.setPolicy({ enabled: false });
    expect(modalController.isEnabled()).toBe(false);
    const first = bind('First');
    const second = bind('Second');
    first.open();
    second.open();
    expect(visibility).toEqual({ First: true, Second: true });
    first.close();
    expect(visibility.First).toBe(false);
  });

  it('retries a dropped presentation once, then releases the screen and reports', () => {
    const { visibility, issues, bind } = setup();
    const modal = bind('Dropped');
    const other = bind('Other');
    modal.open();
    tick();
    tick(TIMINGS.presentTimeoutMs);
    expect(issues.map(item => item.type)).toEqual(['present_timeout']);
    expect(visibility.Dropped).toBe(false);
    modal.dismissed();
    expect(visibility.Dropped).toBe(true);

    other.open();
    tick(TIMINGS.presentTimeoutMs);
    expect(issues.map(item => item.type)).toEqual([
      'present_timeout',
      'present_failed',
    ]);
    modal.dismissed();
    expect(visibility.Other).toBe(true);
  });

  it('reports and releases a dismissal that never reports back on iOS', () => {
    const { visibility, issues, bind } = setup();
    const stuck = bind('Stuck');
    const next = bind('Next');
    stuck.open();
    tick();
    stuck.shown();
    stuck.close();
    next.open();
    tick(TIMINGS.dismissTimeoutMs);
    expect(issues.map(item => item.type)).toContain('dismiss_timeout');
    expect(visibility.Next).toBe(true);
  });

  it('uses a settle timer on Android, which has no onDismiss', () => {
    setPlatform('android');
    const { visibility, bind } = setup();
    const first = bind('First', { animationType: 'slide' });
    const second = bind('Second');
    first.open();
    tick();
    first.shown();
    first.close();
    second.open();
    tick(300);
    expect(visibility.Second).toBeUndefined();
    tick(30);
    expect(visibility.Second).toBe(true);
  });

  it('releases the screen after a shown modal unbinds', () => {
    const { visibility, bind } = setup();
    const first = bind('First');
    const second = bind('Second');
    first.open();
    tick();
    first.shown();
    second.open();
    first.unbind();
    tick(100);
    expect(visibility.Second).toBeUndefined();
    tick(30);
    expect(visibility.Second).toBe(true);
  });

  it('reports a user-opened modal stuck behind another one, and a starved prompt', () => {
    const { issues, bind } = setup();
    const sheet = bind('Sheet');
    const loader = bind('Loader');
    const prompt = bind('in_app_message');
    sheet.open();
    tick();
    sheet.shown();
    loader.open();
    prompt.open();
    tick(TIMINGS.userStallMs + 10);
    expect(issues).toEqual([
      expect.objectContaining({
        type: 'user_modal_blocked',
        modal_id: 'Loader',
        blocked_by: 'Sheet',
      }),
    ]);
    tick(TIMINGS.promptStallMs);
    expect(issues.map(item => item.type)).toContain('prompt_starved');
  });

  it('holds a modal whose screen is not focused and presents it on focus', () => {
    const { visibility, bind } = setup();
    const sheet = bind('Sheet');
    modalController.setFocused('Sheet', false);
    sheet.open();
    tick(1000);
    expect(visibility.Sheet).toBeUndefined();
    modalController.setFocused('Sheet', true);
    tick();
    expect(visibility.Sheet).toBe(true);
  });

  it('re-queues a failed present on the next navigation change', () => {
    const { visibility, bind } = setup();
    const modal = bind('Dropped');
    modal.open();
    tick();
    tick(TIMINGS.presentTimeoutMs);
    tick(TIMINGS.dismissTimeoutMs);
    tick(TIMINGS.presentTimeoutMs);
    tick(TIMINGS.dismissTimeoutMs);
    expect(visibility.Dropped).toBe(false);

    modalController.markNavigationChange({
      routeName: 'Home',
      routeKey: 'home-2',
    });
    tick(TIMINGS.navigationSettleMs);
    expect(visibility.Dropped).toBe(true);
  });

  it('does not let setParams churn on the same route starve presents', () => {
    const { visibility, bind } = setup();
    modalController.markNavigationChange({
      routeName: 'Home',
      routeKey: 'home-1',
    });
    const modal = bind('Sheet');
    modal.open();
    for (let i = 0; i < 5; i += 1) {
      tick(200);
      modalController.markNavigationChange({
        routeName: 'Home',
        routeKey: 'home-1',
      });
    }
    expect(visibility.Sheet).toBe(true);
  });

  it('treats an empty server route list as unrestricted', () => {
    const { visibility, bind } = setup();
    modalController.setPolicy({
      modals: { segment_opt_in: { allowed_routes: [] } },
    });
    modalController.setSignals({ routeName: 'Restaurant' });
    const segment = bind('segment_opt_in');
    segment.open();
    tick(modalController.resolvePolicy('segment_opt_in').delayMs);
    expect(visibility.segment_opt_in).toBe(true);
  });

  it('holds an automatic prompt for its policy delay', () => {
    const { visibility, bind } = setup();
    modalController.setSignals({ routeName: 'Home' });
    const segment = bind('segment_opt_in');
    segment.open();
    tick(9000);
    expect(visibility.segment_opt_in).toBeUndefined();
    tick(1000);
    expect(visibility.segment_opt_in).toBe(true);
  });

  it('runs whenIdle once the screen is free, afterTransitions once nothing is moving', () => {
    const { bind } = setup();
    const idle = jest.fn();
    const settled = jest.fn();
    const sheet = bind('Sheet');
    sheet.open();
    tick();
    modalController.whenIdle(idle);
    modalController.afterTransitions(settled);
    tick();
    expect(settled).not.toHaveBeenCalled();

    sheet.shown();
    expect(settled).toHaveBeenCalledTimes(1);
    expect(idle).not.toHaveBeenCalled();

    sheet.close();
    tick();
    sheet.dismissed();
    expect(idle).toHaveBeenCalledTimes(1);
  });

  it('holds root presents briefly after an idle waiter runs', () => {
    const { visibility, bind } = setup();
    const navigate = jest.fn();
    modalController.whenIdle(navigate);
    tick();
    expect(navigate).toHaveBeenCalled();
    const prompt = bind('Prompt');
    prompt.open();
    tick(TIMINGS.navigationSettleMs - 50);
    expect(visibility.Prompt).toBeUndefined();
    tick(60);
    expect(visibility.Prompt).toBe(true);
  });

  it('keeps root modals off native modal routes but lets their own modals present', () => {
    const { visibility, bind } = setup();
    modalController.markNavigationChange({
      routeName: 'OrderIssueModal',
      nativeModalRouteActive: true,
    });
    tick(TIMINGS.navigationSettleMs);
    const root = bind('Root');
    const insideRoute = bind('InsideRoute', {
      parentKey: 'screen:OrderIssueModal',
    });
    root.open();
    insideRoute.open();
    tick();
    expect(visibility).toEqual({ InsideRoute: true });
  });

  it('scopes a user-opened modal to the native modal route on top, but not an automatic prompt', () => {
    modalController.markNavigationChange({
      routeName: 'Pay',
      routeKey: 'a',
      nativeModalRoute: 'ChowpassUpgradePlan',
    });
    modalController.open('pay_online');
    modalController.open('order_rating');
    expect(modalController.getView('pay_online').hostScope).toBe(
      'screen:ChowpassUpgradePlan'
    );
    expect(modalController.getView('order_rating').hostScope).toBeNull();
    modalController.close('pay_online');
    modalController.markNavigationChange({
      routeName: 'Home',
      routeKey: 'b',
      nativeModalRoute: null,
    });
    modalController.open('pay_online');
    expect(modalController.getView('pay_online').hostScope).toBeNull();
  });

  it('publishes an event stream and stable per-id views', () => {
    const { bind } = setup();
    const seen: string[] = [];
    modalController.subscribeEvents(event => seen.push(event.type));
    const sheet = bind('Sheet');
    const before = modalController.getView('Other');
    sheet.open();
    tick();
    sheet.shown();
    expect(seen.filter(type => type !== 'bind_unregistered')).toEqual([
      'open',
      'present',
      'shown',
    ]);
    expect(modalController.getView('Other')).toBe(before);
    expect(modalController.getView('Sheet').isShown).toBe(true);
  });
});

describe('TEST_POLICIES', () => {
  it('gives every automatic prompt a distinct priority', () => {
    const priorities = Object.values(TEST_POLICIES).map(
      policy => policy.priority
    );
    expect(new Set(priorities).size).toBe(priorities.length);
  });
});
