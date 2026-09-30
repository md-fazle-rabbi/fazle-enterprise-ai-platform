import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { KillSwitchPanel } from "./kill-switch-panel";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("KillSwitchPanel", () => {
  it("shows inactive and an activate form when the switch is off", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ active: false })));
    render(<KillSwitchPanel />);
    await waitFor(() => expect(screen.getByText(/Inactive/)).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Activate" })).toBeInTheDocument();
  });

  it("shows active and a deactivate button when the switch is on", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ active: true })));
    render(<KillSwitchPanel />);
    await waitFor(() => expect(screen.getByText(/Active/)).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Deactivate" })).toBeInTheDocument();
  });

  it("refuses to activate without a reason", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ active: false })));
    render(<KillSwitchPanel />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Activate" })).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole("button", { name: "Activate" }));

    expect(screen.getByRole("alert")).toHaveTextContent("reason is required");
  });

  it("activates with the typed reason and shows the active state", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ active: false }))
      .mockResolvedValueOnce(Response.json({ active: true }));
    vi.stubGlobal("fetch", fetchMock);
    render(<KillSwitchPanel />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Activate" })).toBeInTheDocument(),
    );

    fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "test drill" } });
    fireEvent.click(screen.getByRole("button", { name: "Activate" }));

    await waitFor(() => expect(screen.getByText(/Active — agents are halted/)).toBeInTheDocument());
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/admin/kill-switch",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ action: "activate", reason: "test drill" }),
      }),
    );
  });

  it("shows an error when the status cannot be loaded", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 500 })));
    render(<KillSwitchPanel />);
    await waitFor(() => expect(screen.getByText(/Could not load the status/)).toBeInTheDocument());
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
