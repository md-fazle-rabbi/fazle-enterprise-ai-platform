import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UploadForm } from "./upload-form";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const DOCUMENT_ID = "22222222-2222-4222-8222-222222222222";

afterEach(() => {
  vi.unstubAllGlobals();
  refresh.mockClear();
});

function choose(file: File): void {
  fireEvent.change(screen.getByLabelText("Choose a file"), { target: { files: [file] } });
}

function submit(): void {
  fireEvent.click(screen.getByRole("button", { name: "Upload" }));
}

function answer(body: unknown, status = 201) {
  const fetchMock = vi.fn().mockResolvedValue(Response.json(body, { status }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const textOk = {
  status: "ok",
  kind: "text",
  documentId: DOCUMENT_ID,
  deduplicated: false,
  chunkCount: 3,
};

describe("UploadForm", () => {
  it("has a labelled file field, the limits and an Upload button", () => {
    render(<UploadForm />);
    expect(screen.getByRole("heading", { name: "Upload a document" })).toBeInTheDocument();
    const input = screen.getByLabelText("Choose a file");
    expect(input).toHaveAttribute("accept", ".pdf,.png,.jpg,.jpeg,.webp,.txt,.md");
    expect(input).toHaveAccessibleDescription(/PDF up to 10 MiB and 20 pages/);
    expect(screen.getByRole("button", { name: "Upload" })).toBeInTheDocument();
  });

  it("asks for a file when none is chosen, and sends nothing", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<UploadForm />);
    submit();
    expect(screen.getByRole("alert")).toHaveTextContent("Choose a file before uploading.");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uploads a text file, says how many chunks it made and refreshes the page", async () => {
    const fetchMock = answer(textOk);
    render(<UploadForm />);
    choose(new File(["hello"], "refunds.md"));
    submit();

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("refunds.md was stored in 3 chunks."),
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("says a document is already stored when the answer is a duplicate", async () => {
    answer({ ...textOk, deduplicated: true });
    render(<UploadForm />);
    choose(new File(["hello"], "refunds.md"));
    submit();
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        "refunds.md is already stored with the same content.",
      ),
    );
  });

  it("says an image was stored", async () => {
    answer({
      status: "ok",
      kind: "image",
      documentId: DOCUMENT_ID,
      deduplicated: false,
      modality: "image_vision",
    });
    render(<UploadForm />);
    choose(new File([new Uint8Array(4)], "scan.png"));
    submit();
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("scan.png was read and stored."),
    );
  });

  it.each([
    [[], "paper.pdf was stored, 5 pages read."],
    [[3], "1 page had no readable content and was skipped: 3."],
    [[2, 4], "2 pages had no readable content and were skipped: 2 and 4."],
    [[2, 4, 6], "3 pages had no readable content and were skipped: 2, 4 and 6."],
  ])("describes a PDF with skipped pages %j", async (skippedPages, expected) => {
    answer({
      status: "ok",
      kind: "pdf",
      documentId: DOCUMENT_ID,
      deduplicated: false,
      pageCount: 5,
      skippedPages,
    });
    render(<UploadForm />);
    choose(new File(["%PDF-"], "paper.pdf"));
    submit();
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(expected));
  });

  it("shows the server's refusal as an alert and does not refresh", async () => {
    answer({ code: "unsupported_type", message: "This file type is not supported." }, 415);
    render(<UploadForm />);
    choose(new File(["MZ"], "setup.exe"));
    submit();
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("This file type is not supported."),
    );
    expect(refresh).not.toHaveBeenCalled();
  });

  it("shows a network failure as an alert", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    render(<UploadForm />);
    choose(new File(["hello"], "a.md"));
    submit();
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/connection/));
  });

  it("refuses a file over 10 MiB without sending it", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<UploadForm />);
    choose(new File([new Uint8Array(10 * 1024 * 1024 + 1)], "big.pdf"));
    submit();
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/too large/));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shows progress and ignores a second click while an upload runs", async () => {
    let finish: (response: Response) => void = () => undefined;
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<UploadForm />);
    choose(new File(["hello"], "a.md"));
    submit();

    const button = await screen.findByRole("button", { name: "Uploading…" });
    // Why: aria-disabled, not disabled, so the button keeps keyboard focus.
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(button).not.toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent(/A PDF can take a few minutes/);
    fireEvent.click(button);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    finish(Response.json(textOk, { status: 201 }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Upload" })).toBeInTheDocument());
  });

  it("clears an old error when the next upload starts", async () => {
    render(<UploadForm />);
    submit();
    expect(screen.getByRole("alert")).toBeInTheDocument();
    answer(textOk);
    choose(new File(["hello"], "a.md"));
    submit();
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  });
});
