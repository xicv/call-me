/**
 * Usage Tracking and Billing
 *
 * Tracks per-minute usage and calculates costs based on configurable multiplier.
 */

export interface UsageRecord {
  userId: string;
  callId: string;
  startTime: Date;
  endTime?: Date;
  durationSeconds: number;
  costCents: number;
}

export interface PricingConfig {
  // Base costs per minute (in cents)
  twilioCostPerMin: number;      // ~1-2 cents
  whisperCostPerMin: number;     // ~0.6 cents
  ttsCostPerMin: number;         // ~4 cents
  // Markup multiplier (e.g., 2.0 = 100% markup)
  priceMultiplier: number;
}

// In production, this would be a database
const usageRecords: UsageRecord[] = [];
const activeCallStarts = new Map<string, { userId: string; startTime: Date }>();

let pricingConfig: PricingConfig = {
  twilioCostPerMin: 2,    // $0.02
  whisperCostPerMin: 1,   // $0.01 (rounded up from 0.6)
  ttsCostPerMin: 5,       // $0.05
  priceMultiplier: 2.0,   // 100% markup = charge 2x cost
};

export function loadPricingConfig(): void {
  pricingConfig = {
    twilioCostPerMin: parseFloat(process.env.TWILIO_COST_PER_MIN || '2'),
    whisperCostPerMin: parseFloat(process.env.WHISPER_COST_PER_MIN || '1'),
    ttsCostPerMin: parseFloat(process.env.TTS_COST_PER_MIN || '5'),
    priceMultiplier: parseFloat(process.env.PRICE_MULTIPLIER || '2.0'),
  };
  console.error(`Pricing config loaded: base cost ${getBaseCostPerMin()}¢/min, multiplier ${pricingConfig.priceMultiplier}x, final ${getPricePerMin()}¢/min`);
}

export function getPricingConfig(): PricingConfig {
  return { ...pricingConfig };
}

export function getBaseCostPerMin(): number {
  return pricingConfig.twilioCostPerMin + pricingConfig.whisperCostPerMin + pricingConfig.ttsCostPerMin;
}

export function getPricePerMin(): number {
  return Math.ceil(getBaseCostPerMin() * pricingConfig.priceMultiplier);
}

export function startCallTracking(callId: string, userId: string): void {
  activeCallStarts.set(callId, { userId, startTime: new Date() });
}

export function endCallTracking(callId: string): UsageRecord | null {
  const start = activeCallStarts.get(callId);
  if (!start) {
    return null;
  }

  activeCallStarts.delete(callId);

  const endTime = new Date();
  const durationSeconds = Math.ceil((endTime.getTime() - start.startTime.getTime()) / 1000);
  const durationMinutes = Math.ceil(durationSeconds / 60);
  const costCents = durationMinutes * getPricePerMin();

  const record: UsageRecord = {
    userId: start.userId,
    callId,
    startTime: start.startTime,
    endTime,
    durationSeconds,
    costCents,
  };

  usageRecords.push(record);
  console.error(`Call ${callId} ended: ${durationSeconds}s, charged ${costCents}¢ to user ${start.userId}`);

  return record;
}

export function getUserUsage(userId: string): { totalCalls: number; totalMinutes: number; totalCostCents: number } {
  const userRecords = usageRecords.filter((r) => r.userId === userId);
  return {
    totalCalls: userRecords.length,
    totalMinutes: Math.ceil(userRecords.reduce((sum, r) => sum + r.durationSeconds, 0) / 60),
    totalCostCents: userRecords.reduce((sum, r) => sum + r.costCents, 0),
  };
}

export function getAllUsage(): UsageRecord[] {
  return [...usageRecords];
}
