const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const crypto = require('../utils/crypto');
const db = require('../utils/db');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('user-wallet')
    .setDescription('Connect your personal Solana wallet (works on all servers)')
    .addSubcommand(subcommand =>
      subcommand
        .setName('connect')
        .setDescription('Connect your personal Solana wallet address and optional private key')
        .addStringOption(option =>
          option.setName('address')
            .setDescription('Your personal Solana wallet address')
            .setRequired(true)
        )
        .addStringOption(option =>
          option.setName('private-key')
            .setDescription('Your Solana private key (base58) — required for pot-mode horse races')
            .setRequired(false)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('view')
        .setDescription('View your connected wallet address and key status')
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('update')
        .setDescription('Update your connected wallet address or private key')
        .addStringOption(option =>
          option.setName('address')
            .setDescription('Your new personal Solana wallet address')
            .setRequired(false)
        )
        .addStringOption(option =>
          option.setName('private-key')
            .setDescription('Your Solana private key (base58) — required for pot-mode horse races')
            .setRequired(false)
        )
    ),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    try {
      const subcommand = interaction.options.getSubcommand();
      const userId = interaction.user.id;
      const username = interaction.user.username;

      if (subcommand === 'connect') {
        const address = (interaction.options.getString('address') || '').trim().replace(/[^\x20-\x7E]/g, '');
        const privateKey = (interaction.options.getString('private-key') || '').trim().replace(/[^\x20-\x7E]/g, '');

        console.log(`[user-wallet] connect: userId=${userId}, sanitized address="${address}", hasPrivateKey=${!!privateKey}`);

        // Check if user already has a wallet connected
        const existingUser = await db.getUser(userId);
        if (existingUser && existingUser.solana_address) {
          const embed = new EmbedBuilder()
            .setColor('#FF9800')
            .setTitle('⚠️ Wallet Already Connected')
            .setDescription('You already have a wallet connected.')
            .addFields(
              { name: 'Current Wallet', value: `\`${existingUser.solana_address}\`` },
              { name: 'Update?', value: 'Use `/user-wallet update` to change your wallet or add your private key' }
            )
            .setTimestamp();

          return interaction.editReply({ embeds: [embed] });
        }

        // Validate Solana address
        if (!crypto.isValidSolanaAddress(address)) {
          const embed = new EmbedBuilder()
            .setColor('#FF0000')
            .setTitle('❌ Invalid Solana Address')
            .setDescription('The address you provided is not a valid Solana address.')
            .addFields(
              { name: 'Tips:', value: '• Use a Base58 encoded address\n• Should be 44 characters long\n• Example: `11111111111111111111111111111111`' }
            )
            .setTimestamp();

          return interaction.editReply({ embeds: [embed] });
        }

        // Validate private key if provided
        if (privateKey) {
          try {
            const kp = crypto.getKeypairFromSecret(privateKey);
            const derivedPub = kp.publicKey.toBase58();
            if (derivedPub !== address) {
              return interaction.editReply({
                embeds: [new EmbedBuilder()
                  .setColor('#FF0000')
                  .setTitle('❌ Key Mismatch')
                  .setDescription('The private key does not match the wallet address you provided.')
                  .addFields(
                    { name: 'Address You Entered', value: `\`${address}\`` },
                    { name: 'Address From Key', value: `\`${derivedPub}\`` }
                  )
                  .setTimestamp()
                ]
              });
            }
          } catch (err) {
            return interaction.editReply({
              embeds: [new EmbedBuilder()
                .setColor('#FF0000')
                .setTitle('❌ Invalid Private Key')
                .setDescription('Could not parse the private key. Make sure it is a valid base58-encoded Solana private key.')
                .setTimestamp()
              ]
            });
          }
        }

        // Add user to database
        await db.addUser(userId, username, address);

        // Save private key if provided
        if (privateKey) {
          await db.setUserWalletSecret(userId, privateKey);
        }

        const fields = [
          { name: 'Wallet Address', value: `\`${address}\`` },
          { name: 'Private Key', value: privateKey ? '🔑 Saved — you can enter pot-mode races' : '⚠️ Not saved — add with `/user-wallet update` to join pot-mode races' },
          { name: 'Status', value: '🟢 Active on all servers' },
          { name: 'Next Steps', value: privateKey
            ? 'You\'re ready to enter pot-mode horse races! Admins can also pay you with `/pay @you`'
            : 'To participate in pot-mode horse races, update your wallet with your private key using `/user-wallet update`'
          }
        ];

        const successEmbed = new EmbedBuilder()
          .setColor('#14F195')
          .setTitle('✅ Wallet Connected Successfully')
          .setDescription('Your personal Solana wallet is now connected to your Discord account across all servers.')
          .addFields(fields)
          .setTimestamp();

        return interaction.editReply({ embeds: [successEmbed] });
      }

      if (subcommand === 'view') {
        const userData = await db.getUser(userId);

        if (!userData || !userData.solana_address) {
          const embed = new EmbedBuilder()
            .setColor('#FF0000')
            .setTitle('❌ No Wallet Connected')
            .setDescription('You haven\'t connected a wallet yet.')
            .addFields(
              { name: 'Connect Now?', value: 'Use `/user-wallet connect` to add your Solana wallet' }
            )
            .setTimestamp();

          return interaction.editReply({ embeds: [embed] });
        }

        let balanceText = '(checking...)';
        try {
          const bal = await crypto.getBalance(userData.solana_address);
          balanceText = `${bal.toFixed(6)} SOL`;
        } catch (_) {
          balanceText = '(unable to fetch)';
        }

        const hasKey = !!userData.wallet_secret;

        const embed = new EmbedBuilder()
          .setColor('#14F195')
          .setTitle('💼 Your Connected Wallet')
          .setDescription('This is the wallet linked to your Discord account.')
          .addFields(
            { name: 'Wallet Address', value: `\`${userData.solana_address}\`` },
            { name: '💰 Balance', value: balanceText, inline: true },
            { name: '🔑 Private Key', value: hasKey ? '✅ Saved — pot-mode ready' : '❌ Not saved — use `/user-wallet update` to add', inline: true },
            { name: 'Status', value: '🟢 Active' },
            { name: 'Connected Since', value: new Date(userData.created_at).toLocaleString() }
          )
          .setTimestamp();

        return interaction.editReply({ embeds: [embed] });
      }

      if (subcommand === 'update') {
        const newAddress = (interaction.options.getString('address') || '').trim().replace(/[^\x20-\x7E]/g, '');
        const privateKey = (interaction.options.getString('private-key') || '').trim().replace(/[^\x20-\x7E]/g, '');

        // Check if user has a wallet
        const userData = await db.getUser(userId);
        if (!userData) {
          const embed = new EmbedBuilder()
            .setColor('#FF0000')
            .setTitle('❌ No Wallet Connected')
            .setDescription('Use `/user-wallet connect` first.')
            .setTimestamp();

          return interaction.editReply({ embeds: [embed] });
        }

        // Must provide at least one thing to update
        if (!newAddress && !privateKey) {
          return interaction.editReply({
            content: '⚠️ Provide at least one option: `address` or `private-key` to update.'
          });
        }

        // Validate new address if provided
        if (newAddress && !crypto.isValidSolanaAddress(newAddress)) {
          return interaction.editReply({
            embeds: [new EmbedBuilder()
              .setColor('#FF0000')
              .setTitle('❌ Invalid Solana Address')
              .setDescription('The address you provided is not a valid Solana address.')
              .setTimestamp()
            ]
          });
        }

        // Validate private key if provided, and auto-derive address from it
        let derivedAddress = null;
        if (privateKey) {
          try {
            const kp = crypto.getKeypairFromSecret(privateKey);
            derivedAddress = kp.publicKey.toBase58();
          } catch (err) {
            return interaction.editReply({
              embeds: [new EmbedBuilder()
                .setColor('#FF0000')
                .setTitle('❌ Invalid Private Key')
                .setDescription('Could not parse the private key. Make sure it is a valid base58-encoded Solana private key.')
                .setTimestamp()
              ]
            });
          }

          // If user also provided an address, verify it matches the key
          if (newAddress && derivedAddress !== newAddress) {
            return interaction.editReply({
              embeds: [new EmbedBuilder()
                .setColor('#FF0000')
                .setTitle('❌ Key Mismatch')
                .setDescription('The private key does not match the address you provided.')
                .addFields(
                  { name: 'Address You Entered', value: `\`${newAddress}\`` },
                  { name: 'Address From Key', value: `\`${derivedAddress}\`` }
                )
                .setTimestamp()
              ]
            });
          }

          // If key doesn't match existing address and no new address given, auto-update address to match key
          if (!newAddress && derivedAddress !== userData.solana_address) {
            // Auto-update the wallet address to match the private key
            await db.addUser(userId, username, derivedAddress);
          }
        }

        const effectiveAddress = newAddress || derivedAddress || userData.solana_address;

        // Update address if a new one was explicitly provided
        if (newAddress && newAddress !== userData.solana_address) {
          await db.addUser(userId, username, newAddress);
        }

        // Save private key if provided
        if (privateKey) {
          await db.setUserWalletSecret(userId, privateKey);
        }

        const fields = [];
        const finalAddress = newAddress || derivedAddress || userData.solana_address;
        if (finalAddress !== userData.solana_address) {
          fields.push({ name: 'Old Address', value: `\`${userData.solana_address}\`` });
          fields.push({ name: 'New Address', value: `\`${finalAddress}\`` });
        } else {
          fields.push({ name: 'Wallet Address', value: `\`${effectiveAddress}\`` });
        }
        if (privateKey) {
          fields.push({ name: '🔑 Private Key', value: '✅ Saved — you can now enter pot-mode races' });
        }
        fields.push({ name: 'Status', value: '🟢 Updated on all servers' });

        const embed = new EmbedBuilder()
          .setColor('#14F195')
          .setTitle('✅ Wallet Updated Successfully')
          .setDescription('Your wallet info has been updated across all DisCryptoBank servers.')
          .addFields(fields)
          .setTimestamp();

        return interaction.editReply({ embeds: [embed] });
      }

    } catch (error) {
      console.error('Error in user-wallet command:', error);
      return interaction.editReply({
        content: `❌ Error: ${error.message}`
      });
    }
  }
};
