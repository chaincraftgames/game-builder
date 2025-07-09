/**
 * Utility functions for safe logging that prevents accidental exposure of secrets
 * 
 * SECURITY PRINCIPLE: Never log user input, environment variables, or potentially sensitive data.
 * Only log explicitly whitelisted, known-safe values.
 */

/**
 * Safely log environment info without exposing secrets
 * Only logs explicitly whitelisted, non-sensitive environment variables
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
 * Log application events with only safe, known values
 * Use this for logging application state, not user input or external data
 * @param component - Component name (e.g., "web-api", "discord-bot")
 * @param event - Event name (e.g., "started", "error", "request-received")
 * @param details - Only log known-safe details (numbers, booleans, predefined strings)
 */
export function logApplicationEvent(component: string, event: string, details?: Record<string, string | number | boolean>) {
  const logEntry = {
    component,
    event,
    timestamp: new Date().toISOString(),
    ...details
  };
  console.log(`[${component}] ${event}`, logEntry);
}

/**
 * Log API requests safely without exposing sensitive data
 * @param method - HTTP method
 * @param path - Request path (sanitized)
 * @param statusCode - Response status code
 * @param duration - Request duration in ms
 */
export function logApiRequest(method: string, path: string, statusCode: number, duration: number) {
  // Only log the path structure, not query parameters or IDs that might be sensitive
  const safePath = path.replace(/\/[a-f0-9-]{36}/g, '/{uuid}').replace(/\/\d+/g, '/{id}');
  console.log(`[api] ${method} ${safePath} ${statusCode} ${duration}ms`);
}

/**
 * DEPRECATED: Don't use this. It creates false security.
 * Instead, only log explicitly safe values using logApplicationEvent()
 * 
 * @deprecated Use logApplicationEvent() with known-safe values instead
 */
export function redactSensitiveInfo(text: string): string {
  console.warn("DEPRECATED: redactSensitiveInfo() creates false security. Use logApplicationEvent() instead.");
  return text
    .replace(/sk-[a-zA-Z0-9_-]{48}/g, 'sk-***REDACTED***')  // OpenAI API keys
    .replace(/sk-[a-zA-Z0-9_-]{32,}/g, 'sk-***REDACTED***')  // Other API keys starting with sk-
    .replace(/MTI[a-zA-Z0-9_-]{50,}/g, 'MTI***REDACTED***')  // Discord bot tokens
    .replace(/Bearer [a-zA-Z0-9_-]{20,}/g, 'Bearer ***REDACTED***')  // Bearer tokens
    .replace(/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/g, '***REDACTED-UUID***'); // UUIDs
}

/**
 * DEPRECATED: Don't use this. It creates false security.
 * Instead, only log explicitly safe values using logApplicationEvent()
 * 
 * @deprecated Use logApplicationEvent() with known-safe values instead
 */
export function safeLog(message: string, ...args: any[]) {
  console.warn("DEPRECATED: safeLog() creates false security. Use logApplicationEvent() instead.");
  const safeMessage = redactSensitiveInfo(message);
  const safeArgs = args.map(arg => 
    typeof arg === 'string' ? redactSensitiveInfo(arg) : arg
  );
  console.log(safeMessage, ...safeArgs);
}

/**
 * DEPRECATED: Don't use this. It creates false security.
 * Instead, only log explicitly safe values using logApplicationEvent()
 * 
 * @deprecated Use logApplicationEvent() with known-safe values instead
 */
export function safeDebug(message: string, ...args: any[]) {
  console.warn("DEPRECATED: safeDebug() creates false security. Use logApplicationEvent() instead.");
  const safeMessage = redactSensitiveInfo(message);
  const safeArgs = args.map(arg => 
    typeof arg === 'string' ? redactSensitiveInfo(arg) : arg
  );
  console.debug(safeMessage, ...safeArgs);
}
