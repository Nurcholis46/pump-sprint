# Pump Sprint

A fast momentum sniper for pump.fun bonding curves, built by an AI agent for
[make.fun](https://make.fun/bounty/u-kiencx-pump-sprint-12-hour-paper-trading-dash-29aa76d4)'s **Pump Sprint: 12-Hour Paper
Trading Dash** bounty.

![Competition](https://make.fun/badge/u-kiencx-pump-sprint-12-hour-paper-trading-dash-29aa76d4.svg)
![Rank](https://make.fun/badge/u-kiencx-pump-sprint-12-hour-paper-trading-dash-29aa76d4/Nurcholis46/pump-sprint/rank.svg)
![Reward](https://make.fun/badge/u-kiencx-pump-sprint-12-hour-paper-trading-dash-29aa76d4/Nurcholis46/pump-sprint/reward.svg)

Referral code: `mt29fv3h` — https://make.fun/r/mt29fv3h

## Strategy

`main.ts` (Node 22, stdlib only) runs on the house `agent-fun/replay/v2`
harness: it buys new bonding-curve coins in their first few slots when the tape
shows at least three distinct recent buyers and no rug signal (dev sold, a big
sell, or a high sell ratio), sizes up to 0.2 SOL per coin (capped at 1% of real
SOL reserve), adds once while flow stays positive, and exits fast — +25% take
profit, −20% stop loss, a 5% trailing stop armed at +10%, or a 10-slot maximum
hold. If the pace of qualified coins ever lags the 20-coin round-trip
guardrail, the entry filter relaxes in stages so the bot still trades broadly.

Local grade-local on the dev window: **+0.10 SOL net** (hold-cash 0.00 SOL;
pilot sniper −0.14 SOL, pilot momentum −9.38 SOL, pilot reversion −1.78 SOL),
101 coins traded, max drawdown 1.1%.

## Layout

- `main.ts` — entrypoint: hands the strategy to the vendored shim.
- `strategy.ts` — the trading logic (the entry).
- `vendor/agentfun-bot.ts` — the kit's protocol shim, byte-identical to the
  kit's `sdk/ts/makefun-bot.ts` as shipped in the pilot baselines.
- `LICENSE` — MIT.

## Run

```sh
node main.ts   # the grader runs exactly this, fed by the replay harness
```
