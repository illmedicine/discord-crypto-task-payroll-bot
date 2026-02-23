const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const crypto = require('../utils/crypto');
const db = require('../utils/db');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('pay-staff')
    .setDescription('Pay a staff member from the guild treasury wallet (Server Owner only)')
    .addUserOption(option =>
      option.setName('worker')
        .setDescription('The staff member to pay')
        .setRequired(true)
    )
    .addNumberOption(option =>
      option.setName('amount')
        .setDescription('Amount in USD to send')
        .setRequired(true)
        .setMinValue(0.01)
        .setMaxValue(100000)
    )
    .addStringOption(option =>
      option.setName('memo')
        .setDescription('Optional memo/reason for payment')
        .setRequired(false)
    ),

  async execute(interaction) {
    const guildId = interaction.guildId;

    // ── 1. Server Owner check ──
    let guild = interaction.guild;
    if (!guild) {
      try { guild = await interaction.client.guilds.fetch(guildId); } catch {}
    }
    if (!guild || guild.ownerId !== interaction.user.id) {
      return interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0xef4444)
            .setTitle('❌ Owner Only')
            .setDescription('Only the **server owner** can use `/pay-staff`.')
        ],
        ephemeral: true
      });
    }

    await interaction.deferReply();

    try {
      const targetUser = interaction.options.getUser('worker');
      const amountUsd = interaction.options.getNumber('amount');
      const memo = interaction.options.getString('memo') || '';

      // ── 2. Get worker's wallet ──
      const user = await db.getUser(targetUser.id);
      if (!user || !user.solana_address) {
        return interaction.editReply({
          embeds: [
            new EmbedBuilder()
              .setColor(0xef4444)
              .setTitle('❌ No Wallet Connected')
              .setDescription(`**${targetUser.username}** has not connected a DisCryptoBank wallet.\nThey must run \`/user-wallet connect\` first.`)
          ]
        });
      }

      // ── 3. Get guild treasury wallet ──
      const guildWallet = await db.getGuildWallet(guildId);
      if (!guildWallet || !guildWallet.wallet_address) {
        return interaction.editReply({
          embeds: [
            new EmbedBuilder()
              .setColor(0xef4444)
              .setTitle('❌ No Treasury Wallet')
              .setDescription('No treasury wallet is configured for this server.\nUse `/wallet connect` to set one up.')
          ]
        });
      }
      if (!guildWallet.wallet_secret) {
        return interaction.editReply({
          embeds: [
            new EmbedBuilder()
              .setColor(0xef4444)
              .setTitle('❌ No Private Key')
              .setDescription('The treasury wallet doesn\'t have a private key configured.\nAuto-payments require the treasury wallet secret to be set.')
          ]
        });
      }

      // ── 4. Get SOL price ──
      const solPrice = await crypto.getSolanaPrice();
      if (!solPrice || solPrice <= 0) {
        return interaction.editReply({
          embeds: [
            new EmbedBuilder()
              .setColor(0xf59e0b)
              .setTitle('⚠️ Price Unavailable')
              .setDescription('Could not fetch the current SOL price. Please try again in a moment.')
          ]
        });
      }

      const amountSol = amountUsd / solPrice;

      // ── 5. Confirm & send ──
      const result = await crypto.sendSolFrom(
        guildWallet.wallet_secret,
        user.solana_address,
        amountSol
      );

      if (!result.success) {
        return interaction.editReply({
          embeds: [
            new EmbedBuilder()
              .setColor(0xef4444)
              .setTitle('❌ Transaction Failed')
              .setDescription(`Solana transaction failed: ${result.error}`)
          ]
        });
      }

      // ── 6. Record transaction ──
      try {
        await db.recordTransaction(
          guildId,
          guildWallet.wallet_address,
          user.solana_address,
          amountSol,
          result.signature
        );
      } catch (e) {
        console.error('[pay-staff] recordTransaction error:', e?.message);
      }

      // ── 7. Update budget spent ──
      try {
        await db.addBudgetSpend(guildId, amountSol);
      } catch (e) {
        console.error('[pay-staff] addBudgetSpend error:', e?.message);
      }

      // ── 8. Sync payout to backend ──
      try {
        const DCB_BACKEND_URL = process.env.DCB_BACKEND_URL || '';
        const DCB_INTERNAL_SECRET = process.env.DCB_INTERNAL_SECRET || '';
        if (DCB_BACKEND_URL) {
          fetch(`${DCB_BACKEND_URL.replace(/\/$/, '')}/api/internal/log-payout`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-dcb-internal-secret': DCB_INTERNAL_SECRET
            },
            body: JSON.stringify({
              guild_id: guildId,
              discord_id: targetUser.id,
              amount_sol: amountSol,
              amount_usd: amountUsd,
              sol_price: solPrice,
              tx_signature: result.signature,
              memo: memo || null,
              paid_by: interaction.user.id,
            })
          }).catch(e => console.warn('[pay-staff] backend sync failed:', e?.message));
        }
      } catch {}

      // ── 9. Success response ──
      const embed = new EmbedBuilder()
        .setColor(0x10b981)
        .setTitle('✅ Payment Sent!')
        .setDescription(`Successfully paid **${targetUser.username}**`)
        .addFields(
          { name: '💵 Amount', value: `$${amountUsd.toFixed(2)} USD`, inline: true },
          { name: '◎ SOL', value: `${amountSol.toFixed(4)} SOL`, inline: true },
          { name: '📈 SOL Price', value: `$${solPrice.toFixed(2)}`, inline: true },
          { name: '📝 Memo', value: memo || '(none)', inline: true },
          { name: '👛 To Wallet', value: `\`${user.solana_address.slice(0, 8)}...${user.solana_address.slice(-4)}\``, inline: true },
        )
        .setFooter({ text: `TX: ${result.signature.slice(0, 16)}...` })
        .setTimestamp();

      return interaction.editReply({ embeds: [embed] });

    } catch (err) {
      console.error('[pay-staff] error:', err?.message || err);
      return interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(0xef4444)
            .setTitle('❌ Error')
            .setDescription(`An error occurred: ${err?.message || 'Unknown error'}`)
        ]
      });
    }
  }
};
