import { Navigate, Route, Routes } from 'react-router-dom'

import { useAppAuth } from './auth/context'
import { LoginScreen } from './components/LoginScreen'
import { WorkspaceShell } from './components/WorkspaceShell'
import { WatchWindowPage } from './components/WatchWindowPage'

function App() {
  const auth = useAppAuth()

  return (
    <Routes>
      <Route
        path="/login"
        element={
          <LoginScreen
            loading={auth.isLoading}
            isAuthenticated={auth.isAuthenticated}
            userName={auth.user?.name}
            onSignIn={auth.signIn}
            onSignOut={auth.signOut}
          />
        }
      />
      <Route
        path="/app"
        element={auth.isAuthenticated ? <WorkspaceShell /> : <Navigate replace to="/login" />}
      />
      <Route
        path="/app/watch-window"
        element={auth.isAuthenticated ? <WatchWindowPage /> : <Navigate replace to="/login" />}
      />
      <Route
        path="*"
        element={<Navigate replace to={auth.isAuthenticated ? '/app' : '/login'} />}
      />
    </Routes>
  )
}

export default App
