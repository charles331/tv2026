/**
 * How a reminder reaches the user. On the PC: a Windows notification. In TV
 * mode the notification is useless (it only answers a mouse click, and the
 * video covers the screen): the app asks in its own window, brought in front.
 */
export function alertChannel(tvMode: boolean): 'notification' | 'prompt' {
  return tvMode ? 'prompt' : 'notification'
}
