-- Orbit Mods: community mods, each version reviewed by staff before it is listed.
ALTER TABLE media DROP CONSTRAINT IF EXISTS media_kind_check;
ALTER TABLE media ADD CONSTRAINT media_kind_check CHECK (kind IN ('avatar', 'banner', 'badge', 'mod'));

CREATE TABLE mods (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug               text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9-]{1,48}$'),
  owner_id           uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  name               text NOT NULL CHECK (char_length(name) BETWEEN 2 AND 60),
  summary            text NOT NULL DEFAULT '' CHECK (char_length(summary) <= 160),
  category           text NOT NULL CHECK (category IN ('tabs', 'sidebar', 'colors', 'layout', 'other')),
  -- draft: never submitted; pending: first version waiting; listed; rejected; removed by staff.
  status             text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'listed', 'rejected', 'removed')),
  source             text NOT NULL CHECK (source IN ('upload', 'zen')),
  zen_id             text,
  preview_media_id   uuid REFERENCES media (id) ON DELETE SET NULL,
  current_version_id uuid,
  installs           integer NOT NULL DEFAULT 0,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  listed_at          timestamptz
);
CREATE INDEX mods_listed_idx ON mods (status, installs DESC);

CREATE TABLE mod_versions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mod_id       uuid NOT NULL REFERENCES mods (id) ON DELETE CASCADE,
  version      text NOT NULL CHECK (version ~ '^[0-9A-Za-z.+-]{1,20}$'),
  files        jsonb NOT NULL,          -- what Orbit installs (after conversion)
  original_css text,                    -- chrome.css as submitted, when converted
  checks       jsonb NOT NULL,          -- { zen, conversion, warnings }
  status       text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'superseded')),
  review_note  text CHECK (char_length(review_note) <= 1000),
  reviewed_by  uuid REFERENCES users (id) ON DELETE SET NULL,
  reviewed_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (mod_id, version)
);
CREATE INDEX mod_versions_pending_idx ON mod_versions (status, created_at);
ALTER TABLE mods ADD CONSTRAINT mods_current_version_fk FOREIGN KEY (current_version_id) REFERENCES mod_versions (id) ON DELETE SET NULL;

INSERT INTO permissions (key, description) VALUES ('mods.review', 'Review, list and remove community mods');
INSERT INTO role_permissions (role_id, permission_key)
SELECT r.id, 'mods.review' FROM roles r WHERE r.key IN ('moderator', 'administrator', 'owner');
