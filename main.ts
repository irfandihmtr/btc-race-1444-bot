// Halcyon Breakout — btc-race-24h-20261118-1444.
//
// Long-only 30-minute breakout bot, one asset (CBBTC), low turnover.
// Entry: the latest completed 30-minute close breaks above the high of the
// previous eight 30-minute closes, the breakout bar itself rose more than
// 0.2%, price sits above its 30-minute EMA(8), and the 12-hour return is
// negative (a recovery breakout after a decline, never chasing a 12-hour
// run-up). Position: 50% of equity. Exit: 0.7% trailing stop from the peak
// since entry, the 30-minute close back below its EMA(8), or a 6-hour
// time-stop. Cash is a position: flat whenever no setup is present.
//
// Everything is deterministic: no clock, no environment, no randomness;
// every decision comes from the bars the harness sent.
import { runBars } from './vendor/makefun-bars.ts';

const SYMBOL = 'CBBTC';
const LOOKBACK = 8; // 30-minute closes: 4 hours of history
const TRAIL_BPS = 70; // 0.7% trailing stop from the peak since entry
const SIZE_NUM = 1n; // 50% of equity per entry
const SIZE_DEN = 2n;
const MAX_HOLD_BARS = 360; // 6 hours
const MAX_SLIPPAGE_BPS = 500; // 5%: far above any 1-minute move seen
const WARMUP_BARS = 240; // need 4 hours of 1-minute closes before deciding

const closes: number[] = []; // 1-minute closes in USD (float, as graded)
const m30: number[] = []; // completed 30-minute closes in USD
let m30ema = 0; // EMA(8) of the 30-minute closes
let entryBar = -1;
let peak = 0;

/** True when the latest completed 30-minute bar broke out: above the high
 *  of the previous LOOKBACK 30-minute closes, up more than 0.2% on its own
 *  bar, and above its EMA(8). */
function isBreakout(j: number): boolean {
  if (j < LOOKBACK + 1) return false;
  let high = -Infinity;
  for (let i = j - LOOKBACK; i < j; i++) if (m30[i] > high) high = m30[i];
  return m30[j] > high && m30[j] / m30[j - 1] - 1 > 0.002 && m30[j] > m30ema;
}

/** True when a held position should close: trailing stop, time-stop, or the
 *  30-minute close back below its EMA(8). */
function shouldExit(c: number, seq: number, j: number): boolean {
  return (
    c < peak * (1 - TRAIL_BPS / 10000) ||
    seq - entryBar > MAX_HOLD_BARS ||
    (j >= 1 && m30[j] < m30ema)
  );
}

await runBars({
  onBatch(state, _batch) {
    const seq = state.seq;
    const closeRaw = state.close(SYMBOL);
    if (closeRaw === null) return [];
    const c = Number(closeRaw) / 1e5;
    closes.push(c);
    if ((seq + 1) % 30 === 0) {
      m30.push(c);
      if (m30.length === 1) {
        m30ema = c;
      } else {
        const k = 2 / 9;
        m30ema = c * k + m30ema * (1 - k);
      }
    }
    if (seq < WARMUP_BARS) return [];
    const held = state.positions.get(SYMBOL);
    if (held === undefined || held.qty === 0n) {
      const j = Math.floor(seq / 30) - 1; // last completed 30-minute bar
      // 12h return must be negative: recovery breakout, never chasing a run-up.
      // Uses whatever history exists (closes[0] before 720 bars have passed).
      if (!isBreakout(j)) return [];
      if (closes[seq] >= closes[Math.max(0, seq - 720)]) return [];
      entryBar = seq;
      peak = c;
      return [{ side: 'buy', symbol: SYMBOL, notional_quote_units: (state.equity * SIZE_NUM) / SIZE_DEN, max_slippage_bps: MAX_SLIPPAGE_BPS }];
    }
    if (c > peak) peak = c;
    const j = Math.floor(seq / 30) - 1;
    if (shouldExit(c, seq, j)) {
      return [{ side: 'sell', symbol: SYMBOL, qty: held.qty, max_slippage_bps: MAX_SLIPPAGE_BPS }];
    }
    return [];
  },
});
