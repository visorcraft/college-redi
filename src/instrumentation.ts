export function register(): void | Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    return import('./instrumentation.node').then((module) => module.register());
  }
}
