# DisCryptoBank Architecture Guide

## 🏗️ System Overview

DisCryptoBank operates as a **bot-wallet-funded system** where the bot's wallet funds all transactions. Each Discord server can register a treasury wallet for tracking purposes, but all actual payments are funded and signed by the bot's central wallet.

```
┌─────────────────────────────────────────────────────────┐
│           DISCORD SERVER #1                              │
├─────────────────────────────────────────────────────────┤
│  Treasury Wallet: EYmq... (tracking only)               │
│  (Set once by admin, immutable)                         │
│                                                          │
│  Members:                                                │
│  ├─ User A: Personal Wallet XYZ (on ALL servers)        │
│  ├─ User B: Personal Wallet ABC (on ALL servers)        │
│  └─ User C: Personal Wallet DEF (on ALL servers)        │
└─────────────────────────────────────────────────────────┘
         │
         │ /pay @User A sends from Bot Wallet
         │ to User A's Personal Wallet
         ↓
         
┌─────────────────────────────────────────────────────────┐
│              BOT CENTRAL WALLET                          │
│  (Funds and signs all transactions)                     │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│           DISCORD SERVER #2                              │
├─────────────────────────────────────────────────────────┤
│  Treasury Wallet: AAAA... (tracking only)               │
│  (Different wallet for this server)                     │
│                                                          │
│  Members:                                                │
│  ├─ User A: Same Personal Wallet XYZ (same everywhere)  │
│  ├─ User D: Personal Wallet GHI (on ALL servers)        │
│  └─ User E: Personal Wallet JKL (on ALL servers)        │
└─────────────────────────────────────────────────────────┘
```

---

## 🔐 Wallet System

### **Bot Wallet** (Central Funding Source)

**Scope:** System-wide
**Purpose:** Funds and signs ALL transactions
**Configuration:** Set via SOLANA_PRIVATE_KEY environment variable
**Use Case:** Centralized funding for all server payments

The bot wallet is the actual source and signer for all Solana transactions. It must have sufficient SOL balance to cover:
- Payment amounts
- Transaction fees (~0.000005 SOL per transaction)
- Rent-exempt minimums for account creation

### **Level 1: Server Treasury Wallet** (`/wallet connect`)

**Scope:** Server-specific (guild)
**Mutability:** Immutable (set once, cannot change)
**Authority:** Server Admin only
**Use Case:** Tracking and organizational purposes (not used for actual transactions)

```
/wallet connect address:TREASURY_ADDRESS
```

**How it works:**
1. Server admin runs `/wallet connect` with treasury address
2. System stores it permanently for that guild
3. Any future attempt returns: "Already configured, cannot change"
4. This wallet is used for TRACKING purposes only in database records
5. Actual payments are funded by the bot wallet

**Database:** Stored in `guild_wallets` table with guild_id as key

---

### **Level 2: User Personal Wallet** (`/user-wallet connect`)

**Scope:** User-global (works on ALL servers)
**Mutability:** Mutable (can change anytime)
**Authority:** User only
**Use Case:** Individual receiving address for payments

```
/user-wallet connect address:PERSONAL_WALLET
```

**How it works:**
1. User runs `/user-wallet connect` on ANY server with DisCryptoBank
2. System stores their Discord ID → Solana address mapping
3. This wallet address is the DESTINATION for all `/pay` commands
4. User can update with `/user-wallet update` anytime

**Database:** Stored in `users` table with discord_id as key

---

## 💸 Payment Flow

### `/pay` Command Flow

```
User A runs: /pay user:@User B amount:50 currency:USD

1. ✅ Validate in Guild Context
   - Is this a Discord server? (not DM)
   - Is @User B a member of THIS server?

2. ✅ Check Treasury Configuration
   - Does this server have treasury configured?
   - (Treasury is for tracking only)

3. ✅ Check Bot Wallet Balance
   - Does bot wallet have enough SOL?
   - Including transaction fees

4. ✅ Check Personal Wallet
   - Has User B connected personal wallet?
   - Is wallet address valid?

5. ✅ Execute Transaction
   - FROM: Bot Wallet (signs and funds)
   - TO: User B's Personal Wallet
   - AMOUNT: Converted to SOL
   - FEES: Paid by bot wallet
   - SIGNATURE: Logged to database

6. ✅ Send Confirmation
   - Shows source (bot wallet via server)
   - Shows destination (user)
   - Shows amount and explorer link
```

---

## 🎯 Key Rules

### Server Treasury (`/wallet` command)
- ✅ Set ONCE per server by admin
- ✅ Cannot be changed after initial setup
- ✅ Each server has its own treasury (independent)
- ✅ Used for TRACKING purposes in database records
- ⚠️  NOT used as actual funding source (bot wallet funds all transactions)
- ✅ Multiple servers = Multiple treasury records

### Bot Wallet (System Configuration)
- ✅ Configured via SOLANA_PRIVATE_KEY environment variable
- ✅ Funds ALL transactions across ALL servers
- ✅ Must maintain sufficient SOL balance
- ✅ Signs all transaction instructions
- ⚠️  Critical: Keep private key secure

### User Personal Wallet (`/user-wallet` command)
- ✅ Can be set/changed ANYTIME
- ✅ SAME wallet on ALL servers
- ✅ Used as DESTINATION for all payments to that user
- ✅ User data is global, not per-server
- ✅ Independent of any treasury wallet

### Payments (`/pay` command)
- ✅ GUILD-SPECIFIC (only works with server members)
- ✅ Funded by bot wallet, attributed to server
- ✅ User must be server member
- ✅ Cannot pay users outside the server
- ✅ Cannot pay bots
- ✅ Bot wallet must have sufficient balance

---

## 📋 Command Reference

### 1. Server Treasury Setup (Admin Only)

**Configure treasury wallet for server (one-time):**
```
/wallet connect address:EYmqFHtBxiyk3qHGecdxcRoEFoktSoJLskBvSL3GmFtP
```

**Check treasury balance:**
```
/wallet balance
```

**View treasury info:**
```
/wallet info
```

---

### 2. Personal Wallet Management (All Users)

**Connect personal wallet (works on all servers):**
```
/user-wallet connect address:9B5X6E3J4K2...
```

**View your connected wallet:**
```
/user-wallet view
```

**Update personal wallet:**
```
/user-wallet update address:NEWYY3J4K2...
```

---

### 3. Payments

**Pay a server member:**
```
/pay user:@username amount:50 currency:USD
```

**Pay with SOL directly:**
```
/pay user:@username amount:1.5 currency:SOL
```

---

## 🔄 Data Model

### Users Table
```sql
users {
  discord_id: "123456789",      -- User's Discord ID
  username: "username",          -- Discord username
  solana_address: "9B5X6E...",   -- Personal wallet (GLOBAL)
  created_at: timestamp
}
```
**Key:** Global per user, independent of servers

### Guild Wallets Table
```sql
guild_wallets {
  guild_id: "987654321",         -- Discord Server ID
  wallet_address: "EYmq...",     -- Treasury wallet (IMMUTABLE)
  configured_at: timestamp,
  configured_by: "admin_user_id"
}
```
**Key:** One per server, never changes

### Transactions Table
```sql
transactions {
  id: auto,
  guild_id: "987654321",         -- Which server
  from_address: "Bot_Wallet...", -- Bot wallet (actual source)
  to_address: "9B5X6E...",       -- User wallet
  amount: 1.5,                   -- SOL amount
  signature: "abc123...",        -- Tx signature
  created_at: timestamp
}
```
**Key:** Records all transactions per server, from_address is bot wallet

---

## ✅ Verification Checklist

### Before Payment Succeeds

- [ ] Command run in a Discord server (not DM)
- [ ] Target @mention is a member of current server
- [ ] Target user is not a bot
- [ ] Server has treasury wallet configured (for tracking)
- [ ] Bot wallet has sufficient SOL balance
- [ ] Target user has personal wallet connected
- [ ] Target user's wallet address is valid
- [ ] Bot has authority to sign transactions (private key configured)

### Error Messages

**Enhanced error handling includes:**
- ✅ Signature verification errors caught and explained
- ✅ Insufficient funds errors provide clear guidance
- ✅ Transaction simulation failures logged with details
- ✅ Transaction logs captured for debugging (SendTransactionError.getLogs())
- ✅ User-friendly error messages for common issues
- ✅ Proper transaction retry logic (maxRetries: 3)
- ✅ Transaction blockhash and fee payer properly configured

| Error | Cause | Solution |
|-------|-------|----------|
| "Can only use in Discord server" | Command in DM | Use in a server |
| "Not a member of this server" | User not in guild | Add user to server |
| "Cannot pay bots" | Target is a bot | Select real user |
| "Treasury not configured" | Admin hasn't run /wallet connect | Admin runs /wallet connect |
| "Insufficient treasury balance" | Not enough SOL in treasury | Fund the treasury |
| "Wallet Not Connected" | User hasn't run /user-wallet connect | User runs /user-wallet connect |
| "Invalid wallet address" | Address format error | User runs /user-wallet connect with valid address |

---

## 🔐 Security Features

- ✅ Treasury wallet is **immutable** (cannot be changed after setup)
- ✅ Users can only update their **own** personal wallet
- ✅ Payments only work within the **same server**
- ✅ Bot signs transactions but doesn't control funds
- ✅ All transactions logged to database with signatures
- ✅ Treasury and personal wallets are **completely separate**

---

## 📊 Example Scenario

### Setup Phase
```
Server: "Tech Community"
Admin Alice: /wallet connect address:EYmq... ✅
  → Treasury: EYmq... (locked forever on Tech Community)

User Bob: /user-wallet connect address:9B5X6E... ✅
  → Bob's wallet: 9B5X6E... (works on ALL servers)

User Carol: /user-wallet connect address:XYZ123... ✅
  → Carol's wallet: XYZ123... (works on ALL servers)
```

### Payment Phase
```
Alice runs: /pay user:@Bob amount:100 currency:USD ✅
  → Sends from EYmq... (Tech Community Treasury)
  → Sends to 9B5X6E... (Bob's Personal Wallet)
  → Recorded to database with TX signature

Bob runs: /pay user:@Carol amount:50 currency:SOL ✅
  → Sends from EYmq... (Tech Community Treasury)
  → Sends to XYZ123... (Carol's Personal Wallet)
  → Recorded to database with TX signature
```

### Multi-Server Scenario
```
User Bob joins "Gaming Guild" server
Admin Dave: /wallet connect address:AAAA... ✅
  → Treasury: AAAA... (locked on Gaming Guild)

Dave runs: /pay user:@Bob amount:25 currency:SOL ✅
  → Sends from AAAA... (Gaming Guild Treasury)
  → Sends to 9B5X6E... (Bob's SAME Personal Wallet)
  
Note: Bob's wallet address (9B5X6E...) is the SAME
even though treasuries are different!
```

---

## 🚀 Deployment

All changes auto-deploy on `git push`:
1. Code pushed to GitHub
2. Railway detects change
3. Bot redeploys (1-2 min)
4. Commands reload automatically
5. Users see new functionality

**No manual restart needed!**

---

**Version:** 2.1.0
**Last Updated:** Jan 29, 2026
**Status:** ✅ Production Ready
