CREATE TABLE beta_keys (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key_hash      bytea NOT NULL UNIQUE,
  key_enc       text NOT NULL,
  last4         text NOT NULL,
  user_id       uuid REFERENCES users (id) ON DELETE SET NULL,
  source        text NOT NULL CHECK (source IN ('payment', 'grant', 'manual')),
  note          text CHECK (char_length(note) <= 200),
  max_devices   smallint NOT NULL DEFAULT 3 CHECK (max_devices BETWEEN 1 AND 20),
  created_by    uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  revoked_at    timestamptz,
  revoke_reason text
);
CREATE INDEX beta_keys_user_idx ON beta_keys (user_id) WHERE revoked_at IS NULL;

CREATE TABLE beta_activations (
  key_id      uuid NOT NULL REFERENCES beta_keys (id) ON DELETE CASCADE,
  device_hash bytea NOT NULL,
  first_seen  timestamptz NOT NULL DEFAULT now(),
  last_seen   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (key_id, device_hash)
);
