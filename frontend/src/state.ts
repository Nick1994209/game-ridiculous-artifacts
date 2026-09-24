import {
  parse,
  mapSchema,
  snapshotSchema,
  resultSchema,
  eventSchema,
  type WorldMap,
  type Snapshot,
  type Result,
  type GameEvent,
  type Input,
} from "./protocol";
export class InputBuffer {
  seq = 0;
  pending: Input[] = [];
  push(buttons: Omit<Input, "seq">) {
    const input = { ...buttons, seq: ++this.seq };
    this.pending.push(input);
    if (this.pending.length > 120) this.pending.shift();
    return input;
  }
  ack(seq: number) {
    this.seq = Math.max(this.seq, seq);
    this.pending = this.pending.filter((i) => i.seq > seq);
  }
  clear() {
    this.pending = [];
  }
}
export type Connection =
  | "idle"
  | "connecting"
  | "connected"
  | "unstable"
  | "reconnecting"
  | "lost"
  | "expired";
export class Store {
  id = "";
  roundID = 0;
  tick = -1;
  map: WorldMap | null = null;
  snapshot: Snapshot | null = null;
  result: Result | null = null;
  connection: Connection = "idle";
  error = "";
  latency = 0;
  target = "";
  role = "spectator";
  queue = 0;
  events: GameEvent[] = [];
  seen = new Set<number>();
  history: { time: number; snapshot: Snapshot }[] = [];
  input = new InputBuffer();
  lastSnapshotAt = 0;
  snapshotCount = 0;
  get self() {
    return this.snapshot?.players.find((p) => p.id === this.id);
  }
  get canInput() {
    return (
      this.connection === "connected" &&
      this.snapshot?.phase === "playing" &&
      this.self?.role === "active" &&
      this.self.alive === true
    );
  }
  apply(raw: string, time = performance.now()) {
    const m = parse(raw);
    if (["welcome", "error", "pong"].includes(m.type)) return m;
    if (m.roundID < this.roundID) return null;
    if (m.roundID > this.roundID) {
      this.roundID = m.roundID;
      this.tick = -1;
      this.snapshot = null;
      this.result = null;
      this.history = [];
      this.events = [];
      this.seen.clear();
      this.input.clear();
      this.target = "";
      this.map = null;
    }
    if (m.type === "map") {
      this.map = mapSchema.parse(m.data);
    }
    if (m.type === "snapshot") {
      if (m.serverTick <= this.tick) return null;
      this.tick = m.serverTick;
      this.snapshot = snapshotSchema.parse(m.data);
      this.result = this.snapshot.result;
      this.history.push({ time, snapshot: this.snapshot });
      this.history = this.history.slice(-12);
      this.lastSnapshotAt = time;
      this.snapshotCount++;
      const p = this.self;
      if (p) {
        this.role = p.role;
        this.queue = p.queue;
        this.input.ack(p.lastProcessedInputSeq);
      }
      if (!this.canInput) this.input.clear();
    }
    if (m.type === "result") this.result = resultSchema.parse(m.data);
    if (
      ![
        "map",
        "snapshot",
        "result",
        "welcome",
        "pong",
        "role",
        "spectate",
        "error",
      ].includes(m.type)
    ) {
      const e = eventSchema.parse(m.data);
      if (this.seen.has(e.id)) return null;
      this.seen.add(e.id);
      if (this.seen.size > 512)
        this.seen.delete(this.seen.values().next().value!);
      this.events.push(e);
      this.events = this.events.slice(-32);
      if (e.type === "player.died" && e.target === this.id) {
        if (this.self) {
          this.self.alive = false;
          this.self.role = "spectator";
        }
        this.role = "spectator";
        this.input.clear();
      }
    }
    return m;
  }
  reset() {
    this.id = "";
    this.role = "spectator";
    this.queue = 0;
    this.lastSnapshotAt = 0;
    this.snapshotCount = 0;
    this.roundID = 0;
    this.tick = -1;
    this.map = null;
    this.snapshot = null;
    this.result = null;
    this.history = [];
    this.events = [];
    this.seen.clear();
    this.input.clear();
    this.input.seq = 0;
    this.target = "";
  }
}
