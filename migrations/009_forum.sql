CREATE TABLE forum_categories (
  id          serial PRIMARY KEY,
  slug        text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9-]{2,32}$'),
  name        text NOT NULL,
  description text NOT NULL DEFAULT '',
  icon        text NOT NULL DEFAULT 'message-square',
  color       text NOT NULL DEFAULT '#c4b5ff',
  kind        text NOT NULL DEFAULT 'discussion' CHECK (kind IN ('discussion', 'suggestions')),
  staff_only  boolean NOT NULL DEFAULT false,
  sort        smallint NOT NULL DEFAULT 0
);

CREATE TABLE forum_threads (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id      integer NOT NULL REFERENCES forum_categories (id),
  author_id        uuid REFERENCES users (id) ON DELETE SET NULL,
  title            text NOT NULL CHECK (char_length(title) BETWEEN 4 AND 140),
  body             text NOT NULL CHECK (char_length(body) <= 20000),
  score            integer NOT NULL DEFAULT 0,
  comment_count    integer NOT NULL DEFAULT 0,
  status           text CHECK (status IN ('open', 'planned', 'in_progress', 'done', 'declined')),
  pinned           boolean NOT NULL DEFAULT false,
  locked           boolean NOT NULL DEFAULT false,
  hidden           boolean NOT NULL DEFAULT false,
  deleted          boolean NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now(),
  edited_at        timestamptz,
  last_activity_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX forum_threads_category_idx ON forum_threads (category_id, last_activity_at DESC);
CREATE INDEX forum_threads_activity_idx ON forum_threads (last_activity_at DESC);
CREATE INDEX forum_threads_author_idx ON forum_threads (author_id);

CREATE TABLE forum_posts (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id  uuid NOT NULL REFERENCES forum_threads (id) ON DELETE CASCADE,
  parent_id  uuid REFERENCES forum_posts (id) ON DELETE CASCADE,
  author_id  uuid REFERENCES users (id) ON DELETE SET NULL,
  body       text NOT NULL CHECK (char_length(body) <= 10000),
  score      integer NOT NULL DEFAULT 0,
  hidden     boolean NOT NULL DEFAULT false,
  deleted    boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  edited_at  timestamptz
);
CREATE INDEX forum_posts_thread_idx ON forum_posts (thread_id, created_at);

CREATE TABLE forum_votes (
  user_id     uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  target_type text NOT NULL CHECK (target_type IN ('thread', 'post')),
  target_id   uuid NOT NULL,
  value       smallint NOT NULL CHECK (value IN (-1, 1)),
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, target_type, target_id)
);

ALTER TABLE reports DROP CONSTRAINT IF EXISTS reports_target_type_check;
ALTER TABLE reports ADD CONSTRAINT reports_target_type_check CHECK (target_type IN ('user', 'collection', 'thread', 'post'));

INSERT INTO forum_categories (slug, name, description, icon, color, kind, staff_only, sort) VALUES
  ('announcements', 'Announcements', 'News from the Orbit team.', 'megaphone', '#f5c518', 'discussion', true, 1),
  ('general', 'General', 'Anything about Orbit and the web.', 'message-square', '#c4b5ff', 'discussion', false, 2),
  ('help', 'Help', 'Questions, problems, how-tos.', 'life-buoy', '#7fd1ff', 'discussion', false, 3),
  ('mods', 'Mods and themes', 'Share, request and polish mods.', 'palette', '#ff8da5', 'discussion', false, 4),
  ('showcase', 'Showcase', 'Show your setup.', 'image', '#3dd68c', 'discussion', false, 5),
  ('suggestions', 'Suggestions', 'Ideas for Orbit. Vote and debate.', 'lightbulb', '#f5b841', 'suggestions', false, 6),
  ('off-topic', 'Off-topic', 'Everything else.', 'coffee', '#c9ccd8', 'discussion', false, 7);

INSERT INTO permissions (key, description) VALUES ('forum.moderate', 'Pin, lock, hide and move forum threads, set suggestion status');
INSERT INTO role_permissions (role_id, permission_key)
SELECT r.id, 'forum.moderate' FROM roles r WHERE r.key IN ('moderator', 'administrator', 'owner');
