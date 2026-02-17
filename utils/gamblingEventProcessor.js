const { Connection, PublicKey, Transaction, SystemProgram, sendAndConfirmTransaction } = require('@solana/web3.js');

const HOUSE_CUT_PERCENT = 10; // 10% house rake

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

/** Send SOL via bot wallet (shared helper) */
async function sendPayment(crypto, recipientAddress, amount) {
  if (typeof crypto.sendSol === 'function') {
    return crypto.sendSol(recipientAddress, amount);
  }
  // Fallback: manual transaction
  const connection = new Connection(process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com', 'confirmed');
  const botWallet = crypto.getWallet();
  if (!botWallet) return { success: false, error: 'Bot wallet not configured' };
  const recipient = new PublicKey(recipientAddress);
  const lamports = Math.floor(amount * 1e9);
  const instruction = SystemProgram.transfer({ fromPubkey: botWallet.publicKey, toPubkey: recipient, lamports });
  const tx = new Transaction().add(instruction);
  const signature = await sendAndConfirmTransaction(connection, tx, [botWallet]);
  return { success: true, signature, amount, recipient: recipientAddress };
}

/**
 * Refund all participants when an event is cancelled.
 * Only refunds bets with payment_status = 'committed' and entry_fee > 0.
 */
async function refundParticipants(event, bets, db, crypto, guildWallet) {
  const refundResults = [];
  const isPotMode = event.mode === 'pot';
  const entryFee = event.entry_fee || 0;

  if (!isPotMode || entryFee <= 0) return refundResults;

  for (const bet of bets) {
    if (bet.payment_status !== 'committed' || (bet.bet_amount || 0) <= 0) continue;

    try {
      // Get user's wallet address
      const userData = await db.getUser(bet.user_id);
      const recipientAddr = userData?.solana_address || bet.wallet_address;
      if (!recipientAddr) {
        refundResults.push({ userId: bet.user_id, success: false, reason: 'No wallet address' });
        await db.updateGamblingBetPayment(event.id, bet.user_id, 'refund_failed', 'payout', null);
        continue;
      }

      const res = await sendPayment(crypto, recipientAddr, bet.bet_amount);
      if (res && res.success) {
        await db.recordTransaction(event.guild_id, guildWallet?.wallet_address || 'treasury', recipientAddr, bet.bet_amount, res.signature);
        await db.updateGamblingBetPayment(event.id, bet.user_id, 'refunded', 'payout', res.signature);
        refundResults.push({ userId: bet.user_id, address: recipientAddr, amount: bet.bet_amount, success: true, signature: res.signature });
      } else {
        await db.updateGamblingBetPayment(event.id, bet.user_id, 'refund_failed', 'payout', null);
        refundResults.push({ userId: bet.user_id, success: false, reason: res?.error || 'Refund failed' });
      }
    } catch (err) {
      console.error(`[GamblingProcessor] Refund error for user ${bet.user_id}:`, err.message);
      await db.updateGamblingBetPayment(event.id, bet.user_id, 'refund_failed', 'payout', null).catch(() => {});
      refundResults.push({ userId: bet.user_id, success: false, reason: err.message });
    }
  }
  return refundResults;
}

/**
 * Process a gambling event ending: spin the wheel, determine winners, pay out, announce.
 * Safe to call multiple times — no-ops if already ended/cancelled/completed.
 * 
 * POT MODE payout:
 *   Total pot = sum of all entry fees
 *   House cut = 10% of pot (retained in treasury)
 *   Winner payout = 90% of pot / number of winners
 *
 * CANCELLATION:
 *   All committed entry fees refunded to participants' wallets from treasury
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
    const guildWallet = await db.getGuildWallet(event.guild_id);
    const isPotMode = event.mode === 'pot';
    const hasEntryFee = isPotMode && (event.entry_fee || 0) > 0;

    // ======== CANCELLATION: not enough players ========
    if (bets.length < event.min_players) {
      console.log(`[GamblingProcessor] Event #${eventId} cancelled — ${bets.length}/${event.min_players} players`);

      // Refund participants if entry fees were committed
      let refundResults = [];
      if (hasEntryFee && guildWallet) {
        refundResults = await refundParticipants(event, bets, db, crypto, guildWallet);
      }

      // Build cancellation embed
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

          // Show refund info if applicable
          if (refundResults.length > 0) {
            let refundSummary = '';
            for (const r of refundResults) {
              if (r.success) {
                refundSummary += `✅ <@${r.userId}>: ${r.amount.toFixed(4)} ${event.currency} refunded - [TX](https://solscan.io/tx/${r.signature})\n`;
              } else {
                refundSummary += `❌ <@${r.userId}>: Refund failed - ${r.reason}\n`;
              }
            }
            cancelEmbed.addFields({ name: '🔄 Refunds', value: refundSummary || 'No refunds needed' });
          } else if (hasEntryFee && !guildWallet) {
            cancelEmbed.addFields({ name: '⚠️ Refund Issue', value: 'No treasury wallet configured. Server admin must manually refund participants.' });
          }

          const mentionContent = bets.length > 0
            ? `🎰 **Event Cancelled** — ${bets.map(b => `<@${b.user_id}>`).join(', ')}, your event has been cancelled.${hasEntryFee ? ' Refunds are being processed.' : ''}`
            : '🎰 **Gambling Event Cancelled** — Not enough players joined.';

          await channel.send({ content: mentionContent, embeds: [cancelEmbed] });
        }
      } catch (e) {
        console.log(`[GamblingProcessor] Could not announce cancellation for #${event.id}:`, e.message);
      }

      await db.updateGamblingEventStatus(eventId, 'cancelled');
      syncStatusToBackend(eventId, 'cancelled', event.guild_id);
      return;
    }

    // ======== SPIN THE WHEEL: pick a random winning slot ========
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

    // ======== Calculate prize with house cut ========
    let totalPot = 0;
    let houseCut = 0;
    let winnerPool = 0;

    if (isPotMode) {
      // Pot mode: sum of all entry fees
      totalPot = bets.reduce((sum, b) => sum + (b.bet_amount || 0), 0);
      houseCut = totalPot * (HOUSE_CUT_PERCENT / 100); // 10% house rake
      winnerPool = totalPot - houseCut;                  // 90% to winners
    } else {
      // House-funded mode: fixed prize, no house cut (owner set the prize)
      totalPot = event.prize_amount || 0;
      houseCut = 0;
      winnerPool = totalPot;
    }

    const prizePerWinner = (winnerPool > 0 && winnerUserIds.length > 0)
      ? winnerPool / winnerUserIds.length
      : 0;

    // ======== Solana payouts to winners ========
    const paymentResults = [];

    if (prizePerWinner > 0 && winnerUserIds.length > 0) {
      if (!guildWallet) {
        console.log(`[GamblingProcessor] No treasury wallet for guild ${event.guild_id}, skipping payments`);
      } else {
        for (const userId of winnerUserIds) {
          try {
            const userData = await db.getUser(userId);
            const bet = winnerBets.find(b => b.user_id === userId);
            const recipientAddr = userData?.solana_address || bet?.wallet_address;

            if (recipientAddr) {
              const res = await sendPayment(crypto, recipientAddr, prizePerWinner);
              if (res && res.success) {
                await db.recordTransaction(event.guild_id, guildWallet.wallet_address, recipientAddr, prizePerWinner, res.signature);
                await db.updateGamblingBetPayment(eventId, userId, 'paid_out', 'payout', res.signature);
                paymentResults.push({ userId, address: recipientAddr, amount: prizePerWinner, success: true, signature: res.signature });
              } else {
                await db.updateGamblingBetPayment(eventId, userId, 'payout_failed', 'payout', null);
                paymentResults.push({ userId, success: false, reason: res?.error || 'Payment failed' });
              }
            } else {
              await db.updateGamblingBetPayment(eventId, userId, 'payout_failed', 'payout', null);
              paymentResults.push({ userId, success: false, reason: 'No wallet connected' });
            }
          } catch (err) {
            console.error(`[GamblingProcessor] Payment error for winner ${userId}:`, err);
            await db.updateGamblingBetPayment(eventId, userId, 'payout_failed', 'payout', null).catch(() => {});
            paymentResults.push({ userId, success: false, reason: err.message });
          }
        }
      }
    }

    // Mark non-winner bets as lost
    for (const bet of bets) {
      if (!winnerUserIds.includes(bet.user_id)) {
        await db.updateGamblingBetPayment(eventId, bet.user_id, 'lost', 'payout', null).catch(() => {});
      }
    }

    // Track house cut in guild budget
    if (houseCut > 0 && guildWallet) {
      try {
        await db.addBudgetSpend(event.guild_id, -houseCut); // Negative = income to treasury
        console.log(`[GamblingProcessor] House cut: ${houseCut.toFixed(4)} ${event.currency} retained for guild ${event.guild_id}`);
      } catch (_) {}
    }

    // ======== Build bet breakdown ========
    let betBreakdown = '';
    for (const slot of slots) {
      const count = bets.filter(b => b.chosen_slot === slot.slot_number).length;
      const pct = bets.length > 0 ? ((count / bets.length) * 100).toFixed(1) : '0.0';
      const isWin = slot.slot_number === winningSlot ? '🏆 ' : '';
      betBreakdown += `${isWin}**${slot.label}**: ${count} bet(s) (${pct}%)\n`;
    }

    // ======== Announce results ========
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

        // Prize pool + house cut breakdown
        if (totalPot > 0) {
          if (isPotMode && houseCut > 0) {
            resultsEmbed.addFields(
              { name: '🏦 Total Pot', value: `${totalPot.toFixed(4)} ${event.currency}`, inline: true },
              { name: '🏠 House Cut (10%)', value: `${houseCut.toFixed(4)} ${event.currency}`, inline: true },
              { name: '🎁 Winner Pool (90%)', value: `${winnerPool.toFixed(4)} ${event.currency}`, inline: true },
            );
          } else {
            resultsEmbed.addFields(
              { name: '🎁 Prize Pool', value: `${totalPot.toFixed(4)} ${event.currency}`, inline: true },
            );
          }

          if (winnerUserIds.length > 0) {
            resultsEmbed.addFields(
              { name: '💰 Per Winner', value: `${prizePerWinner.toFixed(4)} ${event.currency}`, inline: true }
            );
          }

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
          : '🎰 **GAMBLING EVENT RESULTS!** — No winners this round.' + (isPotMode && houseCut > 0 ? `\n🏠 House retains ${houseCut.toFixed(4)} ${event.currency}.` : '');

        await channel.send({ content: mentionContent, embeds: [resultsEmbed] });
      }
    } catch (e) {
      console.log(`[GamblingProcessor] Could not announce results for #${event.id}:`, e.message);
    }

    await db.updateGamblingEventStatus(eventId, 'completed');
    syncStatusToBackend(eventId, 'completed', event.guild_id);
    console.log(`[GamblingProcessor] Event #${eventId} completed with ${winnerUserIds.length} winner(s), house cut: ${houseCut.toFixed(4)}`);
  } catch (error) {
    console.error('[GamblingProcessor] Error processing gambling event:', error);
  }
};

module.exports = { processGamblingEvent };