/**
 * Utility functions for safe logging that prevents accidental exposure of secrets
 */

/**
 * Safely log environment info without exposing secrets
 * Only logs safe, non-sensitive environment variables
 */
export function logSafeEnvironmentInfo() {
  const safeEnvVars = {
    NODE_ENV: process.env.NODE_ENV,
    PORT: process.env.CHAINCRAFT_WEB_API_PORT,
    HOST: process.env.CHAINCRAFT_WEB_API_HOST,
    CHAINCRAFT_WEB_API_PORT: process.env.CHAINCRAFT_WEB_API_PORT,
    // Add other safe environment variables here
  };
  
  console.log("[environment] Safe environment variables:", safeEnvVars);
}

/**
 * Safely log that a secret/token was found without exposing its value
 * @param secretName - Name of the secret (e.g., "DISCORD_BOT_TOKEN")
 * @param value - The secret value
 */
export function logSecretStatus(secretName: string, value: string | undefined) {
  if (value) {
    console.log(`[security] ${secretName}: ✓ loaded (${value.length} chars)`);
  } else {
    console.warn(`[security] ${secretName}: ✗ not found`);
  }
}

/**
 * Redact sensitive information from strings for logging
 * @param text - Text that might contain sensitive info
 * @returns Redacted text safe for logging
 */
export function redactSensitiveInfo(text: string): string {
  return text
    .replace(/sk-[a-zA-Z0-9_-]{48}/g, 'sk-***REDACTED***')  // OpenAI API keys
    .replace(/sk-[a-zA-Z0-9_-]{32,}/g, 'sk-***REDACTED***')  // Other API keys starting with sk-
    .replace(/MTI[a-zA-Z0-9_-]{50,}/g, 'MTI***REDACTED***')  // Discord bot tokens
    .replace(/Bearer [a-zA-Z0-9_-]{20,}/g, 'Bearer ***REDACTED***')  // Bearer tokens
    .replace(/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/g, '***REDACTED-UUID***'); // UUIDs
}

/**
 * Safe console.log that automatically redacts sensitive information
 * @param message - Log message
 * @param args - Additional arguments
 */
export function safeLog(message: string, ...args: any[]) {
  const safeMessage = redactSensitiveInfo(message);
  const safeArgs = args.map(arg => 
    typeof arg === 'string' ? redactSensitiveInfo(arg) : arg
  );
  console.log(safeMessage, ...safeArgs);
}

/**
 * Safe console.debug that automatically redacts sensitive information
 * @param message - Log message
 * @param args - Additional arguments
 */
export function safeDebug(message: string, ...args: any[]) {
  const safeMessage = redactSensitiveInfo(message);
  const safeArgs = args.map(arg => 
    typeof arg === 'string' ? redactSensitiveInfo(arg) : arg
  );
  console.debug(safeMessage, ...safeArgs);
}
