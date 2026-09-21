import { describe, expect, it } from "vitest";
import { loginCookie, sessionCookie } from "./cookie";

describe("cookie settings", () => {
  it("uses plain names and no Secure flag over http", () => {
    expect(sessionCookie("http://localhost:3000", 60)).toMatchObject({
      name: "fazle_sid",
      options: { secure: false },
    });
    expect(loginCookie("http://localhost:3000", 60)).toMatchObject({
      name: "fazle_login",
      options: { secure: false },
    });
  });

  it("uses __Host- names and the Secure flag over https", () => {
    expect(sessionCookie("https://app.example", 60)).toMatchObject({
      name: "__Host-fazle_sid",
      options: { secure: true },
    });
    expect(loginCookie("https://app.example", 60)).toMatchObject({
      name: "__Host-fazle_login",
      options: { secure: true },
    });
  });

  it.each([
    ["session", sessionCookie],
    ["login", loginCookie],
  ])("keeps the %s cookie httpOnly, SameSite Lax, path / and without a Domain", (_name, make) => {
    const { options } = make("https://app.example", 120);
    expect(options).toMatchObject({ httpOnly: true, sameSite: "lax", path: "/", maxAge: 120 });
    expect(options).not.toHaveProperty("domain");
  });
});
