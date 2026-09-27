// Section 8 "Period": paid plans use the Stripe period; FREE plans use monthly periods anchored at
// organizations.quotaAnchorAt — this computes that anchored window for "now" without a reset job.
export function anchoredMonthlyPeriod(anchor: Date, now: Date = new Date()): { periodStart: Date; periodEnd: Date } {
  const addMonths = (date: Date, months: number): Date => {
    const result = new Date(date.getTime());
    result.setUTCMonth(result.getUTCMonth() + months);
    return result;
  };

  // How many whole anchor-months have elapsed by `now`?
  let periodsElapsed = (now.getUTCFullYear() - anchor.getUTCFullYear()) * 12 + (now.getUTCMonth() - anchor.getUTCMonth());
  if (addMonths(anchor, periodsElapsed) > now) periodsElapsed -= 1;

  const periodStart = addMonths(anchor, periodsElapsed);
  const periodEnd = addMonths(anchor, periodsElapsed + 1);
  return { periodStart, periodEnd };
}
