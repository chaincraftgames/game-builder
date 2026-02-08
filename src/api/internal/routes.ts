import { FastifyInstance } from 'fastify';
import { handleCleanup, handleHeapSnapshot, handleMemoryStats } from './handler.js';

export async function registerInternalRoutes(server: FastifyInstance) {
  // Cleanup endpoint - removes old checkpoints
  server.post('/cleanup', handleCleanup);
  
  // Heap snapshot endpoint - for memory profiling
  server.post('/heap-snapshot', handleHeapSnapshot);
  
  // Memory stats endpoint - returns memory usage breakdown
  server.get('/memory-stats', handleMemoryStats);
}
