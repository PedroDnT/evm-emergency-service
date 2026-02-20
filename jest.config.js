module.exports = {
  testEnvironment: "node",
  collectCoverage: true,
  coverageDirectory: "coverage",
  testMatch: ["**/src/**/*.test.js", "**/src/**/*.test.ts"],
  transform: {
    "^.+\\.tsx?$": "ts-jest"
  }
};