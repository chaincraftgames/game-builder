import { FastifyInstance } from 'fastify';
import { handleCleanup, handleHeapSnapshot, handleMemoryStats, handleDbStats } from './handler.js';

export async function registerInternalRoutes(server: FastifyInstance) {
  // Cleanup endpoint - removes old checkpoints
  server.post('/cleanup', handleCleanup);
  
  // Heap snapshot endpoint - for memory profiling
  server.post('/heap-snapshot', handleHeapSnapshot);
  
  // Memory stats endpoint - returns memory usage breakdown
  server.get('/memory-stats', handleMemoryStats);
  
  // Database stats endpoint - returns checkpoint storage statistics
  server.get('/db-stats', handleDbStats);
}
