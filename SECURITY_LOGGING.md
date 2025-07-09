# Security Guidelines for Logging

## Core Principle: **Never Log What You Don't Explicitly Know Is Safe**

### ❌ **NEVER Log These:**
- `process.env` (entire object or individual variables)
- User input (messages, usernames, IDs, etc.)
- API responses from external services
- Request bodies or headers
- Database query results
- File contents
- Error details that might contain sensitive data
- Tokens, keys, or secrets of any kind

### ✅ **Safe to Log:**
- Application state changes ("server started", "request received")
- Performance metrics (duration, count, size)
- Configuration status (without values)
- Known safe environment variables (NODE_ENV, PORT)
- Predefined status codes and messages

## Recommended Logging Patterns

### 1. Application Events
```typescript
import { logApplicationEvent } from '#chaincraft/util/safe-logging.js';

// ✅ Good - only safe, known values
logApplicationEvent('web-api', 'server-started', { port: 3000 });
logApplicationEvent('discord-bot', 'command-received', { command: 'chaincraft' });
logApplicationEvent('simulation', 'game-created', { duration: 150 });
```

### 2. Secret Status Checking
```typescript
import { logSecretStatus } from '#chaincraft/util/safe-logging.js';

// ✅ Good - shows if secret is loaded without exposing it
logSecretStatus('DISCORD_BOT_TOKEN', process.env.DISCORD_BOT_TOKEN);
logSecretStatus('OPENAI_API_KEY', process.env.OPENAI_API_KEY);
```

### 3. API Request Logging
```typescript
import { logApiRequest } from '#chaincraft/util/safe-logging.js';

// ✅ Good - sanitized paths, no sensitive data
logApiRequest('POST', '/api/design/conversation/continue', 200, 350);
```

### 4. Error Logging
```typescript
// ✅ Good - generic error info only
console.error('Failed to process request', { 
  errorType: error.constructor.name,
  statusCode: 500 
});

// ❌ Bad - might expose sensitive data
console.error('Failed to process request', error.message);
console.error('Failed to process request', error);
```

## Migration Guide

### Replace Dangerous Patterns:
```typescript
// ❌ Remove these patterns:
console.log('User message:', userMessage);
console.log('API response:', response);
console.log('Environment:', process.env);
console.log('Token:', token);

// ✅ Replace with safe alternatives:
logApplicationEvent('api', 'message-received', { length: userMessage.length });
logApplicationEvent('api', 'external-api-called', { statusCode: response.status });
logSafeEnvironmentInfo();
logSecretStatus('TOKEN', token);
```

## Code Review Checklist

Before committing, check for:
- [ ] No `console.log()` with variables that could contain user input
- [ ] No logging of `process.env.*` values
- [ ] No logging of API responses or request bodies
- [ ] No logging of tokens, keys, or other secrets
- [ ] Use `logApplicationEvent()` for application state
- [ ] Use `logSecretStatus()` for secret availability checks
- [ ] Error messages don't expose sensitive information

## Tools and Automation

### Pre-commit Hook Example:
```bash
#!/bin/bash
# Check for dangerous logging patterns
if git diff --cached --name-only | grep -E '\.(ts|js)$' | xargs grep -l 'console\.log.*process\.env'; then
    echo "ERROR: Found logging of process.env - this could expose secrets!"
    exit 1
fi
```

### ESLint Rule Configuration:
```json
{
  "rules": {
    "no-console": ["error", { "allow": ["warn", "error"] }],
    "no-restricted-syntax": [
      "error",
      {
        "selector": "CallExpression[callee.object.name='console'][arguments.0.type='BinaryExpression']:has([left.object.name='process'][left.property.name='env'])",
        "message": "Never log process.env - it contains secrets!"
      }
    ]
  }
}
```

## Security Incident Response

If secrets are accidentally logged:
1. **Immediately rotate all potentially exposed secrets**
2. **Remove logs from all systems (local, servers, CI/CD)**
3. **Update git history if needed**: `git filter-branch` or BFG Repo-Cleaner
4. **Review and improve logging practices**
5. **Update security guidelines and training**

## Best Practices Summary

1. **Whitelist, Don't Blacklist**: Only log explicitly safe values
2. **Log Metadata, Not Data**: Log counts, sizes, types - not content
3. **Use Structured Logging**: Consistent format makes security review easier
4. **Regular Security Reviews**: Audit logging code for potential exposures
5. **Principle of Least Information**: Log only what's needed for debugging
6. **Assume Everything Is Sensitive**: Better safe than sorry

Remember: **It's better to have insufficient logging than to accidentally expose secrets!**
