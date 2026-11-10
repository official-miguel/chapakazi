// Money is always stored as whole cents so sums never pick up rounding errors.
export function formatKsh(cents: number): string {
  const shillings = cents / 100
  const hasCents = cents % 100 !== 0
  return (
    'KSh ' +
    shillings.toLocaleString('en-KE', {
      minimumFractionDigits: hasCents ? 2 : 0,
      maximumFractionDigits: 2,
    })
  )
}
