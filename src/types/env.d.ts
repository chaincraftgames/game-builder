declare global {
  namespace NodeJS {
    interface ProcessEnv {
      CHAINCRAFT_GAMEBUILDER_API_KEY: string;
      CHAINCRAFT_GAME_DESIGN_MODEL_NAME: string;
      CHAINCRAFT_SIMULATION_MODEL_NAME: string;
      CHAINCRAFT_DEV_COMMAND_NAME: string;
      CHAINCRAFT_COMMAND_NAME: string;
      CHAINCRAFT_DEV_DISCORD_BOT_TOKEN: string;
      CHAINCRAFT_DISCORD_BOT_TOKEN: string;
    }
  }
}

export {};
