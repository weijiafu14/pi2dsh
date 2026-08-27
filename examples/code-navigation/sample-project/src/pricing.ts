// Ordinary, error-free file: part of the search corpus so a content search
// has more than one candidate to rank.
export function roundHalfToEven(amount: number): number {
  const floor = Math.floor(amount)
  const fraction = amount - floor
  if (fraction > 0.5) return floor + 1
  if (fraction < 0.5) return floor
  return floor % 2 === 0 ? floor : floor + 1
}
