export const OPEN_LOCAL_TIMESTAMP_EVENT = 'research-app:open-local-timestamp'

export interface OpenLocalTimestampDetail {
  corpusItemId: string
  timestampMs: number
}

export function dispatchOpenLocalTimestamp(detail: OpenLocalTimestampDetail) {
  window.dispatchEvent(new CustomEvent(OPEN_LOCAL_TIMESTAMP_EVENT, { detail }))
}
