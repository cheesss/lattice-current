export function isDryRun() {
  return process.env.AUTOMATION_DRY_RUN === '1';
}

export async function executeOrSimulate(actionName, params, executor) {
  if (isDryRun()) {
    return {
      dryRun: true,
      action: actionName,
      params,
    };
  }
  return executor();
}
