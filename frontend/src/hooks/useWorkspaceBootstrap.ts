import { useEffect, useMemo, useState } from 'react'

import { useAppAuth } from '../auth/context'
import { db } from '../db/schema'
import { createApiClient } from '../services/api'
import { makeId } from '../utils/id'

const LIBRARY_STORAGE_KEY = 'research-app:library-id'

export function useWorkspaceBootstrap() {
  const auth = useAppAuth()
  const api = useMemo(() => createApiClient(auth.getAccessToken), [auth])
  const [libraryId, setLibraryId] = useState<string | null>(null)
  const [isReady, setIsReady] = useState(false)

  useEffect(() => {
    if (typeof navigator.storage?.persist === 'function') {
      void navigator.storage.persist()
    }
  }, [])

  useEffect(() => {
    if (auth.isLoading || !auth.isAuthenticated) return

    let cancelled = false

    void (async () => {
      const existing = localStorage.getItem(LIBRARY_STORAGE_KEY)
      const resolvedLibraryId = existing ?? makeId('lib')
      if (!existing) {
        localStorage.setItem(LIBRARY_STORAGE_KEY, resolvedLibraryId)
      }

      const now = new Date().toISOString()
      await db.libraries.put({
        id: resolvedLibraryId,
        name: 'Primary Library',
        registeredAt: now,
        lastSyncedAt: now,
      })

      try {
        const serverLibrary = await api.registerLibrary(resolvedLibraryId, 'Primary Library')
        await db.libraries.put({
          id: serverLibrary.id,
          name: serverLibrary.name,
          registeredAt: serverLibrary.created_at ?? now,
          lastSyncedAt: now,
        })
      } catch {
        // Stay usable offline or without a running backend.
      }

      if (!cancelled) {
        setLibraryId(resolvedLibraryId)
        setIsReady(true)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [api, auth.isAuthenticated, auth.isLoading])

  return { api, auth, libraryId, isReady }
}
