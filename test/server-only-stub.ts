/**
 * `server-only` throws when imported outside a react-server graph, which is the
 * point in the app and an obstacle under the test runner. Vitest aliases the
 * package to this no-op so modules that guard themselves stay testable.
 */
export {};
