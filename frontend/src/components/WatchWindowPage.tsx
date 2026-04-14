import { Box, Button, Group, Stack, Text, Title } from '@mantine/core'
import { useEffect, useRef, useState } from 'react'

import type { WatchSessionState } from '../types/models'
import { watchChannelName, type WatchChannelMessage } from '../utils/watch'

function readSessionId() {
  return new URLSearchParams(window.location.search).get('session') ?? ''
}

export function WatchWindowPage() {
  const captureSessionId = readSessionId()
  const channelRef = useRef<BroadcastChannel | null>(null)
  const [session, setSession] = useState<WatchSessionState | null>(null)

  useEffect(() => {
    if (!captureSessionId) {
      return undefined
    }

    const channel = new BroadcastChannel(watchChannelName(captureSessionId))
    channelRef.current = channel
    channel.onmessage = (event: MessageEvent<WatchChannelMessage>) => {
      if (event.data.type === 'session-state') {
        setSession(event.data.state)
      }
    }
    channel.postMessage({ type: 'popup-ready' })
    channel.postMessage({ type: 'request-state' })

    return () => {
      channel.close()
      channelRef.current = null
    }
  }, [captureSessionId])

  const openTargetDirectly = () => {
    if (!session?.normalizedUrl) return
    window.open(session.normalizedUrl, '_blank', 'noopener,noreferrer')
    channelRef.current?.postMessage({
      type: 'target-opened-directly',
      targetMode: 'direct_tab',
    })
  }

  return (
    <Box
      style={{
        minHeight: '100vh',
        background: '#eef4f1',
        padding: 16,
      }}
    >
      <Stack
        gap="md"
        style={{
          minHeight: 'calc(100vh - 32px)',
        }}
      >
        <Group justify="space-between" align="flex-start" wrap="wrap">
          <div>
            <Title order={2}>Watch Window</Title>
            <Text size="sm" c="dimmed">
              Keep this window open, then choose it or the direct target tab in Chromium&apos;s share picker.
            </Text>
          </div>
          <Button onClick={openTargetDirectly} disabled={!session?.normalizedUrl}>
            Open target directly
          </Button>
        </Group>

        <Group gap="md" wrap="wrap">
          <Text size="sm">
            {session?.normalizedUrl ?? 'Waiting for a target URL from the main app.'}
          </Text>
          {session?.recordingStatus ? (
            <Text size="sm" c="dimmed">
              {session.recordingStatus}
            </Text>
          ) : null}
        </Group>

        <Text size="sm" c="dimmed">
          Some sites block framing. If the page does not load here, open the target directly and capture that tab instead.
        </Text>

        <Box
          style={{
            flex: 1,
            minHeight: 480,
            borderRadius: 8,
            overflow: 'hidden',
            border: '1px solid #d7e6dd',
            background: '#ffffff',
          }}
        >
          {session?.normalizedUrl ? (
            <iframe
              title="Watch target"
              src={session.normalizedUrl}
              style={{
                width: '100%',
                height: '100%',
                border: 0,
              }}
            />
          ) : null}
        </Box>
      </Stack>
    </Box>
  )
}
