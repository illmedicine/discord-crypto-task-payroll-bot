const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db = require('../utils/db');
const crypto = require('../utils/crypto');
const { Connection, PublicKey, Transaction, SystemProgram, sendAndConfirmTransaction } = require('@solana/web3.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('approve-proof')
    .setDescription('Approve or reject task proof submissions')
    .addSubcommand(subcommand =>
      subcommand
        .setName('list')
        .setDescription('View pending proof submissions')
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('approve')
        .setDescription('Approve a proof submission')
        .addIntegerOption(option =>
          option.setName('proof_id')
            .setDescription('Proof submission ID')
            .setRequired(true)
        )
        .addBooleanOption(option =>
          option.setName('pay')
            .setDescription('Automatically pay the user after approval')
            .setRequired(false)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('reject')
        .setDescription('Reject a proof submission')
        .addIntegerOption(option =>
          option.setName('proof_id')
            .setDescription('Proof submission ID')
            .setRequired(true)
        )
        .addStringOption(option =>
          option.setName('reason')
            .setDescription('Reason for rejection')
            .setRequired(true)
        )
    ),

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();
    const guildId = interaction.guildId;

    // Check if user has approved role
    const approvedRoles = await db.getApprovedRoles(guildId);
    const hasApprovalRole = approvedRoles.length === 0 || 
      interaction.member.roles.cache.some(r => approvedRoles.includes(r.id)) ||
      interaction.member.permissions.has('ManageGuild');

    if (!hasApprovalRole) {
      return interaction.reply({
        content: '❌ You do not have permission to approve proofs. Only designated approvers can review submissions.',
        ephemeral: true
      });
    }

    if (subcommand === 'list') {
      const proofs = await db.getPendingProofs(guildId);

      if (!proofs || proofs.length === 0) {
        return interaction.reply({
          content: '📋 No pending proof submissions.',
          ephemeral: true
        });
      }

      let proofList = '';
      for (const proof of proofs) {
        proofList += `**#${proof.id}** - ${proof.title}\n`;
        proofList += `Submitted by: <@${proof.assigned_user_id}>\n`;
        proofList += `Screenshot: [View](${proof.screenshot_url})\n`;
        proofList += `Verification: [View](${proof.verification_url})\n`;
        proofList += `Status: ⏳ Pending\n\n`;
      }

      const embed = new EmbedBuilder()
        .setColor('#FFD700')
        .setTitle('📋 Pending Proof Submissions')
        .setDescription(proofList || 'No pending submissions')
        .setFooter({ text: 'Use /approve-proof approve or reject to review' })
        .setTimestamp();

      return interaction.reply({ embeds: [embed] });
    }

    if (subcommand === 'approve') {
      await interaction.deferReply();

      const proofId = interaction.options.getInteger('proof_id');
      const shouldPay = interaction.options.getBoolean('pay') || false;

      const proof = await db.getProofSubmission(proofId);

      if (!proof) {
        return interaction.editReply({
          content: `❌ Proof #${proofId} not found.`
        });
      }

      if (proof.guild_id !== guildId) {
        return interaction.editReply({
          content: '❌ This proof is not from this server.'
        });
      }

      if (proof.status !== 'pending') {
        return interaction.editReply({
          content: `❌ Proof #${proofId} has already been ${proof.status}.`
        });
      }

      // Approve the proof
      await db.approveProof(proofId, interaction.user.id);

      let paymentInfo = null;
      let paymentError = null;

      // Handle payment if requested
      if (shouldPay) {
        try {
          // Proof now includes bulk_task_id, payout_amount, and payout_currency from JOIN
          if (!proof.bulk_task_id) {
            paymentError = 'Task details not found';
          } else {
            // Get user data for wallet address
            const userData = await db.getUser(proof.user_id);
            if (!userData || !userData.solana_address) {
              paymentError = 'User has not connected their Solana wallet';
            } else if (!crypto.isValidSolanaAddress(userData.solana_address)) {
              paymentError = 'User wallet address is invalid';
            } else {
              // Get guild wallet
              const guildWallet = await db.getGuildWallet(guildId);
              if (!guildWallet) {
                paymentError = 'Server treasury wallet not configured';
              } else {
                // Calculate SOL amount
                let solAmount = proof.payout_amount;
                if (proof.payout_currency === 'USD') {
                  const solPrice = await crypto.getSolanaPrice();
                  if (!solPrice) {
                    paymentError = 'Unable to fetch SOL price';
                  } else {
                    solAmount = proof.payout_amount / solPrice;
                  }
                }

                if (!paymentError) {
                  // Check treasury balance
                  const treasuryBalance = await crypto.getBalance(guildWallet.wallet_address);
                  if (treasuryBalance < solAmount) {
                    paymentError = `Insufficient treasury balance (${treasuryBalance.toFixed(4)} SOL)`;
                  } else {
                    // Execute payment
                    const botWallet = crypto.getWallet();
                    if (!botWallet) {
                      paymentError = 'Bot wallet not configured';
                    } else {
                      const connection = new Connection(process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com', 'confirmed');
                      const recipientPubkey = new PublicKey(userData.solana_address);
                      const treasuryPubkey = new PublicKey(guildWallet.wallet_address);

                      const lamports = Math.floor(solAmount * 1e9);
                      const instruction = SystemProgram.transfer({
                        fromPubkey: treasuryPubkey,
                        toPubkey: recipientPubkey,
                        lamports: lamports
                      });

                      const transaction = new Transaction().add(instruction);
                      const signature = await sendAndConfirmTransaction(connection, transaction, [botWallet]);

                      // Log transaction
                      await db.recordTransaction(guildId, guildWallet.wallet_address, userData.solana_address, solAmount, signature);

                      paymentInfo = {
                        amount: solAmount,
                        currency: proof.payout_currency,
                        usdAmount: proof.payout_currency === 'USD' ? proof.payout_amount : null,
                        signature: signature,
                        recipientAddress: userData.solana_address
                      };
                    }
                  }
                }
              }
            }
          }
        } catch (error) {
          console.error('Payment error:', error);
          paymentError = error.message;
        }
      }

      const embed = new EmbedBuilder()
        .setColor(paymentError && shouldPay ? '#FFA500' : '#00FF00')
        .setTitle(paymentError && shouldPay ? '⚠️ Proof Approved (Payment Failed)' : '✅ Proof Approved!')
        .addFields(
          { name: 'Proof ID', value: `#${proofId}`, inline: true },
          { name: 'Status', value: 'Approved ✓', inline: true },
          { name: 'Approved By', value: interaction.user.username }
        );

      if (shouldPay) {
        if (paymentInfo) {
          embed.addFields(
            { name: '💰 Payment Status', value: '✅ Sent Successfully' },
            { name: 'Amount', value: `${paymentInfo.amount.toFixed(4)} SOL${paymentInfo.usdAmount ? ` (~$${paymentInfo.usdAmount.toFixed(2)} USD)` : ''}` },
            { name: 'Transaction', value: `[View on Explorer](https://solscan.io/tx/${paymentInfo.signature})` }
          );
        } else if (paymentError) {
          embed.addFields(
            { name: '⚠️ Payment Status', value: `❌ Failed: ${paymentError}` },
            { name: 'Action Required', value: 'Please process payment manually using `/pay`' }
          );
        }
      } else {
        embed.addFields(
          { name: 'Next Step', value: 'Use `/pay` command to send payment to the user' }
        );
      }

      embed.setTimestamp();

      // Notify the submitter
      try {
        const user = await interaction.client.users.fetch(proof.user_id);
        const notifyEmbed = new EmbedBuilder()
          .setColor(paymentInfo ? '#00FF00' : '#FFA500')
          .setTitle('✅ Your Proof Was Approved!')
          .addFields(
            { name: 'Proof ID', value: `#${proofId}` },
            { name: 'Approved By', value: interaction.user.username }
          );

        if (paymentInfo) {
          notifyEmbed.addFields(
            { name: '💰 Payment Sent', value: `${paymentInfo.amount.toFixed(4)} SOL${paymentInfo.usdAmount ? ` (~$${paymentInfo.usdAmount.toFixed(2)} USD)` : ''}` },
            { name: 'Transaction', value: `[View on Explorer](https://solscan.io/tx/${paymentInfo.signature})` }
          );
        } else {
          notifyEmbed.addFields(
            { name: 'Status', value: paymentError ? '⚠️ Payment pending' : '✅ Awaiting payment' }
          );
        }

        await user.send({ embeds: [notifyEmbed] });
      } catch (e) {
        console.log('Could not notify user');
      }

      return interaction.editReply({ embeds: [embed] });
    }

    if (subcommand === 'reject') {
      const proofId = interaction.options.getInteger('proof_id');
      const reason = interaction.options.getString('reason');

      const proof = await db.getProofSubmission(proofId);

      if (!proof) {
        return interaction.reply({
          content: `❌ Proof #${proofId} not found.`,
          ephemeral: true
        });
      }

      if (proof.guild_id !== guildId) {
        return interaction.reply({
          content: '❌ This proof is not from this server.',
          ephemeral: true
        });
      }

      if (proof.status !== 'pending') {
        return interaction.reply({
          content: `❌ Proof #${proofId} has already been ${proof.status}.`,
          ephemeral: true
        });
      }

      // Reject the proof
      await db.rejectProof(proofId, reason, interaction.user.id);

      const embed = new EmbedBuilder()
        .setColor('#FF0000')
        .setTitle('❌ Proof Rejected')
        .addFields(
          { name: 'Proof ID', value: `#${proofId}`, inline: true },
          { name: 'Status', value: 'Rejected', inline: true },
          { name: 'Rejected By', value: interaction.user.username },
          { name: 'Reason', value: reason }
        )
        .setTimestamp();

      // Notify the submitter
      try {
        const user = await interaction.client.users.fetch(proof.user_id);
        const notifyEmbed = new EmbedBuilder()
          .setColor('#FF0000')
          .setTitle('❌ Your Proof Was Rejected')
          .addFields(
            { name: 'Proof ID', value: `#${proofId}` },
            { name: 'Reason', value: reason },
            { name: 'Next Step', value: 'You can resubmit your proof' }
          );

        await user.send({ embeds: [notifyEmbed] });
      } catch (e) {
        console.log('Could not notify user');
      }

      return interaction.reply({ embeds: [embed] });
    }
  }
};
