/**
 * Thin renderer-side helpers around the typed IPC contract (`window.api`).
 *
 * The renderer NEVER touches the network or filesystem directly — every call
 * goes through `window.api.*`, which returns a `Result<T>`. These helpers make
 * consuming `Result<T>` ergonomic inside async hooks/components and translate
 * error codes into friendly French messages.
 */

import type { AppError, ErrorCode, Result } from '@shared/index'

/** Stable accessor to the preload-exposed API. */
export const api = (): Window['api'] => window.api

/** Error carrying the structured AppError so callers can branch on `.code`. */
export class IpcError extends Error {
  readonly code: ErrorCode
  readonly details?: string
  constructor(error: AppError) {
    super(error.message)
    this.name = 'IpcError'
    this.code = error.code
    this.details = error.details
  }
}

/** Unwrap a `Result<T>`, throwing an {@link IpcError} on failure. */
export function unwrap<T>(result: Result<T>): T {
  if (result.ok) return result.data
  throw new IpcError(result.error)
}

/** User-facing French copy for each error code. */
export function describeError(error: unknown): string {
  if (error instanceof IpcError) {
    switch (error.code) {
      case 'NOT_IMPLEMENTED':
        return 'Cette fonctionnalité n’est pas encore disponible.'
      case 'INVALID_INPUT':
        return error.message || 'Saisie invalide.'
      case 'NOT_CONNECTED':
        return 'Aucun identifiant enregistré. Renseignez votre connexion dans les Réglages.'
      case 'AUTH_FAILED':
        return 'Échec de l’authentification : identifiants invalides ou jeton expiré.'
      case 'NETWORK_ERROR':
        return 'Impossible de joindre le serveur. Vérifiez votre connexion réseau.'
      case 'NOT_FOUND':
        return 'Élément introuvable.'
      case 'CONNECTION_BUSY':
        return 'La connexion est occupée (lecture ou téléchargement en cours).'
      case 'DISK_ERROR':
        return 'Erreur disque : vérifiez l’espace disponible et le dossier de destination.'
      case 'DB_ERROR':
        return 'Erreur de base de données locale.'
      case 'PLAYER_ERROR':
        return error.message || 'Erreur du lecteur.'
      default:
        return error.message || 'Une erreur inattendue est survenue.'
    }
  }
  if (error instanceof Error) return error.message
  return 'Une erreur inattendue est survenue.'
}

/** Extract the error code if available (for redirect-to-settings logic etc.). */
export function errorCode(error: unknown): ErrorCode | null {
  return error instanceof IpcError ? error.code : null
}

/** True when an error means the user must (re)configure the connection. */
export function isConnectionError(error: unknown): boolean {
  const code = errorCode(error)
  return code === 'NOT_CONNECTED' || code === 'AUTH_FAILED'
}
