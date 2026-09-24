import Phaser from "phaser";
import { Store } from "./state";
import type { Rect, Player, Monster, Artifact } from "./protocol";
import {
  VIEW,
  SpatialIndex,
  cameraBounds,
  renderWindow,
  chunkKeys,
  intersects,
  interpolate,
} from "./spatial";
const colors = [0x78e1bd, 0xf8c76c, 0xc3a4ff, 0x7fceff];
const symbols = ["Ⅰ", "Ⅱ", "Ⅲ", "Ⅳ"];
const icons = ["🥾", "🦷", "🧪", "🗺", "🔘", "🪨", "🥄", "☁"];
const themes: Record<string, number> = {
  attic: 0x252139,
  archive: 0x172e37,
  well: 0x18223b,
  market: 0x34233a,
  museum: 0x252b36,
};
type Static = Rect & { kind: "platform" | "hazard" };
export class GameScene extends Phaser.Scene {
  gfx!: Phaser.GameObjects.Graphics;
  labels = new Map<string, Phaser.GameObjects.Text>();
  index = new SpatialIndex<Static>([]);
  mapKey = "";
  visible = 0;
  total = 0;
  chunks = 0;
  debug = "";
  attacks = new Map<string, number>();
  effects: {
    x: number;
    y: number;
    text: string;
    color: string;
    until: number;
  }[] = [];
  seen = new Set<number>();
  lastFrame = 0;
  constructor(public store: Store) {
    super("world");
  }
  create() {
    this.gfx = this.add.graphics();
    this.events.once("shutdown", () => this.cleanup());
  }
  cleanup() {
    for (const t of this.labels.values()) t.destroy();
    this.labels.clear();
    this.effects = [];
    this.seen.clear();
    this.attacks.clear();
    this.index = new SpatialIndex([]);
    this.gfx?.clear();
    this.mapKey = "";
  }
  text(
    id: string,
    x: number,
    y: number,
    text: string,
    color = "#eee9df",
    size = 14,
  ) {
    let t = this.labels.get(id);
    if (!t) {
      t = this.add
        .text(x, y, text, {
          fontFamily: "system-ui",
          fontSize: size,
          color,
          stroke: "#15202a",
          strokeThickness: 3,
        })
        .setOrigin(0.5);
      this.labels.set(id, t);
    }
    t.setPosition(x, y).setText(text).setColor(color).setVisible(true);
    return t;
  }
  update(time: number, delta: number) {
    const { map, snapshot } = this.store;
    if (!map || !snapshot) {
      this.gfx.clear();
      for (const t of this.labels.values()) t.setVisible(false);
      return;
    }
    const key = `${this.store.roundID}:${map.id}:${map.version}`;
    if (key !== this.mapKey) {
      this.cleanup();
      this.mapKey = key;
      this.index = new SpatialIndex<Static>([
        ...[...map.platforms, ...map.walls].map((r) => ({
          ...r,
          kind: "platform" as const,
        })),
        ...map.hazards.map((r) => ({ ...r, kind: "hazard" as const })),
      ]);
      this.cameras.main.setBounds(0, 0, map.width, map.height);
      this.cameras.main.setBackgroundColor(themes[map.theme] ?? 0x202637);
    }
    const living = snapshot.players.filter((p) => p.alive && p.slot >= 0);
    const self = this.store.self;
    const focus =
      self?.alive && self.role === "active"
        ? self
        : this.store.target === "overview"
          ? undefined
          : (living.find((p) => p.id === this.store.target) ?? living[0]);
    const camera = this.cameras.main;
    const target = cameraBounds(
      focus ? focus.x + focus.w / 2 : map.width / 2,
      focus ? focus.y + focus.h / 2 : map.height / 2,
      VIEW.width,
      VIEW.height,
      map,
    );
    const factor = Math.min(1, delta / 100);
    camera.scrollX += (target.x - camera.scrollX) * factor;
    camera.scrollY += (target.y - camera.scrollY) * factor;
    const win = renderWindow({
      x: camera.scrollX,
      y: camera.scrollY,
      w: VIEW.width,
      h: VIEW.height,
    });
    this.chunks = chunkKeys(win).filter((k) => this.index.chunks.has(k)).length;
    const g = this.gfx;
    g.clear();
    for (const t of this.labels.values()) t.setVisible(false);
    // Only queried geometry is submitted to the renderer.
    for (const p of this.index.query(win)) {
      if (p.kind === "hazard") {
        g.fillStyle(0xf39089);
        for (let x = p.x; x < p.x + p.w; x += 18)
          g.fillTriangle(x, p.y + p.h, x + 9, p.y, x + 18, p.y + p.h);
      } else {
        g.fillStyle(0x101b29).fillRoundedRect(p.x, p.y + 7, p.w, p.h, 5);
        g.fillStyle(0x536266).fillRoundedRect(p.x, p.y, p.w, p.h, 5);
        g.fillStyle(0xa1b4a0).fillRect(p.x + 3, p.y, p.w - 6, 4);
      }
    }
    const remote = this.interpolated(performance.now());
    const entities = [
      ...remote.players,
      ...remote.monsters,
      ...snapshot.artifacts,
    ];
    this.total = entities.length;
    this.visible = 0;
    for (const e of entities) {
      if (!intersects(e, win)) continue;
      this.visible++;
      if ("name" in e) this.player(e, time);
      else if ("hp" in e) this.monster(e, time);
      else this.artifact(e, time);
    }
    for (const event of this.store.events) {
      if (this.seen.has(event.id)) continue;
      this.seen.add(event.id);
      if (event.type === "attack") this.attacks.set(event.source, time + 200);
      const source = entities.find(
        (p) =>
          p.id ===
          (event.type === "artifact.collected" ? event.source : event.target),
      );
      if (source && ["damage", "artifact.collected"].includes(event.type))
        this.effects.push({
          x: source.x + source.w / 2,
          y: source.y - 15,
          text: event.type === "damage" ? `−${event.amount}` : "+1 ◇",
          color: event.type === "damage" ? "#ffa397" : "#f8d890",
          until: time + 850,
        });
      if (event.type === "round.finished" && this.store.result?.winner) {
        const p = snapshot.players.find(
          (p) => p.id === this.store.result?.winner,
        );
        if (p)
          this.effects.push({
            x: p.x,
            y: p.y - 40,
            text: "✦ ПОБЕДА ✦",
            color: "#f8d890",
            until: time + 3000,
          });
      }
    }
    if (this.seen.size > 512)
      this.seen = new Set(this.store.events.map((e) => e.id));
    this.effects = this.effects.filter((e) => e.until > time);
    this.effects.forEach((e, i) => {
      if (intersects({ x: e.x, y: e.y, w: 80, h: 50 }, win))
        this.text(
          `fx${i}`,
          e.x,
          e.y - (850 - (e.until - time)) * 0.04,
          e.text,
          e.color,
          20,
        );
    });
    for (const [id, label] of this.labels)
      if (!label.visible) {
        label.destroy();
        this.labels.delete(id);
      }
    if (
      import.meta.env.DEV &&
      new URLSearchParams(location.search).has("debug")
    ) {
      g.lineStyle(2, 0xf8c76c, 0.5).strokeRect(win.x, win.y, win.w, win.h);
      g.lineStyle(1, 0x78e1bd, 0.6).strokeRect(
        camera.scrollX + 1,
        camera.scrollY + 1,
        VIEW.width - 2,
        VIEW.height - 2,
      );
      this.debug = `${Math.round(this.game.loop.actualFps)} FPS · ${this.visible}/${this.total} entities · ${this.chunks} chunks · ${this.store.history.length > 1 ? Math.round((1000 * (this.store.history.length - 1)) / (this.store.history.at(-1)!.time - this.store.history[0].time)) : 0} snapshots/s`;
    }
    this.lastFrame = time;
  }
  interpolated(now: number) {
    const h = this.store.history;
    const latest = this.store.snapshot!;
    if (this.store.connection !== "connected" || h.length < 2) return latest;
    const target = now - VIEW.interpolation;
    let a = h[0],
      b = h[0];
    for (const frame of h) {
      if (frame.time <= target) a = frame;
      if (frame.time >= target) {
        b = frame;
        break;
      }
      b = frame;
    }
    const alpha =
      a === b
        ? 1
        : Math.max(0, Math.min(1, (target - a.time) / (b.time - a.time)));
    return {
      ...latest,
      players: latest.players.map((p) =>
        p.id === this.store.id
          ? p
          : interpolate(
              b.snapshot.players.find((v) => v.id === p.id) ?? p,
              a.snapshot.players.find((v) => v.id === p.id),
              alpha,
            ),
      ),
      monsters: latest.monsters.map((p) =>
        interpolate(
          b.snapshot.monsters.find((v) => v.id === p.id) ?? p,
          a.snapshot.monsters.find((v) => v.id === p.id),
          alpha,
        ),
      ),
    };
  }
  player(p: Player, time: number) {
    if (p.slot < 0) return;
    const g = this.gfx;
    const color = colors[p.slot] ?? colors[0];
    const dead = !p.alive;
    const bob = p.state === "run" ? Math.sin(time / 65) * 2 : 0;
    const y = p.y + bob;
    g.fillStyle(0x080f1a, 0.3).fillEllipse(p.x + 16, p.y + p.h + 4, 40, 9);
    g.fillStyle(
      p.state === "hurt" ? 0xffffff : color,
      dead ? 0.25 : 1,
    ).fillRoundedRect(p.x, y + (dead ? 30 : 5), 32, dead ? 15 : 36, 9);
    if (!dead) {
      g.fillTriangle(p.x - 6, y + 9, p.x + 6, y - 4, p.x + 12, y + 12);
      g.fillTriangle(p.x + 20, y + 12, p.x + 29, y - 4, p.x + 39, y + 9);
      g.fillStyle(0x183138)
        .fillRect(p.x + 9, y + 16, 5, 7)
        .fillRect(p.x + 21, y + 16, 5, 7);
      g.fillStyle(0xe8e0c9).fillRect(p.x + 5, y + 34, 22, 5);
      g.fillStyle(0x172232)
        .fillRect(p.x + 3, y + 41, 10, 7)
        .fillRect(p.x + 21, y + 41, 10, 7);
    }
    if (p.id === this.store.id)
      g.lineStyle(2, 0xffffff, 0.8).strokeRoundedRect(
        p.x - 4,
        y - 4,
        40,
        55,
        10,
      );
    if (p.state === "attack" || (this.attacks.get(p.id) ?? 0) > time) {
      g.lineStyle(4, 0xffe6a9, 0.8);
      g.beginPath();
      g.arc(
        p.x + (p.facing > 0 ? 35 : -5),
        p.y + 23,
        29,
        p.facing > 0 ? -1.2 : 2,
        p.facing > 0 ? 1.2 : 4.4,
      );
      g.strokePath();
    }
    this.text(
      p.id,
      p.x + 16,
      p.y - 25,
      `${symbols[p.slot]} ${p.name}`,
      dead ? "#7c8794" : "#eee9df",
    );
    g.fillStyle(0x111723).fillRect(p.x - 4, p.y - 12, 40, 4);
    g.fillStyle(color).fillRect(
      p.x - 4,
      p.y - 12,
      (40 * Math.max(0, p.hp)) / 100,
      4,
    );
  }
  monster(m: Monster, time: number) {
    const g = this.gfx;
    const y = m.y + Math.sin(time / 220) * 1.5;
    if (m.kind === "mushroom") {
      g.fillStyle(m.state === "hurt" ? 0xffffff : 0xdfc8a1).fillRoundedRect(
        m.x + 10,
        y + 17,
        20,
        24,
        5,
      );
      g.fillStyle(0xd57d8d).fillEllipse(m.x + 19, y + 15, 44, 27);
      g.fillStyle(0xf7d4b4)
        .fillCircle(m.x + 12, y + 9, 4)
        .fillCircle(m.x + 29, y + 15, 3);
    } else {
      g.fillStyle(m.state === "hurt" ? 0xffffff : 0xb48b55).fillRoundedRect(
        m.x,
        y + 8,
        38,
        30,
        4,
      );
      g.lineStyle(3, 0xe2c57f).strokeRect(m.x + 3, y + 11, 32, 24);
      g.fillStyle(0x1b2030).fillRect(m.x + 3, y + 22, 32, 5);
    }
    g.fillStyle(0x211f2c)
      .fillCircle(m.x + 13, y + 29, 2)
      .fillCircle(m.x + 26, y + 29, 2);
    if (m.state === "attack")
      this.text(m.id, m.x + 20, y - 12, "!", "#ffa397", 24);
  }
  artifact(a: Artifact, time: number) {
    const g = this.gfx;
    const bob = Math.sin(time / 350 + a.kind) * 3;
    g.fillStyle(0xf8c76c, 0.1 + 0.04 * Math.sin(time / 200)).fillCircle(
      a.x + 12,
      a.y + 12 + bob,
      23,
    );
    g.lineStyle(1, 0xe8c46a, 0.55).strokeCircle(a.x + 12, a.y + 12 + bob, 17);
    this.text(a.id, a.x + 12, a.y + 12 + bob, icons[a.kind % 8], "#ffe0a1", 22);
  }
}
