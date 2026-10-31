-- 0013b_campus_rule_bounds: campuses_cgpa_rule_shape (0011) checks only the JSON shape. A rule with a = 0, a < 0 or b = 500 passed it,
-- and invertCgpaRule then returned null for every student, so every drive count silently became "unknown". A CGPA-to-percent rule is
-- pct = a * cgpa + b: a is a multiplier near 10 (0.5 to 20 allows 9.5, 10, 12.5), b a small offset (-50 to 50 allows -7.5 and -3.33).
ALTER TABLE campuses ADD CONSTRAINT campuses_cgpa_rule_bounds CHECK (
  cgpa_rule IS NULL
  OR ((cgpa_rule ->> 'a')::numeric BETWEEN 0.5 AND 20 AND (cgpa_rule ->> 'b')::numeric BETWEEN -50 AND 50));
