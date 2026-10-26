export type MarketCandle = { time: number; open: number; high: number; low: number; close: number; volume: number };

const assets = ['EURUSD', 'GBPUSD', 'USDJPY', 'XAUUSD'] as const;
const timeframes = ['m1', 'm5', 'm15', 'm30', 'h1', 'h4', 'd1'] as const;
export type MarketAsset = typeof assets[number];
export type MarketTimeframe = typeof timeframes[number];
export const isAsset = (value: unknown): value is MarketAsset => typeof value === 'string' && assets.includes(value as MarketAsset);
export const isTimeframe = (value: unknown): value is MarketTimeframe => typeof value === 'string' && timeframes.includes(value as MarketTimeframe);
export const intervalMs: Record<MarketTimeframe, number> = {
  m1: 60_000, m5: 300_000, m15: 900_000, m30: 1_800_000,
  h1: 3_600_000, h4: 14_400_000, d1: 86_400_000,
};

export function countObservedGaps(candles: MarketCandle[], timeframe: MarketTimeframe): number {
  const expectedSeconds = intervalMs[timeframe] / 1000;
  let gaps = 0;
  for (let index = 1; index < candles.length; index++) {
    if (candles[index].time - candles[index - 1].time > expectedSeconds * 1.5) gaps++;
  }
  return gaps;
}

export function isValidCandle(c: MarketCandle): boolean {
  return Number.isInteger(c.time) && c.time > 0
    && [c.open, c.high, c.low, c.close, c.volume].every(Number.isFinite)
    && c.open > 0 && c.high > 0 && c.low > 0 && c.close > 0
    && c.volume >= 0
    && c.high >= Math.max(c.open, c.close)
    && c.low <= Math.min(c.open, c.close)
    && c.high >= c.low;
}

export function normalizeCandles(input: unknown[]): { candles: MarketCandle[]; invalidRows: number; duplicateRows: number } {
  const normalized = input.map((value: any) => {
    const rawTime = value.timestamp ?? value.time ?? value.datetime ?? value.date;
    const numericTime = Number(rawTime);
    const time = Number.isFinite(numericTime)
      ? Math.floor(numericTime / (numericTime > 10_000_000_000 ? 1000 : 1))
      : Math.floor(Date.parse(String(rawTime)) / 1000);
    return {
    time,
    open: Number(value.open), high: Number(value.high), low: Number(value.low), close: Number(value.close), volume: Number(value.volume ?? 0),
  }});
  const valid = normalized.filter(isValidCandle).sort((a, b) => a.time - b.time);
  const candles = valid.filter((c, i) => i === 0 || c.time !== valid[i - 1].time);
  return { candles, invalidRows: normalized.length - valid.length, duplicateRows: valid.length - candles.length };
}

export function utcDateKey(timeSeconds: number): string {
  return new Date(timeSeconds * 1000).toISOString().slice(0, 10);
}

export function candleObjectKey(asset: MarketAsset, timeframe: MarketTimeframe, date: string): string {
  return `market-data/v1/${asset}/${timeframe}/${date}.json`;
}

export function utcDaysBetween(from: Date, to: Date): string[] {
  const result: string[] = [];
  const cursor = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  const end = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate());
  while (cursor.getTime() <= end) {
    result.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return result;
}

export async function mapConcurrent<T, R>(items: readonly T[], concurrency: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const pool = Array.from({ length: Math.min(Math.max(1, concurrency), items.length) }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await worker(items[index]);
    }
  });
  await Promise.all(pool);
  return results;
}

function parseCsvRows(text: string): string[][] {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  const delimiter = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ';'
    : (firstLine.match(/\t/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? '\t' : ',';
  const rows: string[][] = [];
  let row: string[] = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"' && quoted && text[i + 1] === '"') { cell += '"'; i++; }
    else if (char === '"') quoted = !quoted;
    else if (char === delimiter && !quoted) { row.push(cell.trim()); cell = ''; }
    else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && text[i + 1] === '\n') i++;
      row.push(cell.trim());
      if (row.some(value => value !== '')) rows.push(row);
      row = []; cell = '';
    } else cell += char;
  }
  row.push(cell.trim());
  if (row.some(value => value !== '')) rows.push(row);
  return rows;
}

function normalizeHeader(value: string): string {
  return value.toLowerCase().replace(/\(.*?\)|\[.*?\]/g, '').replace(/[^a-z]/g, '');
}

function parseTime(value: string): number {
  const trimmed = value.trim();
  const numeric = Number(trimmed);
  if (trimmed && Number.isFinite(numeric)) return Math.floor(numeric > 10_000_000_000 ? numeric / 1000 : numeric);
  const dottedDate = trimmed.replace(/^(\d{4})\.(\d{2})\.(\d{2})/, '$1-$2-$3');
  const explicitZone = /(?:Z|GMT|UTC|[+-]\d{2}:?\d{2})$/i.test(dottedDate);
  const millis = Date.parse(explicitZone ? dottedDate : `${dottedDate.replace(' ', 'T')}Z`);
  return Number.isFinite(millis) ? Math.floor(millis / 1000) : NaN;
}

/** Accepts headed CSV with time/timestamp/date and OHLC columns. No rows are silently discarded. */
export function parseCandleCsv(text: string): MarketCandle[] {
  if (text.length > 8_000_000) throw new Error('CSV is too large. Import a smaller file (maximum 8 MB).');
  const rows = parseCsvRows(text.replace(/^\uFEFF/, ''));
  if (rows.length < 2) throw new Error('CSV needs a header and at least one candle row.');
  const headers = rows[0].map(normalizeHeader);
  const index = (...names: string[]) => headers.findIndex(value => names.includes(value));
  const timeIndex = index('time', 'timestamp', 'datetime', 'date', 'utctime', 'gmttime', 'timeutc', 'localtime');
  const dateIndex = index('date');
  const clockIndex = index('clock', 'timeofday', 'time');
  const openIndex = index('open', 'o');
  const highIndex = index('high', 'h');
  const lowIndex = index('low', 'l');
  const closeIndex = index('close', 'c');
  const volumeIndex = index('volume', 'vol', 'v');
  if (timeIndex < 0 || openIndex < 0 || highIndex < 0 || lowIndex < 0 || closeIndex < 0) {
    throw new Error('CSV header must include time (or timestamp/date), open, high, low, and close columns.');
  }
  const candles = rows.slice(1).map((row, i) => {
    const timeText = dateIndex >= 0 && clockIndex >= 0 && dateIndex !== clockIndex ? `${row[dateIndex]} ${row[clockIndex]}` : row[timeIndex];
    const candle: MarketCandle = {
      time: parseTime(timeText ?? ''), open: Number(row[openIndex]), high: Number(row[highIndex]),
      low: Number(row[lowIndex]), close: Number(row[closeIndex]), volume: volumeIndex >= 0 && row[volumeIndex] ? Number(row[volumeIndex]) : 0,
    };
    if (!isValidCandle(candle)) throw new Error(`Invalid candle on CSV row ${i + 2}. Check UTC time and OHLC values.`);
    return candle;
  }).sort((a, b) => a.time - b.time);
  const unique = candles.filter((c, i) => i === 0 || c.time !== candles[i - 1].time);
  if (!unique.length) throw new Error('CSV contains no valid candles.');
  return unique;
}
