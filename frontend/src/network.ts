import { Store } from "./state";
import { z } from "zod";
const welcome = z.object({
  playerID: z.string(),
  token: z.string(),
  role: z.string(),
  queue: z.number(),
});
const messages: Record<string, string> = {
  invalid_name: "Некорректное имя.",
  name_taken: "Это имя уже занято.",
  session_expired: "Сессия истекла. Войдите снова.",
  room_full: "Комната заполнена. Попробуйте позже.",
  protocol_mismatch: "Несовместимая версия игры. Обновите страницу.",
};
export const retryDelay = (attempt: number) =>
  Math.min(8000, 500 * 2 ** attempt);
export class Network {
  socket: WebSocket | null = null;
  timer: ReturnType<typeof setTimeout> | undefined;
  heartbeat: ReturnType<typeof setInterval>;
  attempt = 0;
  stopped = true;
  name = "";
  generation = 0;
  constructor(
    public store: Store,
    public url: string,
  ) {
    this.heartbeat = setInterval(() => {
      if (this.socket?.readyState === WebSocket.OPEN)
        this.send("ping", { nonce: performance.now() });
      if (
        store.connection === "connected" &&
        store.lastSnapshotAt &&
        performance.now() - store.lastSnapshotAt > 2500
      )
        store.connection = "unstable";
    }, 1500);
  }
  connect(name: string) {
    this.stop();
    this.name = name;
    this.stopped = false;
    this.attempt = 0;
    this.store.reset();
    this.store.error = "";
    this.open();
  }
  open() {
    if (this.stopped) return;
    const gen = ++this.generation;
    const token = sessionStorage.getItem("artifact-session");
    this.store.connection = this.attempt ? "reconnecting" : "connecting";
    const socket = new WebSocket(this.url);
    this.socket = socket;
    const handshake = setTimeout(() => socket.close(), 7000);
    socket.onopen = () => {
      if (gen !== this.generation) return;
      this.send(
        token ? "resume" : "hello",
        token ? { token } : { name: this.name },
      );
    };
    socket.onmessage = (e) => {
      if (gen !== this.generation) return;
      try {
        const m = this.store.apply(String(e.data));
        if (!m) return;
        if (m.type === "welcome") {
          clearTimeout(handshake);
          const w = welcome.parse(m.data);
          sessionStorage.setItem("artifact-session", w.token);
          this.store.id = w.playerID;
          this.store.role = w.role;
          this.store.queue = w.queue;
          this.store.tick = -1;
          this.store.history = [];
          this.store.connection = "connecting";
          this.store.error = "";
          this.attempt = 0;
        }
        if (m.type === "snapshot") {
          this.store.connection = "connected";
        }
        if (m.type === "pong") {
          this.store.latency = Math.round(
            performance.now() -
              z.object({ nonce: z.number() }).parse(m.data).nonce,
          );
        }
        if (m.type === "role") {
          const d = z
            .object({ role: z.string(), queue: z.number() })
            .parse(m.data);
          this.store.role = d.role;
          this.store.queue = d.queue;
        }
        if (m.type === "error") {
          const code = z.object({ code: z.string() }).parse(m.data).code;
          this.store.error = messages[code] ?? "Сервер отклонил сообщение.";
          if (code === "session_expired") {
            sessionStorage.removeItem("artifact-session");
            if (this.attempt === 0) {
              this.generation++;
              socket.close();
              clearTimeout(handshake);
              this.store.reset();
              this.open();
              return;
            }
            this.store.connection = "expired";
          } else this.store.connection = "lost";
          this.stopped = true;
          socket.close();
        }
      } catch {
        this.store.error = "Некорректное сообщение или версия протокола.";
        this.stopped = true;
        this.store.connection = "lost";
        socket.close();
      }
    };
    socket.onerror = () => {
      this.store.error = "Сервер недоступен.";
    };
    socket.onclose = () => {
      clearTimeout(handshake);
      if (gen !== this.generation || this.stopped) return;
      this.store.input.clear();
      if (this.attempt >= 7) {
        this.store.connection = "lost";
        this.store.error = "Соединение потеряно. Подключитесь снова.";
        return;
      }
      this.store.connection = "reconnecting";
      this.timer = setTimeout(() => {
        this.attempt++;
        this.open();
      }, retryDelay(this.attempt));
    };
  }
  send(type: string, data: Record<string, unknown> = {}) {
    if (this.socket?.readyState === WebSocket.OPEN)
      this.socket.send(
        JSON.stringify({
          protocolVersion: 1,
          type,
          roundID: this.store.roundID,
          ...data,
        }),
      );
  }
  stop() {
    this.stopped = true;
    this.generation++;
    clearTimeout(this.timer);
    this.socket?.close();
    this.socket = null;
    this.store.input.clear();
  }
  destroy() {
    this.stop();
    clearInterval(this.heartbeat);
  }
}
