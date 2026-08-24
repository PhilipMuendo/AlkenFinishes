-- Add the UATTEND device vendor: a closed cloud appliance (e.g. uAttend
-- BN6500) that has no push or poll sync path, only CSV import.
ALTER TYPE "DeviceVendor" ADD VALUE 'UATTEND';
