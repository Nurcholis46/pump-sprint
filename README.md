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
harness: it buys new bonding-curve coins in their first two slots only when
the launch already looks strong — at least 5 SOL of real reserve, price still
above half its create price, at least six distinct recent non-creator buyers,
the creator's own create-slot buy under 2.5 SOL, no big sell and no heavy
selling — sizes up to 0.3 SOL per coin (capped at 1% of real SOL reserve),
never adds, and exits fast: +15% take-profit, −12% stop-loss, a 10-slot
maximum hold from the first fill, or at once when the creator sells. If the
pace of qualified coins ever lags the 20-coin round-trip guardrail, the entry
filter relaxes in stages so the bot still trades broadly.

Official grade-local on the full dev window (1,222 coins): **+0.48 SOL net**,
105 round trips, 47% win rate, max drawdown 2.0%, guardrails met; L1
regrade reproduced byte for byte. For comparison on the same window:
hold-cash 0.00 SOL, pilot sniper −0.49 SOL, pilot momentum −9.39 SOL, pilot
reversion −4.02 SOL.

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
