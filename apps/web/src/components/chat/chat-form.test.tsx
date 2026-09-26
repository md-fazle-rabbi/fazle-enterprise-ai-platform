import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";
import { ChatForm } from "./chat-form";

function setup(overrides: Partial<ComponentProps<typeof ChatForm>> = {}) {
  const onAsk = vi.fn();
  const onStop = vi.fn();
  render(<ChatForm busy={false} onAsk={onAsk} onStop={onStop} {...overrides} />);
  return { onAsk, onStop };
}

describe("ChatForm", () => {
  it("sends the trimmed question and clears the field", () => {
    const { onAsk } = setup();
    const textarea = screen.getByLabelText("Ask a question");
    fireEvent.change(textarea, { target: { value: "  How long is the refund window?  " } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(onAsk).toHaveBeenCalledWith("How long is the refund window?");
    expect(textarea).toHaveValue("");
  });

  it("refuses an empty question", () => {
    const { onAsk } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(onAsk).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("Type a question");
  });

  it("refuses a question over 2000 characters", () => {
    const { onAsk } = setup();
    fireEvent.change(screen.getByLabelText("Ask a question"), {
      target: { value: "x".repeat(2_001) },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(onAsk).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("under 2000 characters");
  });

  it("sends on Enter and does not add a newline", () => {
    const { onAsk } = setup();
    const textarea = screen.getByLabelText("Ask a question");
    fireEvent.change(textarea, { target: { value: "hello" } });
    fireEvent.keyDown(textarea, { key: "Enter" });
    expect(onAsk).toHaveBeenCalledWith("hello");
  });

  it("does not send on Shift+Enter", () => {
    const { onAsk } = setup();
    const textarea = screen.getByLabelText("Ask a question");
    fireEvent.change(textarea, { target: { value: "hello" } });
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: true });
    expect(onAsk).not.toHaveBeenCalled();
  });

  it("does not send on Enter while composing (IME input)", () => {
    const { onAsk } = setup();
    const textarea = screen.getByLabelText("Ask a question");
    fireEvent.change(textarea, { target: { value: "こんにちは" } });
    fireEvent.keyDown(textarea, { key: "Enter", isComposing: true });
    expect(onAsk).not.toHaveBeenCalled();
  });

  it("makes the field readOnly and shows Stop while busy", () => {
    const { rerender } = render(<ChatForm busy={false} onAsk={vi.fn()} onStop={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Stop" })).not.toBeInTheDocument();
    rerender(<ChatForm busy={true} onAsk={vi.fn()} onStop={vi.fn()} />);
    expect(screen.getByLabelText("Ask a question")).toHaveAttribute("readonly");
    expect(screen.getByRole("button", { name: "Stop" })).toBeInTheDocument();
  });

  it("calls onStop when Stop is clicked", () => {
    const onStop = vi.fn();
    render(<ChatForm busy={true} onAsk={vi.fn()} onStop={onStop} />);
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    expect(onStop).toHaveBeenCalled();
  });

  it("ignores Enter while a request is already in flight", () => {
    const { onAsk } = setup({ busy: true });
    const textarea = screen.getByLabelText("Ask a question");
    fireEvent.change(textarea, { target: { value: "another question" } });
    fireEvent.keyDown(textarea, { key: "Enter" });
    expect(onAsk).not.toHaveBeenCalled();
  });
});
