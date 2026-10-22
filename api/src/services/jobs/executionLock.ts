let activeExecution: Promise<unknown> | null = null;

/** Single-process guard shared by scheduled and operator-triggered job runs. */
export async function runWithJobExecutionLock<T>(run: () => Promise<T>): Promise<{ acquired: true; value: T } | { acquired: false }> {
  if (activeExecution) return { acquired: false };
  const execution = Promise.resolve().then(run);
  activeExecution = execution;
  try { return { acquired: true, value: await execution }; }
  finally { if (activeExecution === execution) activeExecution = null; }
}

export async function waitForJobExecution() {
  await activeExecution;
}
