# 🤖 DisCryptoBank Bot - Quick Reference

## Bot Status Shows
```
🎮 Playing "v2.1.0 • Auto wallet lookup on /pay • Built Jan 29, 2026"
```
Status cycles every 30 seconds through latest features!

---

## 💼 User Wallet Commands

### Connect Your Wallet
```
/user-wallet connect address:YOUR_SOLANA_ADDRESS
```
**Response:** ✅ Wallet Connected Successfully

### View Your Wallet
```
/user-wallet view
```
**Response:** Shows your connected address

### Update Your Wallet
```
/user-wallet update address:NEW_SOLANA_ADDRESS
```
**Response:** ✅ Wallet Updated Successfully

---

## 💸 Payment Commands

### Pay a Discord User
```
/pay user:@DiscordUsername amount:100 currency:USD
```
**What it does:**
1. Looks up @DiscordUsername's connected wallet
2. Converts USD to SOL
3. Sends payment
4. Shows transaction on Solana Explorer

**Errors:**
- ❌ Wallet Not Connected → User needs to use `/user-wallet connect`
- ❌ Insufficient bot balance → Bot operator needs SOL
- ❌ Cannot pay bots → Select a real user

---

## 📋 All Available Commands

| Command | Purpose |
|---------|---------|
| `/user-wallet` | Connect/manage your wallet |
| `/pay` | Send SOL to Discord users |
| `/wallet` | Treasury wallet management |
| `/task-create` | Create payroll tasks |
| `/task-approve` | Approve tasks |
| `/bulk-tasks` | Manage bulk tasks |
| `/submit-proof` | Submit task proof |
| `/approve-proof` | Approve proof submissions |

---

## 🚀 Development Workflow

### Push New Features
```bash
git add .
git commit -m "Your feature description"
git push
```

### What Happens
1. ✅ Code pushed to GitHub
2. ✅ Railway auto-deploys (1-2 minutes)
3. ✅ Commands reload automatically
4. ✅ Bot status updates with new date
5. ✅ All changes live!

---

## ⚡ Quick Troubleshooting

**Can't see `/user-wallet` command?**
- Wait 30 seconds after deployment
- Try `/` in Discord again
- Check Railway logs for errors

**Bot offline?**
- Check Railway dashboard
- Click "Restart" to manually restart

**Wrong status showing?**
- Status updates every 30 seconds
- Check Railway is fully deployed
- Look for green checkmark ✅ in Railway

---

## 📊 Bot Monitoring

**View Bot Logs:**
- Go to https://railway.app
- Click your DisCryptoBank project
- View real-time logs

**Check Transactions:**
- Visit Solana Explorer: https://solscan.io
- Paste transaction signature

---

## 🔒 Security Reminders

✅ **Do:**
- Use Railway environment variables for secrets
- Never commit `.env` file
- Add `.env` to `.gitignore`

❌ **Don't:**
- Share your Solana private key
- Expose DISCORD_TOKEN in code
- Commit sensitive data

---

## 📈 Next Steps

1. Have users run `/user-wallet connect` to register
2. Test `/pay` with @mentions
3. Monitor transactions in Railway logs
4. Scale up payroll management!

---

**Version:** 2.1.0
**Last Updated:** Jan 29, 2026
**Bot Status:** 🟢 ONLINE
