// Electron prefixes IPC errors ("Error invoking remote method 'x': Error: …"):
// we only keep the message that is useful to the user.
export const cleanError = (err: unknown): string =>
  String(err instanceof Error ? err.message : err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
