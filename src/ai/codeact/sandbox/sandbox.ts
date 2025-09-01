/**
 * GameCodeSandbox manages the execution of AI-generated code in a safe
 * sandbox environment, with controlled access to game functions.
 *
 * This module provides isolation for executing untrusted code while
 * exposing specific game functions through a controlled API surface.
 */

import { FunctionDefinition } from "../function-registry.js";
import { Worker } from "worker_threads";
import * as path from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";

// Get the directory name of the current module
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Options for sandbox execution
 */
export interface SandboxExecutionOptions {
  timeoutMs?: number;
  debugMode?: boolean;
}

/**
 * Result of code execution in the sandbox
 */
export interface SandboxExecutionResult {
  result: any;
  error: string | null;
  executionTime: number;
}

/**
 * Options for creating a new sandbox
 */
export interface SandboxOptions {
  unsafeFunctions?: FunctionDefinition[];
  debugMode?: boolean;
}

/**
 * GameCodeSandbox provides a secure execution environment for AI-generated game code
 */
export class GameCodeSandbox {
  private debugMode: boolean;
  private unsafeFunctions: Map<string, FunctionDefinition> = new Map();
  private worker: Worker;
  private workerReady: boolean = false;
  private pendingPromises: Map<string, { resolve: Function; reject: Function }> = new Map();
  private nextRequestId: number = 1;

  /**
   * Create a new sandbox for executing game code
   * @param options Options for the sandbox including functions and debug mode
   */
  constructor(options: SandboxOptions = {}) {
    this.debugMode = options.debugMode || false;

    // Store unsafe functions for later registration
    if (options.unsafeFunctions) {
      for (const func of options.unsafeFunctions) {
        this.unsafeFunctions.set(func.name, func);
      }
    }

    // Create a worker thread for the sandbox
    const workerPath = path.join(__dirname, 'sandbox-worker.js');
    this.worker = new Worker(workerPath);
    
    // Set up message handling
    this.worker.on('message', this.handleWorkerMessage.bind(this));
    
    // Set up error handling
    this.worker.on('error', (error) => {
      console.error('[GameCodeSandbox] Worker error:', error);
      // Reject any pending promises
      for (const { reject } of this.pendingPromises.values()) {
        reject(error);
      }
      this.pendingPromises.clear();
    });
    
    // Set up exit handling
    this.worker.on('exit', (code) => {
      if (code !== 0) {
        console.error(`[GameCodeSandbox] Worker stopped with exit code ${code}`);
        // Reject any pending promises
        for (const { reject } of this.pendingPromises.values()) {
          reject(new Error(`Worker stopped with exit code ${code}`));
        }
        this.pendingPromises.clear();
      }
    });

    // Initialize worker with all functions at once
    this.initializationPromise = this.initializeWorker(options);
  }

  private initializationPromise: Promise<void>;

  private async initializeWorker(options: SandboxOptions): Promise<void> {
    // Send init message with all unsafe functions
    return new Promise<void>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error('Worker initialization timed out'));
      }, 5000);

      const messageHandler = (message: any) => {
        if (message.type === 'ready') {
          clearTimeout(timeoutId);
          this.workerReady = true;
          this.worker.off('message', messageHandler);
          resolve();
        } else if (message.type === 'error') {
          clearTimeout(timeoutId);
          this.worker.off('message', messageHandler);
          reject(new Error(message.message));
        }
      };

      this.worker.on('message', messageHandler);
      
      // Send init message with unsafe functions
      this.worker.postMessage({
        type: 'init',
        debugMode: this.debugMode,
        unsafeFunctions: options.unsafeFunctions || []
      });
    });
  }

  /**
   * Handle messages from the worker thread
   */
  private handleWorkerMessage(message: any): void {
    if (message.type === 'ready') {
      this.workerReady = true;
      return;
    }

    if (message.type === 'result') {
      const requestId = message.requestId;
      const pendingPromise = this.pendingPromises.get(requestId);
      
      if (pendingPromise) {
        pendingPromise.resolve(message);
        this.pendingPromises.delete(requestId);
      }
      
      return;
    }

    if (message.type === 'error') {
      const requestId = message.requestId;
      const pendingPromise = this.pendingPromises.get(requestId);
      
      if (pendingPromise) {
        pendingPromise.reject(new Error(message.message));
        this.pendingPromises.delete(requestId);
      } else {
        console.error('[GameCodeSandbox] Worker error:', message.message);
      }
      
      return;
    }
  }

  /**
   * Send a message to the worker and optionally wait for a response
   * @param message The message to send to the worker
   * @param waitForResponse Whether to wait for a response (default: true)
   * @returns A promise that resolves with the worker's response, or void if not waiting
   */
  private async sendToWorker(message: any, waitForResponse: boolean = true): Promise<any> {
    await this.initializationPromise;
    
    const requestId = String(this.nextRequestId++);
    message.requestId = requestId;
    
    // If we don't need to wait for a response, just send the message
    if (!waitForResponse) {
      this.worker.postMessage(message);
      return Promise.resolve();
    }
    
    // Otherwise, set up a promise that will be resolved when a response is received
    return new Promise((resolve, reject) => {
      // Set a timeout to reject the promise if no response is received
      const timeoutMs = message.timeoutMs || 5000;
      const timeoutId = setTimeout(() => {
        this.pendingPromises.delete(requestId);
        reject(new Error(`Request timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      
      // When the promise is resolved or rejected, clear the timeout
      const clearTimeoutOnSettled = (fn: Function) => (...args: any[]) => {
        clearTimeout(timeoutId);
        return fn(...args);
      };
      
      this.pendingPromises.set(requestId, {
        resolve: clearTimeoutOnSettled(resolve),
        reject: clearTimeoutOnSettled(reject)
      });
      
      // Send the message to the worker
      this.worker.postMessage(message);
    });
  }

  /**
   * Register an unsafe function that will be wrapped before exposure to the sandbox
   * @param func The function definition including implementation code
   */
  async registerUnsafeFunction(func: FunctionDefinition): Promise<void> {
    // Store the function definition locally
    this.unsafeFunctions.set(func.name, func);

    // Register the function with the worker
    await this.sendToWorker({
      type: 'register',
      function: func,
      debugMode: this.debugMode
    });

    if (this.debugMode) {
      console.log(`[GameCodeSandbox] Registered unsafe function: ${func.name}`);
    }
  }

  /**
   * Execute code in the sandbox with provided arguments
   *
   * @param code The code to execute
   * @param context Additional context to provide to the code
   * @param options Execution options including timeout
   * @returns The result of the execution
   */
  async execute(
    code: string,
    context: Record<string, any> = {},
    options: SandboxExecutionOptions = {}
  ): Promise<SandboxExecutionResult> {
    const startTime = Date.now();
    const timeout = options.timeoutMs || 5000;

    try {
      // Wait for initialization to complete before executing
      await this.initializationPromise;

      if (this.debugMode) {
        console.log(
          `[GameCodeSandbox] Executing code in sandbox with timeout ${timeout}ms`
        );
        console.log(
          `[GameCodeSandbox] Code snippet: ${code.substring(0, 100)}...`
        );
      }

      // Send a message to the worker to execute the code
      const response = await this.sendToWorker(
        {
          type: 'execute',
          code,
          context,
          timeoutMs: timeout
        },
        true // Wait for response
    );

      // Calculate execution time
      const executionTime = Date.now() - startTime;

      if (this.debugMode) {
        console.log(
          `[GameCodeSandbox] Code executed successfully in ${executionTime}ms`
        );
      }

      return {
        result: response.result,
        error: response.error,
        executionTime
      };
    } catch (error) {
      // Calculate execution time even for errors
      const executionTime = Date.now() - startTime;

      if (this.debugMode) {
        console.error(`[GameCodeSandbox] Error executing code: ${error}`);
      }

      return {
        result: null,
        error: error instanceof Error ? error.message : String(error),
        executionTime,
      };
    }
  }

  /**
   * Clean up resources used by the sandbox
   */
  async dispose(): Promise<void> {
    if (this.worker) {
      // Send terminate message to the worker without waiting for a response
      try {
        await this.sendToWorker({ type: 'terminate' }, false);
      } catch (error) {
        // Ignore errors during termination
      }
      
      // Terminate the worker
      await this.worker.terminate();
    }
  }
}
