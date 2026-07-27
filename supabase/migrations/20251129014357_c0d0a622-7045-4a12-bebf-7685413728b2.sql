-- Add company information columns to nina_settings
ALTER TABLE nina_settings 
ADD COLUMN company_name text DEFAULT NULL,
ADD COLUMN sdr_name text DEFAULT NULL;