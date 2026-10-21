ALTER TABLE user_privacy_settings ADD COLUMN share_presence boolean NOT NULL DEFAULT false;

CREATE TABLE site_presence (
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  domain  text NOT NULL,
  seen_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, domain)
);
CREATE INDEX site_presence_domain_idx ON site_presence (domain, seen_at DESC);
