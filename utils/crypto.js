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

// Send SOL to recipient
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
    new PublicKey(address);
    return true;
  } catch (error) {
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
  sendSol,
  getBalance,
  isValidSolanaAddress,
  getSolanaPrice,
  LAMPORTS_PER_SOL
};
