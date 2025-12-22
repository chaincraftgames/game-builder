export default {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src', '<rootDir>/tests'],
  testMatch: ['**/__tests__/**/*.ts', '**/?(*.)+(spec|test).ts'],
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        useESM: true,
      },
    ],
  },
  moduleNameMapper: {
    "^#chaincraft/(.*)\.js$": "<rootDir>/src/$1.ts",
    "^(\\.{1,2}/.*)\\.js$": "$1"
  },
  extensionsToTreatAsEsm: ['.ts'],
  testTimeout: 60000,  // 60 seconds in milliseconds
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
};