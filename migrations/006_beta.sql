ALTER TABLE donations ADD COLUMN purpose text NOT NULL DEFAULT 'donation' CHECK (purpose IN ('donation', 'beta'));

CREATE TABLE beta_grants (
  id            bigserial PRIMARY KEY,
  user_id       uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  granted_by    uuid REFERENCES users (id) ON DELETE SET NULL,
  reason        text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  revoked_at    timestamptz,
  revoked_by    uuid REFERENCES users (id) ON DELETE SET NULL,
  revoke_reason text
);
CREATE UNIQUE INDEX beta_grants_active_idx ON beta_grants (user_id) WHERE revoked_at IS NULL;

INSERT INTO app_settings (key, value) VALUES ('beta', '{"paywall": true, "price_cents": 200}') ON CONFLICT (key) DO NOTHING;

INSERT INTO permissions (key, description) VALUES ('beta.grant', 'Give or remove beta access by hand');
INSERT INTO role_permissions (role_id, permission_key)
SELECT r.id, 'beta.grant' FROM roles r WHERE r.key IN ('administrator', 'owner');
