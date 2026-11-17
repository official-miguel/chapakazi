import { useEffect } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { Layout } from './components/Layout'
import { I18nProvider } from './i18n'
import { BusinessesScreen } from './screens/BusinessesScreen'
import { CashCountScreen } from './screens/CashCountScreen'
import { HealthReportScreen } from './screens/HealthReportScreen'
import { HomeScreen } from './screens/HomeScreen'
import { InboxScreen } from './screens/InboxScreen'
import { InstallScreen } from './screens/InstallScreen'
import { LockScreen } from './screens/LockScreen'
import { MoreScreen } from './screens/MoreScreen'
import { MpesaScreen } from './screens/MpesaScreen'
import { Onboarding } from './screens/Onboarding'
import { AccountRequiredScreen } from './screens/AccountRequiredScreen'
import { PlanCheckScreen } from './screens/PlanCheckScreen'
import { useFreeEntries } from './freeLimit'
import { AlertsScreen } from './screens/AlertsScreen'
import { AnalysisScreen } from './screens/AnalysisScreen'
import { LedgerScreen } from './screens/LedgerScreen'
import { CustomerScreen } from './screens/CustomerScreen'
import { DebtsScreen } from './screens/DebtsScreen'
import { StockScreen } from './screens/StockScreen'
import { SuppliersScreen } from './screens/SuppliersScreen'
import { PlatformScreen } from './screens/PlatformScreen'
import { PlanScreen } from './screens/PlanScreen'
import { WorkersScreen } from './screens/WorkersScreen'
import { usePlatformAdmin } from './platform'
import { SessionProvider, useSession } from './session'
import { demoOn } from './subscription/demo'
import { usePlan } from './subscription/api'
import { startSync, useSyncState } from './sync'
import { ToastProvider } from './toast'

/**
 * Decides what the person sees: first-time setup, the lock screen, the "create an account"
 * screen, the payment screen, or the app itself.
 */
function Gate() {
  const { dir, person, isAdmin, views, business } = useSession()
  const platformAdmin = usePlatformAdmin()
  const sync = useSyncState()
  const free = useFreeEntries()
  // The plan is checked only for phones with an account (a phone with no account is limited to
  // its free entries instead). Whoever runs Chapa Biz is never locked out.
  const planChecked = !!person && (sync.signedIn || demoOn()) && !platformAdmin
  const isOwner = views.some((v) => v.role === 'admin')
  const plan = usePlan(isOwner ? null : (business?.id ?? null), planChecked)

  if (dir.people.length === 0) return <Onboarding />
  if (!person) return <LockScreen />
  // No account and the free entries are used up: create one, sign in, or join a shop.
  if (free.deciding) return <div className="app" />
  if (free.reached) return <AccountRequiredScreen />
  if (planChecked) {
    // Every account is on a plan. Until the phone has heard which (the first check also starts
    // the one-time free trial), the app does not open.
    if (!plan.known) return <PlanCheckScreen failed={plan.failed} onRetry={plan.refresh} />
    // Time has run out: only the payment screen opens, for the owner and their workers,
    // with the choice of 5 minutes of use below it.
    if (plan.locked) return <PlanScreen locked />
  }

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<HomeScreen />} />
        <Route path="ledger" element={<LedgerScreen />} />
        <Route path="stock" element={<StockScreen />} />
        <Route path="debts" element={<DebtsScreen />} />
        <Route path="debts/:customerId" element={<CustomerScreen />} />
        <Route path="more" element={<MoreScreen />} />
        {isAdmin && <Route path="plan" element={<PlanScreen />} />}
        <Route path="cash-count" element={<CashCountScreen />} />
        <Route path="inbox" element={<InboxScreen />} />
        {/* Owner-only pages do not exist at all in the worker view. */}
        {isAdmin && <Route path="businesses" element={<BusinessesScreen />} />}
        {isAdmin && <Route path="workers" element={<WorkersScreen />} />}
        {isAdmin && <Route path="alerts" element={<AlertsScreen />} />}
        {isAdmin && <Route path="analysis" element={<AnalysisScreen />} />}
        {isAdmin && <Route path="suppliers" element={<SuppliersScreen />} />}
        {isAdmin && <Route path="health-report" element={<HealthReportScreen />} />}
        {isAdmin && <Route path="mpesa" element={<MpesaScreen />} />}
        {/* The page for whoever runs Chapa Biz. The server refuses everyone else regardless. */}
        {platformAdmin && <Route path="platform" element={<PlatformScreen />} />}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}

export default function App() {
  useEffect(() => startSync(), [])

  return (
    <I18nProvider>
      <ToastProvider>
        <BrowserRouter>
          <Routes>
            {/* Public download page, outside the login. */}
            <Route path="install" element={<InstallScreen />} />
            <Route
              path="*"
              element={
                <SessionProvider loading={<div className="app" />}>
                  <Gate />
                </SessionProvider>
              }
            />
          </Routes>
        </BrowserRouter>
      </ToastProvider>
    </I18nProvider>
  )
}
