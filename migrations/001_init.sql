-- Orbit community: initial schema. All times are timestamptz (UTC).
-- Deletion policy: accounts are never hard-deleted by cascade from payments
-- or audit tables; social rows cascade from users, money and audit rows do not.

-- ---------------------------------------------------------------- identity
CREATE TABLE users (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username         text NOT NULL,
  username_lower   text GENERATED ALWAYS AS (lower(username)) STORED,
  email            text NOT NULL,
  email_normalized text NOT NULL,
  email_verified_at timestamptz,
  status           text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'deleted')),
  suspended_until  timestamptz,
  social_suspended_until timestamptz,
  -- Hidden by a moderator: the profile page answers as if it did not exist.
  profile_hidden   boolean NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  last_active_at   timestamptz,
  deleted_at       timestamptz,
  CHECK (username ~ '^[A-Za-z0-9_.-]{3,24}$')
);
CREATE UNIQUE INDEX users_username_lower_key ON users (username_lower);
CREATE UNIQUE INDEX users_email_normalized_key ON users (email_normalized);
CREATE INDEX users_created_at_idx ON users (created_at);

CREATE TABLE user_credentials (
  user_id             uuid PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  password_hash       text NOT NULL,
  password_changed_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE media (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id   uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  kind       text NOT NULL CHECK (kind IN ('avatar', 'banner', 'badge')),
  mime       text NOT NULL CHECK (mime IN ('image/png', 'image/jpeg', 'image/webp', 'image/gif')),
  bytes      bytea NOT NULL,
  size       integer NOT NULL,
  sha256     text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX media_owner_idx ON media (owner_id);

CREATE TABLE user_profiles (
  user_id         uuid PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  display_name    text CHECK (char_length(display_name) <= 40),
  bio             text CHECK (char_length(bio) <= 400),
  avatar_media_id uuid REFERENCES media (id) ON DELETE SET NULL,
  banner_media_id uuid REFERENCES media (id) ON DELETE SET NULL,
  theme_color     text NOT NULL DEFAULT 'violet',
  links           jsonb NOT NULL DEFAULT '[]',
  section_order   jsonb NOT NULL DEFAULT '["badges","sites","collections","interests","links"]',
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE user_privacy_settings (
  user_id               uuid PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  profile_public        boolean NOT NULL DEFAULT true,
  show_badges           boolean NOT NULL DEFAULT true,
  show_activity         boolean NOT NULL DEFAULT false,
  show_collections      boolean NOT NULL DEFAULT true,
  show_interests        boolean NOT NULL DEFAULT true,
  show_sites            boolean NOT NULL DEFAULT true,
  show_friend_count     boolean NOT NULL DEFAULT true,
  allow_friend_requests boolean NOT NULL DEFAULT true,
  discoverable          boolean NOT NULL DEFAULT false,
  share_sites_enabled   boolean NOT NULL DEFAULT false,
  show_stats            boolean NOT NULL DEFAULT false,
  social_disabled       boolean NOT NULL DEFAULT false,
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE user_preferences (
  user_id        uuid PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  notify         jsonb NOT NULL DEFAULT '{}',
  email_security boolean NOT NULL DEFAULT true,
  email_news     boolean NOT NULL DEFAULT false,
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE user_sessions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash   bytea NOT NULL UNIQUE,
  remember     boolean NOT NULL DEFAULT false,
  mfa_passed   boolean NOT NULL DEFAULT true,
  reauth_at    timestamptz,
  ip           text,
  user_agent   text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  revoked_at   timestamptz
);
CREATE INDEX user_sessions_user_idx ON user_sessions (user_id) WHERE revoked_at IS NULL;

CREATE TABLE email_verification_tokens (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash bytea NOT NULL UNIQUE,
  purpose    text NOT NULL CHECK (purpose IN ('verify', 'change')),
  email      text NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE password_reset_tokens (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash bytea NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE user_mfa_methods (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  type         text NOT NULL CHECK (type IN ('totp')),
  secret_enc   text NOT NULL,
  last_step    bigint,
  confirmed_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, type)
);

CREATE TABLE user_recovery_codes (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id   uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  code_hash bytea NOT NULL,
  used_at   timestamptz
);
CREATE INDEX user_recovery_codes_user_idx ON user_recovery_codes (user_id);

-- Prepared for Discord / Google / GitHub; no provider is enabled yet.
CREATE TABLE oauth_accounts (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  provider         text NOT NULL,
  provider_user_id text NOT NULL,
  linked_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_user_id)
);

-- Failed and successful sign-ins, for brute-force limits (kept 30 days).
CREATE TABLE login_attempts (
  id         bigserial PRIMARY KEY,
  key        text NOT NULL,
  success    boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX login_attempts_key_idx ON login_attempts (key, created_at);

-- ------------------------------------------------------------- permissions
CREATE TABLE roles (
  id   serial PRIMARY KEY,
  key  text NOT NULL UNIQUE,
  name text NOT NULL,
  rank integer NOT NULL
);

CREATE TABLE permissions (
  key         text PRIMARY KEY,
  description text NOT NULL
);

CREATE TABLE role_permissions (
  role_id        integer NOT NULL REFERENCES roles (id) ON DELETE CASCADE,
  permission_key text NOT NULL REFERENCES permissions (key) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_key)
);

CREATE TABLE user_roles (
  user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  role_id    integer NOT NULL REFERENCES roles (id),
  granted_by uuid REFERENCES users (id),
  granted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, role_id)
);

-- Append-only: a trigger refuses UPDATE and DELETE.
CREATE TABLE admin_audit_logs (
  id          bigserial PRIMARY KEY,
  actor_id    uuid REFERENCES users (id) ON DELETE SET NULL,
  action      text NOT NULL,
  target_type text,
  target_id   text,
  reason      text,
  meta        jsonb NOT NULL DEFAULT '{}',
  ip          text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX admin_audit_logs_created_idx ON admin_audit_logs (created_at DESC);

CREATE FUNCTION orbit_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END $$;
-- Deleting a user sets actor_id to NULL through the foreign key; that update is allowed.
CREATE FUNCTION orbit_audit_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.actor_id IS NULL AND OLD.actor_id IS NOT NULL
     AND NEW.action = OLD.action AND NEW.target_id IS NOT DISTINCT FROM OLD.target_id
     AND NEW.reason IS NOT DISTINCT FROM OLD.reason AND NEW.meta = OLD.meta AND NEW.created_at = OLD.created_at THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'admin_audit_logs is append-only';
END $$;
CREATE TRIGGER admin_audit_logs_guard BEFORE UPDATE OR DELETE ON admin_audit_logs
  FOR EACH ROW EXECUTE FUNCTION orbit_audit_guard();

CREATE TABLE admin_notes (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  author_id  uuid REFERENCES users (id) ON DELETE SET NULL,
  body       text NOT NULL CHECK (char_length(body) <= 2000),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app_settings (
  key        text PRIMARY KEY,
  value      jsonb NOT NULL,
  updated_by uuid REFERENCES users (id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------------ badges
CREATE TABLE badge_categories (
  key  text PRIMARY KEY,
  name text NOT NULL,
  sort integer NOT NULL
);

CREATE TABLE badges (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key           text NOT NULL UNIQUE CHECK (key ~ '^[a-z0-9_]{2,40}$'),
  name          text NOT NULL,
  description   text NOT NULL,
  icon          text NOT NULL,
  category_key  text NOT NULL REFERENCES badge_categories (key),
  rarity        text NOT NULL CHECK (rarity IN ('common', 'rare', 'epic', 'legendary', 'exclusive')),
  color         text NOT NULL,
  official      boolean NOT NULL DEFAULT false,
  -- Only the one-time owner bootstrap may award a protected badge (Founder).
  protected     boolean NOT NULL DEFAULT false,
  manual_award  boolean NOT NULL DEFAULT true,
  public        boolean NOT NULL DEFAULT true,
  status        text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled', 'retired')),
  permanent     boolean NOT NULL DEFAULT true,
  duration_days integer CHECK (duration_days > 0),
  condition     text NOT NULL DEFAULT '',
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE badge_rules (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  badge_id  uuid NOT NULL REFERENCES badges (id),
  rule_type text NOT NULL CHECK (rule_type IN ('donation_first', 'donation_total', 'subscription_active', 'role', 'account_age_days', 'event')),
  params    jsonb NOT NULL DEFAULT '{}',
  active    boolean NOT NULL DEFAULT true
);

CREATE TABLE user_badges (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  badge_id      uuid NOT NULL REFERENCES badges (id),
  source        text NOT NULL CHECK (source IN ('auto', 'manual', 'payment', 'event', 'contribution', 'bootstrap', 'role')),
  awarded_by    uuid REFERENCES users (id) ON DELETE SET NULL,
  awarded_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz,
  revoked_at    timestamptz,
  revoked_by    uuid REFERENCES users (id) ON DELETE SET NULL,
  revoke_reason text,
  featured      boolean NOT NULL DEFAULT false,
  verified      boolean NOT NULL DEFAULT true
);
-- One active copy of a badge per user.
CREATE UNIQUE INDEX user_badges_active_key ON user_badges (user_id, badge_id) WHERE revoked_at IS NULL;
CREATE INDEX user_badges_badge_idx ON user_badges (badge_id) WHERE revoked_at IS NULL;

CREATE TABLE badge_award_events (
  id            bigserial PRIMARY KEY,
  user_badge_id uuid REFERENCES user_badges (id) ON DELETE SET NULL,
  user_id       uuid REFERENCES users (id) ON DELETE SET NULL,
  badge_id      uuid NOT NULL REFERENCES badges (id),
  action        text NOT NULL CHECK (action IN ('award', 'revoke', 'expire')),
  actor_id      uuid REFERENCES users (id) ON DELETE SET NULL,
  source        text NOT NULL,
  reason        text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX badge_award_events_badge_idx ON badge_award_events (badge_id, created_at DESC);

-- --------------------------------------------------------------- donations
CREATE TABLE supporter_tiers (
  key            text PRIMARY KEY,
  badge_key      text NOT NULL REFERENCES badges (key),
  threshold_cents integer NOT NULL CHECK (threshold_cents > 0),
  sort           integer NOT NULL
);

CREATE TABLE subscriptions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid REFERENCES users (id) ON DELETE SET NULL,
  provider           text NOT NULL,
  provider_sub_id    text NOT NULL UNIQUE,
  status             text NOT NULL,
  amount_cents       integer,
  currency           text,
  current_period_end timestamptz,
  canceled_at        timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE donations (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid REFERENCES users (id) ON DELETE SET NULL,
  provider          text NOT NULL,
  checkout_ref      text UNIQUE,
  payment_ref       text UNIQUE,
  invoice_ref       text UNIQUE,
  subscription_id   uuid REFERENCES subscriptions (id),
  amount_cents      integer NOT NULL CHECK (amount_cents > 0),
  currency          text NOT NULL,
  status            text NOT NULL CHECK (status IN ('pending', 'succeeded', 'failed', 'canceled', 'refunded', 'partially_refunded', 'disputed')),
  refunded_cents    integer NOT NULL DEFAULT 0 CHECK (refunded_cents >= 0),
  recurring         boolean NOT NULL DEFAULT false,
  public_anonymous  boolean NOT NULL DEFAULT false,
  created_at        timestamptz NOT NULL DEFAULT now(),
  confirmed_at      timestamptz,
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX donations_user_idx ON donations (user_id);
CREATE INDEX donations_status_idx ON donations (status, created_at);

CREATE TABLE refunds (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  donation_id        uuid NOT NULL REFERENCES donations (id),
  provider_refund_id text NOT NULL UNIQUE,
  amount_cents       integer NOT NULL,
  status             text NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE payment_events (
  id          bigserial PRIMARY KEY,
  donation_id uuid REFERENCES donations (id),
  type        text NOT NULL,
  amount_cents integer,
  provider_event_id text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Every webhook event once, by the provider's event id (replays are ignored).
CREATE TABLE payment_webhook_events (
  id           text PRIMARY KEY,
  provider     text NOT NULL,
  type         text NOT NULL,
  payload      jsonb NOT NULL,
  status       text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processed', 'failed', 'ignored')),
  error        text,
  attempts     integer NOT NULL DEFAULT 0,
  received_at  timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);

-- --------------------------------------------------------------- community
CREATE TABLE friend_requests (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_user    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  to_user      uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  status       text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined', 'canceled')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  responded_at timestamptz,
  CHECK (from_user <> to_user)
);
-- One pending request per pair, whichever way it goes.
CREATE UNIQUE INDEX friend_requests_pending_key ON friend_requests (LEAST(from_user, to_user), GREATEST(from_user, to_user)) WHERE status = 'pending';

CREATE TABLE friendships (
  user_a     uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  user_b     uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_a, user_b),
  CHECK (user_a < user_b)
);
CREATE INDEX friendships_b_idx ON friendships (user_b);

CREATE TABLE user_blocks (
  blocker_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  blocked_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_id, blocked_id),
  CHECK (blocker_id <> blocked_id)
);

CREATE TABLE notifications (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  type        text NOT NULL,
  data        jsonb NOT NULL DEFAULT '{}',
  read_at     timestamptz,
  archived_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_user_idx ON notifications (user_id, created_at DESC) WHERE archived_at IS NULL;

CREATE TABLE reports (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id uuid REFERENCES users (id) ON DELETE SET NULL,
  target_type text NOT NULL CHECK (target_type IN ('user', 'collection')),
  target_id   uuid NOT NULL,
  reason      text NOT NULL CHECK (reason IN ('spam', 'harassment', 'impersonation', 'inappropriate', 'illegal', 'other')),
  details     text CHECK (char_length(details) <= 1000),
  status      text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'reviewing', 'resolved', 'dismissed')),
  handled_by  uuid REFERENCES users (id) ON DELETE SET NULL,
  resolution  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX reports_status_idx ON reports (status, created_at);

CREATE TABLE moderation_actions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  moderator_id  uuid REFERENCES users (id) ON DELETE SET NULL,
  user_id       uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  action        text NOT NULL CHECK (action IN ('warn', 'suspend_social', 'suspend', 'unsuspend', 'hide_profile', 'unhide_profile', 'hide_collection')),
  reason        text NOT NULL,
  until         timestamptz,
  report_id     uuid REFERENCES reports (id) ON DELETE SET NULL,
  appeal_text   text CHECK (char_length(appeal_text) <= 1000),
  appeal_status text CHECK (appeal_status IN ('pending', 'accepted', 'rejected')),
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX moderation_actions_user_idx ON moderation_actions (user_id, created_at DESC);

-- ------------------------------------------------------------ shared sites
-- Only what a member chose to share: a domain, never a browsing history.
CREATE TABLE shared_sites (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  domain     text NOT NULL CHECK (domain ~ '^[a-z0-9.-]{1,253}$'),
  note       text CHECK (char_length(note) <= 140),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, domain)
);
CREATE INDEX shared_sites_domain_idx ON shared_sites (domain);

CREATE TABLE site_collections (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  title       text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 60),
  description text CHECK (char_length(description) <= 280),
  public      boolean NOT NULL DEFAULT true,
  hidden      boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX site_collections_user_idx ON site_collections (user_id);

CREATE TABLE site_collection_items (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  collection_id uuid NOT NULL REFERENCES site_collections (id) ON DELETE CASCADE,
  url           text NOT NULL CHECK (char_length(url) <= 2000),
  title         text CHECK (char_length(title) <= 120),
  position      integer NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE user_interests (
  user_id  uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  interest text NOT NULL CHECK (interest ~ '^[a-z0-9-]{2,30}$'),
  PRIMARY KEY (user_id, interest)
);
CREATE INDEX user_interests_interest_idx ON user_interests (interest);
