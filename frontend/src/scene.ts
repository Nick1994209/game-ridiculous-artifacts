import Phaser from "phaser";
import { Store } from "./state";
import type { Rect, Player, Monster, Artifact, Medkit } from "./protocol";
import {
  VIEW,
  SpatialIndex,
  cameraBounds,
  renderWindow,
  chunkKeys,
  intersects,
} from "./spatial";
const colors = [0x78e1bd, 0xf8c76c, 0xc3a4ff, 0x7fceff];
const symbols = ["Ⅰ", "Ⅱ", "Ⅲ", "Ⅳ"];
import { itemIcons as icons } from "./items";
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
  backdrop!: Phaser.GameObjects.Graphics;
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
    this.backdrop = this.add.graphics().setScrollFactor(0);
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
    this.backdrop?.clear();
    this.mapKey = "";
  }
  // Built once per map; low-contrast scenery stays behind the playable geometry.
  drawBackdrop(theme: string) {
    const g = this.backdrop;
    g.clear();
    const { width, height } = VIEW;
    if (theme === "attic") {
      g.lineStyle(18, 0x887293, 0.14);
      for (let x = -300; x < width; x += 300) {
        g.lineBetween(x, height, x + 350, 0);
        g.lineBetween(x, 0, x + 350, height);
      }
      g.fillStyle(0xc5a183, 0.07).fillCircle(830, 130, 100);
    } else if (theme === "archive") {
      for (let x = 35; x < width; x += 220) {
        g.fillStyle(0x091c26, 0.3).fillRect(x, 50, 180, height - 50);
        for (let y = 120; y < height; y += 110) {
          g.fillStyle(0x71978b, 0.16).fillRect(x, y, 180, 5);
          for (let i = 0; i < 8; i++) {
            const h = 35 + ((i * 13 + y) % 35);
            g.fillStyle(i % 2 ? 0x8daa93 : 0x729bad, 0.12).fillRect(
              x + 10 + i * 20,
              y - h,
              13,
              h,
            );
          }
        }
      }
    } else if (theme === "well") {
      g.lineStyle(2, 0x7594ae, 0.12);
      for (let y = 0; y < height; y += 85) {
        g.lineBetween(0, y, width, y);
        for (let x = ((y / 85) % 2) * 90; x < width; x += 180)
          g.lineBetween(x, y, x, y + 85);
      }
      g.fillStyle(0x699ec2, 0.06).fillRect(400, 0, 300, height);
    } else if (theme === "market") {
      g.lineStyle(2, 0xd0a28c, 0.18).lineBetween(0, 80, width, 160);
      for (let x = 0; x < width; x += 70) {
        const y = 80 + (x / width) * 80;
        g.fillStyle(x % 140 ? 0xbf879f : 0xc8ab7e, 0.18).fillTriangle(
          x,
          y,
          x + 50,
          y + 4,
          x + 25,
          y + 45,
        );
      }
      for (let x = 30; x < width; x += 270) {
        g.fillStyle(0x170f22, 0.25).fillRect(x, 360, 220, 290);
        g.fillStyle(0xbf879f, 0.1).fillTriangle(
          x - 20,
          360,
          x + 110,
          270,
          x + 240,
          360,
        );
      }
    } else if (theme === "museum") {
      for (let x = 55; x < width; x += 260) {
        g.fillStyle(0xa0a9ab, 0.08).fillRect(x, 40, 28, height);
        g.lineStyle(5, 0xc3b18b, 0.15).strokeRect(x + 65, 170, 125, 155);
        g.fillStyle(0x8f9caa, 0.08).fillEllipse(x + 128, 248, 65, 105);
      }
    }
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
      this.backdrop.clear();
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
      this.drawBackdrop(map.theme);
    }
    const rendered = this.store.interpolated(performance.now())!;
    const living = rendered.players.filter((p) => p.alive && p.slot >= 0);
    const self = rendered.players.find((p) => p.id === this.store.id);
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
    const entities = [
      ...rendered.players,
      ...rendered.monsters,
      ...snapshot.artifacts,
      ...snapshot.medkits,
    ];
    this.total = entities.length;
    this.visible = 0;
    for (const e of entities) {
      if (!intersects(e, win)) continue;
      this.visible++;
      if ("name" in e) this.player(e, time);
      else if ("hp" in e) this.monster(e, time);
      else if ("available" in e) this.medkit(e);
      else this.artifact(e, time);
    }
    for (const event of this.store.events) {
      if (this.seen.has(event.id)) continue;
      this.seen.add(event.id);
      if (event.type === "attack") this.attacks.set(event.source, time + 200);
      const source = entities.find(
        (p) =>
          p.id ===
          (["artifact.collected", "medkit.collected"].includes(event.type)
            ? event.source
            : event.target),
      );
      if (
        source &&
        ["damage", "artifact.collected", "medkit.collected"].includes(
          event.type,
        )
      )
        this.effects.push({
          x: source.x + source.w / 2,
          y: source.y - 15,
          text:
            event.type === "damage"
              ? `−${event.amount}`
              : event.type === "medkit.collected"
                ? `+${event.amount} HP`
                : "+1 ◇",
          color:
            event.type === "damage"
              ? "#ffa397"
              : event.type === "medkit.collected"
                ? "#78e1bd"
                : "#f8d890",
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
  medkit(kit: Medkit) {
    const g = this.gfx;
    if (!kit.available) {
      g.lineStyle(1, 0x78e1bd, 0.25).strokeRoundedRect(kit.x, kit.y, 24, 24, 5);
      return;
    }
    g.fillStyle(0x78e1bd, 0.1).fillCircle(kit.x + 12, kit.y + 12, 23);
    g.fillStyle(0xe2f5eb).fillRoundedRect(kit.x, kit.y, 24, 24, 5);
    g.fillStyle(0x25896c).fillRect(kit.x + 9, kit.y + 4, 6, 16);
    g.fillRect(kit.x + 4, kit.y + 9, 16, 6);
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
