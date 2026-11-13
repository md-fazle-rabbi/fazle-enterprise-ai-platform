import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { deleteDocument } from "@/lib/document-delete/client";
import { DocumentRow } from "./document-row";

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/lib/document-delete/client", () => ({ deleteDocument: vi.fn() }));

const ITEM = { id: "11111111-1111-4111-8111-111111111111", source_path: "handbook.md" };
const DELETE_NAME = "Delete document: handbook.md";

function renderRow() {
  render(
    <ul>
      <DocumentRow item={ITEM} />
    </ul>,
  );
}

describe("DocumentRow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("asks for confirmation before deleting anything", () => {
    renderRow();
    fireEvent.click(screen.getByRole("button", { name: DELETE_NAME }));
    expect(screen.getByRole("button", { name: "Confirm delete" })).toBeInTheDocument();
    expect(deleteDocument).not.toHaveBeenCalled();
  });

  it("goes back to the plain row on cancel", () => {
    renderRow();
    fireEvent.click(screen.getByRole("button", { name: DELETE_NAME }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("button", { name: DELETE_NAME })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Confirm delete" })).not.toBeInTheDocument();
  });

  it("deletes the document and refreshes the page", async () => {
    vi.mocked(deleteDocument).mockResolvedValue(true);
    renderRow();
    fireEvent.click(screen.getByRole("button", { name: DELETE_NAME }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm delete" }));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(deleteDocument).toHaveBeenCalledWith(ITEM.id);
  });

  it("shows an alert and keeps the row when the delete fails", async () => {
    vi.mocked(deleteDocument).mockResolvedValue(false);
    renderRow();
    fireEvent.click(screen.getByRole("button", { name: DELETE_NAME }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm delete" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not delete this document.");
    expect(refresh).not.toHaveBeenCalled();
    expect(screen.getByText("handbook.md")).toBeInTheDocument();
  });
});
