# Deployment Guide - Data Storage

## 📁 Where is `data.json` stored?

By default, all data files (including `data.json`, wallet keys, etc.) are stored in the `keys/` directory relative to where the application runs.

### Current Behavior:
- **Local Development**: Files stored in `./keys/` (project root)
- **Deployed**: Files stored relative to `process.cwd()` (where the process starts)

## ⚠️ Deployment Considerations

### Problem:
Many cloud platforms have **ephemeral filesystems** - files are lost when:
- The container restarts
- The app redeploys
- The instance scales down

### Solution: Use `DATA_DIR` Environment Variable

Set the `DATA_DIR` environment variable to point to a **persistent storage location**.

## 🚀 Deployment Options

### Option 1: VPS / Dedicated Server (Recommended)
**Best for**: Full control, persistent storage

```bash
# Files stored in /var/app/data/keys (persistent)
export DATA_DIR=/var/app/data/keys
npm start
```

**Pros:**
- Full control over storage
- Files persist across restarts
- No additional setup needed

**Cons:**
- You manage the server
- Need to handle backups manually

---

### Option 2: Docker with Volume Mount
**Best for**: Containerized deployments

```dockerfile
# Dockerfile
FROM node:20
WORKDIR /app
COPY . .
RUN npm install
VOLUME ["/data"]
CMD ["npm", "start"]
```

```bash
# Run with volume mount
docker run -d \
  -e DATA_DIR=/data/keys \
  -v /path/to/persistent/storage:/data \
  your-image
```

**Pros:**
- Portable
- Persistent storage via volumes
- Easy to backup

**Cons:**
- Need to manage Docker volumes
- Backup strategy required

---

### Option 3: Railway / Render / Fly.io
**Best for**: Easy cloud deployment

**Railway:**
1. Create a persistent volume in Railway dashboard
2. Set environment variable:
   ```
   DATA_DIR=/data/keys
   ```
3. Mount the volume to `/data` in Railway settings

**Render:**
1. Use Render's persistent disk feature
2. Set `DATA_DIR=/opt/render/project/src/data/keys`

**Fly.io:**
1. Create a volume: `fly volumes create data`
2. Set `DATA_DIR=/data/keys`
3. Mount in `fly.toml`:
   ```toml
   [[mounts]]
     source = "data"
     destination = "/data"
   ```

---

### Option 4: AWS / GCP / Azure
**Best for**: Enterprise deployments

**AWS (EFS):**
```bash
# Mount EFS to /mnt/efs
export DATA_DIR=/mnt/efs/keys
```

**GCP (Persistent Disk):**
```bash
# Mount disk to /mnt/disk
export DATA_DIR=/mnt/disk/keys
```

**Azure (File Share):**
```bash
# Mount file share to /mnt/azure
export DATA_DIR=/mnt/azure/keys
```

---

### Option 5: Database Storage (Advanced)
**Best for**: Multi-instance deployments

Instead of file storage, you could:
1. Store wallet keys in a database (PostgreSQL, MongoDB)
2. Modify `utils/utils.ts` to read/write from database
3. Use connection pooling for multiple instances

**⚠️ Security Note**: Encrypt wallet keys at rest in the database!

---

## 🔒 Security Best Practices

1. **Never commit `.env` files** - Already in `.gitignore` ✅
2. **Encrypt sensitive data** - Consider encrypting wallet keys
3. **Backup regularly** - Wallet keys are irreplaceable
4. **Use secure storage** - Restrict access to `DATA_DIR`
5. **Rotate keys** - Don't reuse wallet keys across projects

## 📝 Example `.env` for Deployment

```env
# Persistent storage (cloud deployment)
DATA_DIR=/data/keys

# Or use default (local development)
# DATA_DIR= (leave empty)

PRIVATE_KEY=your_private_key_here
RPC_ENDPOINT=https://mainnet.helius-rpc.com/?api-key=your_key
# ... rest of config
```

## 🔍 How It Works

The application uses `getDataDirectory()` from `utils/utils.ts`:

```typescript
// Checks DATA_DIR env var first
// Falls back to ./keys if not set
const dataDir = getDataDirectory()
const dataPath = path.join(dataDir, 'data.json')
```

## ⚡ Quick Start for Deployment

1. **Set up persistent storage** (volume, disk, etc.)
2. **Set `DATA_DIR` environment variable** to persistent path
3. **Ensure directory exists** and is writable
4. **Deploy and test** - verify files persist after restart

## 🆘 Troubleshooting

**Files lost after restart?**
- Check if `DATA_DIR` points to persistent storage
- Verify volume/disk is mounted correctly
- Check file permissions

**Permission denied?**
- Ensure app has write access to `DATA_DIR`
- Check directory ownership: `chown -R app:app /data/keys`

**Files not found?**
- Verify `DATA_DIR` path is correct
- Check if directory exists: `ls -la $DATA_DIR`
- Ensure path is absolute (not relative)

