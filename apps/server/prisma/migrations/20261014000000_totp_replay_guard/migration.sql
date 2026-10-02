-- Remember the last accepted TOTP time step so a code cannot be used twice.
ALTER TABLE "User" ADD COLUMN "lastTotpStep" INTEGER;
