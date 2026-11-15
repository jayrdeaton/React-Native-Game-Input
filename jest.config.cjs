module.exports = require('@infinitetoken/jest-config/react-native')({
  moduleNameMapper: {
    '^react-native$': '<rootDir>/src/__mocks__/react-native.ts'
  },
  overrides: {
    // The default already excludes src/index.ts; the ./tilt subpath's barrel is pure re-exports too.
    collectCoverageFrom: ['src/**/*.{ts,tsx}', '!src/**/*.d.ts', '!src/index.ts', '!src/tilt/index.ts']
  }
})
