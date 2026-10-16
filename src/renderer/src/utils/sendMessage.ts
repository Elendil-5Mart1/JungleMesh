//* Sends a message with its staged attachments: the text goes with the first file, the others follow alone
export const sendMessage = async (conv: string, text: string, files: File[], channel?: string): Promise<void> => {
  if (files.length === 0) return window.api.send(conv, text, channel)
  for (const [i, file] of files.entries()) {
    await window.api.sendFileBytes(conv, file.name, new Uint8Array(await file.arrayBuffer()), channel, i === 0 ? text : '')
  }
}
