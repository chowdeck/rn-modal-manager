import modalController, { TIMINGS } from '../modalController';
import { MODAL_PRIORITY, matchesRoute, resolveModalPolicy } from '../policy';
import { testing } from '../testing';

const visibility: Record<string, boolean> = {};
const bind = (id: string) =>
  modalController.bind(id, {
    setNativeVisible: value => {
      visibility[id] = value;
    },
  });
const tick = (ms = 0) => jest.advanceTimersByTime(ms);

describe('modalController.configure', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    modalController.configure({ policies: {}, signals: {} });
    modalController.__reset();
    Object.keys(visibility).forEach(key => delete visibility[key]);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('makes no id an automatic prompt until policies are configured', () => {
    // Splash not complete: a prompt would wait, a user modal does not.
    bind('promo');
    modalController.open('promo');
    tick();
    expect(visibility.promo).toBe(true);
    expect(modalController.inspect().entries[0]).toMatchObject({
      id: 'promo',
      auto: false,
      priority: MODAL_PRIORITY.user,
    });
  });

  it('turns the configured ids into automatic prompts', () => {
    modalController.configure({
      policies: { promo: { priority: MODAL_PRIORITY.marketing } },
    });
    bind('promo');
    modalController.open('promo');
    tick(1000);
    expect(visibility.promo).toBeUndefined();
    expect(modalController.resolvePolicy('promo')).toMatchObject({
      known: true,
      priority: MODAL_PRIORITY.marketing,
    });

    modalController.setSignals({ splashComplete: true });
    tick();
    expect(visibility.promo).toBe(true);
  });

  it('replaces the previous policy set', () => {
    modalController.configure({ policies: { a: { priority: 10 } } });
    modalController.configure({ policies: { b: { priority: 20 } } });
    expect(modalController.resolvePolicy('a').known).toBe(false);
    expect(modalController.resolvePolicy('b').known).toBe(true);
    expect(Object.keys(modalController.getPolicies())).toEqual(['b']);
  });

  it('keeps policies across __reset and re-applies configured signals', () => {
    modalController.configure({
      policies: { promo: { priority: 10 } },
      signals: { splashComplete: true },
    });
    modalController.setSignals({ splashComplete: false });
    modalController.__reset();
    expect(modalController.resolvePolicy('promo').known).toBe(true);
    expect(modalController.getSignals().splashComplete).toBe(true);
    bind('promo');
    modalController.open('promo');
    tick();
    expect(visibility.promo).toBe(true);
  });

  it('lets the server switch a configured prompt off', () => {
    modalController.configure({
      policies: { promo: { priority: 10 } },
      signals: { splashComplete: true },
    });
    modalController.setPolicy({ modals: { promo: { enabled: false } } });
    bind('promo');
    modalController.open('promo');
    tick(5000);
    expect(visibility.promo).toBeUndefined();
    modalController.setPolicy(null);
    tick();
    expect(visibility.promo).toBe(true);
  });

  it('routes reporter issues and accepts timing overrides', () => {
    const issues: string[] = [];
    const before = { ...TIMINGS };
    modalController.configure({
      reporter: { issue: type => issues.push(type) },
      timings: { presentTimeoutMs: 100 },
    });
    try {
      bind('Dropped');
      modalController.open('Dropped');
      tick();
      tick(100);
      expect(issues).toEqual(['present_timeout']);
    } finally {
      modalController.configure({ timings: before });
    }
  });
});

describe('resolveModalPolicy / matchesRoute', () => {
  const policies = {
    rating: {
      priority: 35,
      delayMs: 500,
      blockedRoutes: [/Checkout/],
      waitForSplash: false,
    },
  };

  it('merges the shipped policy with the snake_case server override', () => {
    expect(resolveModalPolicy('rating', null, policies)).toEqual({
      known: true,
      enabled: true,
      priority: 35,
      delayMs: 500,
      waitForSplash: false,
      allowedRoutes: null,
      blockedRoutes: [/Checkout/],
    });
    expect(
      resolveModalPolicy(
        'rating',
        {
          modals: {
            rating: {
              priority: 15,
              delay_ms: 0,
              allowed_routes: ['Home'],
              blocked_routes: [],
            },
          },
        },
        policies
      )
    ).toMatchObject({
      priority: 15,
      delayMs: 0,
      allowedRoutes: ['Home'],
      // An empty server list means "no restriction": it lifts the shipped one.
      blockedRoutes: null,
    });
  });

  it('treats unknown ids as user modals at the default priority', () => {
    expect(resolveModalPolicy('other', null, policies)).toMatchObject({
      known: false,
      priority: MODAL_PRIORITY.default,
    });
    expect(resolveModalPolicy('toString', null, {}).known).toBe(false);
  });

  it('matches exact names, regexes and slash-wrapped regex source', () => {
    expect(matchesRoute(['Home'], 'Home')).toBe(true);
    expect(matchesRoute(['Home'], 'HomeTab')).toBe(false);
    expect(matchesRoute([/Review$/], 'RiderReview')).toBe(true);
    expect(matchesRoute(['/Checkout/'], 'RestaurantCheckout')).toBe(true);
    expect(matchesRoute(['/[/'], 'anything')).toBe(false);
    expect(matchesRoute(['Home'], undefined)).toBe(false);
    expect(matchesRoute(null, 'Home')).toBe(false);
  });
});

describe('testing helpers', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    Object.keys(visibility).forEach(key => delete visibility[key]);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('reset({ passThrough }) honours every open at once', () => {
    testing.reset({ passThrough: true });
    expect(modalController.isEnabled()).toBe(false);
    bind('A');
    bind('B');
    modalController.open('A');
    modalController.open('B');
    expect(visibility).toEqual({ A: true, B: true });
  });

  it('completeTransitions() drives a modal through its native callbacks', () => {
    testing.reset();
    expect(modalController.isEnabled()).toBe(true);
    const then = jest.fn();
    bind('Sheet');
    modalController.open('Sheet');
    tick();
    expect(testing.completeTransitions()).toBe(1);
    expect(modalController.getView('Sheet').phase).toBe('shown');
    modalController.close('Sheet', { then });
    tick();
    testing.completeTransitions();
    expect(modalController.getView('Sheet').phase).toBe('idle');
    expect(then).toHaveBeenCalledTimes(1);
  });
});
