-- Family member profiles (#68): the things a household knows about each
-- other and currently keeps in someone's head. A profile is strictly 1:1
-- with an account (decided over a standalone "family member" entity):
-- avatars, colours, ownership and the self-or-admin editing rule all
-- already exist on users, and a person without a device joins as a
-- kid account through an invite the parent opens themselves.
--
-- family_role is NOT users.role. users.role governs permissions;
-- family_role governs nothing — it is a descriptive label, relative
-- labels deliberately flattened to one per person (a household, not a
-- genealogy program). The distinct name exists so the two concepts
-- never blur.
CREATE TABLE profiles (
  user_id     TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  birthday    TEXT,             -- YYYY-MM-DD, local wall date like everything else
  family_role TEXT CHECK (family_role IN
                ('mother', 'father', 'daughter', 'son', 'grandmother', 'grandfather')),
  -- The public wishlist link, stored as a hash exactly like invite
  -- tokens: a database leak must not leak working links.
  wishlist_share_hash       TEXT,
  wishlist_share_created_at TEXT
);

-- Preferences and allergies are both short rows, one table with a kind:
-- a preference is label+value ("Shoes" — "38"), an allergy is label only
-- ("nuts"). Rows, not a text blob — the whole point of a profile over a
-- note is that "Shoes" is findable at a glance in a shop.
CREATE TABLE profile_entries (
  id       TEXT PRIMARY KEY,
  user_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind     TEXT NOT NULL CHECK (kind IN ('preference', 'allergy')),
  label    TEXT NOT NULL,
  value    TEXT,
  position INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_profile_entries_user ON profile_entries(user_id);

-- claimed_by for family members, claimed_by_name for guests coming
-- through the public link. The owner must never learn either — that is
-- enforced in the routes, and it is the reason claims live on the wish
-- row rather than in a place the owner's queries could join.
CREATE TABLE wishes (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title           TEXT NOT NULL,
  url             TEXT,
  claimed_by      TEXT REFERENCES users(id) ON DELETE SET NULL,
  claimed_by_name TEXT,
  claimed_at      TEXT,
  position        INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL
);
CREATE INDEX idx_wishes_user ON wishes(user_id);

-- A birthday event the profile owns: the profile is the source of truth
-- for the date, the yearly calendar event (and the age the calendar
-- computes from birth_year) is derived from it on every save. The column
-- is how the derived event is found again to update or remove.
ALTER TABLE events ADD COLUMN profile_user_id TEXT REFERENCES users(id) ON DELETE CASCADE;
CREATE INDEX idx_events_profile ON events(profile_user_id);
