export type CookieSpec = {
  name: string;
  options: {
    httpOnly: true;
    secure: boolean;
    sameSite: "lax";
    path: "/";
    maxAge: number;
  };
};

// Why: httpOnly keeps scripts away from the cookie. SameSite Lax is required because the
// redirect back from Keycloak is a cross site navigation, and Strict cookies are not sent
// on it. There is no Domain, path is "/", and over https the name gets the __Host- prefix,
// which makes browsers refuse the cookie unless it is Secure, host only and path "/".
// Over plain http (local) the prefix and the Secure flag are dropped, because browsers do
// not keep Secure cookies on http.
function cookieSpec(baseName: string, appUrl: string, maxAgeSeconds: number): CookieSpec {
  const secure = new URL(appUrl).protocol === "https:";
  return {
    name: secure ? `__Host-${baseName}` : baseName,
    options: { httpOnly: true, secure, sameSite: "lax", path: "/", maxAge: maxAgeSeconds },
  };
}

export function sessionCookie(appUrl: string, maxAgeSeconds: number): CookieSpec {
  return cookieSpec("fazle_sid", appUrl, maxAgeSeconds);
}

export function loginCookie(appUrl: string, maxAgeSeconds: number): CookieSpec {
  return cookieSpec("fazle_login", appUrl, maxAgeSeconds);
}
