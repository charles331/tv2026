/**
 * Platform-specific mpv launch arguments.
 *
 * Under WSL (WSLg), mpv picks its native Wayland backend, and WSLg's compositor
 * does not let the user resize Wayland windows (only maximise them). Through
 * X11 (XWayland) the same window resizes normally and playback stays smooth
 * (checked on the user's machine). A regular Linux desktop keeps mpv's default.
 */
import { readFileSync } from 'fs'

export function isWsl(
  env: Record<string, string | undefined> = process.env,
  kernel: string = readKernelVersion()
): boolean {
  return Boolean(env['WSL_DISTRO_NAME']) || /microsoft/i.test(kernel)
}

function readKernelVersion(): string {
  try {
    return readFileSync('/proc/version', 'utf8')
  } catch {
    return ''
  }
}

export function mpvPlatformArgs(
  platform: NodeJS.Platform = process.platform,
  wsl: boolean = platform === 'linux' && isWsl()
): string[] {
  return platform === 'linux' && wsl ? ['--gpu-context=x11egl'] : []
}
