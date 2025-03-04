declare global {
  namespace NodeJS {
    interface ProcessEnv {
      CHAINCRAFT_GAMEBUILDER_API_KEY: string;
      GAME_DESIGN_MODEL_NAME: string;
    }
  }
}

export {};
