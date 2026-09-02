import 'dotenv/config';
import { loadConfig } from './config';
import { createHistoryGateway } from './telegram-gramjs';
import { createBotGateway } from './telegram-bot';
import { onNewMessage, onEditedMessage } from './handlers';
import { reconcileBalance } from './reconcile';
import { scheduleMonthlyBanner } from './scheduler';
import { postMonthBanner } from './banner';
import { previousBucket } from './dates';
import { isOnline, retry, startHealthMonitor, startWakeDetector, watchdogLog } from './watchdog';

/** Backoff for the catch-up reconcile after a wake, while Wi-Fi comes back. */
const WAKE_RECONCILE_DELAYS_MS = [5_000, 20_000, 60_000] as const;

async function main(): Promise<void> {
  const config = loadConfig();
  const chatId = config.groupChatId;

  const { botGateway, botUserId, onUpdate, startPolling, isPollingHealthy, dropStaleSockets } =
    await createBotGateway(config);
  const { historyGateway, isConnected, ensureConnected, reconnect } =
    await createHistoryGateway(config, botUserId);

  // Catch up on anything missed while offline (settles previous + current month).
  try {
    await reconcileBalance(historyGateway, botGateway, config, chatId, 'previous');
  } catch (err) {
    console.warn('Startup reconcile failed; continuing:', err);
  }

  onUpdate(async (kind, ev) => {
    try {
      if (kind === 'new') await onNewMessage(historyGateway, botGateway, config, chatId, ev);
      else await onEditedMessage(botGateway, config, chatId, ev);
    } catch (err) {
      console.error(`Update handler failed (kind=${kind}, messageId=${ev.messageId}):`, err);
      // A command that answers with silence is indistinguishable from a dead
      // bot, which is what sends the user to restart it. Say so instead; the
      // watchdog is already healing whatever broke.
      if (kind === 'new' && ev.text.startsWith('/')) {
        await botGateway
          .sendMessage(chatId, '⚠️ Не вдалося виконати команду. Спробуйте ще раз за хвилину.')
          .catch((sendErr) => console.error('Failed to report handler error:', sendErr));
      }
    }
  });

  scheduleMonthlyBanner(config.timezone, async () => {
    try {
      // Settle the just-ended month, then post its banner.
      const bucket = previousBucket(config.timezone);
      await reconcileBalance(historyGateway, botGateway, config, chatId, 'previous');
      await postMonthBanner(botGateway, chatId, bucket);
    } catch (err) {
      console.error('Monthly banner cron failed:', err);
    }
  });

  // Both connections die silently when the laptop sleeps: the Bot API sockets
  // become unusable zombies, and the MTProto sender needs a nudge to come back.
  // A detected wake heals both without waiting for a health check to notice
  // (`force`); a health check only touches the half that actually looks broken.
  async function recoverConnections(reason: string, force = false): Promise<void> {
    watchdogLog('warn', `recovering connections (${reason})`);
    if (force || !isPollingHealthy()) dropStaleSockets();
    if (force || !isConnected()) {
      await (force ? reconnect() : ensureConnected()).catch((err) =>
        watchdogLog('error', `MTProto reconnect failed: ${String(err)}`),
      );
    }
  }

  startWakeDetector({
    onWake: (gapMs) => {
      void (async () => {
        watchdogLog('warn', `wake detected after ${Math.round(gapMs / 1000)}s asleep`);
        await recoverConnections('wake', true);
        // Long polling replays the last 24h on its own; this covers a longer
        // sleep, where Telegram has already dropped those updates.
        await retry(
          () => reconcileBalance(historyGateway, botGateway, config, chatId, 'previous'),
          WAKE_RECONCILE_DELAYS_MS,
        ).catch((err) => watchdogLog('error', `post-wake reconcile failed: ${String(err)}`));
      })();
    },
  });

  startHealthMonitor({
    check: async () => {
      const polling = isPollingHealthy();
      const mtproto = isConnected();
      if (polling && mtproto) return true;
      // Being offline is not the same as being broken: while the machine has
      // no network there is nothing to repair and nothing a restart would fix.
      if (!(await isOnline())) return true;
      // Name the sick half. Without this the log only says "unhealthy", and
      // telling a real fault from a watchdog of its own making means guessing.
      watchdogLog('warn', `sick: ${polling ? '' : 'polling '}${mtproto ? '' : 'mtproto'}`.trim());
      return false;
    },
    recover: () => recoverConnections('health check'),
    onGiveUp: () => {
      watchdogLog('error', 'still unhealthy after repeated recovery; exiting for a restart');
      process.exit(1);
    },
  });

  startPolling((err) => {
    console.error('Long polling stopped:', err);
    process.exit(1);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
