# ChainCraft GameBuilder API

This document describes the REST API endpoints for the ChainCraft GameBuilder system, which provides two main services: Design and Simulate.

## Design API

The Design API provides endpoints for creating and managing game design conversations.

### Base URL

```
/api/design
```

### Endpoints

#### Continue Design Conversation

**POST** `/conversation/continue`

Continue an existing design conversation with a user message.

**Request Body:**

```json
{
  "conversationId": "string (required)",
  "userMessage": "string (required, max 2000 chars)",
  "gameDescription": "string (optional)"
}
```

**Response:**

```json
{
  "designResponse": "string",
  "updatedTitle": "string (optional)",
  "systemPromptVersion": "string (optional)",
  "specification": {
    "summary": "string",
    "playerCount": {
      "min": "number",
      "max": "number"
    },
    "designSpecification": "string"
  } // (optional)
}
```

#### Generate Image

**POST** `/conversation/generate-image`

Generate an image for a game design. Supports both legacy cartridge styling and raw images.

**Request Body:**

```json
{
  "conversationId": "string (required)",
  "image_type": "string (optional, default: 'legacy')"
}
```

**Parameters:**

- `conversationId`: The ID of the conversation to generate an image for
- `image_type`: Either `"legacy"` (cartridge styling) or `"raw"` (no cartridge styling)

**Response:**

```json
{
  "imageUrl": "string"
}
```

#### Get Full Specification

**POST** `/conversation/specification`

Retrieve the full game design specification.

**Request Body:**

```json
{
  "conversationId": "string (required)"
}
```

**Response:**

```json
{
  "title": "string",
  "summary": "string",
  "playerCount": {
    "min": "number",
    "max": "number"
  },
  "designSpecification": "string"
}
```

**POST** `/create`

Legacy endpoint for backward compatibility.

**Request Body:**

```json
{
  "description": "string (required, max 2000 chars)"
}
```

**Response:**

```json
{
  "gameDescription": "string"
}
```

## Simulate API

The Simulate API provides endpoints for managing game simulations.

### Base URL

```
/api/simulate
```

### Endpoints

#### Create Simulation

**POST** `/create`

Create a new game simulation.

**Request Body:**

```json
{
  "gameId": "string (required)",
  "gameSpecification": "string (required)",
  "gameSpecificationVersion": "number (required, min 1)"
}
```

**Response:**

```json
{
  "gameRules": "string"
}
```

#### Initialize Simulation

**POST** `/initialize`

Initialize a simulation with players.

**Request Body:**

```json
{
  "gameId": "string (required)",
  "players": ["string (required, min 1 player)"]
}
```

**Response:**

```json
{
  "publicMessage": "string (optional)",
  "playerStates": {
    "playerId": {
      "illegalActionCount": "number",
      "privateMessage": "string (optional)",
      "actionsAllowed": "boolean",
      "actionRequired": "boolean"
    }
  }
}
```

#### Process Action

**POST** `/action`

Process a player action in the simulation.

**Request Body:**

```json
{
  "gameId": "string (required)",
  "playerId": "string (required)",
  "action": "string (required)"
}
```

**Response:**

```json
{
  "publicMessage": "string (optional)",
  "playerStates": {
    "playerId": {
      "illegalActionCount": "number",
      "privateMessage": "string (optional)",
      "actionsAllowed": "boolean",
      "actionRequired": "boolean"
    }
  },
  "gameEnded": "boolean"
}
```

#### Get Simulation State

**POST** `/state`

Get the current state of a simulation.

**Request Body:**

```json
{
  "gameId": "string (required)"
}
```

**Response:**

```json
{
  "publicMessage": "string (optional)",
  "playerStates": {
    "playerId": {
      "illegalActionCount": "number",
      "privateMessage": "string (optional)",
      "actionsAllowed": "boolean",
      "actionRequired": "boolean"
    }
  },
  "gameEnded": "boolean"
}
```

#### Update Simulation

**POST** `/update`

Update a simulation with a new game specification.

**Request Body:**

```json
{
  "gameId": "string (required)",
  "gameSpecification": "string (required)"
}
```

**Response:**

```json
{
  "success": "boolean"
}
```

## Error Responses

All endpoints return appropriate HTTP status codes:

- **200 OK**: Successful request
- **400 Bad Request**: Invalid request parameters
- **404 Not Found**: Resource not found (e.g., conversation or game not found)
- **500 Internal Server Error**: Server error

Error responses have the following format:

```json
{
  "error": "string",
  "details": "object (optional)"
}
```

## Authentication

All API endpoints require authentication via the middleware. The `/health` endpoint is exempted from authentication requirements.

## Usage Examples

### Design Flow Example

1. **Start a conversation:**

   ```bash
   curl -X POST /api/design/conversation/continue \
     -H "Content-Type: application/json" \
     -d '{
       "conversationId": "conv-123",
       "userMessage": "I want to create a card game",
       "gameDescription": "A strategic card game for 2-4 players"
     }'
   ```

2. **Generate an image:**

   ```bash
   # Generate legacy cartridge image
   curl -X POST /api/design/conversation/generate-image \
     -H "Content-Type: application/json" \
     -d '{
       "conversationId": "conv-123",
       "image_type": "legacy"
     }'

   # Generate raw image (no cartridge)
   curl -X POST /api/design/conversation/generate-image \
     -H "Content-Type: application/json" \
     -d '{
       "conversationId": "conv-123",
       "image_type": "raw"
     }'
   ```

3. **Get full specification:**
   ```bash
   curl -X POST /api/design/conversation/specification \
     -H "Content-Type: application/json" \
     -d '{
       "conversationId": "conv-123"
     }'
   ```

### Simulation Flow Example

1. **Create simulation:**

   ```bash
   curl -X POST /api/simulate/create \
     -H "Content-Type: application/json" \
     -d '{
       "gameId": "game-456",
       "gameSpecification": "Card game specification...",
       "gameSpecificationVersion": 1
     }'
   ```

2. **Initialize with players:**

   ```bash
   curl -X POST /api/simulate/initialize \
     -H "Content-Type: application/json" \
     -d '{
       "gameId": "game-456",
       "players": ["player1", "player2"]
     }'
   ```

3. **Process player action:**

   ```bash
   curl -X POST /api/simulate/action \
     -H "Content-Type: application/json" \
     -d '{
       "gameId": "game-456",
       "playerId": "player1",
       "action": "play card hearts_ace"
     }'
   ```

4. **Get game state:**
   ```bash
   curl -X POST /api/simulate/state \
     -H "Content-Type: application/json" \
     -d '{
       "gameId": "game-456"
     }'
   ```
