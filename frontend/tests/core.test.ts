import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import {
  validateName,
  parse,
  mapSchema,
  type Player,
  type Snapshot,
} from "../src/protocol";
import { Store, InputBuffer } from "../src/state";
import {
  cameraBounds,
  renderWindow,
  SpatialIndex,
  intersects,
  chunkKeys,
} from "../src/spatial";
import { Network, retryDelay } from "../src/network";
const player: Player = {
  id: "p1",
  name: "Гоблин",
  role: "active",
  slot: 0,
  x: 100,
  y: 100,
  w: 32,
  h: 46,
  hp: 100,
  artifacts: 0,
  pvpKills: 0,
  monsterKills: 0,
  connected: true,
  alive: true,
  facing: 1,
  state: "idle",
  lastProcessedInputSeq: 0,
  queue: 0,
};
const snapshot: Snapshot = {
  phase: "playing",
  remaining: 100,
  players: [player],
  monsters: [],
  artifacts: [],
  result: null,
};
const msg = (type: string, data: unknown, roundID = 1, serverTick = 1) =>
  JSON.stringify({ protocolVersion: 1, type, data, roundID, serverTick });
describe("protocol and state", () => {
  it("validates Unicode names", () => {
    expect(validateName("  Ведьма 🐸 ")).toBeNull();
    for (const name of ["", "   ", "a\nb", "x".repeat(17)])
      expect(validateName(name)).not.toBeNull();
  });
  it("rejects malformed version and DTO", () => {
    expect(() => parse("{")).toThrow();
    expect(() => parse(msg("snapshot", {}))).toThrow();
    expect(() =>
      parse(
        JSON.stringify({
          protocolVersion: 2,
          type: "snapshot",
          data: snapshot,
          roundID: 1,
          serverTick: 1,
        }),
      ),
    ).toThrow();
  });
  it("stops input immediately on death and handles promotion", () => {
    const s = new Store();
    s.id = "p1";
    s.connection = "connected";
    s.apply(msg("snapshot", snapshot));
    expect(s.canInput).toBe(true);
    s.input.push({ left: true, right: false, jump: false, attack: false });
    s.apply(
      msg(
        "player.died",
        {
          id: 1,
          type: "player.died",
          source: "m1",
          target: "p1",
          cause: "melee",
          amount: 25,
          serverTick: 2,
        },
        1,
        2,
      ),
    );
    expect(s.canInput).toBe(false);
    expect(s.input.pending).toHaveLength(0);
    s.apply(msg("snapshot", snapshot, 2, 3));
    expect(s.canInput).toBe(true);
  });
  it("acks inputs and preserves sequence after reconnect", () => {
    const b = new InputBuffer();
    const buttons = { left: false, right: true, jump: false, attack: false };
    b.push(buttons);
    b.push(buttons);
    b.ack(1);
    expect(b.pending.map((i) => i.seq)).toEqual([2]);
    b.ack(80);
    expect(b.push(buttons).seq).toBe(81);
    b.clear();
    expect(b.pending).toHaveLength(0);
  });
  it("discards old rounds, stale snapshots and duplicate events", () => {
    const s = new Store();
    s.apply(msg("snapshot", snapshot, 2, 10));
    s.apply(msg("snapshot", { ...snapshot, remaining: 1 }, 1, 11));
    s.apply(msg("snapshot", { ...snapshot, remaining: 2 }, 2, 9));
    expect(s.snapshot?.remaining).toBe(100);
    const e = {
      id: 1,
      type: "damage",
      source: "m1",
      target: "p1",
      cause: "melee",
      amount: 25,
      serverTick: 12,
    };
    s.apply(msg("damage", e, 2, 12));
    s.apply(msg("damage", e, 2, 12));
    expect(s.events).toHaveLength(1);
  });
  it("clears previous round and bounds snapshot history", () => {
    const s = new Store();
    for (let i = 1; i <= 30; i++) s.apply(msg("snapshot", snapshot, 1, i), i);
    expect(s.history).toHaveLength(12);
    s.apply(msg("snapshot", snapshot, 2, 31));
    expect(s.history).toHaveLength(1);
    expect(s.events).toHaveLength(0);
    expect(s.map).toBeNull();
  });
  it.each(["p1", ""])("accepts server result winner=%s", (winner) => {
    const s = new Store();
    s.apply(
      msg("result", {
        winner,
        reason: winner ? "five_artifacts" : "timeout",
        standings: [player],
      }),
    );
    expect(s.result?.winner).toBe(winner);
  });
});
describe("viewport", () => {
  const maps = readdirSync("../backend/maps")
    .filter((n) => n.endsWith(".json"))
    .map((n) =>
      mapSchema.parse(JSON.parse(readFileSync(`../backend/maps/${n}`, "utf8"))),
    );
  it.each(maps)("bounds camera on $id", (map) => {
    for (const [x, y] of [
      [-100, -100],
      [map.width + 100, map.height + 100],
      [500, 500],
    ]) {
      const c = cameraBounds(x, y, 1100, 650, map);
      expect(c.x).toBeGreaterThanOrEqual(0);
      expect(c.y).toBeGreaterThanOrEqual(0);
      expect(c.x + c.w).toBeLessThanOrEqual(map.width);
      expect(c.y + c.h).toBeLessThanOrEqual(map.height);
    }
    expect(cameraBounds(0, 0, 1100, 650, map).w).toBeLessThan(map.width);
  });
  it("selects visible geometry crossing chunks", () => {
    const near = { x: 490, y: 10, w: 200, h: 20 };
    const far = { x: 2500, y: 10, w: 40, h: 20 };
    const index = new SpatialIndex([near, far]);
    const window = renderWindow({ x: 0, y: 0, w: 900, h: 600 });
    expect(chunkKeys(window).length).toBeGreaterThan(1);
    expect(index.query(window)).toEqual([near]);
    expect(index.query(window).every((r) => intersects(r, window))).toBe(true);
  });
  it("preserves offscreen network state", () => {
    const s = new Store();
    const far = { ...player, id: "far", x: 2900 };
    s.apply(msg("snapshot", { ...snapshot, players: [player, far] }));
    expect(
      s.snapshot!.players.filter((p) =>
        intersects(p, renderWindow({ x: 0, y: 0, w: 1000, h: 650 })),
      ),
    ).toHaveLength(1);
    expect(s.snapshot?.players).toHaveLength(2);
  });
});
class MockSocket {
  static OPEN = 1;
  static instances: MockSocket[] = [];
  readyState = 1;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  sent: string[] = [];
  constructor(public url: string) {
    MockSocket.instances.push(this);
  }
  send(s: string) {
    this.sent.push(s);
  }
  close() {
    this.onclose?.();
  }
  receive(s: string) {
    this.onmessage?.({ data: s });
  }
}
describe("reconnect", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    MockSocket.instances = [];
  });
  it("resumes token and disables disconnected inputs", () => {
    vi.useFakeTimers();
    const memory = new Map<string, string>();
    vi.stubGlobal("sessionStorage", {
      getItem: (k: string) => memory.get(k) ?? null,
      setItem: (k: string, v: string) => memory.set(k, v),
      removeItem: (k: string) => memory.delete(k),
    });
    vi.stubGlobal("WebSocket", MockSocket);
    const s = new Store();
    const n = new Network(s, "ws://localhost");
    n.connect("a");
    let socket = MockSocket.instances.at(-1)!;
    socket.onopen?.();
    expect(JSON.parse(socket.sent[0]).type).toBe("hello");
    socket.receive(
      msg("welcome", {
        playerID: "p1",
        token: "opaque",
        role: "active",
        queue: 0,
      }),
    );
    socket.receive(msg("snapshot", snapshot));
    expect(s.canInput).toBe(true);
    socket.close();
    expect(s.connection).toBe("reconnecting");
    expect(s.canInput).toBe(false);
    vi.advanceTimersByTime(500);
    socket = MockSocket.instances.at(-1)!;
    socket.onopen?.();
    expect(JSON.parse(socket.sent[0])).toMatchObject({
      type: "resume",
      token: "opaque",
    });
    socket.receive(
      msg("welcome", {
        playerID: "p1",
        token: "opaque",
        role: "active",
        queue: 0,
      }),
    );
    expect(s.connection).toBe("connecting");
    socket.receive(msg("snapshot", snapshot));
    expect(s.connection).toBe("connected");
    n.destroy();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("caps backoff", () => {
    expect(retryDelay(0)).toBe(500);
    expect(retryDelay(10)).toBe(8000);
  });
});

it("processes session-expired control errors after server restart", () => {
  const s = new Store();
  s.apply(msg("snapshot", snapshot, 9, 900));
  expect(s.apply(msg("error", { code: "session_expired" }, 0, 1))?.type).toBe(
    "error",
  );
  expect(s.roundID).toBe(9);
});
