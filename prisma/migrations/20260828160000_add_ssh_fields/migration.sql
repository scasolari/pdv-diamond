-- Add SSH fields to SavedDevice for network terminals.
ALTER TABLE `SavedDevice` ADD COLUMN `sshUser` TEXT;
ALTER TABLE `SavedDevice` ADD COLUMN `sshPort` INTEGER;
