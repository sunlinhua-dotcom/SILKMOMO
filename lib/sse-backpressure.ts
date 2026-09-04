export function createSseBackpressureObserver(options: {
  thresholdMs: number;
  now?: () => number;
  log: (data: { desiredSize: number; durationMs: number }) => void;
}): (desiredSize: number | null) => void {
  const now = options.now || Date.now;
  let negativeSince: number | null = null;
  let logged = false;

  return (desiredSize: number | null) => {
    if (desiredSize === null || desiredSize >= 0) {
      negativeSince = null;
      logged = false;
      return;
    }
    const current = now();
    if (negativeSince === null) negativeSince = current;
    const durationMs = current - negativeSince;
    if (!logged && durationMs >= options.thresholdMs) {
      logged = true;
      options.log({ desiredSize, durationMs });
    }
  };
}
