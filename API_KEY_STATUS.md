# API Key Environment Status

## Current Situation (2026-02-01T00:34:37)

### What We See
- `COPILOT_AGENT_INJECTED_SECRET_NAMES=ANTHROPIC_API_KEY` (secret is declared)
- But `$ANTHROPIC_API_KEY` is not accessible in bash environment
- Node.js process also cannot access `process.env.ANTHROPIC_API_KEY`

### Verification Steps Taken

1. **Bash shell check**: `env | grep ANTHROPIC` → Only shows injected secret names, not the actual value
2. **Process environment**: `cat /proc/self/environ | tr '\0' '\n' | grep ANTHROPIC` → Same result
3. **Node.js check**: `node -e "console.log(process.env.ANTHROPIC_API_KEY)"` → undefined

### Test Failures

When running `npm run test:sim:schema-extract`:
```
Error: Anthropic API key not found
  at new ChatAnthropicMessages (node_modules/@langchain/anthropic/src/chat_models.ts:927:13)
```

The Anthropic SDK's ChatAnthropic constructor looks for `ANTHROPIC_API_KEY` environment variable and cannot find it.

### Question

The user stated: "The API key should already be configured in your environment. You do not need to put it in the env."

However, the API key is not accessible through:
- Shell environment variables
- Node.js process.env
- .env file (which we were told not to use)

**How should the tests access the API key?**

Possible scenarios:
1. The secret needs special activation/command in Copilot environment
2. Tests need to be run via a special wrapper that injects secrets
3. The secret is available but under a different variable name
4. There's a timing/initialization issue

### What's Working
- ✅ Code compiles successfully
- ✅ Dependencies installed
- ✅ Network access to api.anthropic.com confirmed
- ✅ Model configurations loaded from .env
- ❌ API key not accessible to tests
