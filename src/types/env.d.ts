declare global {
  namespace NodeJS {
    interface ProcessEnv {
      CHAINCRAFT_GAMEBUILDER_API_KEY: string;
      CHAINCRAFT_GAME_DESIGN_MODEL_NAME: string;
      CHAINCRAFT_SIMULATION_MODEL_NAME: string;
    }
  }
}

export {};
