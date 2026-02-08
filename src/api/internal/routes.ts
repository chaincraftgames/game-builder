import { FastifyInstance } from 'fastify';
import { handleCleanup, handleHeapSnapshot } from './handler.js';

export async function registerInternalRoutes(server: FastifyInstance) {
  // Cleanup endpoint - removes old checkpoints
  server.post('/cleanup', handleCleanup);
  
  // Heap snapshot endpoint - for memory profiling
  server.post('/heap-snapshot', handleHeapSnapshot);
}
