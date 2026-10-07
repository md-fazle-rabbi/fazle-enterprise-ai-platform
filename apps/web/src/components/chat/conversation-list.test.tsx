import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ConversationList } from "./conversation-list";
import type { ConversationsState } from "./use-conversations";

const FIRST = { id: "11111111-1111-4111-8111-111111111111", title: "Refunds?", updatedAt: "t1" };
const SECOND = {
  id: "22222222-2222-4222-8222-222222222222",
  title: "Security policy",
  updatedAt: "t2",
};
const ITEMS = [FIRST, SECOND];

function setup(
  overrides: {
    state?: ConversationsState;
    activeId?: string | null;
    disabled?: boolean;
    onDelete?: (id: string) => Promise<boolean>;
  } = {},
) {
  const props = {
    state: overrides.state ?? ({ status: "ready", items: ITEMS } as ConversationsState),
    activeId: overrides.activeId ?? null,
    disabled: overrides.disabled ?? false,
    onOpen: vi.fn(),
    onNew: vi.fn(),
    onRetry: vi.fn(),
    onDelete: vi.fn(overrides.onDelete ?? (async () => true)),
  };
  render(<ConversationList {...props} />);
  return props;
}

describe("ConversationList", () => {
  it("shows New chat and a loading note while the list loads", () => {
    setup({ state: { status: "loading" } });
    expect(screen.getByRole("button", { name: "New chat" })).toBeInTheDocument();
    expect(screen.getByText("Loading chats…")).toBeInTheDocument();
  });

  it("lists the chats and marks the open one as current", () => {
    setup({ activeId: SECOND.id });
    expect(screen.getByRole("button", { name: FIRST.title })).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("button", { name: SECOND.title })).toHaveAttribute(
      "aria-current",
      "true",
    );
  });

  it("opens a chat when it is clicked", () => {
    const props = setup();
    fireEvent.click(screen.getByRole("button", { name: FIRST.title }));
    expect(props.onOpen).toHaveBeenCalledWith(FIRST.id);
  });

  it("starts a new chat", () => {
    const props = setup();
    fireEvent.click(screen.getByRole("button", { name: "New chat" }));
    expect(props.onNew).toHaveBeenCalled();
  });

  it("says so when there are no saved chats", () => {
    setup({ state: { status: "ready", items: [] } });
    expect(screen.getByText("No saved chats yet.")).toBeInTheDocument();
  });

  it("shows an error with a way to try again", () => {
    const props = setup({ state: { status: "error" } });
    expect(screen.getByRole("alert")).toHaveTextContent("Could not load past chats");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(props.onRetry).toHaveBeenCalled();
  });

  it("asks for confirmation before deleting", async () => {
    const props = setup();
    fireEvent.click(screen.getByRole("button", { name: `Delete chat: ${FIRST.title}` }));
    expect(props.onDelete).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Confirm delete" }));
    await waitFor(() => expect(props.onDelete).toHaveBeenCalledWith(FIRST.id));
  });

  it("deletes nothing when the confirmation is cancelled", () => {
    const props = setup();
    fireEvent.click(screen.getByRole("button", { name: `Delete chat: ${FIRST.title}` }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(props.onDelete).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Confirm delete" })).not.toBeInTheDocument();
  });

  it("shows a message when the delete fails", async () => {
    setup({ onDelete: async () => false });
    fireEvent.click(screen.getByRole("button", { name: `Delete chat: ${FIRST.title}` }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm delete" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not delete");
  });

  it("disables every button while an answer is running", () => {
    setup({ disabled: true });
    for (const button of screen.getAllByRole("button")) {
      expect(button).toBeDisabled();
    }
  });
});
