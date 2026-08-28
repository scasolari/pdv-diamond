-- CreateTable
CREATE TABLE IF NOT EXISTS `Account` (
    `id` TEXT NOT NULL PRIMARY KEY,
    `userId` TEXT NOT NULL,
    `type` TEXT NOT NULL,
    `provider` TEXT NOT NULL,
    `providerAccountId` TEXT NOT NULL,
    `refresh_token` TEXT,
    `access_token` TEXT,
    `expires_at` INTEGER,
    `token_type` TEXT,
    `scope` TEXT,
    `id_token` TEXT,
    `session_state` TEXT
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS `Account_provider_providerAccountId_key`
ON `Account`(`provider`, `providerAccountId`);

-- CreateTable
CREATE TABLE IF NOT EXISTS `Session` (
    `id` TEXT NOT NULL PRIMARY KEY,
    `sessionToken` TEXT NOT NULL,
    `userId` TEXT NOT NULL,
    `expires` DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS `Session_sessionToken_key`
ON `Session`(`sessionToken`);

-- CreateTable
CREATE TABLE IF NOT EXISTS `User` (
    `id` TEXT NOT NULL PRIMARY KEY,
    `name` TEXT,
    `email` TEXT,
    `emailVerified` DATETIME,
    `image` TEXT,
    `admin` BOOLEAN NOT NULL DEFAULT false,
    `is2FAEnabled` BOOLEAN NOT NULL DEFAULT false,
    `is2FAActive` BOOLEAN NOT NULL DEFAULT false,
    `twoFASecret` TEXT
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS `User_email_key`
ON `User`(`email`);

-- CreateTable
CREATE TABLE IF NOT EXISTS `VerificationToken` (
    `identifier` TEXT NOT NULL,
    `token` TEXT NOT NULL,
    `expires` DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS `VerificationToken_token_key`
ON `VerificationToken`(`token`);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS `VerificationToken_identifier_token_key`
ON `VerificationToken`(`identifier`, `token`);

-- CreateTable
CREATE TABLE IF NOT EXISTS `AppSetting` (
    `key` TEXT NOT NULL PRIMARY KEY,
    `value` TEXT NOT NULL,
    `updatedAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE IF NOT EXISTS `SavedDevice` (
    `id` TEXT NOT NULL PRIMARY KEY,
    `sourceKey` TEXT NOT NULL,
    `alias` TEXT NOT NULL,
    `name` TEXT NOT NULL,
    `baudRate` INTEGER NOT NULL DEFAULT 115200,
    `transport` TEXT NOT NULL,
    `type` TEXT NOT NULL,
    `source` TEXT NOT NULL,
    `path` TEXT,
    `address` TEXT,
    `port` INTEGER,
    `sshUser` TEXT,
    `sshPort` INTEGER,
    `protocol` TEXT,
    `manufacturer` TEXT,
    `serialNumber` TEXT,
    `vendorId` TEXT,
    `productId` TEXT,
    `pnpId` TEXT,
    `mac` TEXT,
    `interface` TEXT,
    `archivedAt` DATETIME,
    `createdAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updatedAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS `SavedDevice_sourceKey_key`
ON `SavedDevice`(`sourceKey`);

-- CreateTable
CREATE TABLE IF NOT EXISTS `Mission` (
    `id` TEXT NOT NULL PRIMARY KEY,
    `name` TEXT NOT NULL,
    `deviceId` TEXT NOT NULL,
    `remotePath` TEXT NOT NULL,
    `entrypoint` TEXT NOT NULL,
    `notes` TEXT,
    `filesJson` TEXT NOT NULL DEFAULT '[]',
    `status` TEXT NOT NULL DEFAULT 'draft',
    `createdAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updatedAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT `Mission_deviceId_fkey`
      FOREIGN KEY (`deviceId`) REFERENCES `SavedDevice` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS `Mission_deviceId_idx`
ON `Mission`(`deviceId`);
