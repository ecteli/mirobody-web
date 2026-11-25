/**
 * `pagehide` shuts the manager down, and a page put in the back-forward cache
 * comes back with that same instance. Its socket reopened, but its elector was
 * dead, so `sendMessage` passed every message to a closed channel and said it
 * was sent: the upload showed as started and the server never heard of it
 * (thetahealth/mirobody#361).
 */
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";

const fake = vi.hoisted(() => ({ channels: [], electors: [] }));

vi.mock("broadcast-channel", () => ({
  BroadcastChannel: class {
    constructor(name) {
      this.name = name;
      this.closed = false;
      fake.channels.push(this);
    }
    postMessage() {
      if (this.closed) throw new Error("BroadcastChannel is closed");
    }
    close() {
      this.closed = true;
    }
  },
  // The only tab. As in broadcast-channel 7: leader once awaited, the first
  // awaitLeadership() promise is kept and handed back again, also after die().
  createLeaderElection: () => {
    const elector = {
      isLeader: false,
      isDead: false,
      awaited: null,
      awaitLeadership() {
        if (!this.awaited) {
          this.isLeader = true;
          this.awaited = Promise.resolve();
        }
        return this.awaited;
      },
      die() {
        this.isDead = true;
        this.isLeader = false;
        return Promise.resolve();
      },
    };
    fake.electors.push(elector);
    return elector;
  },
}));

vi.mock("../../store/Drive/index.js", () => ({
  useDriveStore: { getState: () => ({ current_drive_user_id: "7" }) },
}));

class FakeSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 3;
  static opened = [];

  constructor(url) {
    this.url = url;
    this.sent = [];
    this.readyState = FakeSocket.CONNECTING;
    this.listeners = { open: new Set(), close: new Set() };
    FakeSocket.opened.push(this);
    queueMicrotask(() => {
      this.readyState = FakeSocket.OPEN;
      this.onopen?.();
      this.listeners.open.forEach((fn) => fn());
    });
  }
  addEventListener(type, fn) {
    this.listeners[type]?.add(fn);
  }
  removeEventListener(type, fn) {
    this.listeners[type]?.delete(fn);
  }
  send(data) {
    this.sent.push(data);
  }
  close() {
    this.readyState = FakeSocket.CLOSED;
  }
}

// What reached a socket besides its heartbeat, which it sends on opening.
const uploads = (socket) => socket.sent.filter((data) => JSON.parse(data).type !== "ping");

const makeStorage = (entries = {}) => {
  const map = new Map(Object.entries(entries));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
};

describe("WebSocketManager after pagehide", () => {
  let getWebSocketManager;
  let pageListeners;

  beforeEach(async () => {
    fake.channels.length = 0;
    fake.electors.length = 0;
    FakeSocket.opened = [];
    pageListeners = {};
    vi.stubGlobal("window", {
      addEventListener: (type, fn) => {
        pageListeners[type] = fn;
      },
    });
    vi.stubGlobal("WebSocket", FakeSocket);
    vi.stubGlobal("localStorage", makeStorage({ ACCESS_TOKEN: "jwt-abc" }));
    vi.stubGlobal("sessionStorage", makeStorage());
    vi.resetModules();
    ({ default: getWebSocketManager } = await import("./WebSocketManager.js"));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends again once the page is back", async () => {
    const manager = getWebSocketManager();
    await manager.ensureConnected();
    expect(manager.sendMessage({ type: "upload_start" })).toBe(true);
    expect(uploads(FakeSocket.opened[0])).toHaveLength(1);

    pageListeners.pagehide();
    expect(fake.electors[0].isDead).toBe(true);
    expect(fake.channels.every((c) => c.closed)).toBe(true);

    // The same instance: useUpload holds on to it in a ref.
    expect(getWebSocketManager()).toBe(manager);
    await manager.ensureConnected();
    expect(manager.sendMessage({ type: "upload_start" })).toBe(true);

    const socket = FakeSocket.opened.at(-1);
    expect(socket).not.toBe(FakeSocket.opened[0]);
    expect(uploads(socket)).toEqual([JSON.stringify({ type: "upload_start" })]);
    expect(fake.channels.filter((c) => !c.closed)).toHaveLength(2);
  });

  it("builds nothing new while it is still open", async () => {
    const manager = getWebSocketManager();
    await manager.ensureConnected();
    await manager.ensureConnected();
    manager.sendMessage({ type: "ping" });

    expect(fake.electors).toHaveLength(1);
    expect(fake.channels).toHaveLength(2);
    expect(FakeSocket.opened).toHaveLength(1);
  });
});
