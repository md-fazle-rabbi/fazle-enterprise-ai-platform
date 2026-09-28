import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TenantSwitcher } from "./tenant-switcher";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const TENANT_A = "00000000-0000-0000-0000-000000000001";
const TENANT_B = "00000000-0000-0000-0000-000000000002";

afterEach(() => {
  vi.unstubAllGlobals();
  refresh.mockClear();
});

describe("TenantSwitcher", () => {
  it("renders nothing for a user with one tenant or none", () => {
    const { container: one } = render(
      <TenantSwitcher tenants={[TENANT_A]} currentTenantId={TENANT_A} />,
    );
    expect(one).toBeEmptyDOMElement();
    const { container: none } = render(<TenantSwitcher tenants={[]} currentTenantId={null} />);
    expect(none).toBeEmptyDOMElement();
  });

  it("lists every tenant and shows the current one selected", () => {
    render(<TenantSwitcher tenants={[TENANT_A, TENANT_B]} currentTenantId={TENANT_B} />);
    expect(screen.getByLabelText("Workspace")).toHaveValue(TENANT_B);
    expect(screen.getAllByRole("option")).toHaveLength(2);
  });

  it("posts the chosen tenant and refreshes the page on success", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<TenantSwitcher tenants={[TENANT_A, TENANT_B]} currentTenantId={TENANT_A} />);

    fireEvent.change(screen.getByLabelText("Workspace"), { target: { value: TENANT_B } });

    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/tenant",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ tenantId: TENANT_B }) }),
    );
  });

  it("shows an error and does not refresh when the switch fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 403 })));
    render(<TenantSwitcher tenants={[TENANT_A, TENANT_B]} currentTenantId={TENANT_A} />);

    fireEvent.change(screen.getByLabelText("Workspace"), { target: { value: TENANT_B } });

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(refresh).not.toHaveBeenCalled();
  });
});
