const fs = require("fs");
function retryConfig(config) {
  const maxRetries = config.maxRetries ?? 3;
  const retryDelaySeconds = config.retryDelaySeconds ?? 60;
  if (!Number.isInteger(maxRetries) || maxRetries < 0 || maxRetries > 3)
    throw new Error("maxRetries must be an integer 0..3");
  if (!Number.isFinite(retryDelaySeconds) || retryDelaySeconds < 1)
    throw new Error("retryDelaySeconds must be positive");
  return {maxRetries, retryDelaySeconds};
}
function readProgress(file) {
  try {return JSON.parse(fs.readFileSync(file,"utf8"));} catch {return {};}
}
function outcome(progress) {
  if (progress.phase === "clicked") return "clicked";
  if (progress.phase === "before_click") return "retryable";
  return "unknown";
}
function complete(job, progress, config, now = new Date()) {
  const {maxRetries, retryDelaySeconds} = retryConfig(config);
  const result = outcome(progress);
  job.finishedAt = now.toISOString();
  delete job.nextRetryAt;
  if (result === "retryable") {
    if ((job.attemptsInCycle ?? job.attempts) < 1 + maxRetries) {
      job.status = "pending";
      job.nextRetryAt = new Date(now.getTime() + retryDelaySeconds * 1000).toISOString();
    } else job.status = "failed";
  } else job.status = result;
  return job.status;
}
module.exports = {retryConfig, readProgress, outcome, complete};
