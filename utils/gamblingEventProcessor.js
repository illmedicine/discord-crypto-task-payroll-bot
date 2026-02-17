const { Connection, PublicKey, Transaction, SystemProgram, sendAndConfirmTransaction } = require('@solana/web3.js');

/** Fire-and-forget sync event status to backend */
function syncStatusToBackend(eventId, status, guildId) {
  try {
    const backendUrl = process.env.DCB_BACKEND_URL;
    const secret = process.env.DCB_INTERNAL_SECRET;
    if (!backendUrl || !secret) return;
    const url = `${backendUrl.replace(/\/$/, '')}/api/internal/gambling-event-sync`;
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-dcb-internal-secret': secret },
      body: JSON.stringify({ eventId, action: 'status_update', status, guildId }),
    }).catch(() => {});
  } catch (_) {}
}

/**
 * Process a gambling event ending: spin the wheel, determine winners, pay out, announce.
 * Safe to call multiple times — no-ops if already ended/cancelled/completed.
 */
const processGamblingEvent = async (eventId, client, reason = 'time', deps = {}) => {
  try {
    const db = deps.db || require('./db');
    const crypto = deps.crypto || require('./crypto');

    const event = await db.getGamblingEvent(eventId);
    if (!event) return;

    if (event.status !== 'active') {
      console.log(`[GamblingProcessor] Event #${eventId} already processed (status=${event.status}), skipping`);
      return;
    }

    console.log(`[GamblingProcessor] Processing event #${eventId} (reason=${reason})`);

    // Mark as ended early to prevent duplicate processing
    await db.updateGamblingEventStatus(eventId, 'ended');

    const bets = await db.getGamblingEventBets(eventId);
    const slots = await db.getGamblingEventSlots(eventId);

    if (bets.length < event.min_players) {
      // Cancel — not enough players
      try {
        const channel = await client.channels.fetch(event.channel_id);
        if (channel) {
          const { EmbedBuilder } = require('discord.js');
          const cancelEmbed = new EmbedBuilder()
            .setColor('#FF6600')
            .setTitle(`🎰 Gambling Event #${event.id} Cancelled`)
            .setDescription(`**${event.title}** has been cancelled — not enough players.`)
            .addFields(
              { name: '📊 Required', value: `${event.min_players}`, inline: true },
              { name: '👥 Joined', value: `${bets.length}`, inline: true }
            )
            .setTimestamp();
          await channel.send({ embeds: [cancelEmbed] });
        }
      } catch (e) {
        console.log(`[GamblingProcessor] Could not announce cancellation for #${event.id}:`, e.message);
      }

      await db.updateGamblingEventStatus(eventId, 'cancelled');
      syncStatusToBackend(eventId, 'cancelled', event.guild_id);
      return;
    }

    // ---- SPIN THE WHEEL: pick a random winning slot ----
    const numSlots = slots.length || event.num_slots;
    const winningSlot = Math.floor(Math.random() * numSlots) + 1; // 1-based
    await db.setGamblingEventWinningSlot(eventId, winningSlot);

    const winningSlotInfo = slots.find(s => s.slot_number === winningSlot);
    const winnerBets = bets.filter(b => b.chosen_slot === winningSlot);
    const winnerUserIds = winnerBets.map(b => b.user_id);

    // Mark winners
    if (winnerUserIds.length > 0) {
      await db.setGamblingEventWinners(eventId, winnerUserIds);
    }

    // ---- Calculate prize ----
    let totalPrize = 0;
    if (event.mode === 'pot') {
      // Pot mode: sum of all entry fees
      totalPrize = bets.reduce((sum, b) => sum + (b.bet_amount || 0), 0);
    } else {
      // House-funded mode
      totalPrize = event.prize_amount || 0;
    }

    const prizePerWinner = (totalPrize > 0 && winnerUserIds.length > 0)
      ? totalPrize / winnerUserIds.length
      : 0;

    // ---- Solana payouts ----
    const guildWallet = await db.getGuildWallet(event.guild_id);
    const paymentResults = [];

    if (totalPrize > 0 && winnerUserIds.length > 0) {
      if (!guildWallet) {
        console.log(`[GamblingProcessor] No treasury wallet for guild ${event.guild_id}, skipping payments`);
      } else {
        const connection = new Connection(process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com', 'confirmed');

        for (const userId of winnerUserIds) {
          try {
            const userData = await db.getUser(userId);
            if (userData && userData.solana_address) {
              if (typeof crypto.sendSol === 'function') {
                const res = await crypto.sendSol(userData.solana_address, prizePerWinner);
                if (res && res.success) {
                  await db.recordTransaction(event.guild_id, guildWallet.wallet_address, userData.solana_address, prizePerWinner, res.signature);
                  paymentResults.push({ userId, address: userData.solana_address, amount: prizePerWinner, success: true, signature: res.signature });
                } else {
                  paymentResults.push({ userId, success: false, reason: res.error || 'Payment failed' });
                }
              } else {
                const recipientPubkey = new PublicKey(userData.solana_address);
                const lamports = Math.floor(prizePerWinner * 1e9);
                const treasuryPubkey = new PublicKey(guildWallet.wallet_address);
                const instruction = SystemProgram.transfer({ fromPubkey: treasuryPubkey, toPubkey: recipientPubkey, lamports });
                const tx = new Transaction().add(instruction);
                const botWallet = crypto.getWallet();
                const signature = await sendAndConfirmTransaction(connection, tx, [botWallet]);
                await db.recordTransaction(event.guild_id, guildWallet.wallet_address, userData.solana_address, prizePerWinner, signature);
                paymentResults.push({ userId, address: userData.solana_address, amount: prizePerWinner, success: true, signature });
              }
            } else {
              paymentResults.push({ userId, success: false, reason: 'No wallet connected' });
            }
          } catch (err) {
            console.error(`[GamblingProcessor] Payment error for winner ${userId}:`, err);
            paymentResults.push({ userId, success: false, reason: err.message });
          }
        }
      }
    }

    // ---- Build bet breakdown ----
    let betBreakdown = '';
    for (const slot of slots) {
      const count = bets.filter(b => b.chosen_slot === slot.slot_number).length;
      const pct = bets.length > 0 ? ((count / bets.length) * 100).toFixed(1) : '0.0';
      const isWin = slot.slot_number === winningSlot ? '🏆 ' : '';
      betBreakdown += `${isWin}**${slot.label}**: ${count} bet(s) (${pct}%)\n`;
    }

    // ---- Announce results ----
    try {
      const channel = await client.channels.fetch(event.channel_id);
      if (channel) {
        const { EmbedBuilder } = require('discord.js');
        const resultsEmbed = new EmbedBuilder()
          .setColor('#E74C3C')
          .setTitle(`🎰 Gambling Event #${event.id} Results!`)
          .setDescription(`**${event.title}** — The wheel has spoken!`)
          .addFields(
            { name: '🎰 Winning Slot', value: `**#${winningSlot} — ${winningSlotInfo?.label || 'Unknown'}**`, inline: true },
            { name: '👥 Total Players', value: `${bets.length}`, inline: true },
            { name: '🏆 Winners', value: `${winnerUserIds.length}`, inline: true },
          );

        resultsEmbed.addFields({ name: '📈 Bet Breakdown', value: betBreakdown || 'No bets placed' });

        if (winnerUserIds.length > 0) {
          const winnerMentions = winnerUserIds.map(id => `<@${id}>`).join(', ');
          resultsEmbed.addFields({ name: '🎊 Winners', value: winnerMentions });
        } else {
          resultsEmbed.addFields({ name: '🎊 Winners', value: 'No winners this round — nobody bet on the winning slot!' });
        }

        if (totalPrize > 0 && winnerUserIds.length > 0) {
          resultsEmbed.addFields(
            { name: '🎁 Prize Pool', value: `${totalPrize} ${event.currency}`, inline: true },
            { name: '💰 Per Winner', value: `${prizePerWinner.toFixed(4)} ${event.currency}`, inline: true }
          );

          if (paymentResults.length > 0) {
            let paymentSummary = '';
            for (const r of paymentResults) {
              if (r.success) paymentSummary += `✅ <@${r.userId}>: ${r.amount.toFixed(4)} ${event.currency} - [View TX](https://solscan.io/tx/${r.signature})\n`;
              else paymentSummary += `❌ <@${r.userId}>: Payment failed - ${r.reason}\n`;
            }
            resultsEmbed.addFields({ name: '💸 Prize Distribution', value: paymentSummary });
          } else if (!guildWallet) {
            resultsEmbed.addFields({ name: '⚠️ Payment Issue', value: 'No treasury wallet configured. Server admin must manually pay winners.' });
          }
        }

        resultsEmbed.setTimestamp();

        const mentionContent = winnerUserIds.length > 0
          ? `🎰 **GAMBLING EVENT RESULTS!** 🎰\n\nCongratulations ${winnerUserIds.map(id => `<@${id}>`).join(', ')}!`
          : '🎰 **GAMBLING EVENT RESULTS!** — No winners this round.';

        await channel.send({ content: mentionContent, embeds: [resultsEmbed] });
      }
    } catch (e) {
      console.log(`[GamblingProcessor] Could not announce results for #${event.id}:`, e.message);
    }

    await db.updateGamblingEventStatus(eventId, 'completed');
    syncStatusToBackend(eventId, 'completed', event.guild_id);
    console.log(`[GamblingProcessor] Event #${eventId} completed with ${winnerUserIds.length} winner(s)`);
  } catch (error) {
    console.error('[GamblingProcessor] Error processing gambling event:', error);
  }
};

module.exports = { processGamblingEvent };
