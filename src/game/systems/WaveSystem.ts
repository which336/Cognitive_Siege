import { EnemyKind, GridPos, RouteVariant, WaveSpec, EnemySpawnSpec } from '../../types';
import { resolveRouteVariant } from './Grid';

export interface PathPool {
  short: GridPos[];
  long: GridPos[];
  edge: GridPos[];
}

export interface RouteStrategyConfig {
  enemyRoutePreferences: Record<EnemyKind, RouteVariant[]>;
  strategyRouteWeight: number;
  kindPreferenceWeight: number;
}

const DEFAULT_ROUTE_STRATEGY: RouteStrategyConfig = {
  enemyRoutePreferences: {
    anxiety: ['short', 'edge', 'long'],
    depression: ['long', 'short', 'edge'],
    obsession: ['edge', 'short', 'long'],
    guilt: ['long', 'edge', 'short'],
    ptsd: ['edge', 'long', 'short'],
  },
  strategyRouteWeight: 0.7,
  kindPreferenceWeight: 0.2,
};

let routeStrategyConfig: RouteStrategyConfig = {
  enemyRoutePreferences: {
    anxiety: [...DEFAULT_ROUTE_STRATEGY.enemyRoutePreferences.anxiety],
    depression: [...DEFAULT_ROUTE_STRATEGY.enemyRoutePreferences.depression],
    obsession: [...DEFAULT_ROUTE_STRATEGY.enemyRoutePreferences.obsession],
    guilt: [...DEFAULT_ROUTE_STRATEGY.enemyRoutePreferences.guilt],
    ptsd: [...DEFAULT_ROUTE_STRATEGY.enemyRoutePreferences.ptsd],
  },
  strategyRouteWeight: DEFAULT_ROUTE_STRATEGY.strategyRouteWeight,
  kindPreferenceWeight: DEFAULT_ROUTE_STRATEGY.kindPreferenceWeight,
};

export function setRouteStrategyConfig(config: Partial<RouteStrategyConfig>): void {
  routeStrategyConfig = {
    enemyRoutePreferences: {
      anxiety: [...nonEmptyRoutes(config.enemyRoutePreferences?.anxiety, DEFAULT_ROUTE_STRATEGY.enemyRoutePreferences.anxiety)],
      depression: [...nonEmptyRoutes(config.enemyRoutePreferences?.depression, DEFAULT_ROUTE_STRATEGY.enemyRoutePreferences.depression)],
      obsession: [...nonEmptyRoutes(config.enemyRoutePreferences?.obsession, DEFAULT_ROUTE_STRATEGY.enemyRoutePreferences.obsession)],
      guilt: [...nonEmptyRoutes(config.enemyRoutePreferences?.guilt, DEFAULT_ROUTE_STRATEGY.enemyRoutePreferences.guilt)],
      ptsd: [...nonEmptyRoutes(config.enemyRoutePreferences?.ptsd, DEFAULT_ROUTE_STRATEGY.enemyRoutePreferences.ptsd)],
    },
    strategyRouteWeight: clampWeight(config.strategyRouteWeight ?? DEFAULT_ROUTE_STRATEGY.strategyRouteWeight),
    kindPreferenceWeight: clampWeight(config.kindPreferenceWeight ?? DEFAULT_ROUTE_STRATEGY.kindPreferenceWeight),
  };
}

function nonEmptyRoutes(routes: RouteVariant[] | undefined, fallback: RouteVariant[]): RouteVariant[] {
  return routes?.length ? routes : fallback;
}

function clampWeight(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function pickRouteForEnemy(
  spec: EnemySpawnSpec,
  openRoutes: RouteVariant[],
  waveIndex = 1,
): RouteVariant {
  const routes = normalizeOpenRoutes(openRoutes);

  if (spec.pathBias === 'random') return randomRoute(routes);

  const strategicRoute = resolveRouteVariant(spec.pathBias, waveIndex);
  const preferredRoute = preferredRouteForEnemy(spec.kind, routes);
  const roll = Math.random();

  const strategyWeight = routeStrategyConfig.strategyRouteWeight;
  const kindWeight = routeStrategyConfig.kindPreferenceWeight;

  if (routes.includes(strategicRoute) && roll < strategyWeight) {
    return strategicRoute;
  }

  if (roll < strategyWeight + kindWeight) {
    return preferredRoute;
  }

  return randomRoute(routes);
}

function normalizeOpenRoutes(openRoutes: RouteVariant[]): RouteVariant[] {
  const unique = Array.from(new Set(openRoutes));
  return unique.length ? unique : ['short'];
}

function preferredRouteForEnemy(kind: EnemyKind, openRoutes: RouteVariant[]): RouteVariant {
  const fallback = DEFAULT_ROUTE_STRATEGY.enemyRoutePreferences[kind];
  for (const route of routeStrategyConfig.enemyRoutePreferences[kind] ?? fallback) {
    if (openRoutes.includes(route)) return route;
  }

  return openRoutes[0];
}

function randomRoute(openRoutes: RouteVariant[]): RouteVariant {
  return openRoutes[Math.floor(Math.random() * openRoutes.length)] ?? 'short';
}

/** Picks the actual grid path used by an enemy from the wave's open route set. */
export function pickPath(
  spec: EnemySpawnSpec,
  pool: PathPool,
  waveIndex = 1,
  openRoutes: RouteVariant[] = ['short'],
): GridPos[] {
  return pool[pickRouteForEnemy(spec, openRoutes, waveIndex)];
}

/** Returns the total wave duration (last spawn delay + 8s buffer) for UI hints. */
export function estimateWaveDuration(w: WaveSpec): number {
  const last = w.spawns.reduce((m, s) => Math.max(m, s.delayMs), 0);
  return last + 8000;
}
