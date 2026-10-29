/** `PIPELINE_ENABLED` is the pause switch: only the exact text `false` pauses the pipeline. */
export function isPaused(env: Pick<Env, 'PIPELINE_ENABLED'>): boolean {
  return env.PIPELINE_ENABLED === 'false';
}
