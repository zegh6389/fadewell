-- Pin the three states whose medical-cannabis programs require 21+ patient age.
-- Everything else keeps the 18 default from migration 020.
UPDATE jurisdictions SET min_age = 21, updated_at = now() WHERE code IN ('AK', 'ME', 'WA');