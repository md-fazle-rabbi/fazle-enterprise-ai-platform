import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReviewQueuePanel } from "./review-queue-panel";

const ITEM = {
  id: "11111111-1111-4111-8111-111111111111",
  question: "What is my SSN on file?",
  answer: "I can't share that.",
  flag_reasons: ["output_pii"],
  status: "pending",
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ReviewQueuePanel", () => {
  it("lists flagged items with their flag reasons", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(Response.json({ items: [ITEM], tenantSelected: true })),
    );
    render(<ReviewQueuePanel />);
    await waitFor(() => expect(screen.getByText(/What is my SSN/)).toBeInTheDocument());
    expect(screen.getByText(/output_pii/)).toBeInTheDocument();
  });

  it("shows a message when no workspace is selected", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(Response.json({ items: [], tenantSelected: false })),
    );
    render(<ReviewQueuePanel />);
    await waitFor(() => expect(screen.getByText(/No workspace selected/)).toBeInTheDocument());
  });

  it("shows a message when there is nothing flagged", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(Response.json({ items: [], tenantSelected: true })),
    );
    render(<ReviewQueuePanel />);
    await waitFor(() =>
      expect(screen.getByText(/No flagged answers right now/)).toBeInTheDocument(),
    );
  });

  it("shows an error when the queue cannot be loaded", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 500 })));
    render(<ReviewQueuePanel />);
    await waitFor(() =>
      expect(screen.getByText(/Could not load the review queue/)).toBeInTheDocument(),
    );
  });

  it("reveals a note field when Resolve is clicked, and hides it on Cancel", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(Response.json({ items: [ITEM], tenantSelected: true })),
    );
    render(<ReviewQueuePanel />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Resolve" })).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole("button", { name: "Resolve" }));
    expect(screen.getByLabelText("Note (optional)")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByLabelText("Note (optional)")).not.toBeInTheDocument();
  });

  it("resolves with the typed note and removes the item from the list", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ items: [ITEM], tenantSelected: true }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<ReviewQueuePanel />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Resolve" })).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole("button", { name: "Resolve" }));
    fireEvent.change(screen.getByLabelText("Note (optional)"), {
      target: { value: "false positive" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Confirm resolve" }));

    await waitFor(() => expect(screen.queryByText(/What is my SSN/)).not.toBeInTheDocument());
    expect(fetchMock).toHaveBeenLastCalledWith(
      `/api/admin/review-queue/${ITEM.id}`,
      expect.objectContaining({ method: "POST", body: JSON.stringify({ note: "false positive" }) }),
    );
  });

  it("shows an error and keeps the item when resolving fails", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ items: [ITEM], tenantSelected: true }))
      .mockResolvedValueOnce(new Response(null, { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<ReviewQueuePanel />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Resolve" })).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole("button", { name: "Resolve" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm resolve" }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Could not resolve"));
    expect(screen.getByText(/What is my SSN/)).toBeInTheDocument();
  });
});
