-- Screenshots of a mod (1 to 6, the first is the cover shown in the store).
CREATE TABLE mod_images (
  mod_id   uuid NOT NULL REFERENCES mods (id) ON DELETE CASCADE,
  media_id uuid NOT NULL REFERENCES media (id) ON DELETE CASCADE,
  position smallint NOT NULL CHECK (position BETWEEN 0 AND 5),
  PRIMARY KEY (mod_id, position)
);
CREATE INDEX mod_images_media_idx ON mod_images (media_id);
