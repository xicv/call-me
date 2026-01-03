/**
 * Subscription Billing Configuration
 *
 * $20/month includes 60 minutes
 * Additional credits: $0.50/minute
 */

export interface SubscriptionPlan {
  monthlyPriceCents: number;
  monthlyMinutes: number;
  creditPricePerMinute: number;
}

let plan: SubscriptionPlan = {
  monthlyPriceCents: 2000,    // $20
  monthlyMinutes: 60,         // 60 minutes
  creditPricePerMinute: 50,   // $0.50 per minute
};

export function loadBillingConfig(): void {
  plan = {
    monthlyPriceCents: parseInt(process.env.MONTHLY_PRICE_CENTS || '2000', 10),
    monthlyMinutes: parseInt(process.env.MONTHLY_MINUTES || '60', 10),
    creditPricePerMinute: parseInt(process.env.CREDIT_PRICE_PER_MINUTE || '50', 10),
  };

  console.error(`Plan: $${plan.monthlyPriceCents / 100}/mo, ${plan.monthlyMinutes} minutes`);
  console.error(`Credits: $${(plan.creditPricePerMinute / 100).toFixed(2)}/minute`);
}

export function getMonthlyPriceCents(): number {
  return plan.monthlyPriceCents;
}

export function getMonthlyMinutes(): number {
  return plan.monthlyMinutes;
}

export function getCreditPricePerMinute(): number {
  return plan.creditPricePerMinute;
}

export function getMinutesRemaining(minutesUsed: number): number {
  return Math.max(0, plan.monthlyMinutes - minutesUsed);
}

export function hasMinutesRemaining(minutesUsed: number): boolean {
  return minutesUsed < plan.monthlyMinutes;
}

/**
 * Check if user can make calls (has subscription minutes OR credits)
 */
export function canMakeCalls(minutesUsed: number, creditMinutes: number): boolean {
  return minutesUsed < plan.monthlyMinutes || creditMinutes > 0;
}

/**
 * Get total available minutes (subscription remaining + credits)
 */
export function getTotalAvailableMinutes(minutesUsed: number, creditMinutes: number): number {
  const subscriptionRemaining = getMinutesRemaining(minutesUsed);
  return subscriptionRemaining + creditMinutes;
}
