/**
 * Data Source Configurations
 *
 * Predefined data sources that can be injected into game designs to enable
 * live external data integration. Supports both blockchain (smart contract reads)
 * and HTTP (keyless REST API) sources.
 *
 * Design flow:
 * 1. Data source configs are injected into the design graph state
 * 2. The conversational agent sees labels/descriptions to recommend features
 * 3. Discovery uses configs to generate schema fields + setFromDataSource ops
 * 4. Runtime pre-processor executes the actual reads (contract or HTTP)
 *
 * Data sources are pure infrastructure — they describe *what* data exists
 * and *how* to read it. The mapping to game state happens via the
 * setFromDataSource stateDelta operation at the instruction level.
 */

import { type BlockchainDataSourceConfig, type HttpDataSourceConfig, type DataSourceConfig, type DataSourceAggregatorConfig } from "./game-design-state.js";

const INCLUDE_CHAINCRAFT_DATA_SOURCES_IN_DESIGN_AGENT = true; // Set to false to exclude data sources from design agent prompt (for testing/iteration purposes)

// ─── Predefined Data Sources ─────────────────────────────────────────────────

// #region Chaincraft-specific data sources (primarily on Arbitrum Sepolia and Sanko)
/**
 * CC Token (ERC20) balance for a wallet address.
 *
 * Use case: Games where players wager, display, or compete based on
 * their real CC token holdings.
 */
const ccTokenBalance: BlockchainDataSourceConfig = {
  sourceType: "blockchain",
  id: "cc-token-balance",
  label: "CC Token Balance",
  description:
    "A player's ChainCraft (CC) ERC-20 token balance on Arbitrum Sepolia. " +
    "Returns the token amount as a number (normalized from 18 decimals). " +
    "Useful for games that display or use real token holdings — e.g., " +
    "high-stakes wagering, balance-based handicaps, or leaderboard qualification.",
  chain: "Arbitrum Sepolia",
  chainId: 421614,
  rpcUrl: "https://arbitrum-sepolia-rpc.publicnode.com",
  contract: "", // Set via environment variable at runtime
  method: "balanceOf",
  abi: [
    {
      type: "function",
      name: "balanceOf",
      inputs: [{ name: "account", type: "address" }],
      outputs: [{ name: "", type: "uint256" }],
      stateMutability: "view",
    },
  ],
  params: [
    {
      name: "account",
      type: "address",
      description: "The wallet address to check the token balance for",
    },
  ],
  returnType: "uint256",
  resultType: "number",
  transform: { decimals: 18 },
};

/**
 * Data Drifters NFT (ERC721) balance for a wallet address.
 *
 * Use case: Games that gate access, grant bonuses, or display ownership
 * of ChainCraft's Data Drifters NFT collection.
 */
const dataDriftersNftBalance: BlockchainDataSourceConfig = {
  sourceType: "blockchain",
  id: "data-drifters-nft-balance",
  label: "Data Drifters NFT Count",
  description:
    "The number of Data Drifters NFTs a player owns on the Sanko chain. " +
    "Returns a count (uint256). Useful for NFT-gated features, ownership " +
    "bonuses, or cosmetic unlocks based on collection size.",
  chain: "Sanko",
  chainId: 1996,
  rpcUrl: "https://mainnet.sanko.xyz",
  contract: "0x1ae8095d2de1a6e74b15c5175071264e6142de57",
  method: "balanceOf",
  abi: [
    {
      type: "function",
      name: "balanceOf",
      inputs: [{ name: "owner", type: "address" }],
      outputs: [{ name: "", type: "uint256" }],
      stateMutability: "view",
    },
  ],
  params: [
    {
      name: "owner",
      type: "address",
      description: "The wallet address to check NFT ownership for",
    },
  ],
  returnType: "uint256",
  resultType: "number",
};

/**
 * Token Duels on-chain game state.
 *
 * Use case: Games that integrate with the TokenDuels smart contract to
 * read staking state, player deposits, and settlement status.
 */
const tokenDuelsGameState: BlockchainDataSourceConfig = {
  sourceType: "blockchain",
  id: "token-duels-game-state",
  label: "Token Duels Game State",
  description:
    "On-chain state of a TokenDuels match — includes both player addresses, " +
    "stake amount, individual deposits, game state (waiting/active/finished/canceled), " +
    "winner address, and game NFT ID. Returns a structured object. " +
    "Useful for games that need to verify on-chain stakes or settlement status.",
  chain: "Arbitrum Sepolia",
  chainId: 421614,
  rpcUrl: "https://arbitrum-sepolia-rpc.publicnode.com",
  contract: "", // Set via environment variable at runtime
  method: "getGame",
  abi: [
    {
      type: "function",
      name: "getGame",
      inputs: [{ name: "sessionId", type: "uint256" }],
      outputs: [
        {
          name: "",
          type: "tuple",
          components: [
            { name: "p1", type: "address" },
            { name: "p2", type: "address" },
            { name: "stakeAmount", type: "uint256" },
            { name: "p1Deposit", type: "uint256" },
            { name: "p2Deposit", type: "uint256" },
            { name: "state", type: "uint8" },
            { name: "winner", type: "address" },
            { name: "gameId", type: "uint256" },
          ],
        },
      ],
      stateMutability: "view",
    },
  ],
  params: [
    {
      name: "sessionId",
      type: "uint256",
      description: "The session ID of the TokenDuels match to query",
    },
  ],
  returnType: "tuple",
  resultType: "object",
};

/**
 * Token Duels stake amount (global config).
 *
 * Use case: Display or use the current required stake amount in game logic
 * (e.g., showing "this match requires X CC tokens to enter").
 */
const tokenDuelsStakeAmount: BlockchainDataSourceConfig = {
  sourceType: "blockchain",
  id: "token-duels-stake-amount",
  label: "Token Duels Stake Amount",
  description:
    "The current required stake amount (in CC tokens) for TokenDuels matches. " +
    "Returns a single number (uint256). This is a global value — same for all " +
    "matches. Useful for displaying entry costs or validating wager amounts.",
  chain: "Arbitrum Sepolia",
  chainId: 421614,
  rpcUrl: "https://arbitrum-sepolia-rpc.publicnode.com",
  contract: "", // Set via environment variable at runtime
  method: "stakeAmount",
  abi: [
    {
      type: "function",
      name: "stakeAmount",
      inputs: [],
      outputs: [{ name: "", type: "uint256" }],
      stateMutability: "view",
    },
  ],
  params: [],
  returnType: "uint256",
  resultType: "number",
};

/**
 * Published game count from the Game Registry.
 *
 * Use case: Trivia/meta-games that reference the total number of published
 * games on the platform.
 */
const gameRegistryTotalGames: BlockchainDataSourceConfig = {
  sourceType: "blockchain",
  id: "game-registry-total-games",
  label: "Total Published Games",
  description:
    "The total number of games published on the ChainCraft Game Registry " +
    "(Arbitrum Sepolia). Returns a count (uint256). Useful for meta-game " +
    "mechanics, platform statistics, or milestone-based gameplay.",
  chain: "Arbitrum Sepolia",
  chainId: 421614,
  rpcUrl: "https://arbitrum-sepolia-rpc.publicnode.com",
  contract: "", // Set via environment variable at runtime
  method: "totalGames",
  abi: [
    {
      type: "function",
      name: "totalGames",
      inputs: [],
      outputs: [{ name: "", type: "uint256" }],
      stateMutability: "view",
    },
  ],
  params: [],
  returnType: "uint256",
  resultType: "number",
};

/**
 * Game Asset (ERC721) balance — how many character/token NFTs a player owns.
 *
 * Use case: Games that reward or gate based on a player's game asset
 * collection (characters, items minted through gameplay).
 */
const gameAssetBalance: BlockchainDataSourceConfig = {
  sourceType: "blockchain",
  id: "game-asset-balance",
  label: "Game Asset NFT Count",
  description:
    "The number of Game Asset NFTs (characters/tokens) a player owns " +
    "on Arbitrum Sepolia. Returns a count (uint256). Useful for collection-based " +
    "bonuses, gating, or progression systems tied to minted game assets.",
  chain: "Arbitrum Sepolia",
  chainId: 421614,
  rpcUrl: "https://arbitrum-sepolia-rpc.publicnode.com",
  contract: "", // Set via environment variable at runtime
  method: "balanceOf",
  abi: [
    {
      type: "function",
      name: "balanceOf",
      inputs: [{ name: "account", type: "address" }],
      outputs: [{ name: "", type: "uint256" }],
      stateMutability: "view",
    },
  ],
  params: [
    {
      name: "account",
      type: "address",
      description: "The wallet address to check game asset ownership for",
    },
  ],
  returnType: "uint256",
  resultType: "number",
};

/**
 * Faucet — can a player claim free tokens?
 *
 * Use case: Games that incorporate the faucet cooldown as a mechanic
 * (e.g., "claim your daily tokens before playing").
 */
const faucetCanClaim: BlockchainDataSourceConfig = {
  sourceType: "blockchain",
  id: "faucet-can-claim",
  label: "Faucet Claim Available",
  description:
    "Whether a player can currently claim free CC tokens from the faucet. " +
    "Returns true/false. Useful for games that incorporate token claiming " +
    "as a prerequisite or bonus mechanic.",
  chain: "Arbitrum Sepolia",
  chainId: 421614,
  rpcUrl: "https://arbitrum-sepolia-rpc.publicnode.com",
  contract: "", // Set via environment variable at runtime
  method: "canClaim",
  abi: [
    {
      type: "function",
      name: "canClaim",
      inputs: [{ name: "user", type: "address" }],
      outputs: [{ name: "", type: "bool" }],
      stateMutability: "view",
    },
  ],
  params: [
    {
      name: "user",
      type: "address",
      description: "The wallet address to check faucet claim eligibility for",
    },
  ],
  returnType: "bool",
  resultType: "boolean",
};

/**
 * Faucet — time until next claim.
 *
 * Use case: Display countdown timers or use cooldown duration in game logic.
 */
const faucetTimeUntilClaim: BlockchainDataSourceConfig = {
  sourceType: "blockchain",
  id: "faucet-time-until-claim",
  label: "Faucet Cooldown Timer",
  description:
    "Seconds remaining until a player can claim free CC tokens from the faucet. " +
    "Returns a number (uint256, in seconds). Returns 0 if claim is available. " +
    "Useful for countdown displays or cooldown-based game mechanics.",
  chain: "Arbitrum Sepolia",
  chainId: 421614,
  rpcUrl: "https://arbitrum-sepolia-rpc.publicnode.com",
  contract: "", // Set via environment variable at runtime
  method: "timeUntilNextClaim",
  abi: [
    {
      type: "function",
      name: "timeUntilNextClaim",
      inputs: [{ name: "user", type: "address" }],
      outputs: [{ name: "", type: "uint256" }],
      stateMutability: "view",
    },
  ],
  params: [
    {
      name: "user",
      type: "address",
      description: "The wallet address to check faucet cooldown for",
    },
  ],
  returnType: "uint256",
  resultType: "number",
  transform: { decimals: 18 },
};

// #endregion

// #region Chainlink price feeds

/**
 * Chainlink TSLA/USD price feed on Arbitrum Mainnet.
 *
 * Use case: Games that incorporate real-world stock prices — e.g.,
 * prediction markets, trading simulations, or price-based challenges.
 * Note: Feed updates during NYSE market hours only.
 * Price has 8 decimals (divide by 1e8 to get USD).
 */
const chainlinkTslaUsd: BlockchainDataSourceConfig = {
  sourceType: "blockchain",
  id: "chainlink-tsla-usd",
  label: "TSLA Stock Price (Chainlink)",
  description:
    "Current Tesla (TSLA) stock price in USD via Chainlink oracle on Arbitrum. " +
    "Returns the price in USD as a number (e.g., 248.35). " +
    "Updates during NYSE market hours. Useful for prediction markets, " +
    "stock-price challenges, or financial trivia games.",
  chain: "Arbitrum",
  chainId: 42161,
  rpcUrl: "https://arb1.arbitrum.io/rpc",
  contract: "0x3609baAa0a9b1f0FE4d6CC01884585d0e191C3E3",
  method: "latestRoundData",
  abi: [
    {
      type: "function",
      name: "latestRoundData",
      inputs: [],
      outputs: [
        { name: "roundId", type: "uint80" },
        { name: "answer", type: "int256" },
        { name: "startedAt", type: "uint256" },
        { name: "updatedAt", type: "uint256" },
        { name: "answeredInRound", type: "uint80" },
      ],
      stateMutability: "view",
    },
  ],
  params: [],
  returnType: "tuple",
  resultType: "number",
  transform: {
    extractField: "answer",
    decimals: 8,
  },
};

// #endregion

// #region Chainlink crypto price feeds (Arbitrum Mainnet)

/**
 * Chainlink ETH/USD price feed on Arbitrum Mainnet.
 *
 * Use case: Games that use live ETH prices — prediction markets,
 * crypto trading simulations, or price-based wagers.
 * ~0.05% deviation threshold, ~1h heartbeat.
 */
const chainlinkEthUsd: BlockchainDataSourceConfig = {
  sourceType: "blockchain",
  id: "chainlink-eth-usd",
  label: "ETH Price (Chainlink)",
  description:
    "Current Ethereum (ETH) price in USD via Chainlink oracle on Arbitrum. " +
    "Returns the price in USD as a number (e.g., 3450.25). " +
    "Updates continuously (~1h heartbeat, ~0.05% deviation trigger). " +
    "Useful for crypto prediction games, trading simulations, or price-based challenges.",
  chain: "Arbitrum",
  chainId: 42161,
  rpcUrl: "https://arb1.arbitrum.io/rpc",
  contract: "0x639Fe6ab55C921f74e7fac1ee960C0B6293ba612",
  method: "latestRoundData",
  abi: [
    {
      type: "function",
      name: "latestRoundData",
      inputs: [],
      outputs: [
        { name: "roundId", type: "uint80" },
        { name: "answer", type: "int256" },
        { name: "startedAt", type: "uint256" },
        { name: "updatedAt", type: "uint256" },
        { name: "answeredInRound", type: "uint80" },
      ],
      stateMutability: "view",
    },
  ],
  params: [],
  returnType: "tuple",
  resultType: "number",
  transform: {
    extractField: "answer",
    decimals: 8,
  },
};

/**
 * Chainlink BTC/USD price feed on Arbitrum Mainnet.
 *
 * Use case: Games that use live BTC prices — prediction markets,
 * crypto trading simulations, or price-based wagers.
 * ~0.05% deviation threshold, ~1h heartbeat.
 */
const chainlinkBtcUsd: BlockchainDataSourceConfig = {
  sourceType: "blockchain",
  id: "chainlink-btc-usd",
  label: "BTC Price (Chainlink)",
  description:
    "Current Bitcoin (BTC) price in USD via Chainlink oracle on Arbitrum. " +
    "Returns the price in USD as a number (e.g., 87250.50). " +
    "Updates continuously (~1h heartbeat, ~0.05% deviation trigger). " +
    "Useful for crypto prediction games, trading simulations, or price-based challenges.",
  chain: "Arbitrum",
  chainId: 42161,
  rpcUrl: "https://arb1.arbitrum.io/rpc",
  contract: "0x6ce185860a4963106506C203335A2910413708e9",
  method: "latestRoundData",
  abi: [
    {
      type: "function",
      name: "latestRoundData",
      inputs: [],
      outputs: [
        { name: "roundId", type: "uint80" },
        { name: "answer", type: "int256" },
        { name: "startedAt", type: "uint256" },
        { name: "updatedAt", type: "uint256" },
        { name: "answeredInRound", type: "uint80" },
      ],
      stateMutability: "view",
    },
  ],
  params: [],
  returnType: "tuple",
  resultType: "number",
  transform: {
    extractField: "answer",
    decimals: 8,
  },
};

// #endregion

// #region Binance.US HTTP price feeds (keyless, no API key required, US-accessible)

/**
 * Supported Binance feed types. Each maps to a Binance REST endpoint,
 * a response field to extract, and human-readable description fragments.
 */
interface BinanceFeedType {
  /** Suffix appended to the data-source ID, e.g. "usd-price" → "binance-btc-usd-price" */
  idSuffix: string;
  /** Human-readable label suffix, e.g. "Spot Price" */
  labelSuffix: string;
  /** Binance REST path */
  path: string;
  /** JSON field to extract from the response */
  extractField: string;
  /** Description template — `{name}` and `{ticker}` are replaced per-asset */
  descriptionTemplate: string;
}

const BINANCE_FEED_TYPES: BinanceFeedType[] = [
  {
    idSuffix: "usd-price",
    labelSuffix: "Spot Price",
    path: "/api/v3/ticker/price",
    extractField: "price",
    descriptionTemplate:
      "Current {name} ({ticker}) price in USDT from Binance. " +
      "Returns the price as a number. " +
      "Updates in real time. Useful for price prediction games, " +
      "trading simulations, or crypto trivia.",
  },
  {
    idSuffix: "24h-change",
    labelSuffix: "24h Price Change",
    path: "/api/v3/ticker/24hr",
    extractField: "priceChange",
    descriptionTemplate:
      "{name}'s absolute price change over the last 24 hours in USDT. " +
      "Returns a number (positive = up, negative = down). " +
      "Perfect for prediction games where players guess the direction of price movement.",
  },
  {
    idSuffix: "24h-pct",
    labelSuffix: "24h % Change",
    path: "/api/v3/ticker/24hr",
    extractField: "priceChangePercent",
    descriptionTemplate:
      "{name}'s percentage price change over the last 24 hours. " +
      "Returns a number (e.g., -2.15 means a 2.15% drop). " +
      "Useful for prediction games where players bet on volatility or percentage thresholds.",
  },
];

/**
 * Kline (candlestick) feed types. These use the Binance `/api/v3/klines`
 * endpoint with `interval=1m&limit=1` to fetch the most recent 1-minute candle.
 *
 * Kline response format: [[openTime, open, high, low, close, volume, ...]]
 * open = index 1, close = index 4 (both returned as strings by Binance).
 */
interface BinanceKlineFeedType {
  /** Suffix appended to the data-source ID, e.g. "1m-open" → "binance-btc-1m-open" */
  idSuffix: string;
  /** Human-readable label suffix */
  labelSuffix: string;
  /** Array index within the kline candle (0=openTime, 1=open, 4=close) */
  candleFieldIndex: string;
  /** Description template — `{name}` and `{ticker}` are replaced per-asset */
  descriptionTemplate: string;
}

const BINANCE_KLINE_FEED_TYPES: BinanceKlineFeedType[] = [
  {
    idSuffix: "1m-open",
    labelSuffix: "1m Candle Open",
    candleFieldIndex: "1",
    descriptionTemplate:
      "The opening price of the most recent 1-minute candle for {name} ({ticker}) in USDT. " +
      "Use this to capture the price at the start of a short prediction window. " +
      "Pair with the 1m close price to calculate the price delta over 1 minute.",
  },
  {
    idSuffix: "1m-close",
    labelSuffix: "1m Candle Close",
    candleFieldIndex: "4",
    descriptionTemplate:
      "The closing price of the most recent 1-minute candle for {name} ({ticker}) in USDT. " +
      "Use this to capture the final price after a short prediction window. " +
      "Pair with the 1m open price to calculate the price delta over 1 minute.",
  },
];

/**
 * Build Binance kline (1m candle) data source configs for a given asset.
 * Generates one entry per kline feed type (open, close).
 */
function buildBinanceKlineDataSources(asset: BinanceAsset): HttpDataSourceConfig[] {
  return BINANCE_KLINE_FEED_TYPES.map((feed) => ({
    sourceType: "http" as const,
    id: `binance-${asset.ticker}-${feed.idSuffix}`,
    label: `${asset.ticker.toUpperCase()} ${feed.labelSuffix} (Binance)`,
    description: feed.descriptionTemplate
      .replace(/\{name\}/g, asset.name)
      .replace(/\{ticker\}/g, asset.ticker.toUpperCase()),
    baseUrl: "https://api.binance.us",
    path: "/api/v3/klines",
    queryParams: { symbol: asset.symbol, interval: "1m", limit: "1" },
    params: [],
    resultType: "number" as const,
    transform: {
      arrayIndex: 0,
      extractField: feed.candleFieldIndex,
      coerceNumber: true,
    },
  }));
}

/**
 * Asset definitions for Binance feeds.
 * Adding a new crypto asset here automatically generates spot + 24h change + 24h % entries.
 */
interface BinanceAsset {
  /** Lowercase ticker used in IDs, e.g. "btc" */
  ticker: string;
  /** Full name for descriptions, e.g. "Bitcoin" */
  name: string;
  /** Binance trading pair symbol, e.g. "BTCUSDT" */
  symbol: string;
}

const BINANCE_ASSETS: BinanceAsset[] = [
  { ticker: "btc", name: "Bitcoin", symbol: "BTCUSDT" },
  { ticker: "eth", name: "Ethereum", symbol: "ETHUSDT" },
];

/**
 * Build all Binance HTTP data source configs for a given asset.
 * Generates one entry per feed type (spot, 24h change, 24h %).
 */
function buildBinanceDataSources(asset: BinanceAsset): HttpDataSourceConfig[] {
  return BINANCE_FEED_TYPES.map((feed) => ({
    sourceType: "http" as const,
    id: `binance-${asset.ticker}-${feed.idSuffix}`,
    label: `${asset.ticker.toUpperCase()} ${feed.labelSuffix} (Binance)`,
    description: feed.descriptionTemplate
      .replace(/\{name\}/g, asset.name)
      .replace(/\{ticker\}/g, asset.ticker.toUpperCase()),
    baseUrl: "https://api.binance.us",
    path: feed.path,
    queryParams: { symbol: asset.symbol },
    params: [],
    resultType: "number" as const,
    transform: {
      extractField: feed.extractField,
      coerceNumber: true,
    },
  }));
}

/** All generated Binance data sources, keyed by ID. */
const binanceDataSources: Record<string, HttpDataSourceConfig> = {};
for (const asset of BINANCE_ASSETS) {
  for (const ds of buildBinanceDataSources(asset)) {
    binanceDataSources[ds.id] = ds;
  }
  for (const ds of buildBinanceKlineDataSources(asset)) {
    binanceDataSources[ds.id] = ds;
  }
}

// #endregion

// #region Coinbase HTTP price feeds (keyless, no API key required, high US volume)

/**
 * Coinbase asset definitions.
 * Adding a new crypto asset here automatically generates a spot price entry.
 *
 * Coinbase API: https://api.coinbase.com/v2/prices/{pair}/spot
 * Response: {"data":{"amount":"67220.235","base":"BTC","currency":"USD"}}
 * High US volume — price updates with every real trade, ideal for
 * short-window aggregators (30s/60s movement detection).
 */
interface CoinbaseAsset {
  /** Lowercase ticker used in IDs, e.g. "btc" */
  ticker: string;
  /** Full name for descriptions, e.g. "Bitcoin" */
  name: string;
  /** Coinbase trading pair slug, e.g. "BTC-USD" */
  pair: string;
}

const COINBASE_ASSETS: CoinbaseAsset[] = [
   { ticker: "btc", name: "Bitcoin", pair: "BTC-USD" },
  { ticker: "eth", name: "Ethereum", pair: "ETH-USD" },
  { ticker: "bnb", name: "BNB", pair: "BNB-USD" },
  { ticker: "xrp", name: "XRP", pair: "XRP-USD" },
  { ticker: "sol", name: "Solana", pair: "SOL-USD" },
  { ticker: "trx", name: "TRON", pair: "TRX-USD" },
  { ticker: "doge", name: "Dogecoin", pair: "DOGE-USD" },
  { ticker: "ada", name: "Cardano", pair: "ADA-USD" },
  { ticker: "bch", name: "Bitcoin Cash", pair: "BCH-USD" },
  { ticker: "leo", name: "LEO Token", pair: "LEO-USD" },
  { ticker: "arb", name: "Arbitrum", pair: "ARB-USD" },
];

/**
 * Build a Coinbase spot price data source for a given asset.
 */
function buildCoinbaseSpotSource(asset: CoinbaseAsset): HttpDataSourceConfig {
  return {
    sourceType: "http" as const,
    id: `coinbase-${asset.ticker}-usd-price`,
    label: `${asset.ticker.toUpperCase()} Spot Price (Coinbase)`,
    description:
      `Current ${asset.name} (${asset.ticker.toUpperCase()}) price in USD from Coinbase. ` +
      `Returns the price as a number. Updates in real time with high US trading volume. ` +
      `Ideal for short-window price prediction games using the 30s-movement or 60s-movement aggregator.`,
    baseUrl: "https://api.coinbase.com",
    path: `/v2/prices/${asset.pair}/spot`,
    params: [],
    resultType: "number" as const,
    transform: {
      extractField: "data.amount",
      coerceNumber: true,
    },
  };
}

/** All generated Coinbase data sources, keyed by ID. */
const coinbaseDataSources: Record<string, HttpDataSourceConfig> = {};
for (const asset of COINBASE_ASSETS) {
  const ds = buildCoinbaseSpotSource(asset);
  coinbaseDataSources[ds.id] = ds;
}

// #endregion

// #region Data Source Aggregators (static registry — platform-level infrastructure)

/**
 * Delayed-comparison aggregator: reads an underlying data source twice
 * with a configurable delay, then computes directional metrics.
 *
 * Result fields:
 * - startValue: the first read (number)
 * - endValue: the second read after delay (number)
 * - direction: "UP" | "DOWN" | "NO_MOVEMENT"
 * - delta: endValue - startValue (number)
 * - pctChange: percentage change ((end - start) / start * 100)
 *
 * Usage in setFromDataSource ops:
 * {
 *   "op": "setFromDataSource",
 *   "dataSourceId": "binance-btc-usd-price",
 *   "aggregatorId": "30s-movement",
 *   "path": "game.openingPrice",
 *   "extractField": "startValue"
 * }
 */
const movement30s: DataSourceAggregatorConfig = {
  id: "30s-movement",
  label: "30-Second Price Movement",
  description:
    "Reads a numeric data source twice with a 30-second delay and computes " +
    "directional metrics. Returns an object with startValue, endValue, " +
    "direction (UP/DOWN/NO_MOVEMENT), delta, and pctChange. " +
    "Composable with any data source that returns a number (e.g., spot prices). " +
    "Use extractField on the op to pick the specific field you need.",
  type: "delayed-comparison",
  delayMs: 30_000,
  resultFields: ["startValue", "endValue", "direction", "delta", "pctChange"],
};

const movement60s: DataSourceAggregatorConfig = {
  id: "60s-movement",
  label: "60-Second Price Movement",
  description:
    "Reads a numeric data source twice with a 60-second delay and computes " +
    "directional metrics. Returns an object with startValue, endValue, " +
    "direction (UP/DOWN/NO_MOVEMENT), delta, and pctChange. " +
    "Composable with any data source that returns a number (e.g., spot prices). " +
    "Use extractField on the op to pick the specific field you need.",
  type: "delayed-comparison",
  delayMs: 60_000,
  resultFields: ["startValue", "endValue", "direction", "delta", "pctChange"],
};

// #endregion
// ─── Registry ────────────────────────────────────────────────────────────────

const chaincraftDataSources: Record<string, BlockchainDataSourceConfig> =
  INCLUDE_CHAINCRAFT_DATA_SOURCES_IN_DESIGN_AGENT
    ? {
        "cc-token-balance": ccTokenBalance,
        "data-drifters-nft-balance": dataDriftersNftBalance,
        "token-duels-game-state": tokenDuelsGameState,
        "token-duels-stake-amount": tokenDuelsStakeAmount,
        "game-registry-total-games": gameRegistryTotalGames,
        "game-asset-balance": gameAssetBalance,
        "faucet-can-claim": faucetCanClaim,
        "faucet-time-until-claim": faucetTimeUntilClaim,
      }
    : {};

/**
 * All predefined data sources, keyed by ID.
 * Includes blockchain (ChainCraft contracts) and
 * HTTP (Coinbase keyless API) sources.
 *
 * NOTE: Chainlink oracles update too slowly for short-window aggregators (~1h heartbeat).
 * Binance.US has near-zero BTC/USDT volume (klines show no movement).
 * Coinbase has high US volume — ideal for real-time price feeds.
 */
export const PREDEFINED_DATA_SOURCES: Record<string, DataSourceConfig> = {
  ...chaincraftDataSources,
  // Chainlink oracles — disabled: ~1h heartbeat means 30s/60s aggregators always return NO_MOVEMENT
  // "chainlink-tsla-usd": chainlinkTslaUsd,
  // "chainlink-eth-usd": chainlinkEthUsd,
  // "chainlink-btc-usd": chainlinkBtcUsd,
  // Binance.US — disabled: near-zero BTC/USDT trade volume, prices don't move
  // ...binanceDataSources,
  ...coinbaseDataSources,
};

/**
 * Get all predefined data sources as an array.
 */
export function getAllDataSources(): DataSourceConfig[] {
  return Object.values(PREDEFINED_DATA_SOURCES);
}

/**
 * Get a data source by ID.
 */
export function getDataSourceById(
  id: string,
): DataSourceConfig | undefined {
  return PREDEFINED_DATA_SOURCES[id];
}

// ─── Aggregator Registry ─────────────────────────────────────────────────────

/**
 * All predefined data source aggregators, keyed by ID.
 * Aggregators are static platform infrastructure — resolved at runtime
 * by ID, never injected into design state.
 */
export const PREDEFINED_AGGREGATORS: Record<string, DataSourceAggregatorConfig> = {
  "30s-movement": movement30s,
  "60s-movement": movement60s,
};

/**
 * Get all predefined aggregators as an array.
 */
export function getAllAggregators(): DataSourceAggregatorConfig[] {
  return Object.values(PREDEFINED_AGGREGATORS);
}

/**
 * Get an aggregator by ID.
 */
export function getAggregatorById(
  id: string,
): DataSourceAggregatorConfig | undefined {
  return PREDEFINED_AGGREGATORS[id];
}

/**
 * Get the IDs of data sources compatible with aggregators that require numeric input.
 * Filters predefined data sources where resultType === "number".
 */
export function getNumericDataSourceIds(): string[] {
  return Object.values(PREDEFINED_DATA_SOURCES)
    .filter(ds => ds.resultType === 'number')
    .map(ds => ds.id);
}
