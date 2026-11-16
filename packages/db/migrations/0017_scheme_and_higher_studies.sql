-- 0017: the student's university scheme and admission year, and the higher_studies outcome kind (NAAC 5.2.1 part B).
--
--  1. eligibility_profiles.university_scheme / admission_year. A university with one formula per scheme (VTU) cannot be
--     converted from a campus rule or from the passout year, so the student's own scheme is stored. Nothing derives it.
--  2. outcomes.kind accepts 'higher_studies'. Reuses the columns: employer = institution joined, role_title = programme admitted
--     to. A higher-studies record has no package.
--  3. tpo_naac_rows returns {placements, higherEd} under the same consent filter (verified member, share level outcomes or
--     full, same campus) and logs each student once. Year is the academic year of the cohort passout ("2025-26"), not the year
--     the row was created. tpo_naac_count counts both parts.

ALTER TABLE eligibility_profiles
  ADD COLUMN university_scheme text,
  ADD COLUMN admission_year    smallint,
  ADD CONSTRAINT eligibility_university_scheme_len CHECK (university_scheme IS NULL OR char_length(university_scheme) BETWEEN 1 AND 40),
  ADD CONSTRAINT eligibility_admission_year CHECK (admission_year IS NULL OR admission_year BETWEEN 1990 AND 2100);

ALTER TABLE outcomes DROP CONSTRAINT outcomes_kind;
ALTER TABLE outcomes ADD CONSTRAINT outcomes_kind CHECK (kind IN ('interview', 'offer', 'higher_studies'));
ALTER TABLE outcomes ADD CONSTRAINT outcomes_higher_studies_no_package CHECK (kind <> 'higher_studies' OR package_lpa IS NULL);

CREATE OR REPLACE FUNCTION tpo_naac_rows(p_campus uuid, p_passout_year integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  me     uuid := current_setting('hirelane.user_id')::uuid;
  v_place jsonb;
  v_high  jsonb;
BEGIN
  IF tpo_role(p_campus) IS NULL THEN RETURN NULL; END IF;
  INSERT INTO tpo_access_log (campus_id, actor_id, subject_user_id, action)
  SELECT p_campus, me, x.user_id, 'naac_export'
    FROM (SELECT DISTINCT o.user_id FROM outcomes o
            JOIN cohort_members m ON m.user_id = o.user_id AND m.campus_id = o.campus_id
            JOIN cohorts c ON c.id = o.cohort_id
           WHERE o.campus_id = p_campus AND o.kind IN ('offer', 'higher_studies') AND m.verified_at IS NOT NULL AND m.share_level IN ('outcomes', 'full')
             AND (p_passout_year IS NULL OR c.passout_year = p_passout_year)) x;
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'year', (c.passout_year - 1)::text || '-' || lpad((c.passout_year % 100)::text, 2, '0'),
           'student', coalesce(u.display_name, ''), 'programme', c.programme,
           'employer', o.employer, 'packageLpa', o.package_lpa, 'verification', o.verification)
           ORDER BY o.created_at, o.id), '[]'::jsonb)
    INTO v_place
    FROM outcomes o
    JOIN cohort_members m ON m.user_id = o.user_id AND m.campus_id = o.campus_id
    JOIN cohorts c ON c.id = o.cohort_id
    JOIN users u ON u.id = o.user_id
   WHERE o.campus_id = p_campus AND o.kind = 'offer' AND m.verified_at IS NOT NULL AND m.share_level IN ('outcomes', 'full')
     AND (p_passout_year IS NULL OR c.passout_year = p_passout_year);
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'student', coalesce(u.display_name, ''), 'programme', c.programme,
           'institution', o.employer, 'admittedTo', coalesce(o.role_title, ''), 'verification', o.verification)
           ORDER BY o.created_at, o.id), '[]'::jsonb)
    INTO v_high
    FROM outcomes o
    JOIN cohort_members m ON m.user_id = o.user_id AND m.campus_id = o.campus_id
    JOIN cohorts c ON c.id = o.cohort_id
    JOIN users u ON u.id = o.user_id
   WHERE o.campus_id = p_campus AND o.kind = 'higher_studies' AND m.verified_at IS NOT NULL AND m.share_level IN ('outcomes', 'full')
     AND (p_passout_year IS NULL OR c.passout_year = p_passout_year);
  RETURN jsonb_build_object('placements', v_place, 'higherEd', v_high);
END
$$;

CREATE OR REPLACE FUNCTION tpo_naac_count(p_campus uuid, p_passout_year integer) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_p integer;
  v_h integer;
BEGIN
  IF tpo_role(p_campus) IS NULL THEN RETURN NULL; END IF;
  SELECT count(*) FILTER (WHERE o.kind = 'offer')::integer, count(*) FILTER (WHERE o.kind = 'higher_studies')::integer INTO v_p, v_h
    FROM outcomes o
    JOIN cohort_members m ON m.user_id = o.user_id AND m.campus_id = o.campus_id
    JOIN cohorts c ON c.id = o.cohort_id
   WHERE o.campus_id = p_campus AND o.kind IN ('offer', 'higher_studies') AND m.verified_at IS NOT NULL AND m.share_level IN ('outcomes', 'full')
     AND (p_passout_year IS NULL OR c.passout_year = p_passout_year);
  RETURN jsonb_build_object('rows', v_p + v_h, 'placements', v_p, 'higherEd', v_h);
END
$$;
