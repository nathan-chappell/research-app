import { Button, Group, Stack, Text, Title } from '@mantine/core'

import heroImage from '../assets/hero.png'

interface LoginScreenProps {
  loading: boolean
  isAuthenticated: boolean
  userName?: string
  onSignIn: () => Promise<void>
  onSignOut: () => Promise<void>
}

export function LoginScreen({
  loading,
  isAuthenticated,
  userName,
  onSignIn,
  onSignOut,
}: LoginScreenProps) {
  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'grid',
        alignItems: 'stretch',
        backgroundImage: `linear-gradient(110deg, rgba(12, 25, 20, 0.82), rgba(17, 52, 38, 0.68)), url(${heroImage})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
      }}
    >
      <Stack
        justify="space-between"
        style={{
          minHeight: '100vh',
          padding: '48px clamp(24px, 6vw, 72px)',
          color: '#f4fbf7',
        }}
      >
        <div />
        <Stack gap="lg" maw={620}>
          <Text tt="uppercase" fw={700} c="teal.2">
            Local-first media research
          </Text>
          <Title order={1} fz="clamp(2.5rem, 6vw, 4.5rem)" lh={1}>
            Bring your own files. Keep the corpus in your browser. Ask better questions.
          </Title>
          <Text size="lg" c="rgba(244, 251, 247, 0.82)" maw={520}>
            Import audio or video you already have, transcribe only the pieces that matter,
            and keep the searchable corpus on your own machine.
          </Text>
          <Group>
            {!isAuthenticated ? (
              <Button size="md" color="teal" loading={loading} onClick={() => void onSignIn()}>
                Sign in
              </Button>
            ) : (
              <>
                <Button size="md" color="teal" component="a" href="/app">
                  Continue as {userName ?? 'Researcher'}
                </Button>
                <Button
                  size="md"
                  variant="light"
                  color="gray"
                  onClick={() => void onSignOut()}
                >
                  Sign out
                </Button>
              </>
            )}
          </Group>
        </Stack>
        <Text size="sm" c="rgba(244, 251, 247, 0.7)">
          OPFS for media, Dexie for structure, ChatKit for conversation, FastAPI for the thin server edge.
        </Text>
      </Stack>
    </main>
  )
}
