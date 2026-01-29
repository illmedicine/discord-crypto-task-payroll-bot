# Fix for Missing Commands in Discord

## 🔍 Why Commands Aren't Showing

Discord slash commands sync from Discord's servers, not directly from the bot. This can cause delays up to 15 minutes.

---

## ✅ Solution: 3-Step Fix

### Step 1: Check Command Status (Right Now!)
```
/bot-status
```
This will show:
- ✅ All loaded commands (should include `/user-wallet`)
- 🤖 Bot status
- 📊 Command count

**If you see `/user-wallet` listed** → Go to Step 2

**If you DON'T see `/user-wallet`** → The command didn't load. Check [Troubleshooting](#troubleshooting) below.

---

### Step 2: Manually Refresh Commands
If you're admin, run:
```
/refresh-commands
```

**Response:**
```
✅ Commands Refreshed Successfully
All 8 commands have been synced with Discord.
⏱️ Note: Commands may take 5-15 minutes to appear. Try typing `/` to see the updated list.
```

---

### Step 3: Wait and Refresh Discord

1. **Close Discord** completely (right-click system tray → Quit)
2. **Wait 30 seconds**
3. **Open Discord** again
4. **Type `/` in chat** and look for new commands
5. **Wait up to 15 minutes** for Discord's servers to sync

---

## ⚡ Quick Troubleshooting

### Issue: `/bot-status` shows `/user-wallet` but I can't see it

**Solutions (in order):**
1. Close and reopen Discord
2. Run `/refresh-commands` again
3. Wait 10 minutes and try `/` again
4. Restart your Discord app completely
5. Try on a different device/browser

**Why:** Discord has command caching and it takes time to propagate

---

### Issue: `/bot-status` does NOT show `/user-wallet`

**The command didn't load. Check:**

1. **Is the bot fully deployed?**
   - Check Railway dashboard
   - Look for green checkmark ✅ on deployment
   - Wait for it to complete

2. **Are there errors in Railway logs?**
   - Go to Railway → Your project
   - Click service → Logs
   - Look for `❌ Error loading command: user-wallet.js`
   - Or `✅ Command loaded: user-wallet`

3. **Did the code deploy?**
   - Check git commit was pushed
   - Railway dashboard should show new deployment in progress

4. **Try restarting the bot:**
   - Go to Railway dashboard
   - Click service menu (three dots)
   - Select "Restart"
   - Wait 1-2 minutes for restart

---

### Issue: See commands in `/` but still not working

**Try:**
1. Run `/refresh-commands` again
2. Restart Discord
3. Wait 5 minutes
4. Try the command again

If that doesn't work:
- The command file might have an error
- Check Railway logs for: `Error executing command:`

---

## 📊 New Diagnostic Commands

### `/bot-status`
Shows all loaded commands and bot information

### `/refresh-commands`  
(Admin only) Forces Discord to sync all commands

---

## 🎯 Expected Timeline

| Action | Timeline |
|--------|----------|
| You push code | Immediate |
| Railway deploys | 1-2 minutes |
| Bot restarts | 30 seconds |
| Commands load in bot | 5-10 seconds |
| Commands sync to Discord | 5-15 minutes |
| Commands show in Discord | 5-20 minutes |
| You can use commands | 20 minutes max |

---

## 🚀 What You Should See Now

After completing all steps, you should see:

```
/user-wallet connect - Connect your Solana wallet
/user-wallet view - View your connected wallet  
/user-wallet update - Update your wallet address
/pay - Send SOL to Discord users
/bot-status - Check bot status
/refresh-commands - Refresh command list (admin)
```

---

## 🆘 If Still Not Working

**Collect this info and check:**

1. Run `/bot-status` and screenshot
2. Check Railway logs for errors
3. Verify DISCORD_TOKEN and DISCORD_CLIENT_ID in Railway
4. Try `/refresh-commands` one more time
5. Wait 15 minutes
6. Restart Discord completely

**Last resort:**
- Check bot has correct permissions in server
- Invite bot with `applications.commands` scope
- Go to: https://discord.com/api/oauth2/authorize?client_id=YOUR_CLIENT_ID&scope=applications.commands

---

## ✨ Commands Are Working When:

✅ You can type `/` and see the full list
✅ `/bot-status` loads and shows all commands
✅ `/user-wallet connect` autocompletes
✅ `/user-wallet` subcommands appear in suggestions
✅ You can successfully run `/user-wallet connect address:YOUR_ADDRESS`

---

**Version:** 2.1.0
**Last Updated:** Jan 29, 2026
**Status:** 🟢 Commands Fixed
