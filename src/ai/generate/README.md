# ChainCraft AI Game Generation

This directory contains tools for AI-powered game generation using OpenSWE in local mode.

## Setup

Run the setup script once to configure OpenSWE and the generated-games directory:

```bash
cd game-builder/src/ai/generate/scripts
./setup-openswe.sh
```

This will:
- Clone and build OpenSWE in local mode
- Configure the generated-games directory with proper instructions
- Set up all necessary dependencies

## Usage

### 1. Start in the Generated Games Directory

```bash
cd generated-games
```

### 2. Run OpenSWE with Game Generation Instructions

```bash
node ../open-swe/apps/cli/dist/index.js
```

This will:
- Start OpenSWE in local mode (no GitHub integration)
- Use the embedded prompts in `.openswe/instructions/`
- Generate games using the text-game-engine patterns
- Keep all output private in the `generated-games` directory

### 3. Game Generation Flow

When OpenSWE starts, you can request game generation like:

> "Create a simple turn-based RPG combat game using the ChainCraft text-game-engine. The game should have heroes, monsters, and basic attack mechanics."

OpenSWE will:
1. Read the ChainCraft game generation instructions
2. Analyze the text-game-engine reference implementation
3. Generate a complete game following ECS patterns
4. Create all necessary files in the current directory

## Directory Structure

```
generated-games/
├── .openswe/
│   └── instructions/           # OpenSWE configuration
│       ├── project-context.md  # ChainCraft architecture overview
│       └── prompts.md          # Game generation instructions
├── .gitignore                  # Keeps generated content private
└── README.md                   # Usage instructions
```

## Generated Game Structure

Each generated game will follow the ChainCraft patterns:

```
my-game/
├── package.json               # Game dependencies
├── tsconfig.json             # TypeScript configuration
├── src/
│   ├── index.ts              # Game entry point
│   ├── components/           # ECS components
│   ├── systems/              # Game logic systems
│   └── game.ts               # Main game orchestration
└── README.md                 # Game documentation
```

## Development Workflow

1. Generate games in `generated-games/`
2. Test and iterate on generated code
3. Extract successful patterns back to text-game-engine
4. Use learnings to improve generation prompts

## Notes

- All generated content stays in `generated-games/` and is git-ignored
- OpenSWE runs completely locally - no GitHub integration
- Generated games use text-game-engine as a dependency
- Focus on ECS patterns and component composition over custom functions
  - Code generation best practices

### Tools (`tools/`)
- Future home for custom tools and utilities
- Code analysis tools
- Template generators
- Validation scripts

## Usage

### Initial Setup
```bash
# Run from workspace root
./game-builder/src/ai/generate/scripts/setup-openswe.sh
```

### Game Generation Workflow
1. **Configure API Keys**: Add to `open-swe/apps/cli/.env`
2. **Start OpenSWE CLI**: `cd open-swe/apps/cli && corepack yarn cli`
3. **Generate Games**: Use prompts from `prompts/` directory
4. **Output Location**: Games generate in `generated-games/`

## Integration Points

### With OpenSWE
- Prompts copied to OpenSWE CLI during setup
- Local mode configured for private generation
- References ChainCraft framework patterns

### With ChainCraft Framework
- Reads from `text-game-engine/` for reference patterns
- Studies `gamedef/` for game definition examples
- Generates using established ECS patterns

### With GameBuilder Service
- Scripts can be called from GameBuilder workflows
- Prompts can be programmatically loaded
- Generated games integrate with build pipeline

## Future Enhancements

### Planned Tools
- **Game Template Generator**: Create boilerplate from patterns
- **Code Validator**: Verify generated games follow conventions
- **Asset Manager**: Handle game assets and content
- **Test Generator**: Create automated tests for generated games

### Integration Improvements
- API endpoints for programmatic game generation
- Real-time generation status tracking
- Custom prompt management interface
- Generated game deployment automation

## Development Guidelines

### Adding New Prompts
1. Create `.md` files in `prompts/` directory
2. Follow existing prompt structure and patterns
3. Include clear instructions and examples
4. Reference ChainCraft framework components

### Adding New Scripts
1. Create executable scripts in `scripts/` directory
2. Include proper error handling and logging
3. Document usage and requirements
4. Test from workspace root

### Adding New Tools
1. Create tools in `tools/` directory
2. Include README for each tool
3. Follow TypeScript/Node.js conventions
4. Include tests and documentation
