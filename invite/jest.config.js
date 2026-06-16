module.exports = {
  testEnvironment: 'jsdom',
  testMatch: ['**/__tests__/**/*.test.js'],
  collectCoverageFrom: [
    'ExclusivePersonaSystem.js',
    'ExclusiveAvatarRevealFlow.js'
  ],
  coveragePathIgnorePatterns: [
    '/node_modules/',
    '/__tests__/'
  ],
  verbose: true,
  testTimeout: 10000
};
