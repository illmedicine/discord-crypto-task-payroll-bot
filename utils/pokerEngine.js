/**
 * DCB Poker Engine — Texas Hold'em
 * Full game logic: deck, hand evaluation, betting rounds, pot management.
 */

// ─── Card & Deck ────────────────────────────────────────────────────────────

const SUITS = ['♠', '♥', '♦', '♣'];
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const RANK_VALUES = { '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, 'J': 11, 'Q': 12, 'K': 13, 'A': 14 };

function createDeck() {
  const deck = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({ rank, suit, value: RANK_VALUES[rank] });
    }
  }
  return deck;
}

function shuffleDeck(deck) {
  const d = [...deck];
  for (let i = d.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d;
}

function cardToString(card) {
  return `${card.rank}${card.suit}`;
}

function cardToEmoji(card) {
  const suitEmoji = { '♠': '♠️', '♥': '♥️', '♦': '♦️', '♣': '♣️' };
  return `\`${card.rank}${suitEmoji[card.suit] || card.suit}\``;
}

// ─── Hand Evaluation ────────────────────────────────────────────────────────

const HAND_RANKS = {
  HIGH_CARD: 0,
  ONE_PAIR: 1,
  TWO_PAIR: 2,
  THREE_OF_A_KIND: 3,
  STRAIGHT: 4,
  FLUSH: 5,
  FULL_HOUSE: 6,
  FOUR_OF_A_KIND: 7,
  STRAIGHT_FLUSH: 8,
  ROYAL_FLUSH: 9,
};

const HAND_NAMES = {
  0: 'High Card',
  1: 'One Pair',
  2: 'Two Pair',
  3: 'Three of a Kind',
  4: 'Straight',
  5: 'Flush',
  6: 'Full House',
  7: 'Four of a Kind',
  8: 'Straight Flush',
  9: 'Royal Flush',
};

/**
 * Evaluate the best 5-card hand from 7 cards (2 hole + 5 community).
 * Returns { rank, name, kickers, cards } for comparison.
 */
function evaluateHand(cards) {
  if (cards.length < 5) return { rank: -1, name: 'Incomplete', kickers: [], cards: [] };

  const combos = getCombinations(cards, 5);
  let best = null;

  for (const combo of combos) {
    const result = evaluate5(combo);
    if (!best || compareHandResult(result, best) > 0) {
      best = result;
    }
  }
  return best;
}

function evaluate5(cards) {
  const sorted = [...cards].sort((a, b) => b.value - a.value);
  const values = sorted.map(c => c.value);
  const suits = sorted.map(c => c.suit);

  const isFlush = suits.every(s => s === suits[0]);
  const isStraight = checkStraight(values);
  const isLowStraight = checkLowStraight(values);

  // Count rank frequencies
  const freq = {};
  for (const v of values) freq[v] = (freq[v] || 0) + 1;
  const groups = Object.entries(freq).sort((a, b) => b[1] - a[1] || b[0] - a[0]);

  if (isFlush && isStraight && values[0] === 14) {
    return { rank: HAND_RANKS.ROYAL_FLUSH, name: 'Royal Flush', kickers: values, cards };
  }
  if (isFlush && (isStraight || isLowStraight)) {
    const kickers = isLowStraight ? [5, 4, 3, 2, 1] : values;
    return { rank: HAND_RANKS.STRAIGHT_FLUSH, name: 'Straight Flush', kickers, cards };
  }
  if (groups[0][1] === 4) {
    const quad = Number(groups[0][0]);
    const kicker = Number(groups[1][0]);
    return { rank: HAND_RANKS.FOUR_OF_A_KIND, name: 'Four of a Kind', kickers: [quad, kicker], cards };
  }
  if (groups[0][1] === 3 && groups[1][1] === 2) {
    return { rank: HAND_RANKS.FULL_HOUSE, name: 'Full House', kickers: [Number(groups[0][0]), Number(groups[1][0])], cards };
  }
  if (isFlush) {
    return { rank: HAND_RANKS.FLUSH, name: 'Flush', kickers: values, cards };
  }
  if (isStraight || isLowStraight) {
    const kickers = isLowStraight ? [5, 4, 3, 2, 1] : values;
    return { rank: HAND_RANKS.STRAIGHT, name: 'Straight', kickers, cards };
  }
  if (groups[0][1] === 3) {
    const trip = Number(groups[0][0]);
    const kickers = values.filter(v => v !== trip).slice(0, 2);
    return { rank: HAND_RANKS.THREE_OF_A_KIND, name: 'Three of a Kind', kickers: [trip, ...kickers], cards };
  }
  if (groups[0][1] === 2 && groups[1][1] === 2) {
    const high = Math.max(Number(groups[0][0]), Number(groups[1][0]));
    const low = Math.min(Number(groups[0][0]), Number(groups[1][0]));
    const kicker = values.find(v => v !== high && v !== low);
    return { rank: HAND_RANKS.TWO_PAIR, name: 'Two Pair', kickers: [high, low, kicker], cards };
  }
  if (groups[0][1] === 2) {
    const pair = Number(groups[0][0]);
    const kickers = values.filter(v => v !== pair).slice(0, 3);
    return { rank: HAND_RANKS.ONE_PAIR, name: 'One Pair', kickers: [pair, ...kickers], cards };
  }
  return { rank: HAND_RANKS.HIGH_CARD, name: 'High Card', kickers: values, cards };
}

function checkStraight(values) {
  for (let i = 0; i < values.length - 1; i++) {
    if (values[i] - values[i + 1] !== 1) return false;
  }
  return true;
}

function checkLowStraight(values) {
  // A-2-3-4-5 (wheel)
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[0] === 2 && sorted[1] === 3 && sorted[2] === 4 && sorted[3] === 5 && sorted[4] === 14;
}

function compareHandResult(a, b) {
  if (a.rank !== b.rank) return a.rank - b.rank;
  for (let i = 0; i < Math.min(a.kickers.length, b.kickers.length); i++) {
    if (a.kickers[i] !== b.kickers[i]) return a.kickers[i] - b.kickers[i];
  }
  return 0;
}

function getCombinations(arr, k) {
  if (k === 0) return [[]];
  if (arr.length === 0) return [];
  const [first, ...rest] = arr;
  const withFirst = getCombinations(rest, k - 1).map(c => [first, ...c]);
  const withoutFirst = getCombinations(rest, k);
  return [...withFirst, ...withoutFirst];
}

// ─── Game State ─────────────────────────────────────────────────────────────

const PHASES = ['waiting', 'preflop', 'flop', 'turn', 'river', 'showdown', 'finished'];

/**
 * Create a new poker table.
 */
function createTable(options = {}) {
  return {
    id: options.id || `table_${Date.now()}`,
    guildId: options.guildId || null,
    channelId: options.channelId || null,
    messageId: null, // the embed message ID (updated on each render)
    hostId: options.hostId || null,

    // Settings
    mode: options.mode || 'casual', // 'casual' = play money, 'crypto' = real SOL
    maxPlayers: Math.min(Math.max(options.maxPlayers || 6, 2), 8),
    startingBank: options.startingBank || 1000,
    smallBlind: options.smallBlind || 5,
    bigBlind: options.bigBlind || 10,
    turnTimer: options.turnTimer || 30, // seconds

    // Crypto mode fields
    eventId: options.eventId || null, // linked poker_events.id
    buyIn: options.buyIn || 0, // SOL amount per player
    currency: options.currency || 'SOL',
    chipValue: options.buyIn && options.startingBank
      ? (options.buyIn / (options.startingBank || 1000)) : 0, // SOL per chip

    // State
    phase: 'waiting',
    deck: [],
    communityCards: [],
    pot: 0,
    sidePots: [], // { amount, eligible: [seatIndex] }
    currentBet: 0, // the current bet amount to call
    minRaise: 0,

    // Players
    seats: [], // { discordId, username, displayName, avatar, chips, holeCards, bet, folded, allIn, lastAction, sittingOut }
    dealerIndex: 0,
    currentPlayerIndex: -1,
    lastRaiserIndex: -1,
    playersActedThisRound: new Set(),

    // Turn timeout
    turnTimeout: null,
    turnDeadline: null,

    // History
    handNumber: 0,
    lastResult: null, // { winners, handDescription }

    // Timestamps
    createdAt: Date.now(),
    lastActivity: Date.now(),
  };
}

function addPlayer(table, discordId, username, displayName, avatar) {
  if (table.phase !== 'waiting' && table.phase !== 'finished') {
    return { error: 'Cannot join mid-hand. Wait for the next hand.' };
  }
  if (table.seats.length >= table.maxPlayers) {
    return { error: 'Table is full.' };
  }
  if (table.seats.find(s => s.discordId === discordId)) {
    return { error: 'You are already at this table.' };
  }
  const seat = {
    discordId,
    username: username || 'Unknown',
    displayName: displayName || username || 'Unknown',
    avatar: avatar || null,
    chips: table.startingBank,
    holeCards: [],
    bet: 0,
    totalBetThisHand: 0,
    folded: false,
    allIn: false,
    lastAction: null,
    sittingOut: false,
  };
  table.seats.push(seat);
  table.lastActivity = Date.now();
  return { ok: true, seat };
}

function removePlayer(table, discordId) {
  const idx = table.seats.findIndex(s => s.discordId === discordId);
  if (idx === -1) return { error: 'Not at this table.' };

  // If game is in progress, mark as folded/sitting out
  if (table.phase !== 'waiting' && table.phase !== 'finished') {
    table.seats[idx].folded = true;
    table.seats[idx].sittingOut = true;
    // If it was their turn, advance
    if (table.currentPlayerIndex === idx) {
      advanceToNextPlayer(table);
    }
  } else {
    table.seats.splice(idx, 1);
    // Adjust dealer index
    if (table.dealerIndex >= table.seats.length) table.dealerIndex = 0;
  }
  table.lastActivity = Date.now();
  return { ok: true };
}

// ─── Game Flow ──────────────────────────────────────────────────────────────

function startHand(table) {
  // Remove sitting-out players
  table.seats = table.seats.filter(s => !s.sittingOut);

  const activePlayers = table.seats.filter(s => s.chips > 0);
  if (activePlayers.length < 2) {
    return { error: 'Need at least 2 players with chips to start.' };
  }

  // Remove broke players
  table.seats = table.seats.filter(s => s.chips > 0);

  table.handNumber++;
  table.phase = 'preflop';
  table.deck = shuffleDeck(createDeck());
  table.communityCards = [];
  table.pot = 0;
  table.sidePots = [];
  table.currentBet = 0;
  table.minRaise = table.bigBlind;
  table.lastResult = null;
  table.lastRaiserIndex = -1;
  table.playersActedThisRound = new Set();

  // Reset player states
  for (const seat of table.seats) {
    seat.holeCards = [];
    seat.bet = 0;
    seat.totalBetThisHand = 0;
    seat.folded = false;
    seat.allIn = false;
    seat.lastAction = null;
  }

  // Move dealer button
  table.dealerIndex = table.dealerIndex % table.seats.length;

  // Post blinds
  const sbIndex = (table.dealerIndex + 1) % table.seats.length;
  const bbIndex = (table.dealerIndex + 2) % table.seats.length;

  // Handle heads-up: dealer posts SB, other posts BB
  const numPlayers = table.seats.length;
  let sbIdx, bbIdx;
  if (numPlayers === 2) {
    sbIdx = table.dealerIndex;
    bbIdx = (table.dealerIndex + 1) % numPlayers;
  } else {
    sbIdx = (table.dealerIndex + 1) % numPlayers;
    bbIdx = (table.dealerIndex + 2) % numPlayers;
  }

  postBlind(table, sbIdx, table.smallBlind);
  postBlind(table, bbIdx, table.bigBlind);
  table.currentBet = table.bigBlind;
  table.minRaise = table.bigBlind;

  // Deal hole cards
  for (let i = 0; i < 2; i++) {
    for (let j = 0; j < table.seats.length; j++) {
      table.seats[j].holeCards.push(table.deck.pop());
    }
  }

  // First to act preflop: left of BB
  if (numPlayers === 2) {
    table.currentPlayerIndex = sbIdx; // heads up: SB acts first preflop
  } else {
    table.currentPlayerIndex = (bbIdx + 1) % numPlayers;
  }
  table.lastRaiserIndex = bbIdx; // BB is the "last raiser" initially

  table.lastActivity = Date.now();
  return { ok: true };
}

function postBlind(table, seatIndex, amount) {
  const seat = table.seats[seatIndex];
  const actual = Math.min(amount, seat.chips);
  seat.chips -= actual;
  seat.bet = actual;
  seat.totalBetThisHand += actual;
  table.pot += actual;
  if (seat.chips === 0) seat.allIn = true;
  seat.lastAction = actual === amount ? 'blind' : 'blind (all-in)';
}

/**
 * Player action: fold, check, call, bet, raise, allin
 */
function playerAction(table, discordId, action, amount = 0) {
  const seatIndex = table.seats.findIndex(s => s.discordId === discordId);
  if (seatIndex === -1) return { error: 'You are not at this table.' };
  if (table.currentPlayerIndex !== seatIndex) return { error: 'It is not your turn.' };
  if (table.phase === 'waiting' || table.phase === 'showdown' || table.phase === 'finished') {
    return { error: 'No active betting round.' };
  }

  const seat = table.seats[seatIndex];
  if (seat.folded || seat.allIn) return { error: 'You cannot act.' };

  const toCall = table.currentBet - seat.bet;

  switch (action) {
    case 'fold': {
      seat.folded = true;
      seat.lastAction = 'Fold';
      break;
    }
    case 'check': {
      if (toCall > 0) return { error: 'You must call, raise, or fold.' };
      seat.lastAction = 'Check';
      break;
    }
    case 'call': {
      if (toCall <= 0) return { error: 'Nothing to call. Check instead.' };
      const actual = Math.min(toCall, seat.chips);
      seat.chips -= actual;
      seat.bet += actual;
      seat.totalBetThisHand += actual;
      table.pot += actual;
      if (seat.chips === 0) seat.allIn = true;
      seat.lastAction = seat.allIn ? 'All-In (Call)' : `Call $${actual}`;
      break;
    }
    case 'bet': {
      if (table.currentBet > 0) return { error: 'Already a bet — use raise.' };
      const betAmt = Math.max(table.bigBlind, amount);
      if (betAmt > seat.chips) return { error: `Not enough chips. You have $${seat.chips}.` };
      seat.chips -= betAmt;
      seat.bet += betAmt;
      seat.totalBetThisHand += betAmt;
      table.pot += betAmt;
      table.currentBet = seat.bet;
      table.minRaise = betAmt;
      table.lastRaiserIndex = seatIndex;
      table.playersActedThisRound = new Set([seatIndex]);
      if (seat.chips === 0) seat.allIn = true;
      seat.lastAction = seat.allIn ? `All-In $${betAmt}` : `Bet $${betAmt}`;
      break;
    }
    case 'raise': {
      if (toCall <= 0 && table.currentBet === 0) return { error: 'No bet to raise. Use bet.' };
      const minTotal = table.currentBet + table.minRaise;
      const raiseTotal = Math.max(minTotal, amount + seat.bet);
      const toPay = raiseTotal - seat.bet;
      if (toPay > seat.chips) {
        // All-in raise (may be under minimum)
        const allInPay = seat.chips;
        seat.chips = 0;
        seat.bet += allInPay;
        seat.totalBetThisHand += allInPay;
        table.pot += allInPay;
        seat.allIn = true;
        if (seat.bet > table.currentBet) {
          table.minRaise = seat.bet - table.currentBet;
          table.currentBet = seat.bet;
          table.lastRaiserIndex = seatIndex;
          table.playersActedThisRound = new Set([seatIndex]);
        }
        seat.lastAction = `All-In $${allInPay}`;
      } else {
        seat.chips -= toPay;
        seat.bet += toPay;
        seat.totalBetThisHand += toPay;
        table.pot += toPay;
        table.minRaise = seat.bet - table.currentBet;
        table.currentBet = seat.bet;
        table.lastRaiserIndex = seatIndex;
        table.playersActedThisRound = new Set([seatIndex]);
        if (seat.chips === 0) seat.allIn = true;
        seat.lastAction = seat.allIn ? `All-In (Raise)` : `Raise to $${seat.bet}`;
      }
      break;
    }
    case 'allin': {
      const allInAmt = seat.chips;
      if (allInAmt <= 0) return { error: 'You have no chips.' };
      seat.chips = 0;
      seat.bet += allInAmt;
      seat.totalBetThisHand += allInAmt;
      table.pot += allInAmt;
      seat.allIn = true;
      if (seat.bet > table.currentBet) {
        table.minRaise = Math.max(table.minRaise, seat.bet - table.currentBet);
        table.currentBet = seat.bet;
        table.lastRaiserIndex = seatIndex;
        table.playersActedThisRound = new Set([seatIndex]);
      }
      seat.lastAction = `All-In $${allInAmt}`;
      break;
    }
    default:
      return { error: `Unknown action: ${action}` };
  }

  table.playersActedThisRound.add(seatIndex);
  table.lastActivity = Date.now();

  // Check if only one player remains (everyone else folded)
  const activePlayers = table.seats.filter(s => !s.folded);
  if (activePlayers.length === 1) {
    // Winner by default
    return finishHand(table, activePlayers);
  }

  // Check if betting round is complete
  if (isBettingRoundComplete(table)) {
    return advancePhase(table);
  }

  // Advance to next player
  advanceToNextPlayer(table);
  return { ok: true, phase: table.phase };
}

function isBettingRoundComplete(table) {
  const active = table.seats.filter((s, i) => !s.folded && !s.allIn);
  if (active.length === 0) return true; // everyone is all-in or folded

  // All active (non-folded, non-allin) players must have acted and matched the current bet
  for (let i = 0; i < table.seats.length; i++) {
    const s = table.seats[i];
    if (s.folded || s.allIn) continue;
    if (!table.playersActedThisRound.has(i)) return false;
    if (s.bet < table.currentBet) return false;
  }
  return true;
}

function advanceToNextPlayer(table) {
  const numPlayers = table.seats.length;
  let next = (table.currentPlayerIndex + 1) % numPlayers;
  let attempts = 0;

  while (attempts < numPlayers) {
    const seat = table.seats[next];
    if (!seat.folded && !seat.allIn) {
      table.currentPlayerIndex = next;
      return;
    }
    next = (next + 1) % numPlayers;
    attempts++;
  }

  // No one can act — all-in runout
  table.currentPlayerIndex = -1;
}

function advancePhase(table) {
  // Reset bets for new round
  for (const seat of table.seats) {
    seat.bet = 0;
  }
  table.currentBet = 0;
  table.minRaise = table.bigBlind;
  table.playersActedThisRound = new Set();
  table.lastRaiserIndex = -1;

  // Deal community cards
  switch (table.phase) {
    case 'preflop':
      table.phase = 'flop';
      table.deck.pop(); // burn
      table.communityCards.push(table.deck.pop(), table.deck.pop(), table.deck.pop());
      break;
    case 'flop':
      table.phase = 'turn';
      table.deck.pop(); // burn
      table.communityCards.push(table.deck.pop());
      break;
    case 'turn':
      table.phase = 'river';
      table.deck.pop(); // burn
      table.communityCards.push(table.deck.pop());
      break;
    case 'river':
      table.phase = 'showdown';
      return resolveShowdown(table);
  }

  // Set first player to act (left of dealer)
  const numPlayers = table.seats.length;
  let first = (table.dealerIndex + 1) % numPlayers;
  let attempts = 0;
  while (attempts < numPlayers) {
    if (!table.seats[first].folded && !table.seats[first].allIn) break;
    first = (first + 1) % numPlayers;
    attempts++;
  }

  // If all remaining players are all-in, run out community cards
  const canAct = table.seats.filter(s => !s.folded && !s.allIn);
  if (canAct.length <= 1) {
    return runOutCards(table);
  }

  table.currentPlayerIndex = first;
  return { ok: true, phase: table.phase };
}

function runOutCards(table) {
  // Deal remaining community cards
  while (table.communityCards.length < 5) {
    if (table.communityCards.length === 0) {
      table.phase = 'flop';
      table.deck.pop(); // burn
      table.communityCards.push(table.deck.pop(), table.deck.pop(), table.deck.pop());
    } else if (table.communityCards.length === 3) {
      table.phase = 'turn';
      table.deck.pop(); // burn
      table.communityCards.push(table.deck.pop());
    } else if (table.communityCards.length === 4) {
      table.phase = 'river';
      table.deck.pop(); // burn
      table.communityCards.push(table.deck.pop());
    }
  }
  table.phase = 'showdown';
  return resolveShowdown(table);
}

function resolveShowdown(table) {
  const activePlayers = table.seats.filter(s => !s.folded);
  if (activePlayers.length === 0) {
    table.phase = 'finished';
    return { ok: true, phase: 'finished', winners: [] };
  }

  // Evaluate hands
  for (const seat of activePlayers) {
    const allCards = [...seat.holeCards, ...table.communityCards];
    seat.handResult = evaluateHand(allCards);
  }

  // Calculate side pots
  const allBets = table.seats
    .filter(s => !s.folded)
    .map(s => ({ seat: s, totalBet: s.totalBetThisHand }))
    .sort((a, b) => a.totalBet - b.totalBet);

  const pots = [];
  let processed = 0;

  for (let i = 0; i < allBets.length; i++) {
    const bet = allBets[i].totalBet;
    if (bet <= processed) continue;

    const increment = bet - processed;
    let potAmount = 0;

    // Each player contributes up to this level
    for (const s of table.seats) {
      const contrib = Math.min(s.totalBetThisHand - processed, increment);
      if (contrib > 0) potAmount += contrib;
    }

    const eligible = allBets.filter(ab => ab.totalBet >= bet).map(ab => ab.seat);
    pots.push({ amount: potAmount, eligible });
    processed = bet;
  }

  // Determine winners for each pot
  const winners = [];
  for (const pot of pots) {
    let bestHand = null;
    let potWinners = [];

    for (const seat of pot.eligible) {
      if (!seat.handResult) continue;
      if (!bestHand || compareHandResult(seat.handResult, bestHand) > 0) {
        bestHand = seat.handResult;
        potWinners = [seat];
      } else if (compareHandResult(seat.handResult, bestHand) === 0) {
        potWinners.push(seat);
      }
    }

    const share = Math.floor(pot.amount / potWinners.length);
    const remainder = pot.amount - share * potWinners.length;

    for (let i = 0; i < potWinners.length; i++) {
      const winAmount = share + (i === 0 ? remainder : 0);
      potWinners[i].chips += winAmount;
      winners.push({
        discordId: potWinners[i].discordId,
        displayName: potWinners[i].displayName,
        amount: winAmount,
        hand: potWinners[i].handResult.name,
        cards: potWinners[i].holeCards,
      });
    }
  }

  // Consolidate duplicate winners
  const consolidated = {};
  for (const w of winners) {
    if (consolidated[w.discordId]) {
      consolidated[w.discordId].amount += w.amount;
    } else {
      consolidated[w.discordId] = { ...w };
    }
  }

  table.lastResult = {
    winners: Object.values(consolidated),
    showdown: activePlayers.map(s => ({
      discordId: s.discordId,
      displayName: s.displayName,
      hand: s.handResult?.name || 'Unknown',
      holeCards: s.holeCards,
    })),
  };

  table.phase = 'finished';

  // Advance dealer for next hand
  table.dealerIndex = (table.dealerIndex + 1) % table.seats.length;

  return { ok: true, phase: 'showdown', result: table.lastResult };
}

function finishHand(table, activePlayers) {
  const winner = activePlayers[0];
  winner.chips += table.pot;

  table.lastResult = {
    winners: [{
      discordId: winner.discordId,
      displayName: winner.displayName,
      amount: table.pot,
      hand: 'Everyone folded',
      cards: winner.holeCards,
    }],
    showdown: null,
  };

  table.phase = 'finished';
  table.dealerIndex = (table.dealerIndex + 1) % table.seats.length;
  return { ok: true, phase: 'finished', result: table.lastResult };
}

/**
 * Get the valid actions for the current player.
 */
function getValidActions(table) {
  if (table.currentPlayerIndex < 0 || table.currentPlayerIndex >= table.seats.length) return [];
  const seat = table.seats[table.currentPlayerIndex];
  if (!seat || seat.folded || seat.allIn) return [];

  const toCall = table.currentBet - seat.bet;
  const actions = ['fold'];

  if (toCall <= 0) {
    actions.push('check');
    if (seat.chips > 0) actions.push('bet');
  } else {
    if (seat.chips > toCall) {
      actions.push('call');
      actions.push('raise');
    } else {
      // Can only call all-in or fold
      actions.push('call'); // this will be all-in
    }
  }

  if (seat.chips > 0) actions.push('allin');
  return actions;
}

module.exports = {
  createTable,
  addPlayer,
  removePlayer,
  startHand,
  playerAction,
  getValidActions,
  evaluateHand,
  cardToString,
  cardToEmoji,
  HAND_NAMES,
  PHASES,
};
