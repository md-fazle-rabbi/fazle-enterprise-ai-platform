import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { UserPanel } from "./user-panel";

const TENANT_A = "00000000-0000-0000-0000-000000000001";

describe("UserPanel", () => {
  it("shows who is signed in", () => {
    render(
      <UserPanel username="alice" email="alice@acme.example" tenants={[TENANT_A]} roles={[]} />,
    );
    expect(screen.getByRole("heading", { name: "Signed in as alice" })).toBeInTheDocument();
    expect(screen.getByText("alice@acme.example")).toBeInTheDocument();
  });

  it("lists tenants and roles", () => {
    render(<UserPanel username="carol" tenants={[TENANT_A]} roles={["platform-admin"]} />);
    expect(screen.getByText(TENANT_A)).toBeInTheDocument();
    expect(screen.getByText("platform-admin")).toBeInTheDocument();
  });

  it("says so when the user has no tenant", () => {
    render(<UserPanel username="dave" tenants={[]} roles={[]} />);
    expect(screen.getByText("No tenant assigned")).toBeInTheDocument();
  });

  it("signs out with a POST to the logout route", () => {
    render(<UserPanel username="alice" tenants={[]} roles={[]} />);
    const form = screen.getByRole("button", { name: "Sign out" }).closest("form");
    expect(form).toHaveAttribute("method", "post");
    expect(form).toHaveAttribute("action", "/api/auth/logout");
  });
});
