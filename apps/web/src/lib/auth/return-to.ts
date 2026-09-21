// Why: "where to go after login" arrives in a query string, so it is attacker input. Only a
// plain path on this site is allowed. It must start with exactly one slash (so not //host
// and not /\host) and contain no backslash or whitespace, which some browsers read as a
// host or strip. Anything else becomes "/".
const SAFE_PATH = /^\/(?![/\\])[^\\\s]*$/;
const MAX_LENGTH = 512;

export function safeReturnTo(value: string | null | undefined): string {
  if (!value || value.length > MAX_LENGTH || !SAFE_PATH.test(value)) {
    return "/";
  }
  return value;
}
