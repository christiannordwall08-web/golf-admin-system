-- En CHECK med NULL räknas som uppfylld. Gör kontrollen av avvikande stängningstid NULL-säker:
-- en dag som inte är stängd MÅSTE ha en giltig stängningstid.
ALTER TABLE "BollplockareDayOverride" DROP CONSTRAINT "BollplockareDayOverride_close_chk";
ALTER TABLE "BollplockareDayOverride"
  ADD CONSTRAINT "BollplockareDayOverride_close_chk" CHECK (
    ("isClosed" AND "closeTime" IS NULL)
    OR (NOT "isClosed" AND COALESCE("closeTime" ~ '^(0[6-9]|1[0-9]|2[0-3]):[0-5][0-9]$', false)));
