/**
 * Platform Capabilities
 *
 * Single source of truth for what the ChainCraft game platform can and cannot do.
 * Injected into the design agent's system prompt as `{platformCapabilities}`.
 *
 * This replaces the scattered approach of:
 *  - CONSTRAINTS_TEXT (negative-only, static)
 *  - getDataSourceSummaryForDesignAgent() (never actually wired in)
 *  - inline NFT/token prose in the conversation prompt
 *  - empty {mechanicsRegistry} placeholder
 *
 * The capabilities text is built dynamically so new data sources, image models,
 * or token contracts automatically appear in the design agent's knowledge.
 *
 * IMPORTANT: This describes capabilities in *user-facing* terms. The design agent
 * should capture what the user wants ("use live stock prices") without specifying
 * implementation details (Chainlink, setFromDataSource, contract addresses).
 * Discovery maps requirements → implementation.
 */

import { getAllDataSources, getAllAggregators, getNumericDataSourceIds } from './data-sources.js';

// ─── Static sections ─────────────────────────────────────────────────────────

const SUPPORTED_CAPABILITIES = `
### Fully Supported

**Core Game Mechanics**
- Turn-based gameplay with any number of phases
- Player choices from defined action sets
- Scoring, rounds, and win conditions
- Hidden information (private player state)
- Randomness (dice rolls, shuffled decks, random selection)
- Elimination and knockout mechanics
- Simultaneous or sequential turns (via keeping player choices private until all have acted)

**Narrative & Content**
- Short narrative segments (introductions, round summaries, outcomes)
- Dynamic messaging to individual players or all players
- Flavor text and thematic descriptions

**Image Generation**
- AI-generated images at specific game events (e.g., character portraits, scene illustrations, battle depictions)
- Images are generated on demand when triggered by game logic — not animated or continuously updating
- Best for: hero portraits, item illustrations, scene art, victory images

**Token & NFT Operations**
- Minting tokens as game rewards (e.g., winner receives an NFT of their character)
- Requiring token ownership to enter or unlock game features (NFT-gated access)
- Reading player token/NFT balances as game inputs
- Saving game outcomes, characters, or items as persistent tokens

**Live External Data**
- Real-time blockchain and market data can be read at any point during gameplay
- Data is fetched when a game phase triggers it (e.g., "at game start", "when resolving outcome")
- Supports: token balances, NFT ownership counts, on-chain game state, oracle price feeds, crypto spot prices, 24-hour price changes
- Pre-computed deltas (e.g., "BTC 24h price change") enable prediction games without timing exploits
- The spec should describe *what data is needed and when* — not how to fetch it
`.trim();

const LIMITED_CAPABILITIES = `
### Supported with Limitations

These features work but have known constraints. Warn users proactively and suggest mitigations.

- **Long narrative generation** — Short, focused narratives are reliable. Extended multi-paragraph narratives that must stay internally consistent across many turns can drift. Mitigate by keeping narrative segments short and self-contained.
- **Scoring across many rounds** — Works well for moderate game lengths. Very long games (20+ rounds) accumulate more state, increasing the chance of tracking errors.
- **Complex state machines** — Nested or deeply branching phase structures are harder to verify. Prefer flat phase sequences with clear transitions.
- **Spatial position tracking** — Maintaining piece positions on a grid (e.g., Battleship) is error-prone for large boards. Mitigate with smaller grids (5×5) and fewer pieces.
`.trim();

const NOT_SUPPORTED = `
### Not Supported

These cannot be built on this platform. Immediately flag violations and suggest alternatives that preserve the theme.

- **Real-time or animated graphics** — No continuously updating visuals, animations, falling pieces, or moving sprites. Static images and ASCII art are fine.
- **Autonomous game actions** — The game engine cannot act between player turns. No pieces that move on their own, no AI opponents that take actions unprompted. All state changes must be triggered by a player action or a phase transition.
- **Time-limited gameplay** — No countdown timers, no "you have 10 seconds to respond." The system is turn-based and asynchronous.
- **More than 5 players** — Player count is capped at 5.
- **Gamepiece/Inventory specific actions** - Special actions that occur when a card is played or is in the player's hand (e.g. "if you have a knight card in your hand, you can use it to block an attack") are not supported. 
`.trim();

// ─── Dynamic section builders ────────────────────────────────────────────────

function buildDataSourceSection(): string {
  const sources = getAllDataSources();

  if (sources.length === 0) {
    return `
### Available Live Data Sources

No data sources are currently configured.
    `.trim();
  }

  // Group by source type for clearer presentation
  const blockchain = sources.filter(ds => ds.sourceType === 'blockchain');
  const http = sources.filter(ds => ds.sourceType === 'http');

  const formatEntry = (ds: typeof sources[number]) => {
    const paramNote = ds.params.length > 0
      ? ` Requires: ${ds.params.map(p => p.description).join(', ')}.`
      : ' No parameters needed (global value).';
    return `- **${ds.label}**: ${ds.description}${paramNote} Returns: ${ds.resultType}.`;
  };

  let text = `
### Available Live Data Sources

The following live data can be integrated into games. When a user wants to use
real-world or on-chain data, include the requirement in the spec by describing *what data
is needed and when* (e.g., "fetch the current BTC price at game start", "read the player's
token balance when they join"). Do not reference data source IDs, contract addresses, or
implementation details — discovery handles that.`;

  if (blockchain.length > 0) {
    text += `\n\n**On-Chain Data (Blockchain)**\n${blockchain.map(formatEntry).join('\n\n')}`;
  }

  if (http.length > 0) {
    text += `\n\n**Crypto Market Data (Real-Time)**\nThese provide live cryptocurrency prices and pre-computed deltas from exchanges. ` +
      `The 24-hour change feeds are especially useful for prediction games — they return ` +
      `the price movement over a fixed 24h window in a single read, with no timing exploits.\n\n` +
      `${http.map(formatEntry).join('\n\n')}`;
  }

  // Aggregators section
  const aggregators = getAllAggregators();
  if (aggregators.length > 0) {
    const compatibleIds = getNumericDataSourceIds();
    text += `\n\n**Data Source Aggregators (Composable Read Patterns)**\n` +
      `These aggregators can be combined with any numeric data source listed above to create ` +
      `richer gameplay mechanics without needing additional data sources.\n\n`;
    for (const agg of aggregators) {
      text += `- **${agg.label}** (${agg.id}): ${agg.description} ` +
        `Returns fields: ${agg.resultFields.join(', ')}.\n\n`;
    }
    text += `Compatible data sources: ${compatibleIds.join(', ')}.\n` +
      `\nExample: To track BTC price movement over 30 seconds, the spec should say something like ` +
      `"read the BTC spot price, wait 30 seconds, read again, and determine the direction of movement." ` +
      `The downstream pipeline will map this to the appropriate aggregator.`;
  }

  return text.trim();
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Build the complete platform capabilities text for injection into the
 * design agent's system prompt.
 *
 * Called once at graph creation time (or per-invocation if data sources
 * can change at runtime).
 */
export function buildPlatformCapabilities(): string {
  return `
# PLATFORM CAPABILITIES

This section describes what games on this platform can and cannot do.
Use this to guide design conversations, validate user proposals, and
capture requirements in the specification.

**Important:** The specification should capture *what the user wants*
(requirements) — not *how it will be implemented*. For example, write
"fetch the current TSLA stock price at game start" rather than
specifying contract addresses or API calls. The downstream pipeline
handles implementation details.

${SUPPORTED_CAPABILITIES}

${buildDataSourceSection()}

${LIMITED_CAPABILITIES}

${NOT_SUPPORTED}
  `.trim();
}
