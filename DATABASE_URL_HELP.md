# Database URL Configuration Help

## ❌ Error: `getaddrinfo ENOTFOUND postgres.railway.internal`

This error means you're using Railway's **internal hostname**, which only works when your code runs **inside Railway's network**.

---

## ✅ Solution: Use Public Railway Database URL

For **local testing**, you need the **PUBLIC** Railway database URL.

### **How to Get Your Public Railway Database URL:**

1. **Go to Railway Dashboard**: https://railway.app/
2. **Select your PostgreSQL database** service
3. **Click "Connect"** or **"Variables"** tab
4. **Look for "Public Network"** or **"Connection URL"**
5. **Copy the URL** - it should look like:
   ```
   postgresql://postgres:password@postgres.railway.app:5432/railway
   ```
   **Note:** Hostname should be `postgres.railway.app` (or similar), **NOT** `postgres.railway.internal`

---

## 📝 Update Your `.env` File

Replace your current `DATABASE_URL` with the public URL:

```env
# ❌ WRONG (only works inside Railway):
DATABASE_URL=postgresql://postgres:password@postgres.railway.internal:5432/railway

# ✅ CORRECT (works from anywhere):
DATABASE_URL=postgresql://postgres:password@postgres.railway.app:5432/railway
```

---

## 🔍 How to Find the Public URL in Railway:

### **Method 1: Variables Tab**
1. Railway Dashboard → Your Database Service
2. Click **"Variables"** tab
3. Look for `DATABASE_URL` or `POSTGRES_URL`
4. Copy the value (should have `.railway.app` not `.internal`)

### **Method 2: Connect Tab**
1. Railway Dashboard → Your Database Service
2. Click **"Connect"** tab
3. Select **"Public Network"** (not Private)
4. Copy the connection string

### **Method 3: Service Settings**
1. Railway Dashboard → Your Database Service
2. Click **"Settings"**
3. Look for **"Connection URL"** or **"Public URL"**

---

## ⚠️ Important Notes:

- **Internal URL** (`postgres.railway.internal`) = Only works inside Railway
- **Public URL** (`postgres.railway.app`) = Works from anywhere (your local machine, external services, etc.)
- **Security**: Public URLs are still secure (require password), but Railway recommends using internal URLs when possible
- **For local testing**: You **must** use the public URL

---

## 🧪 Test Your Connection:

After updating `DATABASE_URL` in your `.env`:

1. **Restart API server** (if running)
2. **Click "🧪 Test Website Update"** button
3. **Should connect successfully!**

---

## 💡 Alternative: Use Local PostgreSQL

If you don't want to use Railway for testing, you can set up a local PostgreSQL:

```env
DATABASE_URL=postgresql://postgres:password@localhost:5432/mydatabase
```

---

**Once you update `DATABASE_URL` with the public Railway URL, the test should work!** 🚀



