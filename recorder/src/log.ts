/**
 * One line per event, on the standard streams, which is where the container runtime and the Windows service wrapper
 * both collect them. A message with line breaks (the tail of ffmpeg's error output, say) is folded into one line so
 * that `grep` and a log viewer see an event as a line.
 */
function write(level: string, message: string): string {
  return `${new Date().toISOString()} ${level} ${message.replace(/\s*\r?\n\s*/g, ' ').trim()}`
}

export const log = {
  info(message: string): void {
    console.log(write('INFO ', message))
  },
  warn(message: string): void {
    console.warn(write('WARN ', message))
  },
  error(message: string): void {
    console.error(write('ERROR', message))
  },
}
