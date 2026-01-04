# Website Update Troubleshooting Guide

## Issue: Changes Not Reflecting on Website

If you update the website config from the pumpfun bundler but the razebot website doesn't show the changes, check the following:

### 1. **Domain Mismatch (Most Common Issue)**

**Problem:** The `site_url` in the database doesn't match what razebot is querying.

**Check:**
- What domain is razebot running on? (e.g., `localhost:3000`, `moonboundai.pro`, etc.)
- What `site_url` did you save in the database? (check `WEBSITE_URL` in your `.env`)

**Solution:**
- Make sure `WEBSITE_URL` in pumpfun bundler `.env` matches the domain razebot is using
- For localhost: Use `WEBSITE_URL=localhost` (not `localhost:3000`)
- For production: Use the base domain without protocol (e.g., `moonboundai.pro`, not `https://moonboundai.pro`)

**How to verify:**
1. Check razebot server logs - it will show what `site_url` it's querying
2. Check database: `SELECT site_url, token_name, token_symbol FROM site_config;`
3. Make sure they match!

### 2. **Database Connection**

**Check:**
- Is razebot's `DATABASE_URL` the same as pumpfun bundler's `DATABASE_URL`?
- Are both pointing to the same PostgreSQL database?

**Solution:**
- Verify both `.env` files have the same `DATABASE_URL`
- Test connection: Check razebot server logs for database connection errors

### 3. **Field Mapping Issues**

**What we save:**
- `logo_url` → Website logo
- `color_scheme` → Theme color
- `token_name` → Brand name
- `token_symbol` → Display name

**What razebot reads:**
- `logo_url` OR `website_logo_image` → Logo
- `color_scheme` OR `theme_name` → Theme
- `token_name` → Brand name
- `token_symbol` → Display name

**Solution:**
- We now save both `logo_url` and `website_logo_image`
- We now save both `color_scheme` and `theme_name`

### 4. **Cache Issues**

**Problem:** Browser or server might be caching old config.

**Solution:**
- Hard refresh browser (Ctrl+Shift+R or Cmd+Shift+R)
- Check razebot server logs - it should show config being fetched
- Razebot polls every 10 seconds, so changes should appear within 10-20 seconds

### 5. **Server Not Running**

**Check:**
- Is razebot's server running? (should be on port 3001 by default)
- Check razebot server logs for errors

**Solution:**
- Start razebot server: `npm run start:server` or `npm run dev:server`
- Check if `/site-config` endpoint is accessible

### 6. **Database Query Not Finding Config**

**Check razebot server logs for:**
```
[Config] Querying database with normalized domain: <domain>
[Config] ❌ No config found for site_url: <domain>
```

**Solution:**
- The `site_url` in database doesn't match what razebot is querying
- Check the normalization - both use similar logic but verify they match
- Try querying database directly: `SELECT * FROM site_config WHERE site_url = '<your-domain>';`

## Quick Debug Steps

1. **Check what domain razebot is using:**
   - Look at razebot server logs when it starts
   - Or check browser console for API calls to `/site-config?host=...`

2. **Check what's in the database:**
   ```sql
   SELECT site_url, token_name, token_symbol, logo_url, color_scheme 
   FROM site_config 
   ORDER BY updated_at DESC;
   ```

3. **Verify they match:**
   - Domain razebot queries = `site_url` in database
   - If not, update `WEBSITE_URL` in pumpfun bundler `.env` to match

4. **Test the API directly:**
   ```bash
   curl "http://localhost:3001/site-config?host=moonboundai.pro"
   ```
   (Replace with your actual domain)

## Expected Behavior

After updating website config from pumpfun bundler:
1. Data is saved to `site_config` table in PostgreSQL
2. Razebot server queries database every 10 seconds
3. Changes should appear on website within 10-20 seconds
4. No page refresh needed (razebot polls automatically)
