import type { RocketConfig, RocketState, Detached } from './rocket.ts';
import type { Condition, ConditionMemory, WindowMemory } from './conditions.ts';
import type { Vec } from '../physics/vector.ts';
export type Body = {
  id: string;
  name: string;
  kind: 'star' | 'planet' | 'moon' | 'black-hole' | 'barycenter';
  position: Vec;
  radius: number;
  mu: number;
  color: string;
  dynamic?: { velocity: Vec; epoch?: number };
  atmosphere?: { height: number; density: number; scaleHeight: number };
  spin?: number;
  hiddenGravity: boolean;
  estimateMu: number;
  motion?: { parentId: string; radius: number; phase: number; angularSpeed?: number };
};
export type DeviceKind = 'speed' | 'gravity' | 'distance' | 'direction' | 'clock';
export type WorldObject = {
  id: string;
  kind: 'sensor' | 'gate' | 'hazard' | 'station' | 'path' | 'satellite' | 'debris' | 'landing-site';
  name: string;
  position: Vec;
  radius: number;
  angle: number;
  points?: Vec[];
  sensor: DeviceKind;
  motion?: Body['motion'];
  dynamic?: { velocity: Vec; epoch?: number };
  surface?: { bodyId: string; angle: number };
  /** Old station records described a tracking point, not collision geometry. */
  physicalRadius?: number;
};
export type Goal = {
  editorSeed?: string;
  id: string;
  title: string;
  condition: Condition;
  position: Vec;
  startTime: number;
  endTime: number;
  endTimeUnlimited?: boolean;
  dependsOn: string[];
  display?: { targetId: string; min: number; max: number };
  /** Editor recipe only; the condition tree remains the sole runtime predicate. */
  outcome?: import('../stages/outcomes').Outcome;
  intent?: import('../stages/mission-intent').MissionIntent;
  sketch?: import('../stages/goal-sketch').GoalSketch;
  marker?: import('../stages/goal-marker').GoalMarker;
};
export type Impulse = { id: string; time: number; vector: Vec };
export type RoutePlan = {
  launch: Vec;
  impulses: Impulse[];
  engineCommands?: {
    id: string;
    time: number;
    actorId: string;
    throttle?: number;
    direction?: Vec;
    separate?: boolean;
    releasePayload?: string;
  }[];
  deployments?: { id: string; time: number; kind: DeviceKind }[];
};
export type Stage = {
  version: 2;
  /** Presentation metadata; never changes physical goals or completion UUIDs. */
  chapter?: { id: string; title: string; order: number };
  track?: 'campaign' | 'tutorial';
  tutorial?: {
    lesson: number;
    objective: string;
    steps: { id: string; label: string; detail?: string; target?: string }[];
  };
  learning?: import('./evidence').LearningDesign;
  randomization?: import('./variation').VariationBank;
  published?: boolean;
  launchBodyId?: string;
  launchAngle?: number;
  rocket?: RocketConfig;
  id: string;
  title: string;
  description: string;
  order: number;
  theme: string;
  bodies: Body[];
  objects: WorldObject[];
  goals: Goal[];
  goalMode: 'all' | 'any';
  spawn: {
    position: Vec;
    velocity: Vec;
    /** Incomplete editor drafts only. Absent means placed. */ placed?: boolean;
  };
  rules: {
    /** SI G. GM remains the stored acceleration parameter for legacy documents. */
    gravitationalConstant?: number;
    landingMode?: 'standard' | 'precision';
    surfaceClearance?: number;
    launchLimit: number;
    maneuverBudget: number;
    maxTime: number;
    maxTimeUnlimited?: boolean;
    /** Planning rail duration; remaining mission time is observation/coasting. */
    timelineDuration?: number;
    timelineUnlimited?: boolean;
    commandLimits?: Partial<
      Record<'ignite' | 'stop' | 'turn' | 'separate' | 'push' | 'deploy', number>
    >;
    worldRadius: number;
    sensorSlots: number;
    /** Read-only legacy field, removed on import. Flights have no attempt limit. */
    attempts?: number;
  };
  camera: { x: number; y: number; zoom: number };
  referencePlans: RoutePlan[];
  audit: { samples: number; maxPassRate: number; seed: number; timeLimit?: number };
};
export type GoalProgress = {
  complete: boolean;
  ratio: number;
  completedAt?: number;
  closest?: Record<
    string,
    {
      metric: string;
      targetId: string;
      operator: string;
      target: number;
      value: number;
      time: number;
      distance: number;
    }
  >;
  conditionMemory?: ConditionMemory;
  checkpoints?: Record<string, { value: number; time: number }>;
  windows?: Record<string, WindowMemory>;
};
export type Observation = {
  id: string;
  deviceId: string;
  kind: DeviceKind;
  position: Vec;
  time: number;
  value: number;
  vector: Vec;
  text: string;
};
export type Run = {
  peakLoad?: number;
  evidence: import('./evidence').EvidenceState;
  time: number;
  position: Vec;
  velocity: Vec;
  used: number;
  status: 'running' | 'won' | 'failed' | 'observed' | 'impact' | 'aborted';
  reason: string;
  probe: boolean;
  applied: Set<string>;
  trail: {
    position: Vec;
    time: number;
    velocity: Vec;
    targets?: Record<string, Vec>;
    load?: number;
  }[];
  observations: Observation[];
  sampled: Set<string>;
  goals: Record<string, GoalProgress>;
  goalRoots?: string[];
  frames?: import('./replay').FlightFrame[];
  initialPlan?: RoutePlan;
  lastTrail: number;
  plan: RoutePlan;
  attitude?: Vec;
  rocket?: RocketState;
  detached: Detached[];
  bodies?: Record<string, import('./dynamics.ts').BodyState>;
  objects?: Record<string, import('./dynamics.ts').BodyState>;
  landed?: { bodyId: string; angle: number };
  touchdownSpeed?: number;
  touchdownNormalSpeed?: number;
  touchdownTangentialSpeed?: number;
  touchdownTilt?: number;
  impact?: import('./impact').Impact;
  buoys: { id: string; kind: DeviceKind; position: Vec; velocity: Vec; lastSample: number }[];
};
export type GoalContext = {
  stage: Stage;
  run: Run;
  before: Vec;
  beforeActors?: Record<string, Vec>;
  dt: number;
  previousTime: number;
  collisionBodyId?: string;
  actorId?: string;
  primary?: { position: Vec; velocity: Vec };
  bindings?: { actorId?: string; targetId?: string; scope: string };
  references?: string[];
};
