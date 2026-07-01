import type { ServerState } from './server-controller.js';

export function iconFileFor(state: ServerState): string {
  return `icon-${state}.png`;
}
