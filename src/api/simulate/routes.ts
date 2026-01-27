import { FastifyInstance } from "fastify";
import {
  handleCreateSimulation,
  handleInitializeSimulation,
  handleProcessAction,
  handleGetSimulationState,
} from "./handler.js";
import {
  CreateSimulationRequestSchema,
  CreateSimulationResponseSchema,
  InitializeSimulationRequestSchema,
  InitializeSimulationResponseSchema,
  ProcessActionRequestSchema,
  ProcessActionResponseSchema,
  GetSimulationStateRequestSchema,
  GetSimulationStateResponseSchema,
} from "#chaincraft/api/simulate/schemas.js";
import { zodToJsonSchema } from "zod-to-json-schema";

export async function registerSimulateRoutes(server: FastifyInstance) {
  // Create simulation
  server.post("/create", {
    schema: {
      body: zodToJsonSchema(
        CreateSimulationRequestSchema,
        "createSimulationRequest"
      ),
      response: {
        200: zodToJsonSchema(
          CreateSimulationResponseSchema,
          "createSimulationResponse"
        ),
      },
    },
    handler: handleCreateSimulation,
  });

  // Initialize simulation
  server.post("/initialize", {
    schema: {
      body: zodToJsonSchema(
        InitializeSimulationRequestSchema,
        "initializeSimulationRequest"
      ),
      response: {
        200: zodToJsonSchema(
          InitializeSimulationResponseSchema,
          "initializeSimulationResponse"
        ),
      },
    },
    handler: handleInitializeSimulation,
  });

  // Process action
  server.post("/action", {
    schema: {
      body: zodToJsonSchema(ProcessActionRequestSchema, "processActionRequest"),
      response: {
        200: zodToJsonSchema(
          ProcessActionResponseSchema,
          "processActionResponse"
        ),
      },
    },
    handler: handleProcessAction,
  });

  // Get simulation state
  server.post("/state", {
    schema: {
      body: zodToJsonSchema(
        GetSimulationStateRequestSchema,
        "getSimulationStateRequest"
      ),
      response: {
        200: zodToJsonSchema(
          GetSimulationStateResponseSchema,
          "getSimulationStateResponse"
        ),
      },
    },
    handler: handleGetSimulationState,
  });
}
