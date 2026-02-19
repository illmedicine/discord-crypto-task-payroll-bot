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

    // Guard: reject public addresses mistakenly stored as secrets
    if (typeof secret === 'string' && looksLikePublicKey(secret)) {
      console.error('[CRYPTO] wallet_secret looks like a PUBLIC ADDRESS (32 bytes), not a private key (64 bytes). Please enter the actual secret key.');
      return null;
    }

    // Support JSON byte array format: [1,2,3,...] (e.g. from Solana keypair file)
    if (typeof secret === 'string' && secret.trim().startsWith('[')) {
      const arr = JSON.parse(secret);
      if (arr.length === 32) {
        console.error('[CRYPTO] JSON array is 32 bytes (public key), not 64 bytes (secret key). Please provide the full secret key.');
        return null;
      }
      return Keypair.fromSecretKey(new Uint8Array(arr));
    }
    // Support raw Uint8Array / array
    if (Array.isArray(secret) || secret instanceof Uint8Array) {
      if (secret.length === 32) {
        console.error('[CRYPTO] Array is 32 bytes (public key), not 64 bytes (secret key).');
        return null;
      }
      return Keypair.fromSecretKey(new Uint8Array(secret));
    }
    // Default: base58-encoded string
    const secretKey = bs58.decode(secret);
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

// Get Solana price in USD (from CoinGecko) with timeout
const getSolanaPrice = async () => {
  try {
    const axios = require('axios');
    
    // Create a timeout promise that rejects after 5 seconds
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Price fetch timeout')), 5000)
    );
    
    // Race the actual call against the timeout
    const response = await Promise.race([
      axios.get('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd'),
      timeoutPromise
    ]);
    
    return response.data.solana.usd;
  } catch (error) {
    console.error('Error fetching SOL price:', error);
    return null;
  }
};

module.exports = {
  connection,
  getWallet,
  getKeypairFromSecret,
  sendSol,
  sendSolFrom,
  getBalance,
  isValidSolanaAddress,
  getSolanaPrice,
  LAMPORTS_PER_SOL
};
