import { Box, Text, Title } from '@mantine/core'
import { ChatKit, useChatKit } from '@openai/chatkit-react'
import { useEffect, useMemo } from 'react'

import { appConfig } from '../config'
import type { ApiClient } from '../services/api'
import { retrieveLocalEvidence } from '../services/retrieval'
import { dispatchOpenLocalTimestamp } from '../utils/events'
import type { EvidenceBundle } from '../types/models'

interface ChatPaneProps {
  api: ApiClient
  libraryId: string
  activeCorpusItemId?: string
  activeThreadId?: string | null
  onThreadChange: (threadId: string | null) => void
  onEvidence: (bundle: EvidenceBundle) => void
}

export function ChatPane({
  api,
  libraryId,
  activeCorpusItemId,
  activeThreadId,
  onThreadChange,
  onEvidence,
}: ChatPaneProps) {
  const clientToolHandler = useMemo(
    () =>
      async ({
        name,
        params,
      }: {
        name: string
        params: Record<string, unknown>
      }) => {
        if (name === 'retrieve_local_evidence') {
          const query = String(params.query ?? '')
          const topK = Number(params.topK ?? 6)
          const corpusItemIds =
            Array.isArray(params.corpusItemIds) && params.corpusItemIds.length > 0
              ? (params.corpusItemIds as string[])
              : activeCorpusItemId
                ? [activeCorpusItemId]
                : undefined

          const evidence = await retrieveLocalEvidence(
            api,
            libraryId,
            query,
            corpusItemIds,
            topK,
          )
          onEvidence(evidence)
          return evidence as unknown as Record<string, unknown>
        }

        return { ok: false }
      },
    [activeCorpusItemId, api, libraryId, onEvidence],
  )

  const chat = useChatKit({
    api: {
      url: `${appConfig.apiBaseUrl}/chatkit`,
      domainKey: appConfig.chatkitDomainKey,
      fetch: api.createChatKitFetch(libraryId, activeCorpusItemId),
    },
    initialThread: activeThreadId ?? null,
    onClientTool: clientToolHandler,
    onThreadChange: ({ threadId }) => onThreadChange(threadId),
    theme: {
      colorScheme: 'light',
      radius: 'soft',
      density: 'compact',
      typography: { baseSize: 15, fontFamily: 'Inter, system-ui, sans-serif' },
      color: {
        accent: { primary: '#1b7d57', level: 2 },
        grayscale: { hue: 160, tint: 4, shade: 0 },
        surface: { background: '#f8fcf9', foreground: '#16251c' },
      },
    },
    header: {
      title: { text: 'Research chat' },
    },
    history: {
      enabled: true,
      showDelete: false,
      showRename: true,
    },
    startScreen: {
      greeting: 'Ask about the imported media',
      prompts: [
        { label: 'Summarize this file', prompt: 'Summarize the active file using only retrieved evidence.' },
        { label: 'Find claims', prompt: 'What claims appear in this transcript?' },
        { label: 'Surface contradictions', prompt: 'Do any segments conflict with one another?' },
      ],
    },
    composer: {
      attachments: { enabled: false },
      dictation: { enabled: false },
      models: [{ id: 'gpt-5.4', label: 'GPT-5.4', default: true }],
    },
    entities: {
      onClick: (entity) => {
        const corpusItemId = entity.data?.corpusItemId
        const timestampMs = Number(entity.data?.timestampMs ?? 0)
        if (corpusItemId) {
          dispatchOpenLocalTimestamp({ corpusItemId, timestampMs })
        }
      },
    },
  })

  useEffect(() => {
    void chat.setThreadId(activeThreadId ?? null)
  }, [activeThreadId, chat])

  return (
    <Box
      style={{
        height: '100%',
        borderRadius: 8,
        overflow: 'hidden',
        border: '1px solid #d7e6dd',
        background: '#f8fcf9',
      }}
    >
      <Box px="md" py="sm" style={{ borderBottom: '1px solid #d7e6dd' }}>
        <Title order={3}>Chat</Title>
        <Text size="sm" c="dimmed">
          ChatKit handles the thread UI; retrieval and media remain browser-local.
        </Text>
      </Box>
      <Box style={{ height: 'calc(100% - 74px)' }}>
        <ChatKit control={chat.control} style={{ width: '100%', height: '100%' }} />
      </Box>
    </Box>
  )
}
