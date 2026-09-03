export const DAILY_MODEL_FACE_LIMIT = 200;

export function startOfShanghaiDay(now = new Date()): Date {
  const offsetMs = 8 * 60 * 60 * 1000;
  const dayMs = 24 * 60 * 60 * 1000;
  return new Date(Math.floor((now.getTime() + offsetMs) / dayMs) * dayMs - offsetMs);
}

export function hasModelFaceAttemptCapacity(used: number, requested: number): boolean {
  return Number.isInteger(used)
    && Number.isInteger(requested)
    && used >= 0
    && requested >= 0
    && used + requested <= DAILY_MODEL_FACE_LIMIT;
}
