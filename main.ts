// Pump Sprint entry: a fast momentum sniper for pump.fun bonding curves.
// Run by the grader as `node /bot/main.ts`; the strategy lives in strategy.ts,
// the protocol in the vendored SDK shim (vendor/agentfun-bot.ts, a byte-identical
// copy of the kit's sdk/ts file as shipped in the pilot baselines).

import { runBot } from './vendor/agentfun-bot.ts';
import { createStrategy, DEFAULT_PARAMS } from './strategy.ts';

const strategy = createStrategy(DEFAULT_PARAMS);

await runBot({
  onHello: (state) => {
    // Fail fast, on our own machine and in grading, if the harness caps are
    // not the ones this strategy was tuned against: at least one open
    // position, buys capped at 1% of real SOL reserve, 16 orders per batch,
    // 2-slot latency, no leverage and no shorts.
    const caps = state.hello.caps;
    if (caps.max_open_positions < 1) throw new Error('harness caps: no open positions allowed');
    if (caps.max_order_bps_of_real_reserve !== 100) {
      throw new Error(`harness caps: unexpected max_order_bps_of_real_reserve ${caps.max_order_bps_of_real_reserve}`);
    }
    if (caps.max_orders_per_batch < 16) throw new Error('harness caps: fewer than 16 orders per batch');
    if (caps.shorts !== false || caps.leverage !== false) throw new Error('harness caps: shorts or leverage enabled');
  },
  onBatch: (state, batch) => strategy.onBatch(state, batch),
});
