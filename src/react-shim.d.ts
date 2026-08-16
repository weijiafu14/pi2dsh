// Minimal ambient shape for the browser half. React resolves through DSH's
// client module table at runtime and is deliberately not a dependency of this
// package, so the compiler is given exactly the surface `client.ts` uses.
declare module 'react' {
  export function createElement(type: unknown, props?: unknown, ...children: unknown[]): unknown
  export function useState<T>(initial: T | (() => T)): [T, (next: T | ((previous: T) => T)) => void]
  export function useEffect(effect: () => void | (() => void), deps?: readonly unknown[]): void
}
