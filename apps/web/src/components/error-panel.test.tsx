import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ErrorPanel } from "./error-panel";

describe("ErrorPanel", () => {
  it("shows the title as the page heading, the description, and its children", () => {
    render(
      <ErrorPanel title="Page not found" description="Nothing here.">
        <button type="button">Go home</button>
      </ErrorPanel>,
    );
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Page not found");
    expect(screen.getByText("Nothing here.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Go home" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("marks the description as an alert only when asked", () => {
    render(<ErrorPanel title="Failed" description="It broke." alert />);
    expect(screen.getByRole("alert")).toHaveTextContent("It broke.");
  });
});
