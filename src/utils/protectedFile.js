/**
 * Opening a file the backend now protects.
 *
 * `GET /files/<key>` used to be unauthenticated: anyone who knew or guessed a
 * key got the bytes, and the keys are `<second-resolution timestamp>_<8 hex>`.
 * It serves health reports, so that was a PHI leak, and it is fixed on the
 * backend — the route requires a token and checks that the caller owns the
 * file or has care-circle access to it.
 *
 * A bare `<a href="/files/...">` therefore 401s now. A browser cannot put an
 * Authorization header on a navigation, an `<img src>` or a PDF embed, so the
 * file has to be fetched by script and handed to the page as a blob.
 *
 * **Why not `?access_token=` in the URL.** The backend accepts it, for clients
 * that genuinely cannot do this (embeds, curl). We do not use it here: a token
 * in a URL lands in browser history, in the address bar over someone's
 * shoulder, in `Referer` on any sub-resource the viewer loads, and in every
 * access log between here and the server. That is the same class of leak the
 * backend fix just closed.
 *
 * **Why the MIME type is forced.** A blob: URL inherits the origin of the page
 * that created it, so opening an uploaded `.svg` or `.xml` as its own type
 * would execute its script on our origin with the user's session — turning an
 * upload into stored XSS. Only formats that cannot execute are rendered
 * inline; everything else is handed over as a download.
 *
 * **Why a 200 is checked.** Because the type comes from the file name and not
 * from the response, a 200 that is not the file still opened: a reverse proxy
 * that answers `/files/` with the app's own index.html, or with a login page,
 * showed an empty PDF viewer and no error. The body is checked against what
 * the file should be before it is shown or saved.
 *
 * **Why there is a timeout.** The viewer shows the file as loading before the
 * request starts, so a request that never finishes would leave it spinning for
 * good, with no toast.
 */

import { ACCESS_TOKEN } from "../enum/storage";
import { useFileViewStore } from "../store/fileView";
import { getApiBaseUrl } from "./index";

/**
 * The longest a file may take, headers and body together. The upload limit is
 * 20 MB (`MAX_FILE_SIZE`), which needs about 2.8 Mbit/s to arrive in a minute,
 * and a minute is nginx's default `proxy_read_timeout`: behind a proxy, a
 * request with no answer by then is not going to get one.
 */
export const FILE_FETCH_TIMEOUT_MS = 60_000;

/**
 * Viewers accept a PDF whose header is anywhere in its first 1024 bytes (PDF
 * 1.7 reference, Appendix H, note 13), so a check at offset 0 would refuse
 * files that open fine.
 */
const PDF_HEADER_WINDOW = 1024;

/**
 * Types safe to render in place. Deliberately excludes svg and xml.
 *
 * Text says UTF-8. Without a charset the browser guessed from the page
 * locale, and in Simplified Chinese a UTF-8 lab report opened with its
 * punctuation as mojibake (iOS Safari, seen while checking
 * thetahealth/mirobody#361).
 */
const TEXT = "text/plain;charset=utf-8";
const INLINE_TYPES = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  tiff: "image/tiff",
  txt: TEXT,
  md: TEXT,
  markdown: TEXT,
  csv: TEXT,
};

const extensionOf = (name = "") => {
  const clean = String(name).split("?")[0].split("#")[0];
  const dot = clean.lastIndexOf(".");
  return dot === -1 ? "" : clean.slice(dot + 1).toLowerCase();
};

// The last path segment of a key or URL, for a download with no name given.
const baseNameOf = (keyOrUrl = "") =>
  String(keyOrUrl).split("?")[0].split("#")[0].split("/").pop() || "download";

// A download of `url` named `name`. In the document while clicked: Firefox
// ignores a click on a detached anchor.
const saveAs = (url, name) => {
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
};

/**
 * Whether a 200 body is the file asked for, or a page standing in for it.
 *
 * A PDF is checked by its bytes. An image by the declared type, which the
 * backend derives from the stored key's extension; any `image/` is accepted
 * because the browser sniffs the format, and the forced blob type, not this
 * check, is what keeps an svg from running. Anything else only has to not be
 * HTML, so a `.csv` does not open as the app's own markup or a `.docx` does
 * not download as a login page.
 */
const isTheFile = (ext, contentType, bytes) => {
  if (ext === "pdf") {
    const head = String.fromCharCode(...bytes.subarray(0, PDF_HEADER_WINDOW));
    return head.includes("%PDF-");
  }
  if (INLINE_TYPES[ext]?.startsWith("image/")) return contentType.startsWith("image/");
  return ext === "html" || ext === "htm" || !contentType.startsWith("text/html");
};

/**
 * Resolve a file key or a (possibly relative) URL into an absolute one.
 * `url_full` from the backend is relative when MCP_PUBLIC_URL is unset, which
 * is the default for a self-hosted deployment.
 */
export const resolveFileUrl = (keyOrUrl) => {
  const s = String(keyOrUrl || "");
  if (/^https?:\/\//i.test(s)) return s;
  const base = getApiBaseUrl() || "";
  const path = s.startsWith("/files/") ? s : `/files/${s.replace(/^\/+/, "")}`;
  return `${base}${path}`;
};

/**
 * Fetch a protected file and show it in the page's own viewer, or save it when
 * it is a type that does not render in place.
 *
 * In the page, not in a new tab. A tab had to be opened before the await (one
 * opened after it is what popup blockers block) and was pointed at the blob
 * once it arrived. On a phone that tab is the whole screen: it sat on a blank
 * about:blank, with nothing to say a file was coming, for as long as the file
 * took (tens of seconds while thetahealth/mirobody#360 slowed photos down),
 * and on one reporter's iPhone it never filled in (thetahealth/mirobody#361).
 * The viewer shows progress, needs no popup, and offers the new tab as a link
 * of its own, which the person's own tap opens.
 *
 * A type outside INLINE_TYPES gets no viewer. Pointing a tab at an
 * `application/octet-stream` blob left it on about:blank with nothing in the
 * downloads folder for an .xlsx (Chrome 158; thetahealth/mirobody#341): a
 * blob navigation carries no file name, so the browser had nothing to save it
 * as. An `<a download>` names the file.
 *
 * @returns {Promise<null|string>} null on success, or when the person closed
 *   the viewer before the file arrived; else a reason key for i18n.
 */
export const openProtectedFile = async (keyOrUrl, fileName = "") => {
  const token = localStorage.getItem(ACCESS_TOKEN);
  if (!token) return "file_view_unauthorized";

  const ext = extensionOf(fileName || keyOrUrl);
  const inlineType = INLINE_TYPES[ext];
  const name = fileName || baseNameOf(keyOrUrl);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FILE_FETCH_TIMEOUT_MS);
  const viewer = useFileViewStore.getState();
  // Open at once, so the tap visibly did something while the file loads.
  // Closing it stops the download.
  const viewId = inlineType ? viewer.begin(name, () => controller.abort()) : null;
  const fail = (reason) => {
    if (viewId !== null) viewer.close(viewId);
    return reason;
  };

  try {
    const response = await fetch(resolveFileUrl(keyOrUrl), {
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    });

    if (!response.ok) {
      // 404 covers "not yours" as well as "not there" — the backend answers
      // both identically on purpose, so a key cannot be probed for existence.
      return fail(
        response.status === 401 ? "file_view_unauthorized" : "file_view_unavailable",
      );
    }

    // Still under the signal: a body that stalls after the headers leaves the
    // viewer spinning as surely as headers that never come.
    const bytes = new Uint8Array(await response.arrayBuffer());
    const contentType = (response.headers.get("content-type") || "").toLowerCase();
    if (!isTheFile(ext, contentType, bytes)) return fail("file_view_not_file");

    const url = URL.createObjectURL(
      new Blob([bytes], { type: inlineType || "application/octet-stream" }),
    );

    if (viewId !== null) {
      // The store revokes the URL when the viewer closes; one closed while
      // the bytes were on their way is not there to do it.
      if (!viewer.show(viewId, url, inlineType)) URL.revokeObjectURL(url);
    } else {
      saveAs(url, name);
      // Long enough for the download to start; the blob is held by the
      // browser until then and leaks memory for the session if never revoked.
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    }
    return null;
  } catch {
    // A timeout lands here too: the abort rejects the pending fetch or read.
    // So does the person closing the viewer, which is not a failure to report.
    if (viewId !== null && !viewer.isOpen(viewId)) return null;
    return fail("file_view_unavailable");
  } finally {
    clearTimeout(timer);
  }
};
