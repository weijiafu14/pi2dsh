// A deliberately small ledger with ONE planted type error. The example's
// end-to-end check asks lsp_diagnostics for this file and asserts the real
// TypeScript error (TS2322) comes back — wording only a real language server
// produces, which is the point: green here proves a language server ran.
export function reconcileLedger(entries: number[]): number {
  const opening: number = "seven" // planted: a string is not assignable to number
  return entries.reduce((sum, entry) => sum + entry, opening)
}
