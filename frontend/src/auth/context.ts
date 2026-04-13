import { createContext, useContext } from 'react'

export interface AppUser {
  sub: string
  name: string
  email?: string
}

export interface AppAuthContextValue {
  isAuthenticated: boolean
  isLoading: boolean
  user: AppUser | null
  signIn: () => Promise<void>
  signOut: () => Promise<void>
  getAccessToken: () => Promise<string | null>
}

export const AppAuthContext = createContext<AppAuthContextValue | null>(null)

export function useAppAuth() {
  const context = useContext(AppAuthContext)
  if (!context) {
    throw new Error('useAppAuth must be used inside AppAuthProvider.')
  }
  return context
}
