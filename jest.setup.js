// Silence specific warnings
const originalWarn = console.warn;
console.warn = (...args) => {
  // Add any warning messages you want to ignore
  const ignoredWarnings = [
    "Duplicate atom key",
    "ExperimentalWarning",
    // Add more warning messages to ignore here
  ];

  if (!ignoredWarnings.some((warning) => args[0]?.includes(warning))) {
    originalWarn(...args);
  }
};

// Optional: Silence all warnings
// console.warn = jest.fn();
