-- The wishlist share token moves from hashed to plaintext storage — a
-- deliberate reversal of 020, which copied the invite pattern without
-- copying its reasoning. An invite is shown once and grants account
-- creation, so at-rest hashing is the right trade. A wishlist link is
-- the opposite: long-lived, meant to be re-sent ("the second grandmother,
-- a month later"), and it grants reading one first name and a wish list.
-- Hashed storage made the link unrecoverable after the creation dialog
-- closed — revoke-and-recreate was the only way to share it twice, which
-- defeated the feature.
--
-- Existing links (stored as hashes) cannot be converted and die here;
-- owners re-create them once. The feature is days old.
ALTER TABLE profiles DROP COLUMN wishlist_share_hash;
ALTER TABLE profiles ADD COLUMN wishlist_share_token TEXT;
