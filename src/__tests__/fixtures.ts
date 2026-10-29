import { MODAL_PRIORITY } from '../policy';
import type { ModalPolicies } from '../types';

// The customer app's prompt policies at the time of the port: the controller tests
// were written against them.
export const TEST_POLICIES: ModalPolicies = {
  force_update: { priority: MODAL_PRIORITY.blocking },
  welcome_to_chowdeck: { priority: MODAL_PRIORITY.onboarding },
  select_address: { priority: MODAL_PRIORITY.required },
  potential_failed_delivery: { priority: MODAL_PRIORITY.orderCritical + 5 },
  failed_delivery: { priority: MODAL_PRIORITY.orderCritical },
  delayed_order: { priority: MODAL_PRIORITY.orderCritical - 2 },
  order_extra_pack: { priority: MODAL_PRIORITY.orderCritical - 5 },
  order_pin_info: {
    priority: MODAL_PRIORITY.orderCritical - 11,
    allowedRoutes: ['TrackOrder'],
  },
  survey_acquisition: { priority: MODAL_PRIORITY.feedback + 5 },
  order_rating: {
    priority: MODAL_PRIORITY.feedback,
    blockedRoutes: [/Checkout/, /Review$/],
  },
  survey_custom: {
    priority: MODAL_PRIORITY.feedback - 5,
    blockedRoutes: [/Checkout/],
  },
  chowscore_announcement: {
    priority: MODAL_PRIORITY.marketing + 5,
    blockedRoutes: [/Checkout/],
    delayMs: 1200,
  },
  segment_opt_in: {
    priority: MODAL_PRIORITY.marketing + 2,
    allowedRoutes: ['Home'],
    delayMs: 10000,
  },
  in_app_message: {
    priority: MODAL_PRIORITY.marketing,
    blockedRoutes: [/Checkout/],
  },
};

export const setPlatform = (os: 'ios' | 'android'): void => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  (require('react-native').Platform as { OS: string }).OS = os;
};
