-- 0004b: what each posting says about where the role is. A canonical job that merges several postings (same company,
-- same normalised title, near-identical text, often one per office) shows the union of their countries and locations.
ALTER TABLE postings ADD COLUMN geo_countries char(2)[];
ALTER TABLE postings ADD COLUMN geo_locations text[];
