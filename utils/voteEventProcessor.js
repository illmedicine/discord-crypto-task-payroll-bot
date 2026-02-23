// db and crypto are required lazily inside processVoteEvent to make testing/mocking easier
// EmbedBuilder is required lazily inside functions to avoid heavy module load during tests
const { getGuildWalletWithFallback } = require('./walletSync');

// ---- Photo Competition Animation Config ----
const TRACK_LEN = 20;
const FINISH_CHAR = '🏁';
const FRAMES = 10;
const FRAME_DELAY = 1500; // ms between frames

// Color presets for images in the competition
const IMAGE_PRESETS = [
  { emoji: '🔴', icon: '📸', name: 'Photo 1', color: '#E74C3C' },
  { emoji: '🔵', icon: '📸', name: 'Photo 2', color: '#3498DB' },
  { emoji: '🟢', icon: '📸', name: 'Photo 3', color: '#27AE60' },
  { emoji: '🟡', icon: '📸', name: 'Photo 4', color: '#F1C40F' },
  { emoji: '🟣', icon: '📸', name: 'Photo 5', color: '#9B59B6' },
  { emoji: '⚫', icon: '📸', name: 'Photo 6', color: '#2C3E50' },
];

/** Fire-and-forget sync event status to backend */
function syncStatusToBackend(eventId, status, guildId) {
  try {
    const backendUrl = process.env.DCB_BACKEND_URL;
    const secret = process.env.DCB_INTERNAL_SECRET;
    if (!backendUrl || !secret) return;
    const url = `${backendUrl.replace(/\/$/, '')}/api/internal/vote-event-sync`;
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-secret': secret },
      body: JSON.stringify({ eventId, action: 'status_update', status, guildId }),
    }).catch(() => {});
  } catch (_) {}
}

/**
 * Convert amount to SOL if needed (mirrors gamblingEventProcessor pattern).
 */
async function convertToSol(amount, currency, crypto) {
  if (!currency || currency === 'SOL') return { solAmount: amount, rate: 1 };
  if (currency === 'USD') {
    const solPrice = await crypto.getSolanaPrice();
    if (!solPrice) return { solAmount: null, rate: null, error: 'Unable to fetch SOL price for USD conversion' };
    return { solAmount: amount / solPrice, rate: solPrice };
  }
  return { solAmount: amount, rate: 1 };
}

/** Send SOL via guild treasury wallet (mirrors gamblingEventProcessor pattern) */
async function sendPayment(crypto, recipientAddress, solAmount, guildWallet) {
  if (guildWallet && guildWallet.wallet_secret) {
    const keypair = crypto.getKeypairFromSecret(guildWallet.wallet_secret);
    if (!keypair) {
      return { success: false, error: 'Treasury private key is invalid — check [DCB Event Manager](https://illmedicine.github.io/discord-crypto-task-payroll-bot/) → Treasury' };
    }
    try {
      const balance = await crypto.getBalance(keypair.publicKey.toString());
      if (balance < solAmount) {
        return {
          success: false,
          error: `Insufficient treasury balance: ${balance.toFixed(4)} SOL available, need ${solAmount.toFixed(4)} SOL. Fund the treasury wallet.`
        };
      }
    } catch (balErr) {
      console.warn('[VoteEvent sendPayment] Balance pre-check failed, proceeding anyway:', balErr.message);
    }
    return crypto.sendSolFrom(keypair, recipientAddress, solAmount);
  }
  return { success: false, error: 'No treasury private key configured — go to DCB Event Manager → Treasury → Save Key' };
}

// ======== Photo Competition Animation ========

/**
 * Build a single frame of the photo competition track.
 * Each image has a progress 0..TRACK_LEN, rendered as ASCII art.
 */
function buildPhotoFrame(images, positions, winningIdx, finished) {
  let frame = '';
  if (!finished) {
    frame += '```\n';
    frame += '🖼️  P H O T O   S H O W D O W N  🖼️\n';
    frame += '━'.repeat(TRACK_LEN + 10) + '\n';
  } else {
    frame += '```\n';
    frame += '🏆  P H O T O   W I N N E R !  🏆\n';
    frame += '━'.repeat(TRACK_LEN + 10) + '\n';
  }

  for (let i = 0; i < images.length; i++) {
    const img = images[i];
    const preset = IMAGE_PRESETS[i] || IMAGE_PRESETS[0];
    const pos = positions[i];
    const icon = '📸';

    const before = '▬'.repeat(Math.min(pos, TRACK_LEN));
    const after = '▬'.repeat(Math.max(0, TRACK_LEN - pos - 1));
    const isFinished = pos >= TRACK_LEN;

    let lane;
    if (isFinished) {
      lane = '▬'.repeat(TRACK_LEN) + '|' + FINISH_CHAR + ' ' + icon;
    } else {
      lane = before + icon + after + '|' + FINISH_CHAR;
    }

    const label = `Image ${img.upload_order}`.padEnd(12).slice(0, 12);
    const winTag = (finished && i === winningIdx) ? ' 🏆' : '';
    frame += `${preset.emoji} ${label} ${lane}${winTag}\n`;
  }

  frame += '━'.repeat(TRACK_LEN + 10) + '\n';
  frame += '```';
  return frame;
}

/**
 * Run the animated photo competition in a Discord channel.
 * Similar to horse race animation. Sends a message and edits it showing images advancing.
 * The predetermined winner is guaranteed to finish first.
 */
async function runPhotoCompetitionAnimation(channel, images, winningIdx, eventId) {
  const numImages = images.length;
  const positions = new Array(numImages).fill(0);

  const winnerPerFrame = TRACK_LEN / FRAMES;

  // Send initial frame
  const initialFrame = buildPhotoFrame(images, positions, winningIdx, false);
  let raceMsg;
  try {
    raceMsg = await channel.send({
      content: `🖼️ **Photo Showdown #${eventId}** — The competition is starting! 📸\n${initialFrame}`
    });
  } catch (err) {
    console.error(`[VoteEvent] Could not send photo animation:`, err.message);
    return;
  }

  // Animate frames
  for (let frame = 1; frame <= FRAMES; frame++) {
    await new Promise(resolve => setTimeout(resolve, FRAME_DELAY));

    // Advance winner consistently
    positions[winningIdx] = Math.round(winnerPerFrame * frame);

    // Advance other images randomly but ensure they stay behind winner on final frame
    for (let h = 0; h < numImages; h++) {
      if (h === winningIdx) continue;
      if (frame === FRAMES) {
        const maxPos = TRACK_LEN - 1 - Math.floor(Math.random() * 4);
        positions[h] = Math.min(positions[h] + Math.ceil(winnerPerFrame), maxPos);
      } else {
        const speed = winnerPerFrame * (0.3 + Math.random() * 0.9);
        positions[h] = Math.min(
          Math.round(positions[h] + speed),
          TRACK_LEN - 1
        );
      }
    }

    if (frame === FRAMES) {
      positions[winningIdx] = TRACK_LEN;
    }

    const isFinished = frame === FRAMES;
    const frameContent = buildPhotoFrame(images, positions, winningIdx, isFinished);
    const winnerLabel = `Image ${images[winningIdx]?.upload_order || '?'}`;

    try {
      if (isFinished) {
        await raceMsg.edit({
          content: `🖼️ **Photo Showdown #${eventId}** — 🏁 **FINISH!** 🏆 **${winnerLabel}** wins! 🏆\n${frameContent}`
        });
      } else {
        await raceMsg.edit({
          content: `🖼️ **Photo Showdown #${eventId}** — Competing... (round ${frame}/${FRAMES}) 📸\n${frameContent}`
        });
      }
    } catch (editErr) {
      console.warn(`[VoteEvent] Frame edit failed:`, editErr.message);
    }
  }
}

/**
 * Process a vote event ending: determine winners, run photo competition animation,
 * attempt instant payouts via guild treasury, announce results with winning image.
 * Safe to call multiple times; will no-op if event is already ended/cancelled/completed.
 */
const processVoteEvent = async (eventId, client, reason = 'time', deps = {}) => {
  try {
    const db = deps.db || require('./db');
    const crypto = deps.crypto || require('./crypto');

    const event = await db.getVoteEvent(eventId);
    if (!event) return;

    if (event.status !== 'active') {
      console.log(`[VoteEventProcessor] Event #${eventId} already processed (status=${event.status}), skipping`);
      return;
    }

    console.log(`[VoteEventProcessor] Processing event #${eventId} (reason=${reason})`);

    // Mark as ended early to prevent duplicate processing
    await db.updateVoteEventStatus(eventId, 'ended');

    // Gather participants and validate min participants
    const participants = await db.getVoteEventParticipants(eventId);
    if (participants.length < event.min_participants) {
      // Cancel event — not enough participants
      try {
        const channel = await client.channels.fetch(event.channel_id);
        if (channel) {
          const { EmbedBuilder } = require('discord.js');
          const cancelEmbed = new EmbedBuilder()
            .setColor('#FF6600')
            .setTitle(`🗳️ Vote Event #${event.id} Cancelled`)
            .setDescription(`**${event.title}** has been cancelled due to insufficient participants.`)
            .addFields(
              { name: '📊 Required', value: `${event.min_participants}`, inline: true },
              { name: '👥 Joined', value: `${participants.length}`, inline: true }
            )
            .setTimestamp();

          const mentionContent = participants.length > 0
            ? `📸 **Photo Event Cancelled** — ${participants.map(p => `<@${p.user_id}>`).join(', ')}, the event has been cancelled due to insufficient participants.`
            : '📸 **Photo Event Cancelled** — Not enough participants joined.';

          await channel.send({ content: mentionContent, embeds: [cancelEmbed] });
        }
      } catch (e) {
        console.log(`[VoteEventProcessor] Could not announce cancellation for vote event #${event.id}:`, e.message);
      }

      await db.updateVoteEventStatus(eventId, 'cancelled');
      syncStatusToBackend(eventId, 'cancelled', event.guild_id);
      return;
    }

    // ======== Determine winners ========
    const voteResults = await db.getVoteResults(eventId);
    const images = await db.getVoteEventImages(eventId);
    const guildWallet = await getGuildWalletWithFallback(event.guild_id);

    let winnerUserIds = [];
    let winningImageId = null;

    if (event.owner_favorite_image_id) {
      // Owner pre-selected the winning image
      winningImageId = event.owner_favorite_image_id;
      const winnersData = participants.filter(p => p.voted_image_id === event.owner_favorite_image_id);
      winnerUserIds = winnersData.map(w => w.user_id);
    } else {
      // Most-voted image wins
      if (voteResults.length > 0) {
        winningImageId = voteResults[0].voted_image_id;
        const winnersData = participants.filter(p => p.voted_image_id === winningImageId);
        winnerUserIds = winnersData.map(w => w.user_id);
      }
    }

    // Mark winners in DB
    if (winnerUserIds.length > 0) {
      await db.setVoteEventWinners(eventId, winnerUserIds);
    }

    // Find the winning image index for animation
    const winningImage = images.find(img => img.image_id === winningImageId);
    const winningIdx = winningImage ? images.indexOf(winningImage) : 0;

    // ======== Run photo competition animation ========
    try {
      const channel = await client.channels.fetch(event.channel_id);
      if (channel && images.length >= 2) {
        await runPhotoCompetitionAnimation(channel, images, winningIdx, event.id);
      }
    } catch (animErr) {
      console.warn(`[VoteEvent] Animation error:`, animErr.message);
    }

    // Small delay after animation finishes before showing results
    await new Promise(resolve => setTimeout(resolve, 2000));

    // ======== Calculate prize ========
    const totalPrize = event.prize_amount || 0;
    const prizePerWinner = (totalPrize > 0 && winnerUserIds.length > 0)
      ? totalPrize / winnerUserIds.length
      : 0;

    console.log(`[VoteEvent] Event #${eventId}: totalPrize=${totalPrize}, prizePerWinner=${prizePerWinner}, winners=${winnerUserIds.length}, participants=${participants.length}`);
    console.log(`[VoteEvent] Event #${eventId}: currency=${event.currency}, guildWallet=${guildWallet ? guildWallet.wallet_address : 'NULL'}`);

    // ======== Convert prize to SOL if currency is USD ========
    let solPrizePerWinner = prizePerWinner;
    let solConversionRate = null;
    if (prizePerWinner > 0 && event.currency && event.currency !== 'SOL') {
      const conv = await convertToSol(prizePerWinner, event.currency, crypto);
      if (conv.error || conv.solAmount === null) {
        console.error(`[VoteEvent] Event #${eventId}: ${conv.error || 'USD conversion failed'}`);
      } else {
        solConversionRate = conv.rate;
        solPrizePerWinner = conv.solAmount;
        console.log(`[VoteEvent] Event #${eventId}: Converted ${prizePerWinner} ${event.currency} → ${solPrizePerWinner.toFixed(6)} SOL (rate: $${conv.rate})`);
      }
    }

    // ======== Instant payouts to winners via guild treasury ========
    const paymentResults = [];

    if (prizePerWinner > 0 && winnerUserIds.length > 0) {
      if (!guildWallet) {
        console.log(`[VoteEvent] No treasury wallet for guild ${event.guild_id}, skipping payments`);
      } else if (!guildWallet.wallet_secret) {
        console.log(`[VoteEvent] Treasury wallet has no secret key for guild ${event.guild_id}, cannot auto-pay`);
      } else {
        console.log(`[VoteEvent] Using guild treasury keypair for payouts (guild ${event.guild_id})`);

        // Validate keypair once before looping
        const treasuryKeypair = crypto.getKeypairFromSecret(guildWallet.wallet_secret);
        if (!treasuryKeypair) {
          console.error(`[VoteEvent] Event #${eventId}: Treasury keypair is invalid`);
          for (const userId of winnerUserIds) {
            paymentResults.push({ userId, success: false, reason: 'Treasury private key is invalid — update in DCB Event Manager → Treasury' });
          }
        } else {
          // Pre-check treasury balance
          const totalNeeded = solPrizePerWinner * winnerUserIds.length;
          let treasuryBalance = null;
          try {
            treasuryBalance = await crypto.getBalance(treasuryKeypair.publicKey.toString());
            console.log(`[VoteEvent] Event #${eventId}: Treasury balance=${treasuryBalance?.toFixed(4)} SOL, total needed=${totalNeeded.toFixed(4)} SOL`);
          } catch (balErr) {
            console.warn(`[VoteEvent] Balance pre-check failed:`, balErr.message);
          }

          if (treasuryBalance !== null && treasuryBalance < totalNeeded) {
            console.error(`[VoteEvent] Event #${eventId}: Insufficient treasury balance: ${treasuryBalance.toFixed(4)} SOL < ${totalNeeded.toFixed(4)} SOL`);
            for (const userId of winnerUserIds) {
              paymentResults.push({
                userId, success: false,
                reason: `Insufficient treasury balance: ${treasuryBalance.toFixed(4)} SOL available, need ${totalNeeded.toFixed(4)} SOL`
              });
            }
          } else {
            for (const userId of winnerUserIds) {
              try {
                const userData = await db.getUser(userId);
                const participant = participants.find(p => p.user_id === userId);
                const recipientAddr = userData?.solana_address || participant?.wallet_address;
                console.log(`[VoteEvent] Payment attempt: userId=${userId}, recipientAddr=${recipientAddr}, amount=${solPrizePerWinner.toFixed(6)} SOL (${prizePerWinner} ${event.currency})`);

                if (recipientAddr) {
                  const res = await sendPayment(crypto, recipientAddr, solPrizePerWinner, guildWallet);
                  console.log(`[VoteEvent] Payment result for ${userId}:`, JSON.stringify(res));
                  if (res && res.success) {
                    await db.recordTransaction(event.guild_id, guildWallet.wallet_address, recipientAddr, solPrizePerWinner, res.signature);
                    paymentResults.push({ userId, address: recipientAddr, amount: prizePerWinner, solAmount: solPrizePerWinner, success: true, signature: res.signature });
                  } else {
                    console.error(`[VoteEvent] Payment FAILED for ${userId}: ${res?.error || 'Unknown error'}`);
                    paymentResults.push({ userId, success: false, reason: res?.error || 'Payment failed' });
                  }
                } else {
                  console.warn(`[VoteEvent] No wallet address for winner ${userId}`);
                  paymentResults.push({ userId, success: false, reason: 'No wallet connected' });
                }
              } catch (err) {
                console.error(`[VoteEvent] Payment error for winner ${userId}:`, err);
                paymentResults.push({ userId, success: false, reason: err.message });
              }
            }
          }
        }
      }
    }

    // ======== Build vote breakdown ========
    let voteBreakdown = '';
    const totalVotes = participants.filter(p => p.voted_image_id).length;

    for (const img of images) {
      const votesForImage = voteResults.find(r => r.voted_image_id === img.image_id);
      const voteCount = votesForImage ? votesForImage.vote_count : 0;
      const percentage = totalVotes > 0 ? ((voteCount / totalVotes) * 100).toFixed(1) : '0.0';
      const isWinner = img.image_id === winningImageId ? '🏆 ' : '';
      const preset = IMAGE_PRESETS[images.indexOf(img)] || IMAGE_PRESETS[0];
      voteBreakdown += `${isWinner}${preset.emoji} **Image ${img.upload_order}**: ${voteCount} vote(s) (${percentage}%)\n`;
    }

    // ======== Announce results with rich embed + winning image ========
    try {
      const channel = await client.channels.fetch(event.channel_id);
      if (channel) {
        const { EmbedBuilder } = require('discord.js');
        const winnerPreset = IMAGE_PRESETS[winningIdx] || IMAGE_PRESETS[0];

        const resultsEmbed = new EmbedBuilder()
          .setColor(winnerPreset.color)
          .setTitle(`📸 Photo Showdown #${event.id} — Results!`)
          .setDescription(`**${event.title}** — The competition is over! 🏆`)
          .addFields(
            { name: '🏆 Winning Image', value: winningImage ? `**Image ${winningImage.upload_order}**` : 'None', inline: true },
            { name: '👥 Total Participants', value: `${participants.length}`, inline: true },
            { name: '🏆 Winners', value: `${winnerUserIds.length}`, inline: true },
          );

        resultsEmbed.addFields({ name: '📊 Vote Breakdown', value: voteBreakdown || 'No votes cast' });

        if (winnerUserIds.length > 0) {
          const winnerMentions = winnerUserIds.map(id => `<@${id}>`).join(', ');
          resultsEmbed.addFields({ name: '🎊 Winners', value: winnerMentions });
        } else {
          resultsEmbed.addFields({ name: '🎊 Winners', value: 'No winners — nobody voted for the winning image!' });
        }

        // Prize info
        if (totalPrize > 0) {
          resultsEmbed.addFields(
            { name: '🎁 Prize Pool', value: `${totalPrize.toFixed(4)} ${event.currency}`, inline: true },
          );
        } else {
          resultsEmbed.addFields(
            { name: '🎁 Prize', value: 'No prize amount set', inline: true },
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

        // Payment results
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
          resultsEmbed.addFields({ name: '💸 Instant Payouts', value: paymentSummary });
        } else if (prizePerWinner > 0 && !guildWallet) {
          resultsEmbed.addFields({ name: '⚠️ Payment Issue', value: 'No treasury wallet configured. Server admin must connect a wallet in DCB Event Manager → Treasury.' });
        } else if (prizePerWinner > 0 && winnerUserIds.length > 0) {
          resultsEmbed.addFields({ name: '⚠️ Payment Issue', value: 'Payments were attempted but produced no results. Check bot logs.' });
        }

        // Show the winning image as the embed image
        if (winningImage && winningImage.image_url) {
          resultsEmbed.setImage(winningImage.image_url);
        }

        resultsEmbed.setTimestamp();
        resultsEmbed.setFooter({ text: `DisCryptoBank • Photo Showdown #${event.id}` });

        // Build mention content (always visible even if embed fails)
        let mentionContent = '';
        if (winnerUserIds.length > 0) {
          const winnerMentions = winnerUserIds.map(id => `<@${id}>`).join(', ');
          mentionContent = `📸 **PHOTO SHOWDOWN RESULTS!** 🏆\n\n` +
            `🏆 **Winning Image:** Image ${winningImage?.upload_order || '?'}\n` +
            `👥 **Participants:** ${participants.length} | **Winners:** ${winnerUserIds.length}\n`;

          if (prizePerWinner > 0) {
            let prizeText = `${prizePerWinner.toFixed(4)} ${event.currency}`;
            if (solConversionRate && event.currency !== 'SOL') prizeText += ` (≈ ${solPrizePerWinner.toFixed(6)} SOL)`;
            mentionContent += `💰 **Prize per winner:** ${prizeText}\n`;
          }
          mentionContent += `\nCongratulations ${winnerMentions}! 🏆`;

          // Payment status summary
          const paidCount = paymentResults.filter(r => r.success).length;
          const failedCount = paymentResults.filter(r => !r.success).length;
          if (paidCount > 0) mentionContent += `\n✅ ${paidCount} payout(s) sent successfully!`;
          if (failedCount > 0) mentionContent += `\n❌ ${failedCount} payout(s) failed — check embed for details.`;
          if (paymentResults.length === 0 && prizePerWinner > 0) {
            if (!guildWallet) mentionContent += `\n⚠️ No treasury wallet — admin must pay manually.`;
            else mentionContent += `\n⚠️ Payout processing issue — check bot logs.`;
          }
        } else {
          const allMentions = participants.map(p => `<@${p.user_id}>`).join(', ');
          mentionContent = `📸 **PHOTO SHOWDOWN RESULTS!** 🏆\n\n` +
            `Nobody voted for the winning image!\n` +
            `Better luck next time ${allMentions}! 📸`;
        }

        console.log(`[VoteEvent] Sending results: paymentResults=${JSON.stringify(paymentResults)}`);
        await channel.send({ content: mentionContent, embeds: [resultsEmbed] });
      }
    } catch (e) {
      console.error(`[VoteEvent] Could not announce results for #${event.id}:`, e.message, e.stack);
    }

    await db.updateVoteEventStatus(eventId, 'completed');
    syncStatusToBackend(eventId, 'completed', event.guild_id);
    console.log(`[VoteEventProcessor] Vote event #${eventId} completed with ${winnerUserIds.length} winner(s)`);
  } catch (error) {
    console.error('[VoteEventProcessor] Error processing vote event:', error);
  }
};

module.exports = { processVoteEvent, IMAGE_PRESETS };
