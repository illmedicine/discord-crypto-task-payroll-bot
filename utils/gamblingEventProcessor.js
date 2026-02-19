const { PublicKey } = require('@solana/web3.js');
const { getGuildWalletWithFallback } = require('./walletSync');

const HOUSE_CUT_PERCENT = 10; // 10% house rake

// Horse emoji + name mapped to each slot color
const HORSE_PRESETS = [
  { emoji: '🔴', horse: '🐴', name: 'Crimson Blaze',    color: '#E74C3C' },
  { emoji: '⚫', horse: '🐎', name: 'Shadow Runner',    color: '#2C3E50' },
  { emoji: '🟢', horse: '🐴', name: 'Emerald Thunder',  color: '#27AE60' },
  { emoji: '🔵', horse: '🐎', name: 'Sapphire Storm',   color: '#3498DB' },
  { emoji: '🟡', horse: '🐴', name: 'Golden Lightning', color: '#F1C40F' },
  { emoji: '🟣', horse: '🐎', name: 'Violet Fury',      color: '#9B59B6' },
];

/**
 * Build a single frame of the horse race track.
 * Each horse has a progress 0..TRACK_LEN, the track is rendered as ASCII/emoji.
 */
const TRACK_LEN = 20;
const FINISH_CHAR = '🏁';

function buildRaceFrame(slots, positions, winningSlot, finished) {
  let frame = '';
  if (!finished) {
    frame += '```\n';
    frame += '🏇  D C B   H O R S E   R A C E  🏇\n';
    frame += '━'.repeat(TRACK_LEN + 8) + '\n';
  } else {
    frame += '```\n';
    frame += '🏆  R A C E   F I N I S H E D !  🏆\n';
    frame += '━'.repeat(TRACK_LEN + 8) + '\n';
  }

  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i];
    const preset = HORSE_PRESETS[i] || HORSE_PRESETS[0];
    const pos = positions[i];
    const horse = '🏇';

    // Build track line:  [emoji] ----🏇-----------|🏁
    const before = '▬'.repeat(Math.min(pos, TRACK_LEN));
    const after = '▬'.repeat(Math.max(0, TRACK_LEN - pos - 1));
    const isFinished = pos >= TRACK_LEN;

    let lane;
    if (isFinished) {
      lane = '▬'.repeat(TRACK_LEN) + '|' + FINISH_CHAR + ' ' + horse;
    } else {
      lane = before + horse + after + '|' + FINISH_CHAR;
    }

    const label = (slot.label || preset.name).padEnd(18).slice(0, 18);
    frame += `${label} ${lane}\n`;
  }

  frame += '━'.repeat(TRACK_LEN + 8) + '\n';
  frame += '```';
  return frame;
}

/**
 * Run the animated horse race in a Discord channel.
 * Sends a message and edits it multiple times showing horses advancing.
 * The predetermined winner is guaranteed to finish first.
 * Returns nothing — purely visual.
 */
async function runHorseRaceAnimation(channel, slots, winningSlot, eventId) {
  const numHorses = slots.length;
  const positions = new Array(numHorses).fill(0);
  const winIdx = winningSlot - 1; // 0-based

  const FRAMES = 10; // number of animation frames
  const FRAME_DELAY = 1500; // ms between frames

  // Pre-calculate per-frame speeds. Winner guaranteed to finish exactly on last frame.
  // Other horses are random but always finish behind.
  const winnerPerFrame = TRACK_LEN / FRAMES;

  // Send initial frame
  const initialFrame = buildRaceFrame(slots, positions, winningSlot, false);
  let raceMsg;
  try {
    raceMsg = await channel.send({
      content: `🏇 **Horse Race #${eventId}** — The race is starting! 🏁\n${initialFrame}`
    });
  } catch (err) {
    console.error(`[HorseRace] Could not send race animation:`, err.message);
    return;
  }

  // Animate frames
  for (let frame = 1; frame <= FRAMES; frame++) {
    await new Promise(resolve => setTimeout(resolve, FRAME_DELAY));

    // Advance winner consistently
    positions[winIdx] = Math.round(winnerPerFrame * frame);

    // Advance other horses randomly but ensure they stay behind winner on final frame
    for (let h = 0; h < numHorses; h++) {
      if (h === winIdx) continue;
      if (frame === FRAMES) {
        // Final frame: others land 1–5 behind the finish
        const maxPos = TRACK_LEN - 1 - Math.floor(Math.random() * 4);
        positions[h] = Math.min(positions[h] + Math.ceil(winnerPerFrame), maxPos);
      } else {
        // Random advancement: 0 to 1.2x winner speed (can be temporarily ahead for drama)
        const speed = winnerPerFrame * (0.3 + Math.random() * 0.9);
        positions[h] = Math.min(
          Math.round(positions[h] + speed),
          TRACK_LEN - 1  // can't finish before last frame
        );
      }
    }

    // Ensure winner is at finish on last frame
    if (frame === FRAMES) {
      positions[winIdx] = TRACK_LEN;
    }

    const isFinished = frame === FRAMES;
    const frameContent = buildRaceFrame(slots, positions, winningSlot, isFinished);
    const winnerPreset = HORSE_PRESETS[winIdx] || HORSE_PRESETS[0];
    const winnerName = slots[winIdx]?.label || winnerPreset.name;

    try {
      if (isFinished) {
        await raceMsg.edit({
          content: `🏇 **Horse Race #${eventId}** — 🏁 **FINISH!** 🏆 **${winnerName}** wins! 🏆\n${frameContent}`
        });
      } else {
        await raceMsg.edit({
          content: `🏇 **Horse Race #${eventId}** — Racing... (lap ${frame}/${FRAMES}) 🏁\n${frameContent}`
        });
      }
    } catch (editErr) {
      console.warn(`[HorseRace] Frame edit failed:`, editErr.message);
    }
  }
}

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
 * Convert amount to SOL if needed.
 * If currency is SOL, returns amount as-is.
 * If currency is USD, converts using live SOL price.
 */
async function convertToSol(amount, currency, crypto) {
  if (!currency || currency === 'SOL') return { solAmount: amount, rate: 1 };
  if (currency === 'USD') {
    const solPrice = await crypto.getSolanaPrice();
    if (!solPrice) return { solAmount: null, rate: null, error: 'Unable to fetch SOL price for USD conversion' };
    return { solAmount: amount / solPrice, rate: solPrice };
  }
  // Unknown currency — treat as SOL
  return { solAmount: amount, rate: 1 };
}

/** Send SOL via guild treasury wallet (shared helper) */
async function sendPayment(crypto, recipientAddress, solAmount, guildWallet) {
  // Must have a guild treasury wallet with a valid keypair
  if (guildWallet && guildWallet.wallet_secret) {
    // Validate keypair before sending
    const keypair = crypto.getKeypairFromSecret(guildWallet.wallet_secret);
    if (!keypair) {
      return { success: false, error: 'Treasury private key is invalid — check [DCB Event Manager](https://illmedicine.github.io/discord-crypto-task-payroll-bot/) → Treasury' };
    }

    // Pre-check treasury balance
    try {
      const balance = await crypto.getBalance(keypair.publicKey.toString());
      if (balance < solAmount) {
        return {
          success: false,
          error: `Insufficient treasury balance: ${balance.toFixed(4)} SOL available, need ${solAmount.toFixed(4)} SOL. Fund the treasury wallet.`
        };
      }
    } catch (balErr) {
      console.warn('[sendPayment] Balance pre-check failed, proceeding anyway:', balErr.message);
    }

    return crypto.sendSolFrom(keypair, recipientAddress, solAmount);
  }

  // No guild wallet secret — cannot pay
  return { success: false, error: 'No treasury private key configured — go to DCB Event Manager → Treasury → Save Key' };
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

      const res = await sendPayment(crypto, recipientAddr, bet.bet_amount, guildWallet);
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
    const guildWallet = await getGuildWalletWithFallback(event.guild_id);
    const isPotMode = event.mode === 'pot';
    const hasEntryFee = isPotMode && (event.entry_fee || 0) > 0;

    // ======== CANCELLATION: only if zero players joined ========
    if (bets.length === 0) {
      console.log(`[GamblingProcessor] Event #${eventId} cancelled — no players joined`);

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
            .setTitle(`� Horse Race #${event.id} Cancelled`)
            .setDescription(`**${event.title}** has been cancelled — not enough riders.`)
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
            ? `🏇 **Race Cancelled** — ${bets.map(b => `<@${b.user_id}>`).join(', ')}, the race has been cancelled.${hasEntryFee ? ' Refunds are being processed.' : ''}`
            : '🏇 **Horse Race Cancelled** — Not enough riders joined.';

          await channel.send({ content: mentionContent, embeds: [cancelEmbed] });
        }
      } catch (e) {
        console.log(`[HorseRace] Could not announce cancellation for #${event.id}:`, e.message);
      }

      await db.updateGamblingEventStatus(eventId, 'cancelled');
      syncStatusToBackend(eventId, 'cancelled', event.guild_id);
      return;
    }

    const isSoloRace = bets.length === 1;

    // ======== RACE: pick a random winning horse ========
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

    // ======== Run horse race animation in Discord ========
    try {
      const channel = await client.channels.fetch(event.channel_id);
      if (channel) {
        await runHorseRaceAnimation(channel, slots, winningSlot, event.id);
      }
    } catch (animErr) {
      console.warn(`[HorseRace] Animation error:`, animErr.message);
    }

    // Small delay after animation finishes before showing results embed
    await new Promise(resolve => setTimeout(resolve, 2000));

    // ======== Calculate prize with house cut ========
    // In pot mode, all bets are committed instantly (virtual pot — balance-verified at entry)
    let totalPot = 0;
    let houseCut = 0;
    let winnerPool = 0;

    if (isPotMode) {
      const committedBets = bets.filter(b => b.payment_status === 'committed');
      totalPot = committedBets.reduce((sum, b) => sum + (b.bet_amount || 0), 0);
      houseCut = totalPot * (HOUSE_CUT_PERCENT / 100);
      winnerPool = totalPot - houseCut;
      console.log(`[HorseRace] Event #${eventId}: ${committedBets.length} committed bets, totalPot=${totalPot}`);
    } else {
      totalPot = event.prize_amount || 0;
      houseCut = 0;
      winnerPool = totalPot;
    }

    const prizePerWinner = (winnerPool > 0 && winnerUserIds.length > 0)
      ? winnerPool / winnerUserIds.length
      : 0;

    console.log(`[HorseRace] Event #${eventId}: mode=${event.mode}, totalPot=${totalPot}, houseCut=${houseCut}, winnerPool=${winnerPool}, prizePerWinner=${prizePerWinner}, winners=${winnerUserIds.length}, bets=${bets.length}`);
    console.log(`[HorseRace] Event #${eventId}: entry_fee=${event.entry_fee}, prize_amount=${event.prize_amount}, currency=${event.currency}`);
    console.log(`[HorseRace] Event #${eventId}: guildWallet=${guildWallet ? guildWallet.wallet_address : 'NULL'}`);

    // ======== Convert prize to SOL if currency is USD ========
    let solPrizePerWinner = prizePerWinner;
    let solConversionRate = null;
    if (prizePerWinner > 0 && event.currency && event.currency !== 'SOL') {
      const conv = await convertToSol(prizePerWinner, event.currency, crypto);
      if (conv.error || conv.solAmount === null) {
        console.error(`[HorseRace] Event #${eventId}: ${conv.error || 'USD conversion failed'}`);
        // Will use prizePerWinner as-is (treated as SOL) rather than skip payments entirely
      } else {
        solConversionRate = conv.rate;
        solPrizePerWinner = conv.solAmount;
        console.log(`[HorseRace] Event #${eventId}: Converted ${prizePerWinner} ${event.currency} → ${solPrizePerWinner.toFixed(6)} SOL (rate: $${conv.rate})`);
      }
    }

    // ======== Solana payouts to winners ========
    const paymentResults = [];

    if (prizePerWinner > 0 && winnerUserIds.length > 0) {
      if (!guildWallet) {
        console.log(`[HorseRace] No treasury wallet for guild ${event.guild_id}, skipping payments`);
      } else if (!guildWallet.wallet_secret) {
        console.log(`[HorseRace] Treasury wallet has no secret key for guild ${event.guild_id}, cannot auto-pay`);
      } else {
        console.log(`[HorseRace] Using guild treasury keypair for payouts (guild ${event.guild_id})`);

        // Validate keypair once before looping through winners  
        const treasuryKeypair = crypto.getKeypairFromSecret(guildWallet.wallet_secret);
        if (!treasuryKeypair) {
          console.error(`[HorseRace] Event #${eventId}: Treasury keypair is invalid — wallet_secret may be a public address, not a private key`);
          for (const userId of winnerUserIds) {
            await db.updateGamblingBetPayment(eventId, userId, 'payout_failed', 'payout', null).catch(() => {});
            paymentResults.push({ userId, success: false, reason: 'Treasury private key is invalid — update in DCB Event Manager → Treasury' });
          }
        } else {
          // Pre-check treasury balance once for total needed
          const totalNeeded = solPrizePerWinner * winnerUserIds.length;
          let treasuryBalance = null;
          try {
            treasuryBalance = await crypto.getBalance(treasuryKeypair.publicKey.toString());
            console.log(`[HorseRace] Event #${eventId}: Treasury balance=${treasuryBalance?.toFixed(4)} SOL, total needed=${totalNeeded.toFixed(4)} SOL`);
          } catch (balErr) {
            console.warn(`[HorseRace] Balance pre-check failed:`, balErr.message);
          }

          if (treasuryBalance !== null && treasuryBalance < totalNeeded) {
            console.error(`[HorseRace] Event #${eventId}: Insufficient treasury balance: ${treasuryBalance.toFixed(4)} SOL < ${totalNeeded.toFixed(4)} SOL needed`);
            for (const userId of winnerUserIds) {
              await db.updateGamblingBetPayment(eventId, userId, 'payout_failed', 'payout', null).catch(() => {});
              paymentResults.push({
                userId, success: false,
                reason: `Insufficient treasury balance: ${treasuryBalance.toFixed(4)} SOL available, need ${totalNeeded.toFixed(4)} SOL`
              });
            }
          } else {
            for (const userId of winnerUserIds) {
              try {
                const userData = await db.getUser(userId);
                const bet = winnerBets.find(b => b.user_id === userId);
                const recipientAddr = userData?.solana_address || bet?.wallet_address;
                console.log(`[HorseRace] Payment attempt: userId=${userId}, recipientAddr=${recipientAddr}, amount=${solPrizePerWinner.toFixed(6)} SOL (${prizePerWinner} ${event.currency})`);

                if (recipientAddr) {
                  const res = await sendPayment(crypto, recipientAddr, solPrizePerWinner, guildWallet);
                  console.log(`[HorseRace] Payment result for ${userId}:`, JSON.stringify(res));
                  if (res && res.success) {
                    await db.recordTransaction(event.guild_id, guildWallet.wallet_address, recipientAddr, solPrizePerWinner, res.signature);
                    await db.updateGamblingBetPayment(eventId, userId, 'paid_out', 'payout', res.signature);
                    paymentResults.push({ userId, address: recipientAddr, amount: prizePerWinner, solAmount: solPrizePerWinner, success: true, signature: res.signature });
                  } else {
                    console.error(`[HorseRace] Payment FAILED for ${userId}: ${res?.error || 'Unknown error'}`);
                    await db.updateGamblingBetPayment(eventId, userId, 'payout_failed', 'payout', null);
                    paymentResults.push({ userId, success: false, reason: res?.error || 'Payment failed' });
                  }
                } else {
                  console.warn(`[HorseRace] No wallet address for winner ${userId}`);
                  await db.updateGamblingBetPayment(eventId, userId, 'payout_failed', 'payout', null);
                  paymentResults.push({ userId, success: false, reason: 'No wallet connected' });
                }
              } catch (err) {
                console.error(`[HorseRace] Payment error for winner ${userId}:`, err);
                await db.updateGamblingBetPayment(eventId, userId, 'payout_failed', 'payout', null).catch(() => {});
                paymentResults.push({ userId, success: false, reason: err.message });
              }
            }
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
        await db.addBudgetSpend(event.guild_id, -houseCut);
        console.log(`[HorseRace] House cut: ${houseCut.toFixed(4)} ${event.currency} retained for guild ${event.guild_id}`);
      } catch (_) {}
    }

    // ======== Build bet breakdown (horse-themed) ========
    let betBreakdown = '';
    for (let i = 0; i < slots.length; i++) {
      const slot = slots[i];
      const preset = HORSE_PRESETS[i] || HORSE_PRESETS[0];
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
        const winnerPreset = HORSE_PRESETS[(winningSlot - 1)] || HORSE_PRESETS[0];

        const resultsEmbed = new EmbedBuilder()
          .setColor(winnerPreset.color)
          .setTitle(`🏇 Horse Race #${event.id} — Results!`)
          .setDescription(`**${event.title}** — The race is over! 🏁${isSoloRace ? '\n🏠 *Solo Race vs the House*' : ''}`)
          .addFields(
            { name: '🏆 Winning Horse', value: `**#${winningSlot} — ${winningSlotInfo?.label || winnerPreset.name}**`, inline: true },
            { name: '👥 Total Riders', value: isSoloRace ? '1 (vs House)' : `${bets.length}`, inline: true },
            { name: '🏆 Winners', value: `${winnerUserIds.length}`, inline: true },
          );

        resultsEmbed.addFields({ name: '📈 Bets by Horse', value: betBreakdown || 'No bets placed' });

        if (winnerUserIds.length > 0) {
          const winnerMentions = winnerUserIds.map(id => `<@${id}>`).join(', ');
          resultsEmbed.addFields({ name: '🎊 Winners', value: winnerMentions });
        } else {
          const loserMentions = bets.map(b => `<@${b.user_id}>`).join(', ');
          const taunt = isSoloRace
            ? `🏠 **The house wins!** Your horse didn't cross the finish line first. Better luck next time, ${loserMentions}!`
            : `🏠 **The house wins!** Nobody picked the winning horse. Better luck next time, ${loserMentions}!`;
          resultsEmbed.addFields({ name: '🎊 Winners', value: taunt });
        }

        // Prize pool + house cut breakdown — always show
        if (isPotMode && houseCut > 0) {
          resultsEmbed.addFields(
            { name: '🏦 Total Pot', value: `${totalPot.toFixed(4)} ${event.currency}`, inline: true },
            { name: '🏠 House Cut (10%)', value: `${houseCut.toFixed(4)} ${event.currency}`, inline: true },
            { name: '🎁 Winner Pool (90%)', value: `${winnerPool.toFixed(4)} ${event.currency}`, inline: true },
          );
        } else if (totalPot > 0) {
          resultsEmbed.addFields(
            { name: '🎁 Prize Pool', value: `${totalPot.toFixed(4)} ${event.currency}`, inline: true },
          );
        } else {
          resultsEmbed.addFields(
            { name: '🎁 Prize', value: isPotMode ? 'No entry fees collected' : 'No prize amount set', inline: true },
          );
        }

        if (winnerUserIds.length > 0 && prizePerWinner > 0) {
          let perWinnerText = `${prizePerWinner.toFixed(4)} ${event.currency}`;
          if (solConversionRate && event.currency !== 'SOL') {
            perWinnerText += ` (≈ ${solPrizePerWinner.toFixed(6)} SOL)`;
          }
          resultsEmbed.addFields(
            { name: '💰 Per Winner', value: perWinnerText, inline: true }
          );
        }

        if (paymentResults.length > 0) {
          let paymentSummary = '';
          for (const r of paymentResults) {
            if (r.success) {
              const amtText = r.solAmount && event.currency !== 'SOL'
                ? `${r.amount.toFixed(4)} ${event.currency} (${r.solAmount.toFixed(6)} SOL)`
                : `${(r.solAmount || r.amount).toFixed(4)} SOL`;
              paymentSummary += `✅ <@${r.userId}>: ${amtText} — [View TX](https://solscan.io/tx/${r.signature})\n`;
            } else {
              paymentSummary += `❌ <@${r.userId}>: ${r.reason}\n`;
            }
          }
          resultsEmbed.addFields({ name: '💸 Payouts', value: paymentSummary });
        } else if (prizePerWinner > 0 && !guildWallet) {
          resultsEmbed.addFields({ name: '⚠️ Payment Issue', value: 'No treasury wallet configured. Server admin must connect a wallet in DCB Event Manager → Treasury.' });
        } else if (prizePerWinner > 0 && winnerUserIds.length > 0) {
          resultsEmbed.addFields({ name: '⚠️ Payment Issue', value: 'Payments were attempted but produced no results. Check bot logs.' });
        }

        resultsEmbed.setTimestamp();
        resultsEmbed.setFooter({ text: `DisCryptoBank • Horse Race #${event.id} • Provably Fair` });

        // Build content text with key info inline (always visible even if embed fails)
        let mentionContent = '';
        if (winnerUserIds.length > 0) {
          const winnerMentions = winnerUserIds.map(id => `<@${id}>`).join(', ');
          if (isSoloRace) {
            mentionContent = `🏇 **HORSE RACE RESULTS!** 🏁\n\n` +
              `🏆 **Winning Horse:** ${winningSlotInfo?.label || winnerPreset.name}\n` +
              `🏠 **Solo Race vs the House** — You beat the house!\n`;
          } else {
            mentionContent = `🏇 **HORSE RACE RESULTS!** 🏁\n\n` +
              `🏆 **Winning Horse:** ${winningSlotInfo?.label || winnerPreset.name}\n` +
              `👥 **Riders:** ${bets.length} | **Winners:** ${winnerUserIds.length}\n`;
          }
          if (prizePerWinner > 0) {
            let prizeText = `${prizePerWinner.toFixed(4)} ${event.currency}`;
            if (solConversionRate && event.currency !== 'SOL') prizeText += ` (≈ ${solPrizePerWinner.toFixed(6)} SOL)`;
            mentionContent += `💰 **Prize per winner:** ${prizeText}\n`;
          }
          mentionContent += `\nCongratulations ${winnerMentions}! 🏆`;
          // Add payment status summary
          const paidCount = paymentResults.filter(r => r.success).length;
          const failedCount = paymentResults.filter(r => !r.success).length;
          if (paidCount > 0) mentionContent += `\n✅ ${paidCount} payout(s) sent successfully!`;
          if (failedCount > 0) mentionContent += `\n❌ ${failedCount} payout(s) failed — check embed for details.`;
          if (paymentResults.length === 0 && prizePerWinner > 0) {
            if (!guildWallet) mentionContent += `\n⚠️ No treasury wallet — admin must pay manually.`;
            else mentionContent += `\n⚠️ Payout processing issue — check bot logs.`;
          }
        } else {
          const loserMentions = bets.map(b => `<@${b.user_id}>`).join(', ');
          mentionContent = `🏇 **HORSE RACE RESULTS!** 🏁\n\n` +
            `🏠 **The house wins!** Nobody picked the winning horse.\n` +
            `Better luck next time ${loserMentions}! 💸`;
          if (isPotMode && totalPot > 0) mentionContent += `\n🏠 House takes the pot: **${totalPot.toFixed(4)} ${event.currency}**`;
        }

        console.log(`[HorseRace] Sending results: paymentResults=${JSON.stringify(paymentResults)}`);
        await channel.send({ content: mentionContent, embeds: [resultsEmbed] });
      }
    } catch (e) {
      console.error(`[HorseRace] Could not announce results for #${event.id}:`, e.message, e.stack);
    }

    await db.updateGamblingEventStatus(eventId, 'completed');
    syncStatusToBackend(eventId, 'completed', event.guild_id);
    console.log(`[HorseRace] Event #${eventId} completed with ${winnerUserIds.length} winner(s), house cut: ${houseCut.toFixed(4)}`);
  } catch (error) {
    console.error('[HorseRace] Error processing gambling event:', error);
  }
};

module.exports = { processGamblingEvent, HORSE_PRESETS };