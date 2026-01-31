# Database Management Guide

## Overview

The bot now uses **separate databases** for local development and Railway production:

- **Local Development**: `./payroll.db` (in project root)
- **Railway Production**: `/data/payroll.db` (persistent volume)

## ✅ Current Setup (Automatic)

### Production on Railway
- ✅ Database automatically uses persistent storage at `/data/payroll.db`
- ✅ All Discord commands save to Railway's database
- ✅ Data persists across deployments and restarts
- ✅ Volume is automatically created and mounted

### Local Development
- Uses `./payroll.db` in project directory
- Separate from Railway database
- Good for testing without affecting production

## 🎯 Recommended Workflow

**ALWAYS create tasks through Discord on Railway:**

1. Deploy your bot to Railway
2. In Discord, use `/bulk-tasks create` to create tasks
3. Tasks are automatically stored in Railway's persistent database
4. No need to sync or transfer data

**Local development is for code testing only:**
- Test command functionality locally
- Don't create production data locally
- Production data lives on Railway

## 📊 View Local Database Info

```bash
npm run db:info
```

This shows:
- Number of tasks in local database
- List of all local tasks
- Guidance on using Railway database

## 🔧 Advanced: Connect Local to Railway Database

If you need to test with production data locally:

### Option 1: Using Railway CLI (Recommended)

```bash
# Install Railway CLI
npm install -g @railway/cli

# Login to Railway
railway login

# Link to your project
railway link

# Run locally with Railway's environment
railway run node index.js
```

### Option 2: Manual Environment Variable

Set in your `.env`:
```env
DB_PATH=/data/payroll.db
NODE_ENV=production
```

Then use Railway CLI to mount the volume locally.

## 🗄️ Database Locations

| Environment | Database Path | Persists? |
|------------|---------------|-----------|
| Local Dev | `./payroll.db` | ❌ Local only |
| Railway Production | `/data/payroll.db` | ✅ Yes, via volume |

## 🚀 Migration: Moving Local Data to Railway

If you have local tasks you want on Railway:

1. **Option A: Recreate on Railway (Recommended)**
   - Simply recreate the tasks using Discord commands
   - This ensures all data is properly formatted

2. **Option B: Database Copy (Advanced)**
   - Use Railway CLI to copy your local database
   - Requires manual file transfer to Railway volume

## 📁 Volume Configuration

The bot is configured with a persistent volume in `railway.json`:

```json
{
  "deploy": {
    "volumeMounts": [
      {
        "mountPath": "/data",
        "name": "database-volume"
      }
    ]
  }
}
```

Railway automatically:
- Creates the volume on first deploy
- Mounts it to `/data`
- Persists data across deployments

## 🔍 Troubleshooting

### "Task not found" errors on Railway

**Cause**: Task was created locally, not on Railway

**Solution**: Create the task directly on Railway via Discord:
```
/bulk-tasks create title:... description:... payout:... currency:... slots:...
```

### Local database has tasks but Railway doesn't

**Expected behavior**: They are separate databases

**Solution**: Create tasks on Railway, not locally

### Want to use same database for both

**Solution**: Always use Railway CLI to run locally:
```bash
railway run node index.js
```

## 💡 Best Practices

1. ✅ **DO**: Create all production tasks via Discord on Railway
2. ✅ **DO**: Use local dev for testing command functionality
3. ✅ **DO**: Keep local and Railway databases separate
4. ❌ **DON'T**: Create production tasks locally
5. ❌ **DON'T**: Expect local data to sync automatically

## 🔮 Future: PostgreSQL Migration

For better scalability, consider migrating to PostgreSQL:

1. Add Railway PostgreSQL plugin
2. Update database code to use PostgreSQL
3. Benefits:
   - Better for multiple instances
   - Cloud-native
   - Better backup/restore options
   - No volume needed
