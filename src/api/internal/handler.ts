import { FastifyRequest, FastifyReply } from 'fastify';
import { writeHeapSnapshot } from 'v8';
import { createReadStream } from 'fs';
import { unlink } from 'fs/promises';
import { cleanup } from '#chaincraft/ai/memory/checkpoint-memory.js';
import { getConfig } from '#chaincraft/config.js';

/**
 * Authenticate internal API requests using X-Internal-Token header
 */
function authenticateInternal(request: FastifyRequest, reply: FastifyReply): boolean {
  const token = request.headers['x-internal-token'];
  const expectedToken = process.env.CHAINCRAFT_GAMEBUILDER_INTERNAL_API_TOKEN;
  
  if (!expectedToken) {
    reply.code(500).send({ error: 'CHAINCRAFT_GAMEBUILDER_INTERNAL_API_TOKEN not configured' });
    return false;
  }
  
  if (token !== expectedToken) {
    reply.code(401).send({ error: 'Unauthorized' });
    return false;
  }
  
  return true;
}

/**
 * Cleanup endpoint - removes old checkpoint threads
 * POST /internal/cleanup
 */
export async function handleCleanup(
  request: FastifyRequest,
  reply: FastifyReply
) {
  if (!authenticateInternal(request, reply)) return;

  const startTime = Date.now();
  
  try {
    // Clean up simulation threads older than 7 days (only if game ended)
    const simGraphType = getConfig('simulation-graph-type');
    await cleanup(simGraphType, 7);
    
    const duration = Date.now() - startTime;
    
    return {
      status: 'completed',
      duration,
      cleanedTypes: [simGraphType]
    };
  } catch (error) {
    console.error('[internal/cleanup] Error during cleanup:', error);
    reply.code(500);
    return {
      error: 'Cleanup failed',
      message: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

/**
 * Heap snapshot endpoint - generates and downloads a V8 heap snapshot
 * POST /internal/heap-snapshot
 */
export async function handleHeapSnapshot(
  request: FastifyRequest,
  reply: FastifyReply
) {
  if (!authenticateInternal(request, reply)) return;

  let filename: string | undefined;
  
  try {
    // Write heap snapshot to /tmp (Railway has ephemeral storage)
    const timestamp = Date.now();
    filename = `/tmp/heap-${timestamp}.heapsnapshot`;
    
    console.log(`[internal/heap-snapshot] Generating heap snapshot: ${filename}`);
    writeHeapSnapshot(filename);
    
    // Set response headers for file download
    const downloadName = `heap-${timestamp}.heapsnapshot`;
    reply.type('application/octet-stream');
    reply.header('Content-Disposition', `attachment; filename="${downloadName}"`);
    
    // Stream the file back
    const stream = createReadStream(filename);
    
    // Clean up file after streaming
    stream.on('end', async () => {
      if (filename) {
        try {
          await unlink(filename);
          console.log(`[internal/heap-snapshot] Cleaned up temp file: ${filename}`);
        } catch (err) {
          console.error(`[internal/heap-snapshot] Failed to clean up temp file:`, err);
        }
      }
    });
    
    return reply.send(stream);
  } catch (error) {
    console.error('[internal/heap-snapshot] Error generating heap snapshot:', error);
    
    // Try to clean up file if it was created
    if (filename) {
      try {
        await unlink(filename);
      } catch (err) {
        // Ignore cleanup errors
      }
    }
    
    reply.code(500);
    return {
      error: 'Failed to generate heap snapshot',
      message: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

/**
 * Memory stats endpoint - returns detailed memory usage breakdown
 * GET /internal/memory-stats
 */
export async function handleMemoryStats(
  request: FastifyRequest,
  reply: FastifyReply
) {
  if (!authenticateInternal(request, reply)) return;

  const usage = process.memoryUsage();
  
  return {
    rss: {
      bytes: usage.rss,
      mb: Math.round(usage.rss / 1024 / 1024),
      description: 'Total memory (Resident Set Size) - includes all memory used by the process'
    },
    heapTotal: {
      bytes: usage.heapTotal,
      mb: Math.round(usage.heapTotal / 1024 / 1024),
      description: 'Total size of the allocated V8 heap'
    },
    heapUsed: {
      bytes: usage.heapUsed,
      mb: Math.round(usage.heapUsed / 1024 / 1024),
      description: 'Actual memory used in the V8 heap (JavaScript objects)'
    },
    external: {
      bytes: usage.external,
      mb: Math.round(usage.external / 1024 / 1024),
      description: 'Memory used by C++ objects bound to JavaScript (e.g., Buffers, native modules)'
    },
    arrayBuffers: {
      bytes: usage.arrayBuffers,
      mb: Math.round(usage.arrayBuffers / 1024 / 1024),
      description: 'Memory allocated for ArrayBuffers and SharedArrayBuffers'
    },
    unaccounted: {
      mb: Math.round((usage.rss - usage.heapTotal - usage.external) / 1024 / 1024),
      description: 'Memory not in heap or external (native modules, V8 internals, etc.)'
    }
  };
}
