-- Add missing columns to site_config table
-- Run this directly in your PostgreSQL client or via psql

ALTER TABLE site_config 
ADD COLUMN IF NOT EXISTS website_logo_image TEXT;

ALTER TABLE site_config 
ADD COLUMN IF NOT EXISTS theme_name VARCHAR(50);

-- Verify columns were added
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'site_config' 
  AND column_name IN ('website_logo_image', 'theme_name')
ORDER BY column_name;



