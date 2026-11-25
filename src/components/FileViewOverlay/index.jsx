import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { Spin } from "antd";
import { IconDownload, IconExternalLink, IconX } from "@tabler/icons-react";
import { useFileViewStore } from "../../store/fileView";
import styles from "./index.module.scss";

/**
 * The in-page viewer `openProtectedFile` shows a stored file in.
 *
 * Mounted once at the app root, because the files it shows are opened from
 * the Data page, the indicator drawer and chat citations alike. An image is
 * drawn as an image; a PDF or a text file in a frame, the browser's own
 * viewer. The two links are for what the old new tab gave: its own tab, and
 * a copy saved under the file's name.
 */
export default function FileViewOverlay() {
  const { t } = useTranslation();
  const view = useFileViewStore((s) => s.view);
  const close = useFileViewStore((s) => s.close);
  const closeButton = useRef(null);
  const viewId = view?.id;

  useEffect(() => {
    if (viewId === undefined) return undefined;
    closeButton.current?.focus();
    const onKey = (event) => {
      if (event.key === "Escape") close(viewId);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [viewId, close]);

  if (!view) return null;
  const { id, name, url, type } = view;
  const isImage = Boolean(type?.startsWith("image/"));

  return createPortal(
    <div className={styles.overlay} role="dialog" aria-modal="true" aria-label={name}>
      <div className={styles.header}>
        <div className={styles.name} title={name}>
          {name}
        </div>
        <div className={styles.actions}>
          {url && (
            <>
              <a
                className={styles.btn}
                href={url}
                target="_blank"
                rel="noopener"
                aria-label={t("file_view_open_tab")}
                title={t("file_view_open_tab")}
              >
                <IconExternalLink size={20} stroke={1.8} aria-hidden="true" />
              </a>
              <a
                className={styles.btn}
                href={url}
                download={name}
                aria-label={t("download")}
                title={t("download")}
              >
                <IconDownload size={20} stroke={1.8} aria-hidden="true" />
              </a>
            </>
          )}
          <button
            ref={closeButton}
            type="button"
            className={styles.btn}
            aria-label={t("close")}
            title={t("close")}
            onClick={() => close(id)}
          >
            <IconX size={20} stroke={2} aria-hidden="true" />
          </button>
        </div>
      </div>
      <div className={styles.body}>
        {!url && <Spin size="large" />}
        {url && isImage && <img className={styles.image} src={url} alt={name} />}
        {url && !isImage && <iframe className={styles.frame} src={url} title={name} />}
      </div>
    </div>,
    document.body,
  );
}
