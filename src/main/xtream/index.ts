/**
 * Barrel + factory for the Xtream client.
 *
 * `getXtreamClient()` builds a client from the currently stored, decrypted
 * credentials (main-process only — credentials never cross IPC). It throws a
 * typed XtreamError('NO_CREDENTIALS') if none are configured, which the IPC
 * handlers map to a NOT_CONNECTED Result.
 *
 * Other agents (download-engineer, mpv) that need the movie URL should call
 * `buildMovieUrl(streamId, ext)` on a client obtained here, then drive the
 * actual transfer/playback themselves under the ConnectionLock.
 */

import { getCredentials } from '../secrets/credentials'
import { XtreamClient } from './XtreamClient'
import { XtreamError } from './errors'

export { XtreamClient, maskUrl } from './XtreamClient'
export type { AccountInfo } from './XtreamClient'
export { XtreamError, toErrorCode } from './errors'
export type { XtreamErrorKind } from './errors'

/**
 * Build a client from stored credentials. The caller owns the client and is
 * responsible for calling `await client.close()` when done with a batch of
 * requests, to release pooled sockets.
 */
export function getXtreamClient(): XtreamClient {
  const creds = getCredentials()
  if (!creds) {
    throw new XtreamError(
      'NO_CREDENTIALS',
      'No IPTV credentials are configured. Add them in settings first.'
    )
  }
  return new XtreamClient(creds)
}
