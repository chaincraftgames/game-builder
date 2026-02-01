# game-builder

The ChainCraft game builder provides the core game design creation, remixing, and simulation capabilities within the ChainCraft ecosystem.

## Quick Start

### Prerequisites

- Node.js 18+ and npm
- Anthropic API key for running tests

### Installation

```bash
# Install dependencies
npm install

# Build project
npm run build
```

### Environment Setup

1. Copy the example environment file:
   ```bash
   cp .env.example .env
   ```

2. Add your Anthropic API key to `.env`:
   ```bash
   ANTHROPIC_API_KEY=sk-ant-your-actual-api-key-here
   ```

3. Adjust model configurations as needed (defaults are provided)

See [Testing with Secrets Documentation](./docs/TESTING_WITH_SECRETS.md) for detailed setup instructions.

## Running Tests

### Unit Tests (No API Key Required)
```bash
# Run specific test suites
npm run test:generate
npm run test:action-queues
```

### Integration Tests (Requires API Key)

⚠️ **Note**: Integration tests make real API calls and may incur costs.

```bash
# Schema extraction tests
npm run test:sim:schema-extract

# Transitions extraction tests
npm run test:sim:transitions-extract

# Instructions extraction tests  
npm run test:sim:instructions-extract

# Full spec processing pipeline
npm run test:simulation
```

## Documentation

- **[Testing with Secrets](./docs/TESTING_WITH_SECRETS.md)** - How to configure API keys and run integration tests
- **[API Documentation](./API.md)** - API endpoints and usage
- **[Deployment Guide](./DEPLOYMENT.md)** - Production deployment instructions
- **[Instruction Architecture](./docs/INSTRUCTION_ARCHITECTURE.md)** - Game instruction system design

## Project Structure

- `src/ai/design/` - Game design and specification generation
- `src/ai/simulate/` - Game simulation and runtime
- `src/api/` - HTTP API interfaces
- `src/gen/` - Code generation utilities
- `src/integrations/` - External integrations (Discord, etc.)

## Development

### Building

```bash
# Production build
npm run build

# Development build (includes source maps)
npm run build:dev

# Watch mode
npm run watch
```

### Running Locally

```bash
# Start API server
npm start

# Start Discord bot
npm run start:discord
```

## Contributing

Please read our [Contributing License Agreement](./CLA.md) before submitting pull requests.

## Security

See [SECURITY_LOGGING.md](./SECURITY_LOGGING.md) for information about security practices and logging.
