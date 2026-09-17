import * as os from "os";

type CpuTotals = { idle: number; total: number };

function readCpuTotals(): CpuTotals {
  const cpus = os.cpus();
  let idle = 0;
  let total = 0;
  for (const cpu of cpus) {
    const times = cpu.times;
    idle += times.idle;
    total += times.user + times.nice + times.sys + times.irq + times.idle;
  }
  return { idle, total };
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

export async function sampleCpuUsagePercent(sampleMs = 120): Promise<number> {
  const ms = Math.max(20, Math.min(2000, Math.floor(sampleMs)));
  const a = readCpuTotals();
  await sleep(ms);
  const b = readCpuTotals();

  const idleDelta = b.idle - a.idle;
  const totalDelta = b.total - a.total;
  if (!Number.isFinite(idleDelta) || !Number.isFinite(totalDelta) || totalDelta <= 0) {
    return 0;
  }

  const usage = (1 - idleDelta / totalDelta) * 100;
  return Math.max(0, Math.min(100, usage));
}

