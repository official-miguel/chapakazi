import { useLiveQuery } from 'dexie-react-hooks'
import { db } from './db'
import type { Customer } from './db'
import { useSession } from './session'

/** The customers of the shops in view, kept up to date, with a quick lookup by id. */
export function useCustomers(): { list: Customer[] | undefined; byId: Map<string, Customer> } {
  const { shops } = useSession()
  const shopIds = shops.map((s) => s.id)
  const list = useLiveQuery(() => db.customers.where('businessId').anyOf(shopIds).toArray(), [shopIds.join()])
  return { list, byId: new Map((list ?? []).map((c) => [c.id, c])) }
}
