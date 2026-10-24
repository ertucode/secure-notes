export type RepositoryCoordinates = { owner: string; repo: string };
export type RepositoryFile = { path: string; sha: string };
export type RepositoryFileUpdate = { path: string; content: string };

export function parseRepository(value: string): RepositoryCoordinates {
  const trimmed = value
    .trim()
    .replace(/\.git$/, "")
    .replace(/\/$/, "");
  const match = trimmed.match(
    /^(?:https?:\/\/github\.com\/)?([^/\s]+)\/([^/\s]+)$/i,
  );
  if (!match)
    throw new Error(
      "Enter a GitHub repository URL such as https://github.com/owner/repository",
    );
  return { owner: match[1], repo: match[2] };
}

function decodeBase64Utf8(value: string) {
  const binary = atob(value.replace(/\s/g, ""));
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function encodeBase64Utf8(value: string) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

function encodePath(path: string) {
  return path.split("/").map(encodeURIComponent).join("/");
}

export class GitHubClient {
  constructor(
    private token: string,
    readonly repository: RepositoryCoordinates,
  ) {}

  private async request<T>(
    path: string,
    init?: RequestInit,
    allowNotFound = false,
    allowEmptyRepository = false,
  ): Promise<T | null> {
    const response = await fetch(`https://api.github.com${path}`, {
      ...init,
      cache: "no-store",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${this.token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        ...init?.headers,
      },
    });
    if (
      allowEmptyRepository &&
      (response.status === 404 || response.status === 409)
    )
      return null;
    if (allowNotFound && response.status === 404) return null;
    if (!response.ok) {
      if (response.status === 401)
        throw new Error("GitHub rejected this token. Check that it is valid.");
      if (response.status === 403)
        throw new Error(
          "This token does not have access to repository contents.",
        );
      if (response.status === 404)
        throw new Error("Repository not found or the token cannot access it.");
      if (response.status === 409)
        throw new Error(
          "GitHub reported a repository conflict. Refresh and try again.",
        );
      if (response.status === 422)
        throw new Error(
          "The repository changed while the vault was being updated. Refresh and try again.",
        );
      throw new Error(`GitHub request failed (${response.status}).`);
    }
    return response.status === 204 ? null : (response.json() as Promise<T>);
  }

  private repoPath(path = "") {
    const { owner, repo } = this.repository;
    return `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}${path}`;
  }

  async getRepository() {
    const repository = await this.request<{ default_branch: string }>(
      this.repoPath(),
    );
    const defaultBranch = repository!.default_branch;
    const branchRef = await this.request(
      this.repoPath(`/git/ref/heads/${encodeURIComponent(defaultBranch)}`),
      undefined,
      true,
    );
    return { defaultBranch, empty: branchRef === null };
  }

  async getTextFile(path: string, branch: string) {
    const file = await this.request<{ content: string; sha: string }>(
      `${this.repoPath(`/contents/${encodePath(path)}`)}?ref=${encodeURIComponent(branch)}`,
      undefined,
      true,
    );
    return file
      ? { content: decodeBase64Utf8(file.content), sha: file.sha }
      : null;
  }

  async getBranchHead(branch: string) {
    const ref = await this.request<{ object: { sha: string } }>(
      this.repoPath(`/git/ref/heads/${encodeURIComponent(branch)}`),
    );
    return ref!.object.sha;
  }

  async listVaultFiles(branch: string): Promise<RepositoryFile[]> {
    const tree = await this.request<{
      tree: Array<{ path: string; type: string; sha: string }>;
    }>(
      `${this.repoPath(`/git/trees/${encodeURIComponent(branch)}`)}?recursive=1`,
    );
    return tree!.tree
      .filter(
        (entry) =>
          entry.type === "blob" &&
          (entry.path.startsWith("notes/") ||
            entry.path.startsWith("attachments/")),
      )
      .map(({ path, sha }) => ({ path, sha }));
  }

  async tryListVaultFiles(branch: string): Promise<RepositoryFile[] | null> {
    const tree = await this.request<{
      tree: Array<{ path: string; type: string; sha: string }>;
    }>(
      `${this.repoPath(`/git/trees/${encodeURIComponent(branch)}`)}?recursive=1`,
      undefined,
      false,
      true,
    );
    return tree
      ? tree.tree
          .filter(
            (entry) =>
              entry.type === "blob" &&
              (entry.path.startsWith("notes/") ||
                entry.path.startsWith("attachments/")),
          )
          .map(({ path, sha }) => ({ path, sha }))
      : null;
  }

  async listNoteFiles(branch: string): Promise<RepositoryFile[]> {
    return (await this.listVaultFiles(branch)).filter((entry) =>
      entry.path.endsWith(".cnote"),
    );
  }

  async getBlob(sha: string) {
    const blob = await this.request<{ content: string }>(
      this.repoPath(`/git/blobs/${encodeURIComponent(sha)}`),
    );
    return decodeBase64Utf8(blob!.content);
  }

  async commitFiles(
    files: RepositoryFileUpdate[],
    branch: string,
    message: string,
    parentSha: string,
  ) {
    const blobShas = new Map<string, string>();
    let nextIndex = 0;
    const worker = async () => {
      while (nextIndex < files.length) {
        const file = files[nextIndex++];
        const blob = await this.request<{ sha: string }>(
          this.repoPath("/git/blobs"),
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              content: encodeBase64Utf8(file.content),
              encoding: "base64",
            }),
          },
        );
        blobShas.set(file.path, blob!.sha);
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(6, files.length) }, () => worker()),
    );

    const parent = await this.request<{ tree: { sha: string } }>(
      this.repoPath(`/git/commits/${encodeURIComponent(parentSha)}`),
    );
    const tree = await this.request<{ sha: string }>(
      this.repoPath("/git/trees"),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          base_tree: parent!.tree.sha,
          tree: files.map((file) => ({
            path: file.path,
            mode: "100644",
            type: "blob",
            sha: blobShas.get(file.path),
          })),
        }),
      },
    );
    const commit = await this.request<{ sha: string }>(
      this.repoPath("/git/commits"),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message,
          tree: tree!.sha,
          parents: [parentSha],
        }),
      },
    );
    await this.request(
      this.repoPath(`/git/refs/heads/${encodeURIComponent(branch)}`),
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sha: commit!.sha, force: false }),
      },
    );
    return blobShas;
  }

  async putTextFile(
    path: string,
    content: string,
    branch: string | undefined,
    message: string,
    sha?: string,
  ) {
    const result = await this.request<{ content: { sha: string } }>(
      this.repoPath(`/contents/${encodePath(path)}`),
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message,
          content: encodeBase64Utf8(content),
          ...(branch ? { branch } : {}),
          ...(sha ? { sha } : {}),
        }),
      },
    );
    return result!.content.sha;
  }

  async deleteFile(path: string, sha: string, branch: string, message: string) {
    await this.request(this.repoPath(`/contents/${encodePath(path)}`), {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, sha, branch }),
    });
  }
}
