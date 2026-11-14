import { readFileSync } from 'fs';

interface OHLCV {
  ts: string;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

interface InputData {
  ohlcv_1m: OHLCV[];
}

interface QuantileForecast {
  ts: string;
  quantiles: {
    p05: number;
    p25: number;
    p50: number;
    p75: number;
    p95: number;
  };
}

function erfinv(x: number): number {
  const a = 0.147;
  const sign = x >= 0 ? 1 : -1;
  const xAbs = Math.abs(x);
  const ln = Math.log(1 - xAbs * xAbs);
  const val = Math.sqrt(Math.sqrt((2 / (Math.PI * a) + ln / 2) ** 2 - ln / a) - (2 / (Math.PI * a) + ln / 2));
  return sign * val;
}

function normInv(p: number): number {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  return Math.sqrt(2) * erfinv(2 * p - 1);
}

function ewmaVolatility(returns: number[], lambda = 0.94): number {
  if (returns.length === 0) return 0.01;
  let varEst = returns[0] * returns[0];
  for (let i = 1; i < returns.length; i++) {
    varEst = lambda * varEst + (1 - lambda) * returns[i] * returns[i];
  }
  return Math.sqrt(varEst);
}

function forecastQuantiles(
  lastPrice: number,
  mu: number,
  sigma: number,
  horizonMinutes: number,
  quantiles: number[] = [0.05, 0.25, 0.5, 0.75, 0.95]
): { p05: number; p25: number; p50: number; p75: number; p95: number } {
  const t = horizonMinutes / (24 * 60);
  const drift = mu * t;
  const vol = sigma * Math.sqrt(t);
  const z = quantiles.map(q => normInv(q));
  const preds = z.map(zi => lastPrice * Math.exp(drift - 0.5 * vol * vol + vol * zi));
  return { p05: preds[0], p25: preds[1], p50: preds[2], p75: preds[3], p95: preds[4] };
}

function parseISO(ts: string): Date {
  return new Date(ts);
}

function formatISO(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function addMinutes(d: Date, minutes: number): Date {
  return new Date(d.getTime() + minutes * 60000);
}

function main() {
  const input = JSON.parse(readFileSync(0, 'utf-8')) as InputData;
  const candles = input.ohlcv_1m;

  if (!candles || candles.length === 0) {
    console.error('No candles provided');
    process.exit(1);
  }

  const prices = candles.map(c => c.c);
  const returns: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    if (prices[i - 1] > 0) {
      returns.push(Math.log(prices[i] / prices[i - 1]));
    }
  }

  const mu = returns.reduce((a, b) => a + b, 0) / returns.length;
  const sigma = ewmaVolatility(returns);

  const lastCandle = candles[candles.length - 1];
  const lastPrice = lastCandle.c;
  const lastTime = parseISO(lastCandle.ts);

  const forecasts: QuantileForecast[] = [];
  for (let i = 1; i <= 12; i++) {
    const checkpointTime = addMinutes(lastTime, i * 240);
    const q = forecastQuantiles(lastPrice, mu, sigma, i * 240);
    forecasts.push({
      ts: formatISO(checkpointTime),
      quantiles: q
    });
  }

  console.log(JSON.stringify(forecasts));
}

main();