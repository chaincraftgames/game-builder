export default {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
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
    "^#chaincraft/(.*)$.js": "<rootDir>/src/$1.ts"
  },
  extensionsToTreatAsEsm: ['.ts'],
  testTimeout: 60000  // 60 seconds in milliseconds
};