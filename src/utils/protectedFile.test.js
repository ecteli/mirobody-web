/**
 * `/files/` is authenticated now. These pin the decisions in the helper that
 * are not obvious from reading it, and that a later refactor would plausibly
 * undo.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";

const ACCESS_TOKEN = "ACCESS_TOKEN";

// getApiBaseUrl reads sessionStorage; both are stubbed as plain maps.
const makeStorage = () => {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    clear: () => map.clear(),
  };
};

const encode = (text) => new TextEncoder().encode(text);
const PDF = encode("%PDF-1.7\n1 0 obj\n");
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
// What a reverse proxy without a `/files/` rule answers: the app's own page.
const INDEX_HTML = encode('<!doctype html><html><body><div id="root"></div></body></html>');

// A 200 as fetch resolves it. `slice()` so the buffer is exactly the bytes.
const fileResponse = (bytes, contentType) => ({
  ok: true,
  status: 200,
  headers: new Headers({ "Content-Type": contentType }),
  arrayBuffer: async () => bytes.slice().buffer,
});

// Enough of `document` for a download: every anchor clicked is recorded with
// its href, its name and whether it was in the document when clicked.
const makeDocument = (clicked) => {
  const children = new Set();
  return {
    createElement: () => {
      const a = {
        click: () => clicked.push({ href: a.href, download: a.download, attached: children.has(a) }),
        remove: () => children.delete(a),
      };
      return a;
    },
    body: { appendChild: (a) => children.add(a) },
  };
};

// What a fetch whose answer never comes does: nothing, until it is aborted.
const untilAborted = (signal) =>
  new Promise((_, reject) => {
    if (signal.aborted) reject(signal.reason);
    signal.addEventListener("abort", () => reject(signal.reason));
  });

describe("protectedFile", () => {
  let openProtectedFile;
  let resolveFileUrl;
  let FILE_FETCH_TIMEOUT_MS;
  let viewer;

  beforeEach(async () => {
    vi.stubGlobal("localStorage", makeStorage());
    vi.stubGlobal("sessionStorage", makeStorage());
    vi.resetModules();
    ({ openProtectedFile, resolveFileUrl, FILE_FETCH_TIMEOUT_MS } = await import("./protectedFile.js"));
    // Same module registry as the helper's own import, so the same store.
    const { useFileViewStore } = await import("../store/fileView.js");
    viewer = () => useFileViewStore.getState();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe("resolveFileUrl", () => {
    it("turns a bare file key into a /files/ path", () => {
      expect(resolveFileUrl("uploads/20260818_1_a.pdf")).toBe(
        "/files/uploads/20260818_1_a.pdf",
      );
    });

    it("leaves an already-rooted /files/ path alone", () => {
      expect(resolveFileUrl("/files/uploads/a.pdf")).toBe("/files/uploads/a.pdf");
    });

    it("passes an absolute URL through untouched", () => {
      const url = "https://cdn.example/files/a.pdf";
      expect(resolveFileUrl(url)).toBe(url);
    });
  });

  describe("openProtectedFile", () => {
    it("refuses without a session rather than firing an anonymous request", async () => {
      const fetchSpy = vi.fn();
      vi.stubGlobal("fetch", fetchSpy);
      const reason = await openProtectedFile("uploads/a.pdf");
      expect(reason).toBe("file_view_unauthorized");
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("sends the token in a header and never in the URL", async () => {
      // The whole point. A token in the query string lands in browser history,
      // in Referer on sub-resources, and in every access log on the way.
      localStorage.setItem(ACCESS_TOKEN, "jwt-abc");
      const fetchSpy = vi.fn(async () => fileResponse(PDF, "application/pdf"));
      vi.stubGlobal("fetch", fetchSpy);
      vi.stubGlobal("URL", { createObjectURL: () => "blob:x", revokeObjectURL: () => {} });
      vi.stubGlobal("Blob", class { constructor(parts, opts) { this.type = opts?.type; } });
      vi.stubGlobal("setTimeout", () => 0);

      await openProtectedFile("uploads/a.pdf", "a.pdf");

      const [url, options] = fetchSpy.mock.calls[0];
      expect(url).not.toContain("access_token");
      expect(url).not.toContain("jwt-abc");
      expect(options.headers.Authorization).toBe("Bearer jwt-abc");
    });

    it("reports 401 differently from 404", async () => {
      // 404 is also what "someone else's file" returns — the backend answers
      // both identically so a key cannot be probed for existence.
      localStorage.setItem(ACCESS_TOKEN, "jwt-abc");

      vi.stubGlobal("fetch", async () => ({ ok: false, status: 401 }));
      expect(await openProtectedFile("uploads/a.pdf")).toBe("file_view_unauthorized");
      expect(viewer().view).toBeNull();

      vi.stubGlobal("fetch", async () => ({ ok: false, status: 404 }));
      expect(await openProtectedFile("uploads/a.pdf")).toBe("file_view_unavailable");
      expect(viewer().view).toBeNull();
    });

    it("never hands back an executable type for an uploaded svg", async () => {
      // A blob: URL inherits this page's origin and .svg is an uploadable
      // extension, so rendering one as image/svg+xml runs its script here with
      // the user's session. Only non-executing formats render inline.
      localStorage.setItem(ACCESS_TOKEN, "jwt-abc");
      const types = [];
      vi.stubGlobal("fetch", async () =>
        fileResponse(encode("<svg xmlns='http://www.w3.org/2000/svg'/>"), "image/svg+xml"),
      );
      vi.stubGlobal("document", makeDocument([]));
      vi.stubGlobal("URL", { createObjectURL: () => "blob:x", revokeObjectURL: () => {} });
      vi.stubGlobal("Blob", class {
        constructor(parts, opts) { types.push(opts?.type); }
      });
      vi.stubGlobal("setTimeout", () => 0);

      await openProtectedFile("uploads/evil.svg", "evil.svg");
      expect(types[0]).toBe("application/octet-stream");
    });

    it("renders a pdf inline", async () => {
      localStorage.setItem(ACCESS_TOKEN, "jwt-abc");
      const types = [];
      vi.stubGlobal("fetch", async () => fileResponse(PDF, "application/pdf"));
      vi.stubGlobal("URL", { createObjectURL: () => "blob:x", revokeObjectURL: () => {} });
      vi.stubGlobal("Blob", class {
        constructor(parts, opts) { types.push(opts?.type); }
      });
      vi.stubGlobal("setTimeout", () => 0);

      await openProtectedFile("uploads/report.pdf", "report.pdf");
      expect(types[0]).toBe("application/pdf");
      expect(viewer().view).toMatchObject({
        name: "report.pdf",
        url: "blob:x",
        type: "application/pdf",
      });
    });

    it.each(["labs.csv", "notes.md", "notes.txt"])("says %s is UTF-8", async (name) => {
      localStorage.setItem(ACCESS_TOKEN, "jwt-abc");
      const types = [];
      vi.stubGlobal("fetch", async () => fileResponse(encode("值,单位\n"), "text/plain"));
      vi.stubGlobal("URL", { createObjectURL: () => "blob:x", revokeObjectURL: () => {} });
      vi.stubGlobal("Blob", class {
        constructor(parts, opts) { types.push(opts?.type); }
      });

      await openProtectedFile(`uploads/${name}`, name);
      expect(types).toEqual(["text/plain;charset=utf-8"]);
    });

    // A tab opened before the fetch and pointed at the blob afterwards stayed
    // blank on iOS: opening it suspends this page (thetahealth/mirobody#361).
    it.each([
      ["report.pdf", "application/pdf", PDF],
      ["scan.png", "image/png", PNG],
    ])("shows %s in the page and opens no tab", async (name, contentType, bytes) => {
      localStorage.setItem(ACCESS_TOKEN, "jwt-abc");
      const open = vi.fn();
      vi.stubGlobal("window", { open });
      vi.stubGlobal("fetch", async () => fileResponse(bytes, contentType));
      vi.stubGlobal("URL", { createObjectURL: () => "blob:x", revokeObjectURL: () => {} });
      vi.stubGlobal("Blob", class { constructor() {} });

      expect(await openProtectedFile(`uploads/${name}`, name)).toBeNull();
      expect(open).not.toHaveBeenCalled();
      expect(viewer().view.url).toBe("blob:x");
    });

    // A tab pointed at an octet-stream blob stayed on about:blank and saved
    // nothing for an .xlsx (Chrome 158, thetahealth/mirobody#341).
    describe("a type that does not render in place", () => {
      let clicked;
      let types;
      let open;

      beforeEach(() => {
        localStorage.setItem(ACCESS_TOKEN, "jwt-abc");
        clicked = [];
        types = [];
        open = vi.fn();
        vi.stubGlobal("window", { open });
        vi.stubGlobal("document", makeDocument(clicked));
        vi.stubGlobal("URL", { createObjectURL: () => "blob:x", revokeObjectURL: () => {} });
        vi.stubGlobal("Blob", class {
          constructor(parts, opts) { types.push(opts?.type); }
        });
        vi.stubGlobal("setTimeout", () => 0);
      });

      it("downloads under the file's own name and opens no tab", async () => {
        vi.stubGlobal("fetch", async () =>
          fileResponse(encode("PK\u0003\u0004"), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
        );

        const reason = await openProtectedFile("web_uploads/3a91.xlsx", "you_lab_results_en_2025-03.xlsx");

        expect(reason).toBeNull();
        expect(open).not.toHaveBeenCalled();
        expect(viewer().view).toBeNull();
        expect(types).toEqual(["application/octet-stream"]);
        expect(clicked).toEqual([{ href: "blob:x", download: "you_lab_results_en_2025-03.xlsx", attached: true }]);
      });

      it("names the download after the key when no name is given", async () => {
        vi.stubGlobal("fetch", async () => fileResponse(encode("PK\u0003\u0004"), "application/octet-stream"));

        await openProtectedFile("/files/web_uploads/3a91.xlsx?v=1");

        expect(clicked[0].download).toBe("3a91.xlsx");
      });

      it("still refuses a 200 index.html, and downloads nothing", async () => {
        vi.stubGlobal("fetch", async () => fileResponse(INDEX_HTML, "text/html; charset=utf-8"));

        expect(await openProtectedFile("uploads/a.xlsx", "a.xlsx")).toBe("file_view_not_file");
        expect(clicked).toEqual([]);
      });
    });

    it("shows the viewer as loading before it awaits the file", async () => {
      localStorage.setItem(ACCESS_TOKEN, "jwt-abc");
      let atFetch;
      vi.stubGlobal("fetch", async () => {
        atFetch = viewer().view;
        return fileResponse(PDF, "application/pdf");
      });
      vi.stubGlobal("URL", { createObjectURL: () => "blob:x", revokeObjectURL: () => {} });
      vi.stubGlobal("Blob", class { constructor() {} });

      await openProtectedFile("uploads/a.pdf", "a.pdf");
      expect(atFetch).toMatchObject({ name: "a.pdf", url: null });
    });

    it("stops the download, and reports nothing, when the viewer is closed first", async () => {
      localStorage.setItem(ACCESS_TOKEN, "jwt-abc");
      let signal;
      vi.stubGlobal("fetch", (_, options) => {
        signal = options.signal;
        return untilAborted(options.signal);
      });

      const pending = openProtectedFile("uploads/a.pdf", "a.pdf");
      viewer().close();

      expect(await pending).toBeNull();
      expect(signal.aborted).toBe(true);
    });

    it("lets a second file take the viewer and frees the first one's bytes", async () => {
      localStorage.setItem(ACCESS_TOKEN, "jwt-abc");
      const revoked = [];
      let n = 0;
      vi.stubGlobal("fetch", async () => fileResponse(PDF, "application/pdf"));
      vi.stubGlobal("URL", {
        createObjectURL: () => `blob:${(n += 1)}`,
        revokeObjectURL: (url) => revoked.push(url),
      });
      vi.stubGlobal("Blob", class { constructor() {} });

      await openProtectedFile("uploads/a.pdf", "a.pdf");
      await openProtectedFile("uploads/b.pdf", "b.pdf");

      expect(viewer().view).toMatchObject({ name: "b.pdf", url: "blob:2" });
      expect(revoked).toEqual(["blob:1"]);
      viewer().close();
      expect(revoked).toEqual(["blob:1", "blob:2"]);
    });

    // The viewer is open before the request starts, so any way the request
    // can go wrong without throwing ends with it spinning and no toast.
    describe("when the answer is not the file, or never comes", () => {
      let types;

      beforeEach(() => {
        vi.useFakeTimers();
        localStorage.setItem(ACCESS_TOKEN, "jwt-abc");
        types = [];
        vi.stubGlobal("URL", { createObjectURL: () => "blob:x", revokeObjectURL: () => {} });
        vi.stubGlobal("Blob", class {
          constructor(parts, opts) { types.push(opts?.type); }
        });
      });

      afterEach(() => {
        vi.useRealTimers();
      });

      it.each([
        ["the headers never come", (_, { signal }) => untilAborted(signal)],
        // A timer cleared once the headers arrive would miss this one.
        [
          "the body stops after the headers",
          async (_, { signal }) => ({
            ok: true,
            status: 200,
            headers: new Headers({ "Content-Type": "application/pdf" }),
            arrayBuffer: () => untilAborted(signal),
          }),
        ],
      ])("gives up and closes the viewer when %s", async (_, fetchImpl) => {
        vi.stubGlobal("fetch", fetchImpl);

        const pending = openProtectedFile("uploads/report.pdf", "report.pdf");
        await vi.advanceTimersByTimeAsync(FILE_FETCH_TIMEOUT_MS - 1);
        expect(viewer().view).not.toBeNull();

        await vi.advanceTimersByTimeAsync(1);
        expect(await pending).toBe("file_view_unavailable");
        expect(viewer().view).toBeNull();
      });

      it.each([
        ["report.pdf", "text/html; charset=utf-8"],
        // The page says it is a PDF; its bytes say otherwise.
        ["report.pdf", "application/pdf"],
        ["scan.png", "text/html; charset=utf-8"],
        ["labs.csv", "text/html; charset=utf-8"],
      ])("refuses a 200 index.html for %s served as %s", async (name, contentType) => {
        vi.stubGlobal("fetch", async () => fileResponse(INDEX_HTML, contentType));

        expect(await openProtectedFile(`uploads/${name}`, name)).toBe("file_view_not_file");
        expect(viewer().view).toBeNull();
        expect(types).toEqual([]);
      });

      it.each([
        ["report.pdf", "application/pdf", PDF],
        // Viewers take a header anywhere in the first 1024 bytes; so does this.
        ["scan.pdf", "application/pdf", new Uint8Array([...encode("\r\n\r\n"), ...PDF])],
        ["scan.png", "image/png", PNG],
        // A stored key whose extension differs from the name: still an image,
        // and the browser sniffs which.
        ["scan.png", "image/jpeg", PNG],
        ["labs.csv", "text/csv", encode("date,value\n")],
      ])("still opens %s served as %s", async (name, contentType, bytes) => {
        vi.stubGlobal("fetch", async () => fileResponse(bytes, contentType));

        expect(await openProtectedFile(`uploads/${name}`, name)).toBeNull();
        expect(viewer().view.url).toBe("blob:x");
      });
    });
  });
});
