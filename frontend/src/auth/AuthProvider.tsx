import {
  type PropsWithChildren,
  useMemo,
  useState,
} from 'react'
import { AuthProvider as OidcProvider, useAuth as useOidcAuth } from 'react-oidc-context'
import { WebStorageStateStore } from 'oidc-client-ts'

import { appConfig, getAbsoluteAppUrl } from '../config'
import { AppAuthContext, type AppAuthContextValue } from './context'

function DevAuthProvider({ children }: PropsWithChildren) {
  const [isAuthenticated, setIsAuthenticated] = useState(true)

  const value = useMemo<AppAuthContextValue>(
    () => ({
      isAuthenticated,
      isLoading: false,
      user: isAuthenticated
        ? {
            sub: 'dev-user',
            name: 'Local Developer',
            email: 'dev@example.com',
          }
        : null,
      signIn: async () => setIsAuthenticated(true),
      signOut: async () => setIsAuthenticated(false),
      getAccessToken: async () => null,
    }),
    [isAuthenticated],
  )

  return <AppAuthContext.Provider value={value}>{children}</AppAuthContext.Provider>
}

function OidcBridge({ children }: PropsWithChildren) {
  const auth = useOidcAuth()

  const value = useMemo<AppAuthContextValue>(
    () => ({
      isAuthenticated: auth.isAuthenticated,
      isLoading: auth.isLoading,
      user: auth.user
        ? {
            sub: auth.user.profile.sub,
            name:
              (auth.user.profile.name as string | undefined) ??
              (auth.user.profile.preferred_username as string | undefined) ??
              'Authenticated User',
            email: auth.user.profile.email as string | undefined,
          }
        : null,
      signIn: async () => {
        await auth.signinRedirect()
      },
      signOut: async () => {
        if (auth.settings.post_logout_redirect_uri) {
          await auth.signoutRedirect()
          return
        }
        await auth.removeUser()
      },
      getAccessToken: async () => auth.user?.access_token ?? null,
    }),
    [auth],
  )

  return <AppAuthContext.Provider value={value}>{children}</AppAuthContext.Provider>
}

export function AppAuthProvider({ children }: PropsWithChildren) {
  const oidcConfigured =
    appConfig.authEnabled && appConfig.oidcAuthority && appConfig.oidcClientId

  if (!oidcConfigured) {
    return <DevAuthProvider>{children}</DevAuthProvider>
  }

  return (
    <OidcProvider
      authority={appConfig.oidcAuthority}
      client_id={appConfig.oidcClientId}
      redirect_uri={getAbsoluteAppUrl(appConfig.oidcRedirectPath)}
      post_logout_redirect_uri={getAbsoluteAppUrl(
        appConfig.oidcPostLogoutRedirectPath,
      )}
      response_type="code"
      scope={appConfig.oidcScope}
      automaticSilentRenew
      userStore={new WebStorageStateStore({ store: window.localStorage })}
      onSigninCallback={() => {
        window.history.replaceState({}, document.title, window.location.pathname)
      }}
    >
      <OidcBridge>{children}</OidcBridge>
    </OidcProvider>
  )
}
