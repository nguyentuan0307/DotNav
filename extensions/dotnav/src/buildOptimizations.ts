export function buildOptimizationFlags(): string {
  return '-maxcpucount -p:BuildInParallel=true -p:UseSharedCompilation=true';
}

export function buildOptimizationArgs(): string[] {
  return ['-maxcpucount', '-p:BuildInParallel=true', '-p:UseSharedCompilation=true'];
}
