// Pump Sprint entry: a selective momentum sniper for pump.fun bonding curves.
//
// What the full dev window taught us (the pilot tools only grade the first
// third of it, so the numbers below are from the whole 1,222-coin window):
// most new coins bleed after their create-slot pop, and the round trip costs
// ~2.7% (1.25% curve fees each way + a flat 105,000-lamport tx fee per
// order), so the edge has to come from selection, not from holding or from
// doubling down. This bot buys only launches that already look strong in
// their first two slots — at least 5 SOL of real reserve, price still above
// half its create price, at least six distinct recent non-creator buyers,
// the creator's own create-slot buy under 2.5 SOL, no big sell and no heavy
// selling — sizes up to 0.3 SOL per coin (capped at 1% of real SOL reserve),
// never adds, and gets out fast: +15% take-profit, -12% stop-loss, a 10-slot
// maximum hold from the first fill, or at once when the creator sells.
// Exits are priced on the actual sell proceeds (constant-product sale less
// curve fees and the tx fee) against the real cost (filled buys plus every
// tx fee paid on the coin). If qualified coins ever run scarce, the entry
// filter relaxes in stages so the bot still puts in the 20+ round trips the
// guardrail asks for. Nothing here reads the clock, the environment or
// Math.random, so two runs are byte-identical.

import type { Batch, BotState, Curve, OrderInput } from './vendor/agentfun-bot.ts';

export interface SniperParams {
  /** A buy may spend up to this much SOL (lamports), before the 1% cap. */
  stakeLamports: bigint;
  /** Smallest buy worth paying a tx fee for (lamports). */
  minBuyLamports: bigint;
  /** A coin must hold at least this much real SOL before we touch it. */
  minRealSolLamports: bigint;
  /** A coin must hold at most this much real SOL (lamports). */
  maxRealSolLamports: bigint;
  /** Creator's own buys in the create slot must stay under this (lamports). */
  maxDevBuyLamports: bigint;
  /** Newest age (slots since create) we will open a position in. */
  maxAgeSlots: number;
  /** At most this many distinct non-creator buyers may have bought before entry. */
  maxBuyers: number;
  /** At least this many distinct non-creator buyers in the last flowWindow slots. */
  minRecentBuyers: number;
  /** Tape window (slots) for the recent-buyer check. */
  flowWindowSlots: number;
  /** Price now over the create price, in bps (10,000 = unchanged): at least this. */
  minRunupBps: number;
  /** Reject when the creator has sold any tokens. */
  skipDevSold: boolean;
  /** Reject when one non-creator sell is more than this share (bps) of the real SOL reserve before it. */
  maxBigSellBps: number;
  /** Reject when non-creator sells exceed this share (bps) of all buys. */
  maxSellRatioBps: number;
  /** Take profit, in bps over the real cost (filled buys + tx fees). */
  takeProfitBps: number;
  /** Stop loss, in bps under the real cost. */
  stopLossBps: number;
  /** Maximum slots from the first buy fill to the exit decision. */
  maxHoldSlots: number;
  /** Slippage allowed on buys and sells (bps). */
  slippageBps: number;
}

export const DEFAULT_PARAMS: SniperParams = {
  stakeLamports: 300_000_000n,
  minBuyLamports: 5_000_000n,
  minRealSolLamports: 5_000_000_000n,
  maxRealSolLamports: 30_000_000_000n,
  maxDevBuyLamports: 2_500_000_000n,
  // Tuned 23 Nov: enter only in a coin's first two slots (age 0-1). The dev
  // window's edge lives in the earliest tape: age <= 1 lifts dev PnL from
  // +0.337 to +0.476 SOL and the 70%-subsample stress median from +0.232 to
  // +0.310 SOL (p10 -0.056 -> +0.098, losing copies 3/20 -> 0/20).
  maxAgeSlots: 1,
  maxBuyers: 30,
  minRecentBuyers: 6,
  flowWindowSlots: 10,
  minRunupBps: 5_000,
  skipDevSold: true,
  maxBigSellBps: 2_000,
  maxSellRatioBps: 2_000,
  takeProfitBps: 1_500,
  stopLossBps: 1_200,
  maxHoldSlots: 10,
  slippageBps: 10_000,
};

const FEE_BPS = 125n;
const BPS = 10_000n;

/** What selling `tokens` against (vq, vt) pays after the 1.25% curve fees. */
function sellValue(tokens: bigint, vq: bigint, vt: bigint): bigint {
  if (tokens <= 0n || vt <= 0n) return 0n;
  const q = (tokens * vq) / (vt + tokens);
  return q - (q * FEE_BPS + BPS - 1n) / BPS;
}

/** One trade on the tape, kept only while it is inside the flow window. */
interface TapeTrade {
  slot: number;
  isBuy: boolean;
  sol: bigint;
  user: string;
}

/** Everything we track about one mint, from its own events. */
interface MintBook {
  creator: string;
  createdSlot: number;
  /** Create-time virtual reserves: the price run-up is measured against them. */
  vq0: bigint;
  vt0: bigint;
  trades: TapeTrade[];
  /** Distinct non-creator buyers (the creator's own buys do not count). */
  buyers: Set<string>;
  /** SOL bought by everyone, creator included. */
  buySol: bigint;
  /** SOL sold by non-creator wallets. */
  soldByOthers: bigint;
  /** Largest single non-creator sell, in bps of the real SOL reserve before it. */
  bigSellBps: bigint;
  /** SOL the creator bought in the create slot. */
  devBuy: bigint;
  devSold: boolean;
  complete: boolean;
  /** SOL spent on buys that actually filled. */
  spent: bigint;
  /** Tx fees paid on this coin's orders (any non-rejected fill). */
  txPaid: bigint;
  /** Tokens currently held (filled buys minus filled sells). */
  tokens: bigint;
  /** Slot of the first buy fill, -1 when never filled. */
  openedSlot: number;
  /** Slot of the first buy decision, -1 when never bought. */
  firstBuySlot: number;
  /** A buy has been decided for this mint (never buy it twice). */
  bought: boolean;
  /** A sell is already pending for this mint. */
  sellPending: boolean;
  /** A buy is already pending for this mint. */
  buyPending: boolean;
}

function freshBook(creator: string, slot: number): MintBook {
  return {
    creator,
    createdSlot: slot,
    vq0: 0n,
    vt0: 1n,
    trades: [],
    buyers: new Set(),
    buySol: 0n,
    soldByOthers: 0n,
    bigSellBps: 0n,
    devBuy: 0n,
    devSold: false,
    complete: false,
    spent: 0n,
    txPaid: 0n,
    tokens: 0n,
    openedSlot: -1,
    firstBuySlot: -1,
    bought: false,
    sellPending: false,
    buyPending: false,
  };
}

export function createStrategy(params: SniperParams = DEFAULT_PARAMS) {
  const books = new Map<string, MintBook>();
  let coinsSeen = 0;
  let coinsTraded = 0;
  let relaxed = 0; // 0 = strict, 1 = looser, 2 = loosest

  function bookFor(mint: string): MintBook {
    let b = books.get(mint);
    if (b === undefined) {
      b = freshBook('', -1);
      books.set(mint, b);
    }
    return b;
  }

  function recentBuyers(b: MintBook, now: number): Set<string> {
    const out = new Set<string>();
    for (const t of b.trades) {
      if (t.slot >= now - params.flowWindowSlots && t.isBuy && t.user !== b.creator) out.add(t.user);
    }
    return out;
  }

  /** Entry limits at the current relaxation level. */
  function entryLimits(): { maxAge: number; minRealSol: bigint; minRecent: number } {
    if (relaxed === 1) return { maxAge: 6, minRealSol: 2_000_000_000n, minRecent: 4 };
    if (relaxed >= 2) return { maxAge: 10, minRealSol: 1_000_000_000n, minRecent: 3 };
    return { maxAge: params.maxAgeSlots, minRealSol: params.minRealSolLamports, minRecent: params.minRecentBuyers };
  }

  function onBatch(state: BotState, batch: Batch): OrderInput[] {
    const now = batch.slot;
    const orders: OrderInput[] = [];
    const txFee = state.txFeeLamports();

    // ---- fold this batch's fills into the books -------------------------
    for (const f of batch.fills) {
      const b = bookFor(f.mint);
      if (f.status !== 'rejected') b.txPaid += BigInt(f.tx_fee_lamports);
      if (f.status === 'filled') {
        if (f.side === 'buy') {
          b.spent += BigInt(f.quote_lamports);
          b.tokens += BigInt(f.token_amount);
          if (b.openedSlot < 0) b.openedSlot = f.slot;
        } else {
          b.tokens -= BigInt(f.token_amount);
          if (b.tokens <= 0n) {
            b.tokens = 0n;
            b.spent = 0n;
          }
        }
      }
      // Any resolution (filled, rejected or failed) clears the pending flag.
      if (f.side === 'buy') b.buyPending = false;
      else b.sellPending = false;
    }

    // ---- fold this batch's events into the tape -------------------------
    for (const e of batch.events) {
      if (e.event === 'CreateEvent') {
        const b = bookFor(e.mint);
        b.creator = e.creator;
        b.createdSlot = e.slot;
        b.vq0 = BigInt(e.virtual_quote_reserves);
        b.vt0 = BigInt(e.virtual_token_reserves);
        coinsSeen += 1;
      } else if (e.event === 'TradeEvent') {
        const b = bookFor(e.mint);
        if (b.createdSlot < 0) b.createdSlot = e.slot;
        const sol = BigInt(e.sol_amount);
        const isDev = e.user === b.creator;
        b.trades.push({ slot: e.slot, isBuy: e.is_buy, sol, user: e.user });
        if (e.is_buy) {
          b.buySol += sol;
          if (isDev && e.slot === b.createdSlot) b.devBuy += sol;
          else if (!isDev) b.buyers.add(e.user);
        } else if (isDev) {
          b.devSold = true;
        } else {
          b.soldByOthers += sol;
          const reserveBefore = BigInt(e.real_quote_reserves) + sol;
          if (reserveBefore > 0n) {
            const bps = (sol * BPS) / reserveBefore;
            if (bps > b.bigSellBps) b.bigSellBps = bps;
          }
        }
      } else {
        bookFor(e.mint).complete = true;
      }
    }
    // Prune tape entries older than the flow window (tapes are short).
    for (const b of books.values()) {
      while (b.trades.length > 0 && b.trades[0].slot < now - params.flowWindowSlots - 2) b.trades.shift();
    }

    // ---- pace guard: relax the filter if qualified coins run scarce -----
    // The strict filter trades about one in ten new coins on the dev
    // window; if we are far below that pace once enough coins have been
    // seen, loosen in stages so the 20-coin round-trip guardrail is still
    // met on a fresh window.
    if (coinsSeen >= 100 && coinsTraded < Math.floor(coinsSeen * 0.04) && relaxed < 1) relaxed = 1;
    if (coinsSeen >= 300 && coinsTraded < Math.floor(coinsSeen * 0.02) && relaxed < 2) relaxed = 2;

    const limits = entryLimits();
    const maxPositions = state.hello.caps.max_open_positions;

    // ---- exits for coins we already hold --------------------------------
    for (const [mint, b] of books) {
      if (b.tokens <= 0n || b.sellPending) continue;
      const curve = state.curves.get(mint);
      if (curve === undefined || curve.complete) continue;
      const pos = state.positions.get(mint);
      if (pos === undefined) continue;
      const value = sellValue(pos.token_amount, curve.virtual_quote_reserves, curve.virtual_token_reserves) - txFee;
      const cost = b.spent + b.txPaid;
      if (cost <= 0n) continue;
      const age = b.openedSlot >= 0 ? now - b.openedSlot : now - b.firstBuySlot;
      const takeProfit = (cost * (BPS + BigInt(params.takeProfitBps))) / BPS;
      const stopLoss = (cost * (BPS - BigInt(params.stopLossBps))) / BPS;
      const rugExit = params.skipDevSold && b.devSold;
      if (value >= takeProfit || value <= stopLoss || rugExit || age >= params.maxHoldSlots) {
        orders.push({
          side: 'sell',
          mint,
          token_amount: pos.token_amount,
          max_slippage_bps: params.slippageBps,
        });
        b.sellPending = true;
      }
    }

    // ---- entries: fresh coins with a strong tape and no rug signal ------
    if (state.committedPositionCount() < maxPositions) {
      for (const [mint, curve] of state.curves) {
        if (orders.length >= state.hello.caps.max_orders_per_batch) break;
        if (state.committedPositionCount() + orders.filter((o) => o.side === 'buy').length >= maxPositions) break;
        const b = books.get(mint);
        if (b === undefined || b.createdSlot < 0 || curve.complete) continue;
        const age = now - b.createdSlot;
        if (age < 0 || age > limits.maxAge) continue;
        if (b.bought || b.tokens > 0n || b.buyPending) continue;
        if (curve.real_quote_reserves < limits.minRealSol) continue;
        if (curve.real_quote_reserves > params.maxRealSolLamports) continue;
        if (b.devBuy > params.maxDevBuyLamports) continue;
        if (b.buyers.size > params.maxBuyers) continue;
        if (recentBuyers(b, now).size < limits.minRecent) continue;
        if (params.skipDevSold && b.devSold) continue;
        if (b.buySol > 0n && b.soldByOthers * BPS > b.buySol * BigInt(params.maxSellRatioBps)) continue;
        if (b.bigSellBps > BigInt(params.maxBigSellBps)) continue;
        // Price must still be above half its create price.
        const runup = (curve.virtual_quote_reserves * b.vt0 * BPS) / (curve.virtual_token_reserves * b.vq0);
        if (runup < BigInt(params.minRunupBps)) continue;
        const room = state.maxBuyLamports(mint);
        const amount = room < params.stakeLamports ? room : params.stakeLamports;
        const free = state.freeCashLamports() - txFee;
        if (amount < params.minBuyLamports || free < amount) continue;
        orders.push({ side: 'buy', mint, quote_lamports: amount, max_slippage_bps: params.slippageBps });
        b.buyPending = true;
        b.bought = true;
        b.firstBuySlot = now;
        coinsTraded += 1;
      }
    }

    return orders;
  }

  return { onBatch };
}
