import { CompiledStateGraph } from "@langchain/langgraph";
import { LRUCache } from "lru-cache";

interface GameBuilderGraph<T> {
  graph: CompiledStateGraph<T, Partial<T>>;
  gameSpecVersion?: string; // Store spec to detect if we need to rebuild
}

export class GraphCache<T> {
  private cache: LRUCache<string, GameBuilderGraph<T>>;

  constructor(
    private buildGraph: (
      threadId: string
    ) => Promise<CompiledStateGraph<T, Partial<T>>>,
    maxSize: number = 100
  ) {
    this.cache = new LRUCache<string, GameBuilderGraph<T>>({ max: maxSize });
  }

  async getGraph(
    threadId: string,
    gameSpecVersion?: string
  ): Promise<CompiledStateGraph<T, Partial<T>>> {
    const cached = this.cache.get(threadId);

    // Rebuild if not found or spec changed
    if (
      !cached ||
      (gameSpecVersion && cached.gameSpecVersion !== gameSpecVersion)
    ) {
      console.debug('[graph-cache] Building graph for thread %s', threadId);
      const graph = await this.buildGraph(threadId);
      this.cache.set(threadId, { graph, gameSpecVersion });
      return graph;
    }
    console.debug('[graph-cache] Using cached graph for thread %s', threadId);
    return cached.graph;
  }
}
