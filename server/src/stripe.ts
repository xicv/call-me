/**
 * Stripe Integration for Subscriptions
 *
 * $20/month subscription with included minutes
 */

import Stripe from 'stripe';
import {
  getUserByStripeCustomerId,
  getUserByStripeSubscriptionId,
  getUserById,
  updateUserStripeCustomerId,
  updateUserSubscription,
  cancelUserSubscription,
  resetUserMinutes,
  addCreditMinutes,
} from './database.js';

let stripe: Stripe | null = null;

export interface SubscriptionConfig {
  secretKey: string;
  webhookSecret: string;
  priceId: string;           // Stripe Price ID for the subscription
  monthlyMinutes: number;    // Minutes included per month
  monthlyPriceCents: number; // Price in cents (for display)
  creditPricePerMinute: number; // Price per credit minute in cents (default: 50 = $0.50)
}

// Credit packages available for purchase
export const CREDIT_PACKAGES = [
  { minutes: 30, label: '30 minutes' },
  { minutes: 60, label: '60 minutes' },
  { minutes: 120, label: '120 minutes' },
] as const;

let config: SubscriptionConfig | null = null;

export function initStripe(stripeConfig: SubscriptionConfig): void {
  config = stripeConfig;
  stripe = new Stripe(stripeConfig.secretKey, { apiVersion: '2024-12-18.acacia' });
  console.error(`Stripe initialized: $${stripeConfig.monthlyPriceCents / 100}/mo, ${stripeConfig.monthlyMinutes} min`);
}

export function isStripeEnabled(): boolean {
  return stripe !== null;
}

export function getStripe(): Stripe {
  if (!stripe) throw new Error('Stripe not initialized');
  return stripe;
}

export function getSubscriptionConfig(): SubscriptionConfig | null {
  return config;
}

export function getMonthlyMinutes(): number {
  return config?.monthlyMinutes || 60;
}

export function getMonthlyPriceCents(): number {
  return config?.monthlyPriceCents || 2000;
}

export function getCreditPricePerMinute(): number {
  return config?.creditPricePerMinute || 50; // Default $0.50/min
}

/**
 * Create a Stripe customer for a user
 */
export async function createStripeCustomer(userId: string, email: string): Promise<string> {
  const s = getStripe();

  const customer = await s.customers.create({
    email,
    metadata: { userId },
  });

  updateUserStripeCustomerId(userId, customer.id);
  return customer.id;
}

/**
 * Create a Checkout Session for subscription
 */
export async function createSubscriptionCheckout(
  userId: string,
  successUrl: string,
  cancelUrl: string
): Promise<string> {
  const s = getStripe();
  const user = getUserById(userId);

  if (!user) throw new Error('User not found');
  if (!config?.priceId) throw new Error('Stripe price ID not configured');

  let customerId = user.stripe_customer_id;
  if (!customerId) {
    customerId = await createStripeCustomer(userId, user.email);
  }

  const session = await s.checkout.sessions.create({
    customer: customerId,
    payment_method_types: ['card'],
    line_items: [{ price: config.priceId, quantity: 1 }],
    mode: 'subscription',
    success_url: successUrl,
    cancel_url: cancelUrl,
    metadata: { userId },
  });

  return session.url!;
}

/**
 * Create a Checkout Session for purchasing credit minutes
 */
export async function createCreditCheckout(
  userId: string,
  minutes: number,
  successUrl: string,
  cancelUrl: string
): Promise<string> {
  const s = getStripe();
  const user = getUserById(userId);

  if (!user) throw new Error('User not found');

  let customerId = user.stripe_customer_id;
  if (!customerId) {
    customerId = await createStripeCustomer(userId, user.email);
  }

  const pricePerMin = getCreditPricePerMinute();
  const totalCents = pricePerMin * minutes;

  const session = await s.checkout.sessions.create({
    customer: customerId,
    payment_method_types: ['card'],
    line_items: [{
      price_data: {
        currency: 'usd',
        product_data: {
          name: `${minutes} Credit Minutes`,
          description: 'Additional call minutes for CallMe',
        },
        unit_amount: totalCents,
      },
      quantity: 1,
    }],
    mode: 'payment',
    success_url: successUrl,
    cancel_url: cancelUrl,
    metadata: { userId, creditMinutes: minutes.toString() },
  });

  return session.url!;
}

/**
 * Create a billing portal session for managing subscription
 */
export async function createBillingPortal(userId: string, returnUrl: string): Promise<string> {
  const s = getStripe();
  const user = getUserById(userId);

  if (!user?.stripe_customer_id) {
    throw new Error('No Stripe customer');
  }

  const session = await s.billingPortal.sessions.create({
    customer: user.stripe_customer_id,
    return_url: returnUrl,
  });

  return session.url;
}

/**
 * Handle Stripe webhook events
 */
export async function handleWebhook(payload: string, signature: string): Promise<void> {
  const s = getStripe();

  if (!config?.webhookSecret) {
    throw new Error('Webhook secret not configured');
  }

  const event = s.webhooks.constructEvent(payload, signature, config.webhookSecret);

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session;
      // Handle credit purchase (one-time payment)
      if (session.mode === 'payment' && session.metadata?.creditMinutes) {
        const userId = session.metadata.userId;
        const creditMinutes = parseInt(session.metadata.creditMinutes, 10);
        if (userId && creditMinutes > 0) {
          const newBalance = addCreditMinutes(userId, creditMinutes);
          console.error(`Added ${creditMinutes} credit minutes to user ${userId} (new balance: ${newBalance})`);
        }
      }
      break;
    }

    case 'customer.subscription.created':
    case 'customer.subscription.updated': {
      const subscription = event.data.object as Stripe.Subscription;
      await handleSubscriptionUpdate(subscription);
      break;
    }

    case 'customer.subscription.deleted': {
      const subscription = event.data.object as Stripe.Subscription;
      const user = getUserByStripeSubscriptionId(subscription.id);
      if (user) {
        cancelUserSubscription(user.id);
        console.error(`Subscription cancelled for user ${user.id}`);
      }
      break;
    }

    case 'invoice.paid': {
      const invoice = event.data.object as Stripe.Invoice;
      if (invoice.subscription) {
        // Reset minutes on successful payment (new billing period)
        const user = getUserByStripeSubscriptionId(invoice.subscription as string);
        if (user && invoice.period_start && invoice.period_end) {
          resetUserMinutes(
            user.id,
            new Date(invoice.period_start * 1000),
            new Date(invoice.period_end * 1000)
          );
          console.error(`Reset minutes for user ${user.id} (new billing period)`);
        }
      }
      break;
    }

    default:
      // Ignore other events
      break;
  }
}

async function handleSubscriptionUpdate(subscription: Stripe.Subscription): Promise<void> {
  const customerId = subscription.customer as string;
  const user = getUserByStripeCustomerId(customerId);

  if (!user) {
    console.error(`No user found for customer ${customerId}`);
    return;
  }

  const status = subscription.status === 'active' ? 'active' :
                 subscription.status === 'canceled' ? 'cancelled' : 'none';

  updateUserSubscription(
    user.id,
    subscription.id,
    status,
    new Date(subscription.current_period_start * 1000),
    new Date(subscription.current_period_end * 1000)
  );

  console.error(`Subscription ${status} for user ${user.id}`);
}
