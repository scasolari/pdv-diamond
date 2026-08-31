-- Add pinned flag to saved devices.
ALTER TABLE `SavedDevice` ADD COLUMN `pinned` INTEGER NOT NULL DEFAULT 0;
