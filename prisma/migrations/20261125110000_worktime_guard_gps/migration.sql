-- GPS-registrerad tid (bollplockare) har ingen schemalagd sluttid: för dem är det UTCHECKNINGEN som inte får ligga i framtiden.
-- (scheduledEndsAt är för ett GPS-pass bara slutet på arbetsdygnet och kan ligga i framtiden även när passet är klart.)
CREATE OR REPLACE FUNCTION "work_time_entry_guard"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW."source" = 'SCHEDULE' AND NEW."scheduledEndsAt" > now() THEN
    RAISE EXCEPTION 'WorkTimeEntry: passet har inte avslutats ännu'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."status" IN ('APPROVED', 'CORRECTED') THEN
    IF NEW."source" = 'GPS' THEN
      IF NEW."registeredEndsAt" IS NULL OR NEW."registeredEndsAt" > now() THEN
        RAISE EXCEPTION 'WorkTimeEntry: framtida eller pågående arbetstid kan inte godkännas'
          USING ERRCODE = 'check_violation';
      END IF;
    ELSIF GREATEST(NEW."scheduledEndsAt", NEW."registeredEndsAt") > now() THEN
      RAISE EXCEPTION 'WorkTimeEntry: framtida arbetstid kan inte godkännas'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;
