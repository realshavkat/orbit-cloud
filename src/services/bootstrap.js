// One-time owner setup. INITIAL_OWNER_ID (an account id set on the server,
// never sent by a browser) becomes Owner and receives the Founder badge.
// Once done, app_settings.owner_bootstrap is set and this never runs again:
// there is no endpoint that can create an owner.
import { tx } from "../db.js";
import { audit } from "./core.js";
import { awardBadge, syncRoleBadges } from "./badges.js";

export async function bootstrapOwner(pool, ownerId, log) {
  if (!ownerId) return "not_configured";
  return tx(pool, async db => {
    await db.query("SELECT pg_advisory_xact_lock(727275)");
    const { rows: done } = await db.query("SELECT value FROM app_settings WHERE key = 'owner_bootstrap'");
    if (done.length) {
      if (done[0].value.user_id != ownerId) log.warn("INITIAL_OWNER_ID differs from the bootstrapped owner; ignored");
      return "already_done";
    }
    if (!/^[0-9a-f-]{36}$/i.test(ownerId)) throw new Error("INITIAL_OWNER_ID is not a UUID");
    const { rows: [user] } = await db.query("SELECT id, status, email_verified_at FROM users WHERE id = $1", [ownerId]);
    if (!user || user.status != "active" || !user.email_verified_at) {
      log.warn("owner bootstrap waiting: the account must exist, be active and have a verified e-mail");
      return "waiting";
    }
    await db.query(
      "INSERT INTO user_roles (user_id, role_id) SELECT $1, id FROM roles WHERE key = 'owner' ON CONFLICT DO NOTHING", [ownerId]);
    await awardBadge(db, { userId: ownerId, badgeKey: "founder", source: "bootstrap", reason: "owner bootstrap" });
    await syncRoleBadges(db, ownerId);
    await db.query("INSERT INTO app_settings (key, value) VALUES ('owner_bootstrap', $1)", [{ user_id: ownerId, at: new Date() }]);
    await audit(db, { actorId: ownerId, action: "owner.bootstrap", targetType: "user", targetId: ownerId });
    log.info("owner bootstrap done");
    return "done";
  });
}
