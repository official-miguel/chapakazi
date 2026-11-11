import { useEffect } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { Layout } from './components/Layout'
import { I18nProvider } from './i18n'
import { BusinessesScreen } from './screens/BusinessesScreen'
import { CashCountScreen } from './screens/CashCountScreen'
import { HomeScreen } from './screens/HomeScreen'
import { LockScreen } from './screens/LockScreen'
import { MoreScreen } from './screens/MoreScreen'
import { Onboarding } from './screens/Onboarding'
import { AlertsScreen } from './screens/AlertsScreen'
import { AnalysisScreen } from './screens/AnalysisScreen'
import { LedgerScreen } from './screens/LedgerScreen'
import { CustomerScreen } from './screens/CustomerScreen'
import { DebtsScreen } from './screens/DebtsScreen'
import { StockScreen } from './screens/StockScreen'
import { PlatformScreen } from './screens/PlatformScreen'
import { WorkersScreen } from './screens/WorkersScreen'
import { usePlatformAdmin } from './platform'
import { SessionProvider, useSession } from './session'
import { startSync } from './sync'
import { ToastProvider } from './toast'

/** Decides what the person sees: first-time setup, the lock screen, or the app itself. */
function Gate() {
  const { dir, person, isAdmin } = useSession()
  const platformAdmin = usePlatformAdmin()

  if (dir.people.length === 0) return <Onboarding />
  if (!person) return <LockScreen />

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<HomeScreen />} />
        <Route path="ledger" element={<LedgerScreen />} />
        <Route path="stock" element={<StockScreen />} />
        <Route path="debts" element={<DebtsScreen />} />
        <Route path="debts/:customerId" element={<CustomerScreen />} />
        <Route path="more" element={<MoreScreen />} />
        <Route path="cash-count" element={<CashCountScreen />} />
        {/* Owner-only pages do not exist at all in the worker view. */}
        {isAdmin && <Route path="businesses" element={<BusinessesScreen />} />}
        {isAdmin && <Route path="workers" element={<WorkersScreen />} />}
        {isAdmin && <Route path="alerts" element={<AlertsScreen />} />}
        {isAdmin && <Route path="analysis" element={<AnalysisScreen />} />}
        {/* The page for whoever runs Chapa Kazi. The server refuses everyone else regardless. */}
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
          <SessionProvider loading={<div className="app" />}>
            <Gate />
          </SessionProvider>
        </BrowserRouter>
      </ToastProvider>
    </I18nProvider>
  )
}
