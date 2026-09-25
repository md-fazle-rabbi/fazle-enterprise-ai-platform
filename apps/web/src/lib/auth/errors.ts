// Why: kept apart from the code that throws them, so callers and tests can name them
// without pulling in the Redis and Keycloak code.

// Keycloak said this refresh token is finished (expired, revoked, or its login ended).
export class RefreshRejectedError extends Error {}

// The user has to sign in again.
export class NotSignedInError extends Error {}

// The signed in user belongs to no tenant, so there is nothing to ask the backend for.
export class NoTenantError extends Error {}
