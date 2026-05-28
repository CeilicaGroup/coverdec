import cron from "node-cron";
import { childLogger } from "@/lib/logger";
import {
  processOutboxBatch,
  scanAttendanceIncidents,
  scanAssignedTasksNotLogged,
  scanProjectSlipping,
} from "@/features/notifications/worker";

const log = childLogger({ module: "worker.notifications" });
const TZ = process.env.NOTIFICATION_CRON_TZ ?? "Europe/Madrid";

async function processOutboxLoop() {
  try {
    const processed = await processOutboxBatch();
    if (processed > 0) {
      log.info({ processed }, "notification outbox batch processed");
    }
  } catch (err) {
    log.error(
      { error: err instanceof Error ? err.message : String(err) },
      "notification outbox loop failed",
    );
  }
}

async function runGeneralPass() {
  log.info("general notifications pass start");
  await processOutboxLoop();
  try {
    await scanProjectSlipping();
    log.info("project slipping scan done");
  } catch (err) {
    log.error(
      { error: err instanceof Error ? err.message : String(err) },
      "project slipping scan failed",
    );
  }
  try {
    await scanAssignedTasksNotLogged();
    log.info("assigned tasks not logged scan done");
  } catch (err) {
    log.error(
      { error: err instanceof Error ? err.message : String(err) },
      "assigned tasks not logged scan failed",
    );
  }
  try {
    await scanAttendanceIncidents();
    log.info("attendance incidents scan done");
  } catch (err) {
    log.error(
      { error: err instanceof Error ? err.message : String(err) },
      "attendance incidents scan failed",
    );
  }
  await processOutboxLoop();
  log.info("general notifications pass end");
}

log.info({ timezone: TZ }, "notifications worker started");

void runGeneralPass();

cron.schedule(
  "*/10 * * * * *",
  () => {
    void processOutboxLoop();
  },
  { timezone: TZ },
);

cron.schedule(
  "* * * * *",
  () => {
    void runGeneralPass();
  },
  { timezone: TZ },
);

cron.schedule(
  "0 8 * * *",
  () => {
    void scanProjectSlipping().catch((err) => {
      log.error(
        { error: err instanceof Error ? err.message : String(err) },
        "project slipping scan failed",
      );
    });
  },
  { timezone: TZ },
);

cron.schedule(
  "0 18 * * *",
  () => {
    void scanAssignedTasksNotLogged().catch((err) => {
      log.error(
        { error: err instanceof Error ? err.message : String(err) },
        "assigned tasks not logged scan failed",
      );
    });
  },
  { timezone: TZ },
);

cron.schedule(
  "*/30 * * * *",
  () => {
    void scanAttendanceIncidents().catch((err) => {
      log.error(
        { error: err instanceof Error ? err.message : String(err) },
        "attendance incidents scan failed",
      );
    });
  },
  { timezone: TZ },
);
