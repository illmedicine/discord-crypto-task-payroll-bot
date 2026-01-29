# DisCryptoBank Setup Guide

## 🚀 Quick Start

DisCryptoBank now operates as a **dual-wallet system**. Here's how to set it up.

---

## 📋 Step 1: Admin Setup (Server Treasury)

**Requirement:** You must be a server admin

### Command
```
/wallet connect address:YOUR_SOLANA_ADDRESS
```

### Example
```
/wallet connect address:EYmqFHtBxiyk3qHGecdxcRoEFoktSoJLskBvSL3GmFtP
```

### Response
```
✅ Treasury Wallet Configured
Treasury Address: EYmqFHtBxiyk3qHGecdxcRoEFoktSoJLskBvSL3GmFtP
Status: 🔒 Locked & Immutable
```

### ⚠️ Important Notes
- ✅ This can ONLY be set once per server
- ✅ Once set, it CANNOT be changed
- ✅ Each server has its own independent treasury
- ✅ This is the wallet that pays members

---

## 👤 Step 2: User Setup (Personal Wallet)

**Requirement:** Any user on the server

### Command
```
/user-wallet connect address:YOUR_PERSONAL_WALLET
```

### Example
```
/user-wallet connect address:9B5X6E3J4K2L8M9N0P1Q2R3S4T5U6V7
```

### Response
```
✅ Wallet Connected Successfully
Your personal Solana wallet is now connected 
Status: 🟢 Active on all servers
```

### ℹ️ Important Notes
- ✅ You can change this anytime with `/user-wallet update`
- ✅ This same wallet works on ALL servers with DisCryptoBank
- ✅ This is where you RECEIVE payments
- ✅ No server can change this

---

## 💸 Step 3: Send Payments

### Command
```
/pay user:@username amount:NUMBER currency:CURRENCY
```

### Examples

**Send 50 USD in SOL:**
```
/pay user:@john amount:50 currency:USD
```

**Send 1.5 SOL directly:**
```
/pay user:@john amount:1.5 currency:SOL
```

### Requirements
- ✅ Recipient must be a member of THIS server
- ✅ Recipient must have personal wallet connected
- ✅ Server must have treasury configured
- ✅ Treasury must have enough SOL

### Response
```
✅ Payment Sent Successfully
From: Server Treasury
To: @john (wallet address)
Amount: 50 USD → 1.25 SOL
```

---

## 🔍 Check Your Setup

### Check Treasury Balance
```
/wallet balance
```

### Check Treasury Info
```
/wallet info
```

### Check Your Personal Wallet
```
/user-wallet view
```

### Update Your Personal Wallet
```
/user-wallet update address:NEW_ADDRESS
```

---

## 🎯 How It Works

### Server Treasury (`/wallet`)
- Set ONCE by admin when first configuring server
- Same wallet every time, **cannot change**
- SOURCE of all payments in that server
- Different per server

### Personal Wallet (`/user-wallet`)
- Set by each user
- Can CHANGE anytime
- DESTINATION for payments to that user
- **SAME everywhere** (all servers)

### Payments (`/pay`)
- Sends FROM server treasury
- Sends TO user's personal wallet
- Only works with server members
- Converts USD to SOL if needed

---

## ✅ Complete Setup Example

### Admin Setup (Do this ONCE)
```
1. Admin: /wallet connect address:TREASURY_ADDRESS ✅
   Response: Locked and immutable
```

### User Setup (Everyone does this)
```
2. User A: /user-wallet connect address:USER_A_WALLET ✅
3. User B: /user-wallet connect address:USER_B_WALLET ✅
4. User C: /user-wallet connect address:USER_C_WALLET ✅
```

### Payments (Now operational)
```
5. Admin: /pay user:@User_A amount:100 currency:USD ✅
   → Sends from treasury to User A's wallet
   
6. Admin: /pay user:@User_B amount:50 currency:USD ✅
   → Sends from treasury to User B's wallet
```

---

## 🔐 Safety Features

### ✅ Treasury is Protected
- Cannot be changed once set
- Prevents accidental misconfiguration
- Each server has independent treasury

### ✅ Payments are Secure
- Only works with actual server members
- Requires recipient to have wallet connected
- All transactions logged to blockchain

### ✅ User Data is Protected
- Users control their own wallet
- Can change personal wallet anytime
- One wallet works on all servers

---

## ❌ Common Issues

### "Treasury not configured yet"
**Solution:** Have a server admin run `/wallet connect`

### "@User doesn't have wallet connected"
**Solution:** User runs `/user-wallet connect` first

### "Insufficient treasury balance"
**Solution:** Fund the treasury wallet with more SOL

### "User is not a server member"
**Solution:** You can only pay people in this Discord server

### "Cannot pay bots"
**Solution:** Select a real Discord user instead

---

## 📊 Multi-Server Example

### Server 1: "Tech Community"
- Treasury: Wallet A (immutable)
- Users: Bob, Carol, Dave
  - Bob's personal: Wallet X (same on all servers)
  - Carol's personal: Wallet Y
  - Dave's personal: Wallet Z

### Server 2: "Gaming Guild"
- Treasury: Wallet B (completely different, immutable)
- Users: Bob, Eve, Frank
  - Bob's personal: Wallet X **(SAME as Server 1!)**
  - Eve's personal: Wallet Q
  - Frank's personal: Wallet R

**Result:**
- Bob receives in Wallet X on BOTH servers
- Each server has its own treasury (A vs B)
- Bob's wallet is consistent everywhere

---

## 🎓 Key Concepts

| Concept | Scope | Mutability | Authority | Purpose |
|---------|-------|-----------|-----------|---------|
| **Treasury** | Per Server | Immutable | Admin | Pays members |
| **Personal Wallet** | Global User | Mutable | User | Receives funds |
| **Payment** | Same Server | N/A | Any user | Send SOL |

---

## 🚀 Next Steps

1. ✅ Admin: `/wallet connect` to set treasury
2. ✅ Users: `/user-wallet connect` to enable payments
3. ✅ Anyone: `/pay @member amount 50 currency:USD` to send
4. ✅ Check: `/diagnose` or `/bot-status` if issues

---

**Ready to go!** Your DisCryptoBank is now set up and ready to manage payroll! 🎉

**Version:** 2.1.0
**Architecture:** Dual-wallet (Treasury + Personal)
**Status:** ✅ Production Ready
