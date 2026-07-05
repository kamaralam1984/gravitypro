import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import ErrorBoundary from './components/ErrorBoundary'
import Home from './pages/Home'
import Login from './pages/Login'
import ParentPanel from './pages/ParentPanel'
import ChildPanel from './pages/ChildPanel'
import AdminLogin from './pages/AdminLogin'
import AdminPanel from './pages/AdminPanel'
import Terms from './pages/Terms'
import Privacy from './pages/Privacy'
import LiveShare from './pages/LiveShare'
import Timeline from './pages/Timeline'
import SmartPlaces from './pages/SmartPlaces'
import SmartPlaceDetail from './pages/SmartPlaceDetail'
import NotFound from './pages/NotFound'

// Keyed by pathname so a crash on one route doesn't leave every subsequent
// client-side navigation stuck on the same blank error screen — each new
// route gets a fresh ErrorBoundary instance.
function AppRoutes() {
  const location = useLocation()
  return (
    <ErrorBoundary key={location.pathname}>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/login" element={<Login />} />
        <Route path="/terms" element={<Terms />} />
        <Route path="/privacy" element={<Privacy />} />
        <Route path="/live/:token" element={<LiveShare />} />
        <Route path="/parent" element={<Navigate to="/parent/panel" replace />} />
        <Route path="/parent/panel" element={<ParentPanel />} />
        <Route path="/parent/timeline" element={<Timeline />} />
        <Route path="/parent/smart-places" element={<SmartPlaces />} />
        <Route path="/parent/smart-places/:placeId" element={<SmartPlaceDetail />} />
        <Route path="/child" element={<Navigate to="/child/panel" replace />} />
        <Route path="/child/panel" element={<ChildPanel />} />
        <Route path="/parent-panel" element={<Navigate to="/parent/panel" replace />} />
        <Route path="/child-panel" element={<Navigate to="/child/panel" replace />} />
        <Route path="/admin" element={<Navigate to="/admin/login" replace />} />
        <Route path="/admin/login" element={<AdminLogin />} />
        <Route path="/admin/panel" element={<AdminPanel />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </ErrorBoundary>
  )
}

function App() {
  return (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  )
}

export default App
