//* Invite link: junglemesh://add/<code>
// The code is the one we already shared by hand (public key in base32).
// A link comes from outside: we only keep the code, after checking its format.
export const SCHEME = 'junglemesh'

// Looks for a valid link among command-line arguments (Windows passes the clicked link there)
export const findInviteCode = (args: string[]): string | null => {
  for (const arg of args) {
    const match = /^junglemesh:\/\/add\/([a-z0-9]{40,64})\/?$/i.exec(arg.trim())
    if (match) return match[1]
  }
  return null
}

export const inviteLink = (code: string): string => `${SCHEME}://add/${code}`
