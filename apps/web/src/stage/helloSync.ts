/**
 * Interpret a hello frame for the single-tree runtime.
 * The tree identity never changes while a play is open; only structural epochs
 * invalidate the client event buffer.
 */
export interface HelloSyncInput {
  seen: boolean;
  epoch: number;
  helloEpoch: number | undefined;
}

export interface HelloSync {
  restamped: boolean;
  adoptedEpoch: number | undefined;
}

export function helloSync(input: HelloSyncInput): HelloSync {
  const restamped =
    input.seen &&
    input.helloEpoch !== undefined &&
    input.helloEpoch !== input.epoch;
  return {
    restamped,
    adoptedEpoch: input.helloEpoch,
  };
}
