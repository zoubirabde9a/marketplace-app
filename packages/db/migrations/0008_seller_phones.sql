-- Multiple phone numbers per seller. Replaces the single seller_profiles.phone
-- / .whatsapp columns (left in place for now for compatibility — readers should
-- migrate to seller.seller_phones).
--
-- The scraper (siteBuildGetByStore on ouedkniss.com) returns an ordered list
-- of phones per store along with hasWhatsapp / hasViber booleans per number.
-- The old single-column shape forced us to drop every phone after the first,
-- which made shops with 2-3 sales lines look like single-line individuals.
--
-- Schema notes:
--  * seller_id references identity.organizations(id) — the same uuid the rest
--    of the application uses as "seller id" (seller_profiles.org_id is unique).
--  * phone_e164 is stored canonicalised to +213XXXXXXXXX (see @marketplace/shared
--    normalizeAlgerianPhone). The unique (seller_id, phone_e164) index relies
--    on that canonicalisation to dedupe inputs that arrive in mixed forms.
--  * is_primary uses a partial unique index so at most one row per seller
--    carries it; that lets us mark a "lead" number without modelling it as a
--    column on seller_profiles.
--  * position preserves the order Ouedkniss returned the numbers in (their
--    shop builder lets sellers reorder).

CREATE TABLE seller.seller_phones (
  id uuid PRIMARY KEY,
  seller_id uuid NOT NULL REFERENCES identity.organizations(id) ON DELETE CASCADE,
  phone_e164 varchar(20) NOT NULL,
  is_whatsapp boolean NOT NULL DEFAULT false,
  is_viber boolean NOT NULL DEFAULT false,
  is_primary boolean NOT NULL DEFAULT false,
  position integer NOT NULL DEFAULT 0,
  source varchar(32) NOT NULL DEFAULT 'manual',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX seller_phones_seller_phone_unique
  ON seller.seller_phones (seller_id, phone_e164);

CREATE UNIQUE INDEX seller_phones_primary_unique
  ON seller.seller_phones (seller_id)
  WHERE is_primary;

-- Backfill from seller_profiles.phone. Only rows that normalize cleanly to
-- Algerian E.164 (+213 + 9 digits, leading subscriber digit 2-7) are copied;
-- anything else stays only in the legacy column until the next scraper run
-- overwrites the seller's contact list. is_whatsapp is set true when the
-- legacy whatsapp column held the same number (the old seeder copied phone
-- into whatsapp for every shop, so for backfilled rows this captures the
-- pre-existing assumption rather than ground truth).
INSERT INTO seller.seller_phones (id, seller_id, phone_e164, is_whatsapp, is_primary, position, source)
SELECT
  gen_random_uuid(),
  sp.org_id,
  CASE
    WHEN sp.phone ~ '^\+213[2-7][0-9]{8}$' THEN sp.phone
    WHEN regexp_replace(sp.phone, '\D', '', 'g') ~ '^213[2-7][0-9]{8}$'
      THEN '+' || regexp_replace(sp.phone, '\D', '', 'g')
    WHEN regexp_replace(sp.phone, '\D', '', 'g') ~ '^0[2-7][0-9]{8}$'
      THEN '+213' || substring(regexp_replace(sp.phone, '\D', '', 'g') from 2)
    WHEN regexp_replace(sp.phone, '\D', '', 'g') ~ '^[2-7][0-9]{8}$'
      THEN '+213' || regexp_replace(sp.phone, '\D', '', 'g')
    ELSE NULL
  END,
  (sp.whatsapp IS NOT NULL),
  true,
  0,
  'backfill-seller-profiles'
FROM seller.seller_profiles sp
WHERE sp.phone IS NOT NULL
  AND sp.phone <> ''
  AND (
    sp.phone ~ '^\+213[2-7][0-9]{8}$'
    OR regexp_replace(sp.phone, '\D', '', 'g') ~ '^(213|0)?[2-7][0-9]{8}$'
  )
ON CONFLICT (seller_id, phone_e164) DO NOTHING;
