/**
 * Redis Pub/Sub for real-time event broadcasting.
 *
 * Uses a dedicated Redis connection (separate from BullMQ) for pub/sub,
 * since ioredis in subscriber mode cannot execute other commands.
 *
 * Events are published as JSON strings to channels named:
 *   `realtime:tenant:{tenantId}`
 *
 * Supported event types:
 *   - message:created   → new message in a conversation
 *   - message:updated   → delivery status change
 *   - conversation:created → new conversation started
 *   - conversation:updated → conversation status/aiHandling changed
 */
import { Redis } from 'ioredis';
import { env } from '../config/env.js';
import { logger } from './logger.js';

// Subscriber connection (dedicated — enters subscriber mode)
let subscriberClient: Redis | null = null;
// Publisher connection (reuses main or creates dedicated)
let publisherClient: Redis | null = null;

export interface RealtimeEvent {
  type: 'message:created' | 'message:updated' | 'conversation:created' | 'conversation:updated';
  tenantId: string;
  payload: Record<string, unknown>;
}

function getChannelName(tenantId: string): string {
  return `realtime:tenant:${tenantId}`;
}

export function getPublisher(): Redis {
  if (!publisherClient) {
    publisherClient = new Redis(env.REDIS_URL, {
      maxRetriesPerRequest: null,
      lazyConnect: true,
    });
    publisherClient.on('error', (err) => {
      logger.error({ err }, '❌ Redis publisher error');
    });
    publisherClient.connect().catch(() => {});
  }
  return publisherClient;
}

export function getSubscriber(): Redis {
  if (!subscriberClient) {
    subscriberClient = new Redis(env.REDIS_URL, {
      maxRetriesPerRequest: null,
      lazyConnect: true,
    });
    subscriberClient.on('error', (err) => {
      logger.error({ err }, '❌ Redis subscriber error');
    });
    subscriberClient.connect().catch(() => {});
  }
  return subscriberClient;
}

/**
 * Publish a realtime event for a tenant.
 * Non-blocking — fire and forget. Errors are logged but don't propagate.
 */
export async function publishRealtimeEvent(event: RealtimeEvent): Promise<void> {
  try {
    const channel = getChannelName(event.tenantId);
    const message = JSON.stringify(event);
    await getPublisher().publish(channel, message);
    logger.debug({ channel, type: event.type }, 'realtime:published');
  } catch (err) {
    logger.warn({ err, event: event.type }, 'realtime:publish-failed (non-fatal)');
  }
}

/**
 * Subscribe to realtime events for a specific tenant.
 * Returns an unsubscribe function.
 */
export function subscribeToTenant(
  tenantId: string,
  callback: (event: RealtimeEvent) => void,
): () => void {
  const channel = getChannelName(tenantId);
  const subscriber = getSubscriber();

  const handler = (ch: string, message: string) => {
    if (ch !== channel) return;
    try {
      const event = JSON.parse(message) as RealtimeEvent;
      callback(event);
    } catch (err) {
      logger.warn({ err, channel }, 'realtime:parse-error');
    }
  };

  subscriber.subscribe(channel).catch((err) => {
    logger.error({ err, channel }, 'realtime:subscribe-failed');
  });
  subscriber.on('message', handler);

  return () => {
    subscriber.unsubscribe(channel).catch(() => {});
    subscriber.removeListener('message', handler);
  };
}

/**
 * Cleanup all pub/sub connections on shutdown.
 */
export async function closePubSub(): Promise<void> {
  if (subscriberClient) {
    subscriberClient.disconnect();
    subscriberClient = null;
  }
  if (publisherClient) {
    publisherClient.disconnect();
    publisherClient = null;
  }
}
