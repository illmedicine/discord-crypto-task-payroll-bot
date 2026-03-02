/**
 * DCB Poker Renderer — Builds Discord embeds and action rows for the poker table.
 * Mimics the visual style from the reference screenshot with green felt table,
 * player positions, community cards, and pot display.
 */
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { cardToEmoji, getValidActions, isAnteComplete, HAND_NAMES } = require('./pokerEngine');

// ─── Card Display ───────────────────────────────────────────────────────────

const CARD_BACK = '`🂠`';
const EMPTY_CARD = '`  `';

function renderCards(cards, hidden = false) {
  if (!cards || cards.length === 0) return '';
  if (hidden) return cards.map(() => CARD_BACK).join(' ');
  return cards.map(c => cardToEmoji(c)).join(' ');
}

function renderCommunityCards(cards) {
  const shown = cards.map(c => cardToEmoji(c));
  while (shown.length < 5) shown.push(CARD_BACK);
  return shown.join('  ');
}

// ─── Player Seat Display ────────────────────────────────────────────────────

const POSITION_LABELS = { dealer: '🔘', smallBlind: 'SB', bigBlind: 'BB' };
const ACTION_EMOJIS = {
  'Fold': '🚫', 'Check': '✋', 'Call': '📞', 'Bet': '💰', 'Raise': '⬆️',
  'All-In': '🔥', 'blind': '👁️',
};

function getSeatEmoji(seat, isCurrentTurn) {
  if (seat.folded) return '❌';
  if (seat.allIn) return '🔥';
  if (isCurrentTurn) return '👉';
  return '🪑';
}

function getPositionTag(table, seatIndex) {
  const numPlayers = table.seats.length;
  if (seatIndex === table.dealerIndex) return ' (D)';
  if (numPlayers === 2) {
    if (seatIndex === table.dealerIndex) return ' (D/SB)';
    return ' (BB)';
  }
  const sbIdx = (table.dealerIndex + 1) % numPlayers;
  const bbIdx = (table.dealerIndex + 2) % numPlayers;
  if (seatIndex === sbIdx) return ' (SB)';
  if (seatIndex === bbIdx) return ' (BB)';
  return '';
}

// ─── Table Embed Builder ────────────────────────────────────────────────────

function buildTableEmbed(table) {
  const embed = new EmbedBuilder();

  // Title & color based on phase
  const phaseNames = {
    waiting: '⏳ Waiting for Players',
    ante: '💰 Place Your Wagers',
    preflop: '🃏 Pre-Flop',
    flop: '🃏 The Flop',
    turn: '🃏 The Turn',
    river: '🃏 The River',
    showdown: '🏆 Showdown',
    finished: '🏆 Hand Complete',
  };

  const phaseColors = {
    waiting: 0x3498db,
    ante: 0x9b59b6,
    preflop: 0x2ecc71,
    flop: 0x2ecc71,
    turn: 0xf39c12,
    river: 0xe74c3c,
    showdown: 0xffd700,
    finished: 0xffd700,
  };

  embed.setColor(phaseColors[table.phase] || 0x2ecc71);

  // Header
  const modeLabel = table.mode === 'crypto'
    ? `💰 ${table.buyIn} ${table.currency || 'SOL'} BUY-IN`
    : '🎲 CASUAL';
  embed.setAuthor({ name: `DCB POKER  •  ${modeLabel}  •  Hand #${table.handNumber}` });
  embed.setTitle(phaseNames[table.phase] || 'DCB Poker');

  // ── Waiting phase ──
  if (table.phase === 'waiting') {
    let desc = '```\n';
    desc += '╔══════════════════════════════════╗\n';
    desc += '║        🎰  D C B  P O K E R     ║\n';
    desc += '║                                  ║\n';
    desc += '║          ♠ ♥ ♦ ♣                 ║\n';
    desc += '║                                  ║\n';
    desc += `║    Players: ${String(table.seats.length).padStart(1)}/${table.maxPlayers}                  ║\n`;
    desc += '║                                  ║\n';
    desc += '╚══════════════════════════════════╝\n';
    desc += '```';
    embed.setDescription(desc);

    // Player list
    if (table.seats.length > 0) {
      const playerList = table.seats.map((s, i) => {
        const hostBadge = s.discordId === table.hostId ? ' 👑' : '';
        return `🪑 **${s.displayName}**${hostBadge} — $${s.chips.toLocaleString()}`;
      }).join('\n');
      embed.addFields({ name: '🎰 Seated Players', value: playerList, inline: false });
    }

    // Settings
    const settings = [
      `⏱️ Turn Timer: **${table.turnTimer}s**`,
      `💰 Starting Bank: **$${table.startingBank.toLocaleString()}**`,
      `🔵 Big Blind: **$${table.bigBlind}**`,
      `⚪ Small Blind: **$${table.smallBlind}**`,
    ].join('\n');
    embed.addFields({ name: '⚙️ Table Settings', value: settings, inline: false });

    embed.setFooter({ text: `${table.seats.length >= 2 ? '✅ Ready to start! Host can click Start Game.' : `Need ${2 - table.seats.length} more player(s) to start.`}` });
    return embed;
  }

  // ── Ante phase (wager before seeing cards) ──
  if (table.phase === 'ante') {
    let desc = '```\n';
    desc += '╔══════════════════════════════════╗\n';
    desc += '║        🃏  ANTE UP  🃏          ║\n';
    desc += '║  Place your wager to see      ║\n';
    desc += '║  your cards!                   ║\n';
    desc += '╚══════════════════════════════════╝\n';
    desc += '```\n';
    desc += `**Cards Dealt:** ${CARD_BACK} ${CARD_BACK}  —  *face down*\n\n`;
    desc += `**Pot:** 💰 **$${table.pot.toLocaleString()}**\n`;

    embed.setDescription(desc);

    // Show who has anted and who hasn't
    const antedSet = table.antedPlayers || new Set();
    const playerLines = table.seats.map((seat, i) => {
      const hasAnted = antedSet.has(seat.discordId);
      const icon = hasAnted ? '✅' : '⏳';
      const status = hasAnted ? '*Wager placed!*' : '*Waiting...*';
      const posTag = getPositionTag(table, i);
      return `${icon} **${seat.displayName}**${posTag} — $${seat.chips.toLocaleString()} — ${status}`;
    }).join('\n');

    const antedCount = antedSet.size;
    const totalPlayers = table.seats.length;
    embed.addFields({ name: `🎨 Players (${antedCount}/${totalPlayers} ready)`, value: playerLines, inline: false });

    embed.setFooter({ text: 'Click "Ante Up" to place your wager and see your cards!' });
    return embed;
  }

  // ── Active game / showdown ──

  // Community cards
  let communityDisplay;
  if (table.phase === 'preflop') {
    communityDisplay = `${CARD_BACK}  ${CARD_BACK}  ${CARD_BACK}  ${CARD_BACK}  ${CARD_BACK}`;
  } else if ((table.phase === 'finished' || table.phase === 'showdown') && table.communityCards.length === 0) {
    communityDisplay = '*No community cards dealt*';
  } else {
    communityDisplay = renderCommunityCards(table.communityCards);
  }

  // Table layout
  let desc = '```\n';
  desc += '╔══════════════════════════════════╗\n';
  desc += '║         🟢 POKER TABLE 🟢        ║\n';
  desc += '╚══════════════════════════════════╝\n';
  desc += '```\n';
  desc += `**Community Cards:**  ${communityDisplay}\n\n`;
  desc += `**Pot:** 💰 **$${table.pot.toLocaleString()}**`;
  if (table.currentBet > 0) desc += `  •  Current Bet: $${table.currentBet}`;
  desc += '\n';

  embed.setDescription(desc);

  // Player seats
  const playerLines = table.seats.map((seat, i) => {
    const turnIndicator = (i === table.currentPlayerIndex && !seat.folded && !seat.allIn) ? '👉 ' : '';
    const posTag = getPositionTag(table, i);
    const emoji = getSeatEmoji(seat, i === table.currentPlayerIndex);
    const chipsDisplay = seat.folded ? '~~folded~~' : `$${seat.chips.toLocaleString()}`;
    const betDisplay = seat.bet > 0 ? ` (bet: $${seat.bet})` : '';
    const actionDisplay = seat.lastAction ? ` — *${seat.lastAction}*` : '';
    const allInTag = seat.allIn ? ' 🔥' : '';

    return `${turnIndicator}${emoji} **${seat.displayName}**${posTag} — ${chipsDisplay}${betDisplay}${allInTag}${actionDisplay}`;
  }).join('\n');

  embed.addFields({ name: '🎰 Players', value: playerLines || 'No players', inline: false });

  // Current player indicator
  if (table.currentPlayerIndex >= 0 && table.currentPlayerIndex < table.seats.length && table.phase !== 'showdown' && table.phase !== 'finished') {
    const current = table.seats[table.currentPlayerIndex];
    if (current && !current.folded && !current.allIn) {
      const toCall = table.currentBet - current.bet;
      let turnInfo = `⏱️ **${current.displayName}**'s turn`;
      if (toCall > 0) turnInfo += ` • $${toCall} to call`;
      embed.addFields({ name: '🎯 Action', value: turnInfo, inline: false });
    }
  }

  // Showdown results
  if ((table.phase === 'showdown' || table.phase === 'finished') && table.lastResult) {
    const result = table.lastResult;

    if (result.showdown) {
      const showdownLines = result.showdown.map(s => {
        const cards = renderCards(s.holeCards);
        return `${cards} — **${s.displayName}**: ${s.hand}`;
      }).join('\n');
      embed.addFields({ name: '🃏 Showdown', value: showdownLines, inline: false });
    }

    const winnerLines = result.winners.map(w => {
      return `🏆 **${w.displayName}** wins **$${w.amount.toLocaleString()}** (${w.hand})`;
    }).join('\n');
    embed.addFields({ name: '💰 Winners', value: winnerLines, inline: false });

    embed.setFooter({ text: 'Click "Next Hand" to continue or "Leave Table" to cash out.' });
  } else {
    // Timer footer
    embed.setFooter({ text: `Turn Timer: ${table.turnTimer}s  •  Blinds: $${table.smallBlind}/$${table.bigBlind}` });
  }

  return embed;
}

// ─── Action Buttons ─────────────────────────────────────────────────────────

function buildWaitingButtons(table) {
  const rows = [];

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`poker_join_${table.id}`)
      .setLabel('🪑 Join Table')
      .setStyle(ButtonStyle.Success)
      .setDisabled(table.seats.length >= table.maxPlayers),
    new ButtonBuilder()
      .setCustomId(`poker_leave_${table.id}`)
      .setLabel('🚪 Leave Table')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`poker_start_${table.id}`)
      .setLabel('▶️ Start Game')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(table.seats.length < 2),
    new ButtonBuilder()
      .setCustomId(`poker_close_${table.id}`)
      .setLabel('🔒 Close Table')
      .setStyle(ButtonStyle.Danger),
  );
  rows.push(row1);
  return rows;
}

function buildAnteButtons(table) {
  const rows = [];

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`poker_ante_${table.id}`)
      .setLabel('💰 Ante Up!')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`poker_fold_${table.id}`)
      .setLabel('🚫 Fold')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(`poker_leave_${table.id}`)
      .setLabel('🚪 Leave Table')
      .setStyle(ButtonStyle.Secondary),
  );
  rows.push(row1);
  return rows;
}

function buildGameButtons(table) {
  const rows = [];

  if (table.phase === 'showdown' || table.phase === 'finished') {
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`poker_nexthand_${table.id}`)
        .setLabel('▶️ Next Hand')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`poker_leave_${table.id}`)
        .setLabel('🚪 Leave Table')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`poker_viewcards_${table.id}`)
        .setLabel('👀 View My Cards')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`poker_close_${table.id}`)
        .setLabel('🔒 Close & Pay Out')
        .setStyle(ButtonStyle.Danger),
    );
    rows.push(row);
    return rows;
  }

  // Active game buttons
  const currentSeat = table.currentPlayerIndex >= 0 ? table.seats[table.currentPlayerIndex] : null;
  const validActions = getValidActions(table);

  const hasCheck = validActions.includes('check');
  const hasBet = validActions.includes('bet');
  const hasCall = validActions.includes('call');
  const hasRaise = validActions.includes('raise');
  const hasAllin = validActions.includes('allin');

  const toCall = currentSeat ? table.currentBet - currentSeat.bet : 0;

  // Row 1: Main actions
  const row1 = new ActionRowBuilder();

  if (hasCheck) {
    row1.addComponents(
      new ButtonBuilder()
        .setCustomId(`poker_check_${table.id}`)
        .setLabel('✋ Check')
        .setStyle(ButtonStyle.Success)
    );
  }

  if (hasCall) {
    row1.addComponents(
      new ButtonBuilder()
        .setCustomId(`poker_call_${table.id}`)
        .setLabel(`📞 Call $${toCall}`)
        .setStyle(ButtonStyle.Success)
    );
  }

  if (hasBet) {
    // Preset bet buttons
    const betSizes = [table.bigBlind, table.bigBlind * 2, table.bigBlind * 4];
    for (const size of betSizes.slice(0, 2)) {
      row1.addComponents(
        new ButtonBuilder()
          .setCustomId(`poker_bet_${table.id}_${size}`)
          .setLabel(`💰 Bet $${size}`)
          .setStyle(ButtonStyle.Primary)
      );
    }
  }

  if (hasRaise) {
    const minRaise = table.currentBet + table.minRaise;
    row1.addComponents(
      new ButtonBuilder()
        .setCustomId(`poker_raise_${table.id}_${minRaise}`)
        .setLabel(`⬆️ Raise to $${minRaise}`)
        .setStyle(ButtonStyle.Primary)
    );

    if (currentSeat) {
      const potRaise = Math.min(table.currentBet + table.pot, currentSeat.chips + currentSeat.bet);
      if (potRaise > minRaise) {
        row1.addComponents(
          new ButtonBuilder()
            .setCustomId(`poker_raise_${table.id}_${potRaise}`)
            .setLabel(`⬆️ Pot $${potRaise}`)
            .setStyle(ButtonStyle.Primary)
        );
      }
    }
  }

  if (row1.components.length > 0) rows.push(row1);

  // Row 2: Fold, All-in, View Cards
  const row2 = new ActionRowBuilder();

  row2.addComponents(
    new ButtonBuilder()
      .setCustomId(`poker_fold_${table.id}`)
      .setLabel('🚫 Fold')
      .setStyle(ButtonStyle.Danger)
  );

  if (hasAllin) {
    row2.addComponents(
      new ButtonBuilder()
        .setCustomId(`poker_allin_${table.id}`)
        .setLabel(`🔥 All-In $${currentSeat?.chips || 0}`)
        .setStyle(ButtonStyle.Danger)
    );
  }

  row2.addComponents(
    new ButtonBuilder()
      .setCustomId(`poker_viewcards_${table.id}`)
      .setLabel('👀 My Cards')
      .setStyle(ButtonStyle.Secondary)
  );

  rows.push(row2);
  return rows;
}

function buildTableComponents(table) {
  if (table.phase === 'waiting') return buildWaitingButtons(table);
  if (table.phase === 'ante') return buildAnteButtons(table);
  return buildGameButtons(table);
}

// ─── Hole Card Ephemeral ────────────────────────────────────────────────────

function buildHoleCardEmbed(seat, table) {
  const embed = new EmbedBuilder()
    .setColor(0x2ecc71)
    .setTitle('🃏 Your Hole Cards')
    .setDescription(renderCards(seat.holeCards))
    .addFields(
      { name: '💰 Chips', value: `$${seat.chips.toLocaleString()}`, inline: true },
      { name: '🎯 Current Bet', value: `$${seat.bet}`, inline: true },
    );

  if (table.communityCards.length > 0) {
    // Show hand strength hint
    const allCards = [...seat.holeCards, ...table.communityCards];
    if (allCards.length >= 5) {
      const { evaluateHand } = require('./pokerEngine');
      const result = evaluateHand(allCards);
      if (result) {
        embed.addFields({ name: '🏅 Best Hand', value: result.name, inline: true });
      }
    }
  }

  embed.setFooter({ text: `Hand #${table.handNumber} • ${table.phase.toUpperCase()}` });
  return embed;
}

module.exports = {
  buildTableEmbed,
  buildTableComponents,
  buildHoleCardEmbed,
  renderCards,
};
