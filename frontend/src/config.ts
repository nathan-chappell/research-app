export const appConfig = {
  apiBaseUrl: import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000/api',
  authEnabled: (import.meta.env.VITE_AUTH_ENABLED ?? 'false') === 'true',
  oidcAuthority: import.meta.env.VITE_OIDC_AUTHORITY ?? '',
  oidcClientId: import.meta.env.VITE_OIDC_CLIENT_ID ?? '',
  oidcScope: import.meta.env.VITE_OIDC_SCOPE ?? 'openid profile email',
  oidcRedirectPath: import.meta.env.VITE_OIDC_REDIRECT_PATH ?? '/app',
  oidcPostLogoutRedirectPath:
    import.meta.env.VITE_OIDC_POST_LOGOUT_REDIRECT_PATH ?? '/login',
  chatkitDomainKey: import.meta.env.VITE_CHATKIT_DOMAIN_KEY ?? 'dev-domain-key',
  embeddingDimensions: Number(import.meta.env.VITE_EMBEDDING_DIMENSIONS ?? '256'),
  transcriptionChunkBytes: 20 * 1024 * 1024,
}

export function getAbsoluteAppUrl(path: string) {
  return new URL(path, window.location.origin).toString()
}
