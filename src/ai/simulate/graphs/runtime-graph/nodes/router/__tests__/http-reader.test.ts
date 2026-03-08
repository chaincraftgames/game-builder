/**
 * Tests for HTTP Data Source Reader
 *
 * Verifies that readHttpDataSource correctly:
 * 1. Builds URLs from config (baseUrl + path + queryParams)
 * 2. Resolves template variables in query params
 * 3. Handles HTTP errors gracefully
 * 4. Returns parsed JSON response
 */

import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { readHttpDataSource } from '../http-reader.js';
import type { HttpDataSourceConfig } from '../../../../../../design/game-design-state.js';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const binanceBtcSpot: HttpDataSourceConfig = {
  sourceType: 'http',
  id: 'binance-btc-usd-price',
  label: 'BTC Spot Price (Binance)',
  description: 'BTC price from Binance',
  baseUrl: 'https://api.binance.com',
  path: '/api/v3/ticker/price',
  queryParams: { symbol: 'BTCUSDT' },
  params: [],
  resultType: 'number',
  transform: {
    extractField: 'price',
    coerceNumber: true,
  },
};

const binanceBtc24hChange: HttpDataSourceConfig = {
  sourceType: 'http',
  id: 'binance-btc-24h-change',
  label: 'BTC 24h Change',
  description: 'BTC 24h price change',
  baseUrl: 'https://api.binance.com',
  path: '/api/v3/ticker/24hr',
  queryParams: { symbol: 'BTCUSDT' },
  params: [],
  resultType: 'number',
  transform: {
    extractField: 'priceChange',
    coerceNumber: true,
  },
};

const binanceBtcKlineOpen: HttpDataSourceConfig = {
  sourceType: 'http',
  id: 'binance-btc-1m-open',
  label: 'BTC 1m Candle Open (Binance)',
  description: 'Opening price of most recent 1-minute BTC candle',
  baseUrl: 'https://api.binance.com',
  path: '/api/v3/klines',
  queryParams: { symbol: 'BTCUSDT', interval: '1m', limit: '1' },
  params: [],
  resultType: 'number',
  transform: {
    arrayIndex: 0,
    extractField: '1',
    coerceNumber: true,
  },
};

const binanceBtcKlineClose: HttpDataSourceConfig = {
  sourceType: 'http',
  id: 'binance-btc-1m-close',
  label: 'BTC 1m Candle Close (Binance)',
  description: 'Closing price of most recent 1-minute BTC candle',
  baseUrl: 'https://api.binance.com',
  path: '/api/v3/klines',
  queryParams: { symbol: 'BTCUSDT', interval: '1m', limit: '1' },
  params: [],
  resultType: 'number',
  transform: {
    arrayIndex: 0,
    extractField: '4',
    coerceNumber: true,
  },
};

const dynamicSymbolSource: HttpDataSourceConfig = {
  sourceType: 'http',
  id: 'binance-dynamic',
  label: 'Dynamic Symbol',
  description: 'Dynamic symbol lookup',
  baseUrl: 'https://api.binance.com',
  path: '/api/v3/ticker/price',
  queryParams: { symbol: '{{tradingPair}}' },
  params: [
    { name: 'tradingPair', type: 'string', description: 'Binance trading pair' },
  ],
  resultType: 'number',
  transform: {
    extractField: 'price',
    coerceNumber: true,
  },
};

// ─── Mock fetch ──────────────────────────────────────────────────────────────

const originalFetch = globalThis.fetch;

let mockFetch: jest.Mock<typeof fetch>;

beforeEach(() => {
  mockFetch = jest.fn<typeof fetch>();
  globalThis.fetch = mockFetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('HTTP Data Source Reader', () => {
  it('should build correct URL from config and return parsed JSON', async () => {
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ symbol: 'BTCUSDT', price: '87250.50' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const result = await readHttpDataSource(binanceBtcSpot, {}, {});

    expect(result).toEqual({ symbol: 'BTCUSDT', price: '87250.50' });
    expect(mockFetch).toHaveBeenCalledTimes(1);

    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain('https://api.binance.com/api/v3/ticker/price');
    expect(calledUrl).toContain('symbol=BTCUSDT');
  });

  it('should resolve template variables in query params from state', async () => {
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ symbol: 'ETHUSDT', price: '3450.25' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const state = { tradingPair: 'ETHUSDT' };
    const result = await readHttpDataSource(dynamicSymbolSource, {}, state);

    expect(result).toEqual({ symbol: 'ETHUSDT', price: '3450.25' });

    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain('symbol=ETHUSDT');
  });

  it('should use runtime paramValues to override query params', async () => {
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ symbol: 'SOLUSDT', price: '180.00' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    // Override the static 'BTCUSDT' symbol with a runtime value
    const result = await readHttpDataSource(
      binanceBtcSpot,
      { symbol: 'SOLUSDT' },
      {}
    );

    expect(result).toEqual({ symbol: 'SOLUSDT', price: '180.00' });

    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain('symbol=SOLUSDT');
  });

  it('should throw on non-OK HTTP response', async () => {
    mockFetch.mockResolvedValue(
      new Response('Rate limit exceeded', {
        status: 429,
        statusText: 'Too Many Requests',
      })
    );

    await expect(
      readHttpDataSource(binanceBtcSpot, {}, {})
    ).rejects.toThrow('HTTP 429');
  });

  it('should build correct klines URL with interval and limit params', async () => {
    // Binance klines returns: [[openTime, open, high, low, close, volume, closeTime, ...]]
    const klineCandle = [
      1735686000000, '97000.50', '97100.00', '96900.00', '97050.30', '12.345',
      1735686059999, '12345.67', 100, '96850.00', '97100.00', 0,
    ];
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify([klineCandle]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const result = await readHttpDataSource(binanceBtcKlineOpen, {}, {});

    // readHttpDataSource returns the raw JSON; transforms are applied by applyTransform in datasource-utils
    expect(result).toEqual([klineCandle]);

    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain('/api/v3/klines');
    expect(calledUrl).toContain('symbol=BTCUSDT');
    expect(calledUrl).toContain('interval=1m');
    expect(calledUrl).toContain('limit=1');
  });

  it('should handle 24hr ticker response correctly', async () => {
    mockFetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          symbol: 'BTCUSDT',
          priceChange: '-1234.56',
          priceChangePercent: '-1.42',
          lastPrice: '86015.44',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );

    const result = await readHttpDataSource(binanceBtc24hChange, {}, {});
    expect(result.priceChange).toBe('-1234.56');
  });
});
