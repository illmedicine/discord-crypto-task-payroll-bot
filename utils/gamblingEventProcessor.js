const { Connection, PublicKey, Transaction, SystemProgram, sendAndConfirmTransaction } = require('@solana/web3.js');
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

// Kentucky Derby bugle call — linked for race start atmosphere
const DERBY_BUGLE_URL = 'https://www.youtube.com/watch?v=PSBL3_pFlS0';

// No-winner house taunts (random pick)
const HOUSE_WINS_MESSAGES = [
  '🏠💰 **No Winner! The House Stays Rich!** 💰🏠',
  '🏠🎩 **The House Always Wins!** Better luck next race, cowboys! 🤠',
  '🏠💸 **Nobody picked the winner — House keeps the pot!** 💸',
  '🏠👑 **House remains undefeated!** Try again if you dare! 🏇',
  '🏠🤑 **All bets lost! The House is feasting tonight!** 🍗🥂',
  '🏠🏆 **Zero winners! House stays on top!** The house ALWAYS eats. 🍽️',
];
function getHouseWinsMessage() {
  return HOUSE_WINS_MESSAGES[Math.floor(Math.random() * HOUSE_WINS_MESSAGES.length)];
}

/**
 * Build a single frame of the horse race track.
 * Each horse has a progress 0..TRACK_LEN, the track is rendered as ASCII/emoji.
 */
const TRACK_LEN = 20;
const FINISH_CHAR = '🏁';

function buildRaceFrame(slots, positions, winningSlot, finished, frameNum, totalFrames) {
  let frame = '';
  const pct = totalFrames > 0 ? Math.round((frameNum / totalFrames) * 100) : 0;
  const progressBar = '█'.repeat(Math.floor(pct / 5)) + '░'.repeat(20 - Math.floor(pct / 5));

  if (!finished) {
    frame += '```\n';
    frame += '╔══════════════════════════════════════════╗\n';
    frame += '║   🏇  D C B   H O R S E   R A C E  🏇   ║\n';
    frame += '║          🎺 AND THEY\'RE OFF! 🎺          ║\n';
    frame += '╠══════════════════════════════════════════╣\n';
  } else {
    frame += '```\n';
    frame += '╔══════════════════════════════════════════╗\n';
    frame += '║  🏆  R A C E   F I N I S H E D !  🏆    ║\n';
    frame += '║       🎊 WHAT A RACE! 🎊                ║\n';
    frame += '╠══════════════════════════════════════════╣\n';
  }

  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i];
    const preset = HORSE_PRESETS[i] || HORSE_PRESETS[0];
    const pos = positions[i];
    const horse = '🏇';

    const isAtFinish = pos >= TRACK_LEN;

    let lane;
    if (isAtFinish) {
      lane = '═'.repeat(TRACK_LEN) + '║' + FINISH_CHAR + ' ' + horse;
    } else {
      const before = '─'.repeat(Math.min(pos, TRACK_LEN));
      const after = '─'.repeat(Math.max(0, TRACK_LEN - pos - 1));
      lane = before + horse + after + '║' + FINISH_CHAR;
    }

    const rank = isAtFinish && finished ? '🏆' : `${preset.emoji} `;
    const label = (slot.label || preset.name).padEnd(16).slice(0, 16);
    frame += `${rank}${label} ${lane}\n`;
  }

  frame += '╚══════════════════════════════════════════╝\n';
  if (!finished) {
    frame += `  Progress: [${progressBar}] ${pct}%\n`;
  }
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

  const FRAMES = 16; // more frames for a longer, more dramatic race
  const FRAME_DELAY = 2000; // 2 seconds between frames — slower, more tension

  // Pre-calculate per-frame speeds. Winner guaranteed to finish exactly on last frame.
  const winnerPerFrame = TRACK_LEN / FRAMES;

  // ── Pre-race bugle call announcement ──
  try {
    const { EmbedBuilder } = require('discord.js');
    const bugleEmbed = new EmbedBuilder()
      .setColor('#DAA520')
      .setTitle('🎺 THE CALL TO POST! 🎺')
      .setDescription(
        `**Horse Race #${eventId}** is about to begin!\n\n` +
        `🏇 Riders, mount your horses!\n` +
        `🎺 [**Listen to the Kentucky Derby Bugle Call**](${DERBY_BUGLE_URL})\n\n` +
        `*"And they\'re at the post..."*`
      )
      .setThumbnail('https://upload.wikimedia.org/wikipedia/en/9/93/Kd-logo.svg')
      .setImage('https://media.giphy.com/media/v1.Y2lkPTc5MGI3NjExcHFtNnE0aGRyb3U3ZGF6azRybGdubXE0Z3VhcWpzam5mczYyNnZ3dyZlcD12MV9naWZzX3NlYXJjaCZjdD1n/3o7TKSjRrfIPjeiVyM/giphy.gif')
      .setFooter({ text: 'DisCryptoBank Horse Racing • 🏇 Provably Fair' });
    await channel.send({ embeds: [bugleEmbed] });
    // Dramatic pause after bugle call
    await new Promise(resolve => setTimeout(resolve, 4000));
  } catch (bugleErr) {
    console.warn(`[HorseRace] Bugle announcement failed:`, bugleErr.message);
  }

  // Send initial frame
  const initialFrame = buildRaceFrame(slots, positions, winningSlot, false, 0, FRAMES);
  let raceMsg;
  try {
    raceMsg = await channel.send({
      content: `🏇 **Horse Race #${eventId}** — 🎺 **AND THEY'RE OFF!** 🏁\n${initialFrame}`
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
        // Random advancement with more variance for drama
        // Horses can surge ahead or fall behind, creating exciting back-and-forth
        const surgeChance = Math.random();
        let speed;
        if (surgeChance > 0.85) {
          speed = winnerPerFrame * (1.0 + Math.random() * 0.5); // burst of speed!
        } else if (surgeChance < 0.15) {
          speed = winnerPerFrame * (0.1 + Math.random() * 0.3); // stumble/slow
        } else {
          speed = winnerPerFrame * (0.3 + Math.random() * 0.8); // normal
        }
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
    const frameContent = buildRaceFrame(slots, positions, winningSlot, isFinished, frame, FRAMES);
    const winnerPreset = HORSE_PRESETS[winIdx] || HORSE_PRESETS[0];
    const winnerName = slots[winIdx]?.label || winnerPreset.name;

    // Race commentary for extra immersion
    let commentary = '';
    if (frame <= 3) commentary = '🏇 The horses are finding their stride...';
    else if (frame <= 6) commentary = '🔥 They\'re heading into the first turn!';
    else if (frame <= 9) commentary = '⚡ Down the backstretch they go!';
    else if (frame <= 12) commentary = '🌪️ Into the final turn — it\'s getting tight!';
    else if (frame <= 14) commentary = '💨 THE HOME STRETCH! Who wants it more?!';
    else if (frame < FRAMES) commentary = '🏁 HERE THEY COME! It\'s a photo finish!';

    try {
      if (isFinished) {
        await raceMsg.edit({
          content: `🏇 **Horse Race #${eventId}** — 🏁 **FINISH!** 🏆 **${winnerName}** WINS THE RACE! 🏆\n${frameContent}`
        });
      } else {
        await raceMsg.edit({
          content: `🏇 **Horse Race #${eventId}** — ${commentary} (${frame}/${FRAMES}) 🏁\n${frameContent}`
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

/** Send SOL via guild treasury wallet (shared helper) */
async function sendPayment(crypto, recipientAddress, amount, guildWallet) {
  // Use guild treasury keypair if available
  if (guildWallet && guildWallet.wallet_secret) {
    return crypto.sendSolFrom(guildWallet.wallet_secret, recipientAddress, amount);
  }
  // Fallback: use bot wallet
  if (typeof crypto.sendSol === 'function') {
    return crypto.sendSol(recipientAddress, amount);
  }
  // Fallback: manual transaction with bot wallet
  const connection = new Connection(process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com', 'confirmed');
  const botWallet = crypto.getWallet();
  if (!botWallet) return { success: false, error: 'No wallet configured for payments' };
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

    // ======== RACE: pick a random winning horse ========
    const numSlots = slots.length || event.num_slots;
    const winningSlot = Math.floor(Math.random() * numSlots) + 1; // 1-based
    await db.setGamblingEventWinningSlot(eventId, winningSlot);

    const winningSlotInfo = slots.find(s => s.slot_number === winningSlot);
    const winnerBets = bets.filter(b => b.chosen_slot === winningSlot);
    const winnerUserIds = winnerBets.map(b => b.user_id);
    const isSoloRace = bets.length === 1;

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
    let totalPot = 0;
    let houseCut = 0;
    let winnerPool = 0;

    if (isPotMode) {
      totalPot = bets.reduce((sum, b) => sum + (b.bet_amount || 0), 0);
      houseCut = totalPot * (HOUSE_CUT_PERCENT / 100);
      winnerPool = totalPot - houseCut;
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

    // ======== Solana payouts to winners ========
    const paymentResults = [];

    if (prizePerWinner > 0 && winnerUserIds.length > 0) {
      if (!guildWallet) {
        console.log(`[HorseRace] No treasury wallet for guild ${event.guild_id}, skipping payments`);
      } else {
        if (!guildWallet.wallet_secret) {
          console.log(`[HorseRace] Treasury wallet has no secret key for guild ${event.guild_id}, falling back to bot wallet`);
        } else {
          console.log(`[HorseRace] Using guild treasury keypair for payouts (guild ${event.guild_id})`);
        }

        for (const userId of winnerUserIds) {
          try {
            const userData = await db.getUser(userId);
            const bet = winnerBets.find(b => b.user_id === userId);
            const recipientAddr = userData?.solana_address || bet?.wallet_address;
            console.log(`[HorseRace] Payment attempt: userId=${userId}, recipientAddr=${recipientAddr}, amount=${prizePerWinner}`);

            if (recipientAddr) {
              const res = await sendPayment(crypto, recipientAddr, prizePerWinner, guildWallet);
              console.log(`[HorseRace] Payment result for ${userId}:`, JSON.stringify(res));
              if (res && res.success) {
                await db.recordTransaction(event.guild_id, guildWallet.wallet_address, recipientAddr, prizePerWinner, res.signature);
                await db.updateGamblingBetPayment(eventId, userId, 'paid_out', 'payout', res.signature);
                paymentResults.push({ userId, address: recipientAddr, amount: prizePerWinner, success: true, signature: res.signature });
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
          const noWinnerMsg = isSoloRace
            ? '🏠💰 **The House Wins!** Your horse didn\'t cross the finish line first. Better luck next race! 🏇'
            : getHouseWinsMessage();
          resultsEmbed.addFields({ name: '🏠 No Winners', value: noWinnerMsg });
          // Add a special "House Wins" image for dramatic effect
          resultsEmbed.setImage('https://media.giphy.com/media/v1.Y2lkPTc5MGI3NjExN2RmejN1Z2RkM2RxZm5lbGFiemQzZGNhdG5nNGZncXZ1MXh3dnNiNyZlcD12MV9naWZzX3NlYXJjaCZjdD1n/GCvktC0KFy9l6/giphy.gif');
        }

        // Prize pool + house cut breakdown — always show
        if (isPotMode && houseCut > 0) {
          resultsEmbed.addFields(
            { name: '🏦 Total Pot', value: `${totalPot.toFixed(4)} ${event.currency}`, inline: true },
            { name: '🏠 House Cut (10%)', value: `${houseCut.toFixed(4)} ${event.currency}`, inline: true },
            { name: '🎁 Winner Pool (90%)', value: `${winnerPool.toFixed(4)} ${event.currency}`, inline: true },
          );
        } else if (!isPotMode && totalPot > 0) {
          // House-funded mode
          if (winnerUserIds.length > 0) {
            resultsEmbed.addFields(
              { name: '🎁 House-Funded Prize', value: `${totalPot.toFixed(4)} ${event.currency}`, inline: true },
            );
          } else {
            resultsEmbed.addFields(
              { name: '🏠 House-Funded Prize', value: `${totalPot.toFixed(4)} ${event.currency} — **KEPT BY THE HOUSE!** 💰`, inline: true },
            );
          }
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
          resultsEmbed.addFields(
            { name: '💰 Per Winner', value: `${prizePerWinner.toFixed(4)} ${event.currency}`, inline: true }
          );
        }

        if (paymentResults.length > 0) {
          let paymentSummary = '';
          for (const r of paymentResults) {
            if (r.success) paymentSummary += `✅ <@${r.userId}>: ${r.amount.toFixed(4)} ${event.currency} — [View TX](https://solscan.io/tx/${r.signature})\n`;
            else paymentSummary += `❌ <@${r.userId}>: Payment failed — ${r.reason}\n`;
          }
          resultsEmbed.addFields({ name: '💸 Payouts', value: paymentSummary });
        } else if (prizePerWinner > 0 && !guildWallet) {
          resultsEmbed.addFields({ name: '⚠️ Payment Issue', value: 'No treasury wallet configured. Server admin must manually pay winners.' });
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
            mentionContent += `💰 **Prize per winner:** ${prizePerWinner.toFixed(4)} ${event.currency}\n`;
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
          if (isSoloRace) {
            const soloUser = bets[0].user_id;
            mentionContent = `🏇 **HORSE RACE RESULTS!** 🏁\n\n` +
              `🏠💰 **THE HOUSE WINS!** 💰🏠\n` +
              `<@${soloUser}>, your horse came up short! The house stays rich today! 🤑\n` +
              `Better luck next time, cowboy! 🤠`;
          } else {
            const houseMsg = getHouseWinsMessage();
            mentionContent = `🏇 **HORSE RACE RESULTS!** 🏁\n\n` +
              `${houseMsg}\n` +
              `Nobody picked **${winningSlotInfo?.label || 'the winning horse'}**! 🐴`;
          }
          if (isPotMode && houseCut > 0) mentionContent += `\n\n🏦 House retains **${houseCut.toFixed(4)} ${event.currency}** — the treasury grows! 💰`;
          if (isPotMode && totalPot > 0 && houseCut <= 0) mentionContent += `\n\n🏦 All entry fees stay in the house pot!`;
          if (!isPotMode && totalPot > 0) mentionContent += `\n\n🏠💰 The house funded **${totalPot.toFixed(4)} ${event.currency}** — and keeps every last coin! The house ALWAYS eats! 🍽️`;
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