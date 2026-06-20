import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import Home from './pages/Home'
import Login from './pages/Login'
import ParentPanel from './pages/ParentPanel'
import ChildPanel from './pages/ChildPanel'
import AdminLogin from './pages/AdminLogin'
import AdminPanel from './pages/AdminPanel'
import Pricing from './pages/Pricing'
import Checkout from './pages/Checkout'
import Terms from './pages/Terms'
import Privacy from './pages/Privacy'
import Share from './pages/Share'
import NotFound from './pages/NotFound'

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/login" element={<Login />} />
        <Route path="/pricing" element={<Pricing />} />
        <Route path="/checkout" element={<Checkout />} />
        <Route path="/terms" element={<Terms />} />
        <Route path="/privacy" element={<Privacy />} />
        <Route path="/share" element={<Share />} />
        <Route path="/parent" element={<Navigate to="/parent/panel" replace />} />
        <Route path="/parent/panel" element={<ParentPanel />} />
        <Route path="/child" element={<Navigate to="/child/panel" replace />} />
        <Route path="/child/panel" element={<ChildPanel />} />
        <Route path="/parent-panel" element={<Navigate to="/parent/panel" replace />} />
        <Route path="/child-panel" element={<Navigate to="/child/panel" replace />} />
        <Route path="/admin" element={<Navigate to="/admin/login" replace />} />
        <Route path="/admin/login" element={<AdminLogin />} />
        <Route path="/admin/panel" element={<AdminPanel />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
