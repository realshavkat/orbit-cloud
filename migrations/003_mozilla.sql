-- One-time codes handing a verified Mozilla identity from the browser to the site.
CREATE TABLE auth_handoffs (
  token_hash       bytea PRIMARY KEY,
  provider         text NOT NULL CHECK (provider IN ('mozilla')),
  provider_user_id text NOT NULL,
  email            text NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  expires_at       timestamptz NOT NULL,
  used_at          timestamptz
);
CREATE INDEX auth_handoffs_expires_idx ON auth_handoffs (expires_at);
