import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { Layout } from './components/Layout'
import { I18nProvider } from './i18n'
import { BusinessesScreen } from './screens/BusinessesScreen'
import { HomeScreen } from './screens/HomeScreen'
import { LockScreen } from './screens/LockScreen'
import { MoreScreen } from './screens/MoreScreen'
import { Onboarding } from './screens/Onboarding'
import { AlertsScreen } from './screens/AlertsScreen'
import { LedgerScreen } from './screens/LedgerScreen'
import { CustomerScreen } from './screens/CustomerScreen'
import { DebtsScreen } from './screens/DebtsScreen'
import { StockScreen } from './screens/StockScreen'
import { WorkersScreen } from './screens/WorkersScreen'
import { SessionProvider, useSession } from './session'
import { ToastProvider } from './toast'

/** Decides what the person sees: first-time setup, the lock screen, or the app itself. */
function Gate() {
  const { dir, person, isAdmin } = useSession()

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
        {/* Owner-only pages do not exist at all in the worker view. */}
        {isAdmin && <Route path="businesses" element={<BusinessesScreen />} />}
        {isAdmin && <Route path="workers" element={<WorkersScreen />} />}
        {isAdmin && <Route path="alerts" element={<AlertsScreen />} />}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}

export default function App() {
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
