const { EmbedBuilder } = require('discord.js');
const db = require('./db');
const crypto = require('./crypto');
const { Connection, PublicKey, Transaction, SystemProgram, sendAndConfirmTransaction } = require('@solana/web3.js');

/**
 * Process a vote event ending: determine winners, attempt payouts, announce results, and finalize status.
 * Safe to call multiple times; will no-op if event is already ended/cancelled/completed.
 */
const processVoteEvent = async (eventId, client, reason = 'time') => {
  try {
    const event = await db.getVoteEvent(eventId);
    if (!event) return;

    if (event.status !== 'active') {
      console.log(`[VoteEventProcessor] Event #${eventId} already processed (status=${event.status}), skipping`);
      return;
    }

    console.log(`[VoteEventProcessor] Processing event #${eventId} (reason=${reason})`);

    // Mark as ended early to avoid duplicate processing
    await db.updateVoteEventStatus(eventId, 'ended');

    // Gather participants and validate min participants
    const participants = await db.getVoteEventParticipants(eventId);
    if (participants.length < event.min_participants) {
      // Cancel event
      try {
        const channel = await client.channels.fetch(event.channel_id);
        if (channel) {
          const cancelEmbed = new EmbedBuilder()
            .setColor('#FF6600')
            .setTitle(`🗳️ Vote Event #${event.id} Cancelled`)
            .setDescription(`**${event.title}** has been cancelled due to insufficient participants.`)
            .addFields(
              { name: '📊 Required', value: `${event.min_participants}`, inline: true },
              { name: '👥 Joined', value: `${participants.length}`, inline: true }
            )
            .setTimestamp();

          await channel.send({ embeds: [cancelEmbed] });
        }
      } catch (e) {
        console.log(`[VoteEventProcessor] Could not announce cancellation for vote event #${event.id}:`, e.message);
      }

      await db.updateVoteEventStatus(eventId, 'cancelled');
      return;
    }

    // Calculate vote results and winners
    const voteResults = await db.getVoteResults(eventId);
    const images = await db.getVoteEventImages(eventId);

    let winnerUserIds = [];
    let winningImageId = null;

    if (event.owner_favorite_image_id) {
      winningImageId = event.owner_favorite_image_id;
      const winnersData = participants.filter(p => p.voted_image_id === event.owner_favorite_image_id);
      winnerUserIds = winnersData.map(w => w.user_id);
    } else {
      if (voteResults.length > 0) {
        winningImageId = voteResults[0].voted_image_id;
        const winnersData = participants.filter(p => p.voted_image_id === winningImageId);
        winnerUserIds = winnersData.map(w => w.user_id);
      }
    }

    // Mark winners
    if (winnerUserIds.length > 0) {
      await db.setVoteEventWinners(eventId, winnerUserIds);
    }

    // Distribute prizes if applicable
    const prizePerWinner = (event.prize_amount > 0 && winnerUserIds.length > 0)
      ? event.prize_amount / winnerUserIds.length
      : 0;

    const guildWallet = await db.getGuildWallet(event.guild_id);
    const paymentResults = [];

    if (event.prize_amount > 0 && winnerUserIds.length > 0) {
      if (!guildWallet) {
        console.log(`[VoteEventProcessor] No treasury wallet configured for guild ${event.guild_id}, skipping payments`);
      } else {
        const connection = new Connection(process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com', 'confirmed');
        const botWallet = crypto.getWallet();
        const treasuryPubkey = new PublicKey(guildWallet.wallet_address);

        for (const userId of winnerUserIds) {
          try {
            const userData = await db.getUser(userId);
            if (userData && userData.solana_address) {
              const recipientPubkey = new PublicKey(userData.solana_address);
              const lamports = Math.floor(prizePerWinner * 1e9);

              const instruction = SystemProgram.transfer({
                fromPubkey: treasuryPubkey,
                toPubkey: recipientPubkey,
                lamports
              });

              const tx = new Transaction().add(instruction);
              const signature = await sendAndConfirmTransaction(connection, tx, [botWallet]);

              await db.recordTransaction(event.guild_id, guildWallet.wallet_address, userData.solana_address, prizePerWinner, signature);

              paymentResults.push({ userId, address: userData.solana_address, amount: prizePerWinner, success: true, signature });
            } else {
              paymentResults.push({ userId, success: false, reason: 'No wallet connected' });
            }
          } catch (err) {
            console.error(`[VoteEventProcessor] Payment error for winner ${userId}:`, err);
            paymentResults.push({ userId, success: false, reason: err.message });
          }
        }
      }
    }

    // Prepare vote breakdown
    let voteBreakdown = '';
    const totalVotes = participants.filter(p => p.voted_image_id).length;

    for (const img of images) {
      const votesForImage = voteResults.find(r => r.voted_image_id === img.image_id);
      const voteCount = votesForImage ? votesForImage.vote_count : 0;
      const percentage = totalVotes > 0 ? ((voteCount / totalVotes) * 100).toFixed(1) : '0.0';
      const isWinner = img.image_id === winningImageId ? '🏆 ' : '';
      voteBreakdown += `${isWinner}**Image ${img.upload_order}**: ${voteCount} votes (${percentage}%)\n`;
    }

    // Announce results
    try {
      const channel = await client.channels.fetch(event.channel_id);
      if (channel) {
        const resultsEmbed = new EmbedBuilder()
          .setColor('#9B59B6')
          .setTitle(`🗳️ Vote Event #${event.id} Results!`)
          .setDescription(`**${event.title}** has ended!`)
          .addFields(
            { name: '📊 Total Participants', value: `${participants.length}`, inline: true },
            { name: '🗳️ Total Votes Cast', value: `${totalVotes}`, inline: true },
            { name: '🏆 Winners', value: `${winnerUserIds.length}`, inline: true }
          );

        if (winningImageId) {
          const winningImage = images.find(img => img.image_id === winningImageId);
          if (winningImage) resultsEmbed.addFields({ name: '🎯 Winning Image', value: `Image ${winningImage.upload_order}` });
        }

        resultsEmbed.addFields({ name: '📈 Vote Breakdown', value: voteBreakdown || 'No votes cast' });

        if (winnerUserIds.length > 0) {
          const winnerMentions = winnerUserIds.map(id => `<@${id}>`).join(', ');
          resultsEmbed.addFields({ name: '🎊 Winners', value: winnerMentions });
        } else {
          resultsEmbed.addFields({ name: '🎊 Winners', value: 'No winners (no votes matched winning criteria)' });
        }

        if (event.prize_amount > 0 && winnerUserIds.length > 0) {
          resultsEmbed.addFields(
            { name: '🎁 Prize Pool', value: `${event.prize_amount} ${event.currency}`, inline: true },
            { name: '💰 Per Winner', value: `${prizePerWinner.toFixed(4)} ${event.currency}`, inline: true }
          );

          if (paymentResults.length > 0) {
            let paymentSummary = '';
            for (const result of paymentResults) {
              if (result.success) paymentSummary += `✅ <@${result.userId}>: ${result.amount.toFixed(4)} ${event.currency} - [View TX](https://solscan.io/tx/${result.signature})\n`;
              else paymentSummary += `❌ <@${result.userId}>: Payment failed - ${result.reason}\n`;
            }
            resultsEmbed.addFields({ name: '💸 Prize Distribution', value: paymentSummary });
          } else if (!guildWallet) {
            resultsEmbed.addFields({ name: '⚠️ Payment Issue', value: 'No treasury wallet configured. Server admin must manually pay winners.' });
          }
        }

        resultsEmbed.setTimestamp();

        const mentionContent = winnerUserIds.length > 0 ? `🎉 **VOTE EVENT RESULTS!** 🎉\n\nCongratulations ${winnerUserIds.map(id => `<@${id}>`).join(', ')}!` : '🗳️ **VOTE EVENT RESULTS!**';

        await channel.send({ content: mentionContent, embeds: [resultsEmbed] });
      }
    } catch (e) {
      console.log(`[VoteEventProcessor] Could not announce results for vote event #${event.id}:`, e.message);
    }

    await db.updateVoteEventStatus(eventId, 'completed');
    console.log(`[VoteEventProcessor] Vote event #${eventId} completed with ${winnerUserIds.length} winner(s)`);
  } catch (error) {
    console.error('[VoteEventProcessor] Error processing vote event:', error);
  }
};

module.exports = { processVoteEvent };
