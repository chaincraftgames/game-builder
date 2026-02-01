# Testing with Secrets in GitHub Copilot Environment

This document explains how to configure and use secrets when running integration tests in the GitHub Copilot agent environment.

## Overview

The game-builder project requires API keys for LLM services (Anthropic Claude) to run integration tests. This guide covers how to properly set up and access these secrets.

## GitHub Copilot Secret Injection

### How Copilot Injects Secrets

GitHub Copilot can inject secrets into the agent environment. When properly configured, you'll see:

```bash
COPILOT_AGENT_INJECTED_SECRET_NAMES=ANTHROPIC_API_KEY
```

This environment variable indicates which secrets have been configured for injection.

### Current Limitation

**Important**: As of the current Copilot agent implementation, injected secrets listed in `COPILOT_AGENT_INJECTED_SECRET_NAMES` may not be directly accessible as environment variables in all contexts (bash, Node.js, etc.).

## Configuring Secrets for Copilot

### For Repository Administrators

1. **Add Secret to Repository**
   - Navigate to your repository settings
   - Go to: Settings → Secrets and variables → Codespaces → Repository secrets
   - Click "New repository secret"
   - Name: `ANTHROPIC_API_KEY`
   - Value: Your Anthropic API key
   - Click "Add secret"

2. **Verify Secret is Available to Copilot**
   - The secret should appear in `COPILOT_AGENT_INJECTED_SECRET_NAMES` when the agent runs
   - Check with: `echo $COPILOT_AGENT_INJECTED_SECRET_NAMES`

### Alternative: Using .env File (Local Development)

For local development and testing, you can use a `.env` file:

1. **Create .env File**
   ```bash
   cp .env.example .env
   ```

2. **Add Your API Key**
   Edit `.env` and replace placeholder values:
   ```bash
   ANTHROPIC_API_KEY=sk-ant-your-actual-api-key-here
   
   # Model configurations
   LATEST_SONNET_MODEL=claude-sonnet-4-5-20250929
   LATEST_HAIKU_MODEL=claude-haiku-4-5-20251001
   HAIKU_3_5_MODEL=claude-3-5-haiku-20241022
   
   CHAINCRAFT_SIM_SCHEMA_EXTRACTION_MODEL=${LATEST_SONNET_MODEL}
   CHAINCRAFT_SPEC_TRANSITIONS_MODEL=${LATEST_SONNET_MODEL}
   CHAINCRAFT_SIM_INSTRUCTIONS_MODEL=${LATEST_SONNET_MODEL}
   ```

3. **Security**: Never commit `.env` file
   - The `.env` file is already in `.gitignore`
   - Never commit actual API keys to the repository

## Running Integration Tests

### Prerequisites

1. **Install Dependencies**
   ```bash
   npm install
   ```

2. **Build Project**
   ```bash
   npm run build
   ```

### Running Tests

#### Schema Extraction Tests
Tests the planner-only schema extraction (no JSON Schema conversion):
```bash
npm run test:sim:schema-extract
```

Expected duration: 60-120 seconds (includes LLM API calls)

#### Transitions Extraction Tests
Tests that transitions work with planner schema format:
```bash
npm run test:sim:transitions-extract
```

Expected duration: 90-180 seconds

#### Instructions Extraction Tests
Tests that instructions work with planner schema:
```bash
npm run test:sim:instructions-extract
```

Expected duration: 120-240 seconds

#### Full Spec Processing Pipeline
Tests complete pipeline (schema → transitions → instructions):
```bash
node --experimental-vm-modules node_modules/jest/bin/jest.js \
  src/ai/simulate/__tests__/spec-processing-graph.test.ts
```

Expected duration: 180-360 seconds

### Test Requirements

All integration tests require:
- ✅ Valid `ANTHROPIC_API_KEY` environment variable
- ✅ Network access to `api.anthropic.com`
- ✅ Model configuration environment variables (from `.env`)

## Troubleshooting

### Error: "Anthropic API key not found"

**Symptoms:**
```
Error: Anthropic API key not found
  at new ChatAnthropicMessages
```

**Solutions:**

1. **Check if API key is accessible:**
   ```bash
   # In bash:
   echo $ANTHROPIC_API_KEY
   
   # In Node.js:
   node -e "console.log(process.env.ANTHROPIC_API_KEY)"
   ```

2. **If using Copilot:** Verify the secret is configured in repository settings

3. **If using .env:** Ensure the `.env` file exists and contains the API key

4. **Export directly (temporary workaround):**
   ```bash
   export ANTHROPIC_API_KEY="your-api-key-here"
   npm run test:sim:schema-extract
   ```

### Error: "Model name must be provided"

**Symptoms:**
```
Error: Model name must be provided either through options or environment variables
```

**Solution:**
Ensure your `.env` file has model configuration:
```bash
LATEST_SONNET_MODEL=claude-sonnet-4-5-20250929
CHAINCRAFT_SIM_SCHEMA_EXTRACTION_MODEL=${LATEST_SONNET_MODEL}
```

### Network Error: "getaddrinfo ENOTFOUND api.anthropic.com"

**Symptoms:**
```
Error: Connection error
  Cause: getaddrinfo ENOTFOUND api.anthropic.com
```

**Solution:**
Network access to `api.anthropic.com` may be blocked. Check:
1. Firewall settings
2. VPN configuration
3. Corporate proxy settings

For Copilot environment: Ensure `api.anthropic.com` is on the allow list

## Best Practices

### Security

1. **Never commit secrets** to the repository
2. **Use .env for local development only**
3. **Use GitHub Secrets** for CI/CD and Copilot environments
4. **Rotate API keys** regularly
5. **Use minimal permissions** for API keys

### Testing

1. **Run tests sequentially** when using API limits
2. **Use timeouts appropriately** (LLM calls can take 30-120s)
3. **Check costs** - Each test run makes multiple API calls
4. **Cache test artifacts** when possible

### Code Reviews

When reviewing PRs with test changes:
1. Verify tests work without requiring secrets in code
2. Check that `.env.example` is updated if needed
3. Ensure documentation reflects any new requirements

## Environment Variables Reference

### Required for All Tests
- `ANTHROPIC_API_KEY` - Your Anthropic API key

### Model Configuration (optional, uses defaults if not set)
- `LATEST_SONNET_MODEL` - Latest Sonnet model name
- `LATEST_HAIKU_MODEL` - Latest Haiku model name
- `CHAINCRAFT_SIM_SCHEMA_EXTRACTION_MODEL` - Model for schema extraction
- `CHAINCRAFT_SPEC_TRANSITIONS_MODEL` - Model for transitions
- `CHAINCRAFT_SIM_INSTRUCTIONS_MODEL` - Model for instructions

### Optional
- `LANGSMITH_TRACING` - Enable/disable LangSmith tracing (default: false)
- `LANGSMITH_API_KEY` - LangSmith API key if tracing enabled

## Additional Resources

- [Anthropic API Documentation](https://docs.anthropic.com/)
- [GitHub Secrets Documentation](https://docs.github.com/en/actions/security-guides/encrypted-secrets)
- [LangChain Environment Variables](https://js.langchain.com/docs/guides/development/environment_variables)

## Support

If you encounter issues with secret configuration or test execution:

1. Check this documentation first
2. Review the troubleshooting section
3. Check `API_KEY_STATUS.md` for detailed diagnostics
4. Open an issue with the `testing` label
