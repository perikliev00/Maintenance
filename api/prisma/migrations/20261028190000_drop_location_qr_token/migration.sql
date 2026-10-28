-- Drop room QR identify token; invitations and devices are unaffected.
DROP INDEX IF EXISTS "Location_qrToken_key";
ALTER TABLE "Location" DROP COLUMN IF EXISTS "qrToken";
