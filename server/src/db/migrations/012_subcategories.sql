-- Expense and income subcategories: "Car → Fuel, Parking, Service".
--
-- Depth is exactly one level, and that's a deliberate limit: a tree of
-- arbitrary nesting turns every report into recursion, while in practice
-- a family gets by with "group → line item". The server makes sure a
-- subcategory never becomes a parent.
--
-- Deleting a parent doesn't lose the subcategories — they rise to the
-- top level (ON DELETE SET NULL): transaction labeling is worth more
-- than the hierarchy.

ALTER TABLE categories ADD COLUMN parent_id TEXT REFERENCES categories(id) ON DELETE SET NULL;

CREATE INDEX idx_categories_parent ON categories(parent_id);
