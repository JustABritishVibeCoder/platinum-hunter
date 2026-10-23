/**
 * PSN sync is opt-in (settings.psn.optIn) and rate-limited; see `psnPolicy.ts`.
 * This text explains the risk wherever the opt-in is offered.
 */
export const PSN_RISK_TEXT =
  "Sony has no official trophy API. PSN sync uses the same unofficial sign-in as Sony's own app, and an account was locked after using it before. Platinum Hunter keeps requests to a minimum (one sync per hour, at most 20 requests per hour), but the risk to your account cannot be removed. Only turn this on if you accept that.";
