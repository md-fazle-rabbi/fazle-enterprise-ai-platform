import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ErrorPage from "./error";

function makeError(message: string, digest?: string): Error & { digest?: string } {
  return Object.assign(new Error(message), digest === undefined ? {} : { digest });
}

beforeEach(() => {
  // Why: the page logs the error on purpose. Silencing it keeps the test output clean.
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ErrorPage", () => {
  it("shows a fixed message and the digest, and never the error message", () => {
    render(<ErrorPage error={makeError("internal detail 12345", "abc123")} retry={vi.fn()} />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Something went wrong");
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText("Reference: abc123")).toBeInTheDocument();
    expect(screen.queryByText(/internal detail/)).not.toBeInTheDocument();
  });

  it("leaves out the reference line when there is no digest", () => {
    render(<ErrorPage error={makeError("client side failure")} retry={vi.fn()} />);
    expect(screen.queryByText(/Reference:/)).not.toBeInTheDocument();
  });

  it("calls retry once when Try again is pressed", () => {
    const retry = vi.fn();
    render(<ErrorPage error={makeError("x", "d1")} retry={retry} />);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("links back to the home page", () => {
    render(<ErrorPage error={makeError("x", "d1")} retry={vi.fn()} />);
    expect(screen.getByRole("link", { name: "Back to home" })).toHaveAttribute("href", "/");
  });

  it("writes the error to the browser console", () => {
    const error = makeError("x", "d1");
    render(<ErrorPage error={error} retry={vi.fn()} />);
    expect(console.error).toHaveBeenCalledWith(error);
  });
});
