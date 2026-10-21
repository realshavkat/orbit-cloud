// Orbit community API. Start: node api.mjs (Pelican: the Node.js server's startup).
import { loadDotEnv, config } from "./src/config.js";
import { createPool, migrate } from "./src/db.js";
import { buildApp } from "./src/app.js";
import { bootstrapOwner } from "./src/services/bootstrap.js";
import { expireBadges } from "./src/services/badges.js";

loadDotEnv();
const cfg = config();
const pool = createPool(cfg.databaseUrl);
const app = await buildApp({ cfg, pool });

app.log.info(`database: ${new URL(cfg.databaseUrl).host}`);
const applied = await migrate(pool);
if (applied.length) app.log.info({ applied }, "migrations applied");
await bootstrapOwner(pool, cfg.initialOwnerId, app.log);

// Housekeeping: expired badges hourly; old login attempts, tokens and sessions daily.
const hourly = setInterval(() => expireBadges(pool).catch(e => app.log.error(e)), 3600_000);
const daily = setInterval(async () => {
  try {
    await pool.query("DELETE FROM login_attempts WHERE created_at < now() - interval '30 days'");
    await pool.query("DELETE FROM email_verification_tokens WHERE expires_at < now() - interval '7 days'");
    await pool.query("DELETE FROM password_reset_tokens WHERE expires_at < now() - interval '7 days'");
    await pool.query("DELETE FROM user_sessions WHERE expires_at < now() - interval '30 days' OR revoked_at < now() - interval '30 days'");
    await pool.query("DELETE FROM notifications WHERE archived_at < now() - interval '90 days' OR created_at < now() - interval '1 year'");
    await bootstrapOwner(pool, cfg.initialOwnerId, app.log);
  } catch (e) {
    app.log.error(e, "housekeeping");
  }
}, 24 * 3600_000);

const stop = async () => {
  clearInterval(hourly);
  clearInterval(daily);
  await app.close();
  await pool.end();
  process.exit(0);
};
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
// Pelican sends "stop" on stdin.
process.stdin.on("data", d => String(d).trim() == "stop" && stop());

await app.listen({ port: cfg.port, host: cfg.host });
app.log.info(`Orbit API ready on ${cfg.baseUrl}`);
