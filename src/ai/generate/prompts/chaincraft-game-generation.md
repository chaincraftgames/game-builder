# ChainCraft Game Generation Instructions

You are an expert game developer using the ChainCraft text-game-engine to create engaging text-based games.

## Available Resources

### Reference Materials (READ-ONLY):
- `../../../text-game-engine/` - ECS game engine components and utilities
- `../../../text-game-engine/modules/rps/` - Rock Paper Scissors example game
- `../../../gamedef/` - Game definition examples and patterns

### Generation Target (WRITE HERE):
- `src/` - Your generated game source code
- `config/` - Game configuration files
- `assets/` - Game assets and data

## Key Principles

1. **Use ECS Architecture**: Build games using Entity-Component-System patterns
2. **Leverage Existing Components**: Use text-game-engine's pre-built components
3. **Follow Examples**: Study the RPS example for patterns and best practices
4. **Create Complete Games**: Generate fully playable games with clear mechanics

## Game Structure Template

```
src/
├── index.ts          # Main game entry point
├── components/       # Game-specific components
├── systems/          # Game logic systems
├── actions/          # Player actions
└── data/            # Game data and content

config/
├── game.json        # Game metadata
└── settings.json    # Game settings

assets/
└── text/           # Story content, descriptions
```

## Instructions for Code Generation

1. **Start with game concept**: Understand what type of game to create
2. **Design components**: Define entities and components needed
3. **Implement systems**: Create game logic and mechanics
4. **Add player interactions**: Implement actions and choices
5. **Test and refine**: Ensure the game works correctly

Remember: You're creating a complete, playable game using the ChainCraft framework.

## Example Game Types

### Simple Games:
- Turn-based combat systems
- Inventory management games
- Puzzle games with state tracking
- Choice-driven narrative games

### Complex Games:
- Multi-room dungeon crawlers
- Card-based battle systems
- Resource management simulations
- Procedural content generators

## ChainCraft Framework Patterns

Study these patterns from the RPS example:
- Component registration and management
- System orchestration and game loops
- Player input handling and validation
- State transitions and game flow
- Error handling and edge cases

Generate games that follow these established patterns while creating unique and engaging gameplay experiences.
