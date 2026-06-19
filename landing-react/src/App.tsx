import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import Home from './pages/Home'
import Login from './pages/Login'
import Parent from './pages/Parent'
import ParentPanel from './pages/ParentPanel'
import Child from './pages/Child'
import ChildPanel from './pages/ChildPanel'

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/login" element={<Login />} />
        <Route path="/parent" element={<Parent />} />
        <Route path="/parent/panel" element={<ParentPanel />} />
        <Route path="/child" element={<Child />} />
        <Route path="/child/panel" element={<ChildPanel />} />
        <Route path="/parent-panel" element={<Navigate to="/parent/panel" replace />} />
        <Route path="/child-panel" element={<Navigate to="/child/panel" replace />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
