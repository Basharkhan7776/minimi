export function boundedSignal(
  signal: AbortSignal | undefined,
  ms: number,
): AbortSignal {
  const timeout = AbortSignal.timeout(ms);
  if (!signal) return timeout;
  return AbortSignal.any([signal, timeout]);
}
