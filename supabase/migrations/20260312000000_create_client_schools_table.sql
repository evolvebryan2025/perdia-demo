-- Migration: Create client_schools table for AI-aware client school lookups
-- Purpose: Dedicated table the AI generation pipeline can query to know which
--          schools are GetEducated partners (paying clients). This drives
--          prioritization of client schools in generated articles.
--
-- Context: The existing `schools` table has `is_paid_client` and `is_sponsored`
--          flags, but AI prompts and QA checks need a purpose-built lookup with
--          embedded degree data, category tags, and per-credit cost info so the
--          generation service can inject real client school data into articles.
--
-- Related tables: schools, degrees, paid_school_degrees (view)

CREATE TABLE IF NOT EXISTS client_schools (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,

  -- School identification
  school_name TEXT NOT NULL,
  school_slug TEXT UNIQUE,

  -- URLs
  website_url TEXT,
  geteducated_url TEXT,  -- GetEducated school page URL (ALWAYS link here, never .edu)

  -- Status
  is_active BOOLEAN DEFAULT true,

  -- Embedded degree data for quick AI lookups (no JOINs needed at generation time)
  -- Array of { degree_name, degree_level, geteducated_ranking_url, per_credit_cost, total_credits }
  degrees JSONB DEFAULT '[]',

  -- Category tags for topic-based filtering
  -- e.g., ['nursing', 'business', 'education', 'criminal-justice']
  categories TEXT[] DEFAULT '{}',

  -- Admin notes
  notes TEXT,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for fast lookups by active status
CREATE INDEX IF NOT EXISTS idx_client_schools_active
  ON client_schools(is_active)
  WHERE is_active = true;

-- GIN index for category array searches (e.g., "find all nursing client schools")
CREATE INDEX IF NOT EXISTS idx_client_schools_categories
  ON client_schools USING GIN(categories);

-- Index for name searches
CREATE INDEX IF NOT EXISTS idx_client_schools_name
  ON client_schools(school_name);

-- Index for slug lookups
CREATE INDEX IF NOT EXISTS idx_client_schools_slug
  ON client_schools(school_slug);

-- Full-text search index for fuzzy name matching
CREATE INDEX IF NOT EXISTS idx_client_schools_name_fts
  ON client_schools USING GIN(to_tsvector('english', school_name));

-- Enable Row Level Security
ALTER TABLE client_schools ENABLE ROW LEVEL SECURITY;

-- Allow all authenticated users to read (reference data)
CREATE POLICY "Authenticated users can read client_schools"
  ON client_schools
  FOR SELECT
  TO authenticated
  USING (true);

-- Allow service_role full access (for seeding / admin operations)
CREATE POLICY "Service role full access to client_schools"
  ON client_schools
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Allow anon read access (edge functions may need this)
CREATE POLICY "Anon can read client_schools"
  ON client_schools
  FOR SELECT
  TO anon
  USING (true);

-- Auto-update timestamps
CREATE TRIGGER update_client_schools_updated_at
  BEFORE UPDATE ON client_schools
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Table documentation
COMMENT ON TABLE client_schools IS 'Client (partner) schools for AI content prioritization. The AI generation pipeline queries this table to know which schools to feature in articles.';
COMMENT ON COLUMN client_schools.degrees IS 'JSONB array of degree objects: [{ degree_name, degree_level, geteducated_ranking_url, per_credit_cost, total_credits }]';
COMMENT ON COLUMN client_schools.categories IS 'Category tags for topic-based filtering, e.g. nursing, business, education';
COMMENT ON COLUMN client_schools.geteducated_url IS 'GetEducated school page URL. ALWAYS link here in articles — never link to .edu websites.';

-- =====================================================
-- SEED: Populate from existing paid schools data
-- =====================================================
-- Pull the 94 known paid client schools from the `schools` table
-- into this dedicated lookup table for AI access.

INSERT INTO client_schools (school_name, school_slug, geteducated_url, is_active, notes)
SELECT
  s.school_name,
  s.school_slug,
  s.geteducated_url,
  s.is_active,
  'Auto-seeded from schools table (is_paid_client = true)'
FROM schools s
WHERE s.is_paid_client = true
  AND s.is_active = true
ON CONFLICT (school_slug) DO NOTHING;

-- Backfill degrees JSONB from the degrees table for each client school
-- This gives the AI embedded degree data without needing JOINs at query time
DO $$
DECLARE
  cs_record RECORD;
  degree_json JSONB;
BEGIN
  FOR cs_record IN
    SELECT cs.id, cs.school_name
    FROM client_schools cs
  LOOP
    SELECT COALESCE(jsonb_agg(
      jsonb_build_object(
        'degree_name', d.program_name,
        'degree_level', d.degree_level,
        'degree_level_code', d.degree_level_code,
        'is_sponsored', d.is_sponsored,
        'geteducated_ranking_url', d.geteducated_url
      )
    ), '[]'::jsonb)
    INTO degree_json
    FROM degrees d
    JOIN schools s ON d.school_id = s.id
    WHERE s.school_name = cs_record.school_name
      AND d.is_active = true;

    UPDATE client_schools
    SET degrees = degree_json,
        updated_at = NOW()
    WHERE id = cs_record.id;
  END LOOP;
END;
$$;

-- Log results
DO $$
DECLARE
  cs_count INTEGER;
  cs_with_degrees INTEGER;
BEGIN
  SELECT COUNT(*) INTO cs_count FROM client_schools WHERE is_active = true;
  SELECT COUNT(*) INTO cs_with_degrees FROM client_schools WHERE is_active = true AND degrees != '[]'::jsonb;
  RAISE NOTICE 'Client schools seeded: % total, % with degree data', cs_count, cs_with_degrees;
END;
$$;
