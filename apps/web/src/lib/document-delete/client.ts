// Why: true when the document is gone afterwards. A 404 counts, because someone else
// removing it first leaves the person with the result they asked for.
export async function deleteDocument(id: string): Promise<boolean> {
  try {
    const response = await fetch(`/api/documents/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    return response.ok || response.status === 404;
  } catch {
    return false;
  }
}
