import { z } from "zod";
const num = z.number().finite();
export const rect = z.object({
  x: num,
  y: num,
  w: num.positive(),
  h: num.positive(),
});
const point = z.object({ x: num, y: num });
export const playerSchema = rect.extend({
  id: z.string(),
  name: z.string(),
  role: z.enum(["active", "spectator"]),
  slot: z.number().int(),
  hp: num,
  artifacts: num,
  collected: z.array(num),
  pvpKills: num,
  monsterKills: num,
  connected: z.boolean(),
  alive: z.boolean(),
  facing: num,
  state: z.string(),
  lastProcessedInputSeq: num,
  queue: num,
});
export const monsterSchema = rect.extend({
  id: z.string(),
  kind: z.string(),
  hp: num,
  facing: num,
  state: z.string(),
});
export const artifactSchema = rect.extend({ id: z.string(), kind: num });
export const medkitSchema = rect.extend({
  id: z.string(),
  available: z.boolean(),
});
export const mapSchema = z.object({
  id: z.string(),
  name: z.string(),
  version: num,
  width: num.positive(),
  height: num.positive(),
  theme: z.string(),
  platforms: z.array(rect),
  walls: z.array(rect),
  hazards: z.array(rect),
  spawns: z.array(point).length(4),
  artifactSpawns: z.array(point),
  medkitSpawns: z.array(point).length(4),
  monsterSpawns: z.array(point.extend({ platform: num, kind: z.string() })),
});
export const resultSchema = z.object({
  winner: z.string(),
  reason: z.string(),
  standings: z.array(playerSchema),
});
export const snapshotSchema = z.object({
  phase: z.enum([
    "waiting",
    "countdown",
    "playing",
    "round_finished",
    "intermission",
  ]),
  remaining: num,
  players: z.array(playerSchema),
  monsters: z.array(monsterSchema),
  artifacts: z.array(artifactSchema),
  medkits: z.array(medkitSchema),
  required: z.array(num),
  result: resultSchema.nullable(),
});
export const eventSchema = z.object({
  id: num,
  type: z.string(),
  source: z.string(),
  target: z.string(),
  cause: z.string(),
  serverTick: num,
  amount: num,
});
const envelope = z.object({
  protocolVersion: z.literal(1),
  type: z.string(),
  roundID: num,
  serverTick: num,
  data: z.unknown(),
});
export type Rect = z.infer<typeof rect>;
export type Player = z.infer<typeof playerSchema>;
export type Monster = z.infer<typeof monsterSchema>;
export type Medkit = z.infer<typeof medkitSchema>;
export type Artifact = z.infer<typeof artifactSchema>;
export type WorldMap = z.infer<typeof mapSchema>;
export type Snapshot = z.infer<typeof snapshotSchema>;
export type Result = z.infer<typeof resultSchema>;
export type GameEvent = z.infer<typeof eventSchema>;
export interface Buttons {
  left: boolean;
  right: boolean;
  jump: boolean;
  attack: boolean;
}
export interface Input extends Buttons {
  seq: number;
}
const schemas = {
  welcome: z.object({
    playerID: z.string(),
    token: z.string(),
    role: z.enum(["active", "spectator"]),
    queue: num,
  }),
  map: mapSchema,
  snapshot: snapshotSchema,
  result: resultSchema,
  error: z.object({ code: z.string() }),
  pong: z.object({ nonce: num }),
  role: z.object({ role: z.enum(["active", "spectator"]), queue: num }),
  spectate: z.object({ target: z.string() }),
};
export function parse(raw: string) {
  const parsed: unknown = JSON.parse(raw);
  const msg = envelope.parse(parsed);
  const key = msg.type as keyof typeof schemas;
  if (key in schemas) schemas[key].parse(msg.data);
  else eventSchema.parse(msg.data);
  return msg;
}
export function validateName(value: string): string | null {
  const n = value.trim();
  return [...n].length < 1 || [...n].length > 16 || /[\p{Cc}]/u.test(n)
    ? "Имя должно содержать от 1 до 16 символов без управляющих знаков."
    : null;
}
