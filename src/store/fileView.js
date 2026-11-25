import { create } from "zustand";

/**
 * The file shown in the in-page viewer (components/FileViewOverlay), if any.
 *
 * `view` is `{ id, name, url, type }`: `url` is null while the file is still
 * being fetched, then an object URL this store owns and revokes when the view
 * closes. `id` tells a late answer for a view the person already closed, or
 * replaced with another file, from one for the view on screen.
 */
let lastId = 0;

export const useFileViewStore = create((set, get) => ({
  view: null,

  /** Show `name` as loading; `onClose` runs when the view goes away. */
  begin: (name, onClose) => {
    get().close();
    lastId += 1;
    set({ view: { id: lastId, name, url: null, type: null, onClose } });
    return lastId;
  },

  /** Fill view `id` in. False when it is no longer on screen. */
  show: (id, url, type) => {
    const view = get().view;
    if (!view || view.id !== id) return false;
    set({ view: { ...view, url, type } });
    return true;
  },

  isOpen: (id) => get().view?.id === id,

  /** Close view `id`, or whichever is open when no id is given. */
  close: (id) => {
    const view = get().view;
    if (!view || (id !== undefined && view.id !== id)) return;
    set({ view: null });
    if (view.url) URL.revokeObjectURL(view.url);
    view.onClose?.();
  },
}));
