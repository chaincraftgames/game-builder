/**
 * Tests for configureDataSources and getConfiguredDataSources
 * in design-workflow.ts, and the API handler/schema layer.
 *
 * These are unit tests that mock the LangGraph checkpoint layer
 * and the conversation-existence check.
 */

import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import { PREDEFINED_DATA_SOURCES, getAllDataSources, getDataSourceById } from "#chaincraft/ai/design/data-sources.js";
import type { DataSourceConfig } from "#chaincraft/ai/design/game-design-state.js";

// ─── Schema-level tests (no mocking needed) ──────────────────────────────────

import {
  ConfigureDataSourcesRequestSchema,
  GetConfiguredDataSourcesRequestSchema,
  DataSourceSummarySchema,
  ListDataSourcesResponseSchema,
} from "#chaincraft/api/design/schemas.js";

describe("Data source API schemas", () => {
  describe("ConfigureDataSourcesRequestSchema", () => {
    it("should accept valid input", () => {
      const result = ConfigureDataSourcesRequestSchema.safeParse({
        conversationId: "conv-123",
        dataSourceIds: ["binance-btc-usd-price", "chainlink-eth-usd"],
      });
      expect(result.success).toBe(true);
    });

    it("should reject empty conversationId", () => {
      const result = ConfigureDataSourcesRequestSchema.safeParse({
        conversationId: "",
        dataSourceIds: ["binance-btc-usd-price"],
      });
      expect(result.success).toBe(false);
    });

    it("should reject empty dataSourceIds array", () => {
      const result = ConfigureDataSourcesRequestSchema.safeParse({
        conversationId: "conv-123",
        dataSourceIds: [],
      });
      expect(result.success).toBe(false);
    });

    it("should reject empty string IDs inside array", () => {
      const result = ConfigureDataSourcesRequestSchema.safeParse({
        conversationId: "conv-123",
        dataSourceIds: [""],
      });
      expect(result.success).toBe(false);
    });
  });

  describe("DataSourceSummarySchema", () => {
    it("should accept valid blockchain summary", () => {
      const result = DataSourceSummarySchema.safeParse({
        id: "chainlink-eth-usd",
        label: "Chainlink ETH/USD",
        description: "Price feed",
        sourceType: "blockchain",
      });
      expect(result.success).toBe(true);
    });

    it("should accept valid http summary", () => {
      const result = DataSourceSummarySchema.safeParse({
        id: "binance-btc-usd-price",
        label: "BTC/USD Spot",
        description: "Binance spot price",
        sourceType: "http",
      });
      expect(result.success).toBe(true);
    });

    it("should reject unknown sourceType", () => {
      const result = DataSourceSummarySchema.safeParse({
        id: "foo",
        label: "Foo",
        description: "Desc",
        sourceType: "websocket",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("ListDataSourcesResponseSchema", () => {
    it("should validate a response built from real data sources", () => {
      const all = getAllDataSources();
      const response = {
        dataSources: all.map((ds) => ({
          id: ds.id,
          label: ds.label,
          description: ds.description,
          sourceType: ds.sourceType,
        })),
      };
      const result = ListDataSourcesResponseSchema.safeParse(response);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.dataSources.length).toBeGreaterThan(0);
      }
    });
  });
});

// ─── Data source registry tests ──────────────────────────────────────────────

describe("Data source registry", () => {
  it("should have Binance data sources", () => {
    expect(getDataSourceById("binance-btc-usd-price")).toBeDefined();
    expect(getDataSourceById("binance-eth-usd-price")).toBeDefined();
    expect(getDataSourceById("binance-btc-24h-change")).toBeDefined();
    expect(getDataSourceById("binance-eth-24h-change")).toBeDefined();
    expect(getDataSourceById("binance-btc-24h-pct")).toBeDefined();
    expect(getDataSourceById("binance-eth-24h-pct")).toBeDefined();
  });

  it("should have Binance kline (1m candle) data sources", () => {
    expect(getDataSourceById("binance-btc-1m-open")).toBeDefined();
    expect(getDataSourceById("binance-btc-1m-close")).toBeDefined();
    expect(getDataSourceById("binance-eth-1m-open")).toBeDefined();
    expect(getDataSourceById("binance-eth-1m-close")).toBeDefined();

    const open = getDataSourceById("binance-btc-1m-open")!;
    expect(open.sourceType).toBe("http");
    expect((open as any).path).toBe("/api/v3/klines");
    expect((open as any).queryParams).toEqual({ symbol: "BTCUSDT", interval: "1m", limit: "1" });
    expect(open.transform).toEqual({ arrayIndex: 0, extractField: "1", coerceNumber: true });

    const close = getDataSourceById("binance-btc-1m-close")!;
    expect(close.transform).toEqual({ arrayIndex: 0, extractField: "4", coerceNumber: true });
  });

  it("should have Chainlink data sources", () => {
    expect(getDataSourceById("chainlink-tsla-usd")).toBeDefined();
    expect(getDataSourceById("chainlink-eth-usd")).toBeDefined();
    expect(getDataSourceById("chainlink-btc-usd")).toBeDefined();
  });

  it("Binance sources should be sourceType http", () => {
    const btc = getDataSourceById("binance-btc-usd-price")!;
    expect(btc.sourceType).toBe("http");
  });

  it("Chainlink sources should be sourceType blockchain", () => {
    const eth = getDataSourceById("chainlink-eth-usd")!;
    expect(eth.sourceType).toBe("blockchain");
  });

  it("should return undefined for unknown IDs", () => {
    expect(getDataSourceById("nonexistent")).toBeUndefined();
  });

  it("getAllDataSources should return all registered entries", () => {
    const all = getAllDataSources();
    const keys = Object.keys(PREDEFINED_DATA_SOURCES);
    expect(all.length).toBe(keys.length);
  });
});

// ─── Workflow-level tests (mock LangGraph) ───────────────────────────────────

// We mock the design-workflow module's dependencies so we can test
// configureDataSources without a running LangGraph server.

// Mock the graph cache and conversation check
const mockUpdateState = jest.fn<() => Promise<any>>().mockResolvedValue({});
const mockGetState = jest.fn<() => Promise<any>>().mockResolvedValue({ values: {} });
const mockStream = jest.fn<() => Promise<any>>();
const mockGraph = { updateState: mockUpdateState, getState: mockGetState, stream: mockStream };

jest.unstable_mockModule("#chaincraft/ai/graph-cache.js", () => ({
  GraphCache: jest.fn().mockImplementation(() => ({
    getGraph: jest.fn().mockResolvedValue(mockGraph),
  })),
}));

jest.unstable_mockModule("#chaincraft/ai/conversation.js", () => ({
  isActiveConversation: jest.fn<() => Promise<boolean>>().mockResolvedValue(true),
  registerConversationId: jest.fn(),
}));

jest.unstable_mockModule("#chaincraft/ai/memory/checkpoint-memory.js", () => ({
  getSaver: jest.fn().mockResolvedValue({}),
}));

jest.unstable_mockModule("#chaincraft/config.js", () => ({
  getConfig: jest.fn().mockReturnValue("test-design"),
}));

jest.unstable_mockModule("#chaincraft/util/safe-logging.js", () => ({
  logApplicationEvent: jest.fn(),
  logSecretStatus: jest.fn(),
}));

jest.unstable_mockModule("#chaincraft/ai/design/graphs/main-design-graph/index.js", () => ({
  createMainDesignGraph: jest.fn().mockResolvedValue(mockGraph),
}));

jest.unstable_mockModule("#chaincraft/ai/image-gen/image-gen-service.js", () => ({
  generateImageWithDescription: jest.fn(),
  CARTRIDGE_IMAGE_CONFIG: {},
  RAW_IMAGE_CONFIG: {},
}));

describe("configureDataSources (workflow)", () => {
  let configureDataSources: typeof import("#chaincraft/ai/design/design-workflow.js").configureDataSources;
  let isActiveConversation: jest.MockedFunction<() => Promise<boolean>>;

  beforeEach(async () => {
    jest.clearAllMocks();
    const workflow = await import("#chaincraft/ai/design/design-workflow.js");
    configureDataSources = workflow.configureDataSources;
    const convModule = await import("#chaincraft/ai/conversation.js");
    isActiveConversation = convModule.isActiveConversation as any;
  });

  it("should resolve valid IDs and call updateState", async () => {
    const ids = ["binance-btc-usd-price", "chainlink-eth-usd"];
    const result = await configureDataSources("conv-123", ids);

    expect(result).toHaveLength(2);
    expect(result[0].id).toBe("binance-btc-usd-price");
    expect(result[1].id).toBe("chainlink-eth-usd");

    expect(mockUpdateState).toHaveBeenCalledTimes(1);
    const [_config, values] = mockUpdateState.mock.calls[0] as [any, any];
    expect(values.dataSources).toHaveLength(2);
  });

  it("should throw on unknown data source IDs", async () => {
    await expect(
      configureDataSources("conv-123", ["nonexistent-id"]),
    ).rejects.toThrow("Unknown data source ID(s): nonexistent-id");
  });

  it("should throw when conversation not found", async () => {
    isActiveConversation.mockResolvedValueOnce(false);
    await expect(
      configureDataSources("missing-conv", ["binance-btc-usd-price"]),
    ).rejects.toThrow("not found");
  });

  it("should report all unknown IDs at once", async () => {
    await expect(
      configureDataSources("conv-123", ["bad-1", "bad-2"]),
    ).rejects.toThrow("Unknown data source ID(s): bad-1, bad-2");
  });
});

// ─── Auto-inject tests ──────────────────────────────────────────────────────

describe("continueDesignConversation auto-inject", () => {
  let continueDesignConversation: typeof import("#chaincraft/ai/design/design-workflow.js").continueDesignConversation;

  beforeEach(async () => {
    jest.clearAllMocks();

    // Default: getState returns empty dataSources → triggers auto-inject
    mockGetState.mockResolvedValue({ values: { dataSources: [] } });

    // stream returns an async iterable that yields one AI message
    const fakeMessage = {
      content: "Hello!",
      constructor: { name: "AIMessage" },
    };
    const fakeIterable = {
      async *[Symbol.asyncIterator]() {
        yield { messages: [fakeMessage] };
      },
    };
    mockStream.mockResolvedValue(fakeIterable);

    const workflow = await import("#chaincraft/ai/design/design-workflow.js");
    continueDesignConversation = workflow.continueDesignConversation;
  });

  it("should auto-inject all predefined data sources when dataSources is empty", async () => {
    mockGetState.mockResolvedValue({ values: { dataSources: [] } });

    await continueDesignConversation("conv-inject-1", "Hello");

    // updateState should have been called with all data sources
    expect(mockUpdateState).toHaveBeenCalledTimes(1);
    const [_config, values] = mockUpdateState.mock.calls[0] as [any, any];
    expect(values.dataSources).toBeDefined();
    expect(values.dataSources.length).toBeGreaterThan(0);

    // Verify it includes both blockchain and http sources
    const sourceTypes = new Set(values.dataSources.map((ds: any) => ds.sourceType));
    expect(sourceTypes.has("blockchain")).toBe(true);
    expect(sourceTypes.has("http")).toBe(true);
  });

  it("should auto-inject when dataSources is undefined (legacy checkpoint)", async () => {
    mockGetState.mockResolvedValue({ values: {} }); // no dataSources key

    await continueDesignConversation("conv-inject-2", "Hello");

    expect(mockUpdateState).toHaveBeenCalledTimes(1);
    const [_config, values] = mockUpdateState.mock.calls[0] as [any, any];
    expect(values.dataSources.length).toBeGreaterThan(0);
  });

  it("should NOT auto-inject when dataSources is already populated", async () => {
    const existingSources = [getAllDataSources()[0]]; // at least one source
    mockGetState.mockResolvedValue({ values: { dataSources: existingSources } });

    await continueDesignConversation("conv-inject-3", "Hello");

    // updateState should NOT have been called
    expect(mockUpdateState).not.toHaveBeenCalled();
  });

  it("should not fail the conversation if auto-inject throws", async () => {
    mockGetState.mockRejectedValue(new Error("checkpoint broken"));

    // Should still succeed — auto-inject failure is non-fatal
    const response = await continueDesignConversation("conv-inject-4", "Hello");
    expect(response.designResponse).toBeTruthy();
  });
});
