# DisCryptoBank Architecture Guide

## 🏗️ System Overview

DisCryptoBank operates as a **three-tier wallet system**:
1. **Bot Wallet** - Centralized funding source and transaction ledger (Owner only)
2. **Guild Treasury Wallets** - Server-specific wallets for each Discord server (Server Owner only)
3. **User Personal Wallets** - Global wallets tied to Discord ID for receiving payments (All users)

```
┌─────────────────────────────────────────────────────────────────────┐
│                      🤖 BOT WALLET (Central Ledger)                  │
│  ────────────────────────────────────────────────────────────────── │
│  • Configured via SOLANA_PRIVATE_KEY environment variable           │
│  • Signs all transactions on behalf of guild treasuries             │
│  • Tracks all Discord users, commands, payments, guild assignments  │
│  • Cannot be connected to any guild - acts in background            │
│  • Commands restricted to Bot Owner only (/bot-wallet)              │
└─────────────────────────────────────────────────────────────────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        ↓                     ↓                     ↓
┌───────────────────┐ ┌───────────────────┐ ┌───────────────────┐
│  GUILD TREASURY 1 │ │  GUILD TREASURY 2 │ │  GUILD TREASURY 3 │
│  (/wallet connect)│ │  (/wallet connect)│ │  (/wallet connect)│
│  Server Owner Only│ │  Server Owner Only│ │  Server Owner Only│
│  Immutable once   │ │  Immutable once   │ │  Immutable once   │
│  set              │ │  set              │ │  set              │
└───────────────────┘ └───────────────────┘ └───────────────────┘
        │                     │                     │
        └─────────────────────┼─────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────────┐
│                    👥 USER PERSONAL WALLETS                         │
│  ────────────────────────────────────────────────────────────────── │
│  • Connected via /user-wallet connect (once, works everywhere)      │
│  • Tied to Discord ID - NOT per-server                              │
│  • Used ONLY for receiving payments from tasks/contests/payouts     │
│  • Same wallet receives payments across ALL DisCryptoBank servers   │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 🔐 Three-Level Wallet System

### **Level 0: Bot Wallet** (Central Ledger)

**Scope:** Global across all DisCryptoBank instances
**Mutability:** Configured via environment variable
**Authority:** Bot Owner only (Discord ID restricted)
**Use Case:** Transaction signing, global ledger, audit trail

```
/bot-wallet info       # View bot wallet info
/bot-wallet stats      # View global statistics
/bot-wallet guilds     # View all connected guilds
/bot-wallet users      # View all registered users
/bot-wallet transactions # View global transaction ledger
```

**How it works:**
1. Bot wallet is configured via `SOLANA_PRIVATE_KEY` environment variable
2. Signs all transactions on behalf of guild treasuries
3. Maintains complete audit trail of all DisCryptoBank activity
4. Cannot be connected to any guild - operates globally in background
5. Commands restricted to Bot Owner Discord ID only

**Security:** Only accessible by Discord ID `1075818871149305966`

---

### **Level 1: Server Treasury Wallet** (`/wallet connect`)

**Scope:** Server-specific (guild)
**Mutability:** Immutable (set once by Server Owner, cannot change)
**Authority:** Server Owner ONLY (not just any admin)
**Use Case:** Pool of funds for server tasks, contests, and payouts

```
/wallet connect address:TREASURY_ADDRESS
```

**How it works:**
1. **Server Owner** runs `/wallet connect` with treasury address
2. System stores it permanently for that guild
3. Any future attempt returns: "Already configured, cannot change"
4. This wallet is the SOURCE for all `/pay` commands in that server
5. Only the Server Owner can initially configure this wallet

**Database:** Stored in `guild_wallets` table with guild_id as key

**Note:** If a Server Owner has multiple guilds, they must run `/wallet connect` separately for each server.

---

### **Level 2: User Personal Wallet** (`/user-wallet connect`)

**Scope:** User-global (works on ALL servers)
**Mutability:** Mutable (can change anytime)
**Authority:** User only
**Use Case:** Individual receiving address for payments from tasks, contests, and payouts

```
/user-wallet connect address:PERSONAL_WALLET
```

**How it works:**
1. User runs `/user-wallet connect` on ANY server with DisCryptoBank
2. System stores their Discord ID → Solana address mapping (GLOBAL)
3. This wallet address is the DESTINATION for all payments to that user
4. User can update with `/user-wallet update` anytime
5. **No need to reconnect when joining new servers** - wallet follows Discord ID

**Database:** Stored in `users` table with discord_id as key (global, not per-server)

**Important:** User wallets are for RECEIVING payments only, not for issuing payments.

---

## 💸 Payment Flow

### `/pay` Command Flow

```
User A runs: /pay user:@User B amount:50 currency:USD

1. ✅ Validate in Guild Context
   - Is this a Discord server? (not DM)
   - Is @User B a member of THIS server?

2. ✅ Check Treasury Wallet
   - Does this server have treasury configured?
   - Does treasury have enough SOL?

3. ✅ Check Personal Wallet
   - Has User B connected personal wallet?
   - Is wallet address valid?

4. ✅ Execute Transaction
   - FROM: Server Treasury (guild wallet)
   - TO: User B's Personal Wallet
   - AMOUNT: Converted to SOL
   - SIGNATURE: Logged to database

5. ✅ Send Confirmation
   - Shows source (treasury)
   - Shows destination (user)
   - Shows amount and explorer link
```

---

## 🎯 Key Rules

### Bot Wallet (`/bot-wallet` command)
- ✅ Configured via SOLANA_PRIVATE_KEY environment variable
- ✅ Acts as centralized funding source and transaction ledger
- ✅ Signs all transactions on behalf of guild treasuries
- ✅ Cannot be connected to any guild - global background operation
- ✅ Commands restricted to Bot Owner Discord ID only
- ✅ Provides global visibility into all users, payments, guilds

### Server Treasury (`/wallet` command)
- ✅ Set ONCE per server by **Server Owner only**
- ✅ Cannot be changed after initial setup
- ✅ Each server has its own treasury (independent)
- ✅ Used as SOURCE for all payments in that server (tasks, contests, /pay)
- ✅ Multiple servers = Multiple treasuries (Server Owner must connect each separately)

### User Personal Wallet (`/user-wallet` command)
- ✅ Can be set/changed ANYTIME
- ✅ SAME wallet on ALL servers (tied to Discord ID, not per-server)
- ✅ Used as DESTINATION for all payments to that user
- ✅ User data is global, not per-server
- ✅ No need to reconnect when joining new DisCryptoBank servers
- ✅ For RECEIVING payments only, not issuing

### Payments (`/pay` command)
- ✅ GUILD-SPECIFIC (only works with server members)
- ✅ Sends FROM server treasury, TO user personal wallet
- ✅ User must be server member
- ✅ Cannot pay users outside the server
- ✅ Cannot pay bots
- ✅ Treasury must have sufficient balance

---

## 📋 Command Reference

### 0. Bot Wallet Management (Bot Owner Only)

**View bot wallet info:**
```
/bot-wallet info
```

**View global statistics:**
```
/bot-wallet stats
```

**View all connected guild treasuries:**
```
/bot-wallet guilds
```

**View all registered users:**
```
/bot-wallet users
```

**View global transaction ledger:**
```
/bot-wallet transactions
```

---

### 1. Server Treasury Setup (Server Owner Only)

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

### Bot Wallet Configuration
```
Environment Variable: SOLANA_PRIVATE_KEY
- Used to derive bot's public key and sign transactions
- Single centralized wallet for all DisCryptoBank operations
- Not stored in database (environment-based)
```
**Key:** Global bot wallet, configurable only via environment

### Users Table
```sql
users {
  discord_id: "123456789",      -- User's Discord ID (GLOBAL KEY)
  username: "username",          -- Discord username
  solana_address: "9B5X6E...",   -- Personal wallet (GLOBAL across all servers)
  created_at: timestamp
}
```
**Key:** Global per user, independent of servers - wallet follows Discord ID everywhere

### Guild Wallets Table
```sql
guild_wallets {
  guild_id: "987654321",         -- Discord Server ID
  wallet_address: "EYmq...",     -- Treasury wallet (IMMUTABLE after setup)
  configured_at: timestamp,
  configured_by: "owner_user_id" -- Server Owner who configured it
}
```
**Key:** One per server, set by Server Owner only, never changes after initial configuration

**Note:** Guild treasury wallets remain in database for organizational tracking but the Bot Wallet (via SOLANA_PRIVATE_KEY) is the centralized funding source that signs all transactions.

### Transactions Table
```sql
transactions {
  id: auto,
  guild_id: "987654321",         -- Which server
  from_address: "EYmq...",       -- Treasury
  to_address: "9B5X6E...",       -- User wallet
  amount: 1.5,                   -- SOL amount
  signature: "abc123...",        -- Tx signature
  created_at: timestamp
}
```
**Key:** Records all transactions per server

---

## ✅ Verification Checklist

### Before Payment Succeeds

- [ ] Command run in a Discord server (not DM)
- [ ] Target @mention is a member of current server
- [ ] Target user is not a bot
- [ ] Server has treasury wallet configured
- [ ] Treasury wallet has sufficient SOL balance
- [ ] Target user has personal wallet connected
- [ ] Target user's wallet address is valid
- [ ] Bot has authority to sign transactions

### Error Messages

| Error | Cause | Solution |
|-------|-------|----------|
| "Can only use in Discord server" | Command in DM | Use in a server |
| "Not a member of this server" | User not in guild | Add user to server |
| "Cannot pay bots" | Target is a bot | Select real user |
| "Treasury not configured" | Server Owner hasn't run /wallet connect | Server Owner runs /wallet connect |
| "Insufficient treasury balance" | Not enough SOL in treasury | Fund the treasury |
| "Wallet Not Connected" | User hasn't run /user-wallet connect | User runs /user-wallet connect (once, works everywhere) |
| "Invalid wallet address" | Address format error | User runs /user-wallet connect with valid address |
| "Only Server Owner can connect" | Non-owner tried /wallet connect | Server Owner must configure treasury |
| "Bot wallet commands restricted" | Non-owner tried /bot-wallet | Only Bot Owner can use these commands |

---

## 🔐 Security Features

- ✅ **Bot Wallet commands** restricted to Bot Owner Discord ID only
- ✅ **Treasury wallet** can only be configured by **Server Owner** (not just any admin)
- ✅ Treasury wallet is **immutable** (cannot be changed after setup)
- ✅ Users can only update their **own** personal wallet
- ✅ Payments only work within the **same server**
- ✅ Bot signs transactions but provides audit trail
- ✅ All transactions logged to database with signatures
- ✅ User wallets are **global** (no need to reconnect per server)
- ✅ Three-tier separation: Bot Wallet ↔ Guild Treasury ↔ User Wallet

---

## 📊 Example Scenario

### Setup Phase
```
Server: "Tech Community"
Server Owner Alice: /wallet connect address:EYmq... ✅
  → Treasury: EYmq... (locked forever on Tech Community)
  → Only Alice (Server Owner) could run this command

User Bob: /user-wallet connect address:9B5X6E... ✅
  → Bob's wallet: 9B5X6E... (works on ALL servers)
  → Bob never needs to run this command again on any server

User Carol: /user-wallet connect address:XYZ123... ✅
  → Carol's wallet: XYZ123... (works on ALL servers)
```

### Payment Phase
```
Alice runs: /pay user:@Bob amount:100 currency:USD ✅
  → Sends from EYmq... (Tech Community Treasury)
  → Sends to 9B5X6E... (Bob's Personal Wallet)
  → Recorded to database with TX signature
  → Bot wallet signs the transaction

Bob runs: /pay user:@Carol amount:50 currency:SOL ✅
  → Sends from EYmq... (Tech Community Treasury)
  → Sends to XYZ123... (Carol's Personal Wallet)
  → Recorded to database with TX signature
```

### Multi-Server Scenario
```
User Bob joins "Gaming Guild" server
Server Owner Dave: /wallet connect address:AAAA... ✅
  → Treasury: AAAA... (locked on Gaming Guild)
  → Dave must configure this separately (one per server)

Dave runs: /pay user:@Bob amount:25 currency:SOL ✅
  → Sends from AAAA... (Gaming Guild Treasury)
  → Sends to 9B5X6E... (Bob's SAME Personal Wallet)
  
Note: Bob's wallet address (9B5X6E...) is the SAME
because user wallets are tied to Discord ID, not servers!
Bob did NOT need to run /user-wallet connect again.
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

**Version:** 3.0.0
**Last Updated:** Feb 04, 2026
**Status:** ✅ Production Ready

## Changelog v3.0.0
- Added three-tier wallet system (Bot Wallet, Guild Treasury, User Wallet)
- Bot Wallet commands restricted to Bot Owner Discord ID only
- Guild Treasury wallet connection restricted to Server Owner only
- User wallets are now explicitly documented as global (tied to Discord ID)
- Added `/bot-wallet` command with info, stats, guilds, users, transactions subcommands
