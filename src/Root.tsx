import { ClerkProvider, SignInButton, UserButton, useAuth } from '@clerk/clerk-react'
import { useMemo } from 'react'
import App from './App'

// A real Clerk key is `pk_test_` or `pk_live_` followed by a base64 payload. The .env.example
// placeholder matches the prefix with nothing after it, and ClerkProvider throws on it.
const looksLikeClerkKey = (key: string) => /^pk_(test|live)_[A-Za-z0-9+/=_-]{8,}$/.test(key)

function SignedInShell() {
  const { isLoaded, isSignedIn, userId, getToken } = useAuth()
  // Memoised so App's star sync runs once per sign-in rather than on every render.
  const account = useMemo(() => (isSignedIn && userId ? { userId, getToken } : null), [isSignedIn, userId, getToken])
  const control = !isLoaded ? null : isSignedIn ? (
    <UserButton />
  ) : (
    <SignInButton mode="modal">
      <button className="sign-in">Sign in</button>
    </SignInButton>
  )
  return <App account={account} accountControl={control} />
}

// Unlike the golf app, a missing Clerk key is not an error screen. Every Sleeper read is public,
// so the board runs signed out and only saved state (stars across devices) waits on Clerk.
export default function Root() {
  const publishableKey = String(import.meta.env.VITE_CLERK_PUBLISHABLE_KEY || '')
  if (!looksLikeClerkKey(publishableKey)) return <App account={null} accountControl={null} />
  return (
    <ClerkProvider publishableKey={publishableKey} afterSignOutUrl="/">
      <SignedInShell />
    </ClerkProvider>
  )
}
