const {
  Connection,
  PublicKey,
  Transaction,
  SystemProgram,
  sendAndConfirmTransaction,
  Keypair,
  LAMPORTS_PER_SOL
} = require('@solana/web3.js');
const bs58 = require('bs58');
const { decryptSecret, isEncrypted } = require('./encryption');
require('dotenv').config();

// Initialize Solana connection
const connection = new Connection(
  process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com',
  'confirmed'
);

// Load wallet from private key
const getWallet = () => {
  try {
    const secretKey = bs58.decode(process.env.SOLANA_PRIVATE_KEY);
    return Keypair.fromSecretKey(new Uint8Array(secretKey));
  } catch (error) {
    console.error('Error loading wallet:', error);
    return null;
  }
};

/**
 * Detect if a value looks like a Solana public address (not a secret key).
 * Public keys are 32 bytes, secret keys are 64 bytes.
 */
const looksLikePublicKey = (value) => {
  if (!value || typeof value !== 'string') return false;
  try {
    const decoded = bs58.decode(value.trim());
    return decoded.length === 32; // 32 bytes = public key, not secret
  } catch {
    return false;
  }
};

// Create Keypair from a base58-encoded secret key (or JSON byte array)
const getKeypairFromSecret = (secret) => {
  try {
    if (!secret) return null;

    // Decrypt if encrypted (enc:... format)
    let plainSecret = secret;
    if (typeof secret === 'string' && isEncrypted(secret)) {
      plainSecret = decryptSecret(secret);
      if (!plainSecret) {
        console.error('[CRYPTO] Failed to decrypt wallet_secret — ENCRYPTION_KEY may be missing or wrong.');
        return null;
      }
    }

    // Guard: reject public addresses mistakenly stored as secrets
    if (typeof plainSecret === 'string' && looksLikePublicKey(plainSecret)) {
      console.error('[CRYPTO] wallet_secret looks like a PUBLIC ADDRESS (32 bytes), not a private key (64 bytes). Please enter the actual secret key.');
      return null;
    }

    // Guard: detect still-encrypted values that decryption failed to resolve
    if (typeof plainSecret === 'string' && (plainSecret.startsWith('enc:') || plainSecret.startsWith('e2e:'))) {
      console.error(`[CRYPTO] wallet_secret is still encrypted (${plainSecret.slice(0, 4)}...) — decryption failed or ENCRYPTION_KEY is missing/wrong.`);
      return null;
    }

    // Support JSON byte array format: [1,2,3,...] (e.g. from Solana keypair file)
    if (typeof plainSecret === 'string' && plainSecret.trim().startsWith('[')) {
      const arr = JSON.parse(plainSecret);
      if (arr.length === 32) {
        console.error('[CRYPTO] JSON array is 32 bytes (public key), not 64 bytes (secret key). Please provide the full secret key.');
        return null;
      }
      return Keypair.fromSecretKey(new Uint8Array(arr));
    }
    // Support raw Uint8Array / array
    if (Array.isArray(plainSecret) || plainSecret instanceof Uint8Array) {
      if (plainSecret.length === 32) {
        console.error('[CRYPTO] Array is 32 bytes (public key), not 64 bytes (secret key).');
        return null;
      }
      return Keypair.fromSecretKey(new Uint8Array(plainSecret));
    }
    // Default: base58-encoded string
    const secretKey = bs58.decode(plainSecret);
    return Keypair.fromSecretKey(new Uint8Array(secretKey));
  } catch (error) {
    console.error('Error creating keypair from secret:', error.message, `(type=${typeof secret}, len=${secret?.length})`);
    return null;
  }
};

// Send SOL to recipient (from bot wallet)
const sendSol = async (recipientAddress, amountSol) => {
  try {
    const wallet = getWallet();
    if (!wallet) throw new Error('Wallet not initialized');

    const recipient = new PublicKey(recipientAddress);
    const instruction = SystemProgram.transfer({
      fromPubkey: wallet.publicKey,
      toPubkey: recipient,
      lamports: amountSol * LAMPORTS_PER_SOL
    });

    const transaction = new Transaction().add(instruction);
    const signature = await sendAndConfirmTransaction(connection, transaction, [wallet]);
    
    return {
      success: true,
      signature,
      amount: amountSol,
      recipient: recipientAddress
    };
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
};

// Send SOL from a specific keypair (guild treasury wallet)
const sendSolFrom = async (keypairOrSecret, recipientAddress, amountSol) => {
  try {
    const wallet = typeof keypairOrSecret === 'string'
      ? getKeypairFromSecret(keypairOrSecret)
      : keypairOrSecret;
    if (!wallet) throw new Error('Invalid wallet keypair');

    const recipient = new PublicKey(recipientAddress);
    const lamports = Math.floor(amountSol * LAMPORTS_PER_SOL);
    const instruction = SystemProgram.transfer({
      fromPubkey: wallet.publicKey,
      toPubkey: recipient,
      lamports
    });

    const transaction = new Transaction().add(instruction);
    const signature = await sendAndConfirmTransaction(connection, transaction, [wallet]);
    
    return {
      success: true,
      signature,
      amount: amountSol,
      recipient: recipientAddress
    };
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
};

// Get account balance with timeout
const getBalance = async (publicKey) => {
  try {
    const key = new PublicKey(publicKey);
    
    // Create a timeout promise that rejects after 5 seconds
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Balance fetch timeout')), 5000)
    );
    
    // Race the actual call against the timeout
    const balance = await Promise.race([
      connection.getBalance(key),
      timeoutPromise
    ]);
    
    return balance / LAMPORTS_PER_SOL;
  } catch (error) {
    console.error('Error fetching balance:', error);
    return 0;
  }
};

// Verify Solana address format
const isValidSolanaAddress = (address) => {
  try {
    if (!address || typeof address !== 'string') return false;
    const cleaned = address.trim();
    if (cleaned.length < 32 || cleaned.length > 44) return false;
    new PublicKey(cleaned);
    return true;
  } catch (error) {
    console.log(`[crypto] isValidSolanaAddress FAILED for "${address}" (len=${address?.length}): ${error.message}`);
    return false;
  }
};

// Get Solana price in USD with fallbacks and timeout
const getSolanaPrice = async () => {
  const axios = require('axios');
  
  try {
    const { data } = await axios.get('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd', { timeout: 5000 });
    if (data?.solana?.usd) return data.solana.usd;
  } catch (_) {}
  
  try {
    const { data } = await axios.get('https://api.coinbase.com/v2/prices/SOL-USD/spot', { timeout: 5000 });
    if (data?.data?.amount) return parseFloat(data.data.amount);
  } catch (_) {}
  
  try {
    const { data } = await axios.get('https://api.kraken.com/0/public/Ticker?pair=SOLUSD', { timeout: 5000 });
    if (data?.result?.SOLUSD?.c?.[0]) return parseFloat(data.result.SOLUSD.c[0]);
  } catch (_) {}
  
  console.error('Error fetching SOL price: All APIs failed');
  return null;
};

/**
 * Verify that a transfer of at least `minAmountSol` was sent
 * from `senderAddress` to `recipientAddress` on-chain.
 * Checks the last N confirmed signatures on the recipient's account.
 *
 * Returns: { verified: true, signature, amount } or { verified: false, reason }
 */
const verifyIncomingTransfer = async (senderAddress, recipientAddress, minAmountSol, opts = {}) => {
  try {
    const { maxAge = 30 * 60 * 1000, limit = 20, excludeSignatures = [] } = opts;
    const recipientPubkey = new PublicKey(recipientAddress);
    const senderPubkey = new PublicKey(senderAddress);
    const minLamports = Math.floor(minAmountSol * LAMPORTS_PER_SOL);
    const cutoff = Date.now() - maxAge;

    console.log(`[verifyTransfer] Looking for >= ${minAmountSol} SOL from ${senderAddress.slice(0,6)}... to ${recipientAddress.slice(0,6)}...`);

    // Fetch recent confirmed signatures for the recipient
    const signatures = await connection.getSignaturesForAddress(recipientPubkey, { limit });
    if (!signatures || signatures.length === 0) {
      return { verified: false, reason: 'No recent transactions found on treasury wallet' };
    }

    for (const sigInfo of signatures) {
      // Skip if too old
      if (sigInfo.blockTime && sigInfo.blockTime * 1000 < cutoff) continue;
      // Skip if errored
      if (sigInfo.err) continue;
      // Skip already-used signatures
      if (excludeSignatures.includes(sigInfo.signature)) continue;

      try {
        const tx = await connection.getParsedTransaction(sigInfo.signature, { maxSupportedTransactionVersion: 0 });
        if (!tx || !tx.meta || tx.meta.err) continue;

        // Look through instructions for a system transfer from sender to recipient
        const instructions = tx.transaction?.message?.instructions || [];
        for (const ix of instructions) {
          if (ix.program === 'system' && ix.parsed?.type === 'transfer') {
            const info = ix.parsed.info;
            if (
              info.source === senderPubkey.toString() &&
              info.destination === recipientPubkey.toString() &&
              info.lamports >= minLamports
            ) {
              const foundAmount = info.lamports / LAMPORTS_PER_SOL;
              console.log(`[verifyTransfer] ✅ MATCH: sig=${sigInfo.signature.slice(0,12)}... amount=${foundAmount} SOL`);
              return {
                verified: true,
                signature: sigInfo.signature,
                amount: foundAmount,
                lamports: info.lamports
              };
            }
          }
        }
      } catch (txErr) {
        console.warn(`[verifyTransfer] Failed to parse tx ${sigInfo.signature.slice(0,12)}:`, txErr.message);
      }
    }

    return { verified: false, reason: `No matching transfer of >= ${minAmountSol} SOL found in last ${limit} transactions` };
  } catch (error) {
    console.error('[verifyTransfer] Error:', error.message);
    return { verified: false, reason: error.message };
  }
};

// Generate a new Solana Keypair and return { publicKey, secretKey (base58) }
const generateKeypair = () => {
  const kp = Keypair.generate();
  return {
    publicKey: kp.publicKey.toBase58(),
    secretKey: bs58.encode(kp.secretKey),
    keypair: kp
  };
};

module.exports = {
  connection,
  getWallet,
  getKeypairFromSecret,
  generateKeypair,
  sendSol,
  sendSolFrom,
  getBalance,
  isValidSolanaAddress,
  getSolanaPrice,
  verifyIncomingTransfer,
  LAMPORTS_PER_SOL
};
