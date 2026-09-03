export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { startModelFaceJobSupervisor } = await import('@/lib/model-face-jobs');
  startModelFaceJobSupervisor();
}
