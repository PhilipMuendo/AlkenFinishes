-- The UATTEND vendor was never specific to uAttend: it means "a device with no
-- cloud API, no push and no poll, whose punches are imported from an exported
-- file". Renaming the value carries any existing device rows with it.
ALTER TYPE "DeviceVendor" RENAME VALUE 'UATTEND' TO 'MANUAL';
