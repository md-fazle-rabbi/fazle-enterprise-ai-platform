import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BackendStatus } from "./backend-status";

describe("BackendStatus", () => {
  it("says the backend is reachable", () => {
    render(<BackendStatus reachable />);
    expect(screen.getByRole("status")).toHaveTextContent("Backend reachable");
  });

  it("says the backend is unreachable", () => {
    render(<BackendStatus reachable={false} />);
    expect(screen.getByRole("status")).toHaveTextContent("Backend unreachable");
  });
});
