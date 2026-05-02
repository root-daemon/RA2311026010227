import type { Task } from "../types/index.ts";

/**
 * 0/1 Knapsack — DP solution
 *
 * Maximizes total Impact without exceeding capacity (MechanicHours).
 * Time:  O(n * W)   n = tasks, W = mechanic hours
 * Space: O(n * W)   2D table needed for traceback
 */
export const knapsack = (
  tasks: Task[],
  capacity: number
): { selectedTasks: Task[]; totalImpact: number; totalDuration: number } => {
  const n = tasks.length;

  // dp[i][w] = max impact using first i tasks within capacity w
  const dp: number[][] = Array.from({ length: n + 1 }, () =>
    new Array(capacity + 1).fill(0)
  );

  for (let i = 1; i <= n; i++) {
    const { Duration: weight, Impact: value } = tasks[i - 1];
    for (let w = 0; w <= capacity; w++) {
      if (weight > w) {
        dp[i][w] = dp[i - 1][w];
      } else {
        dp[i][w] = Math.max(dp[i - 1][w], dp[i - 1][w - weight] + value);
      }
    }
  }

  // Traceback to find which tasks were selected
  const selected: Task[] = [];
  let w = capacity;
  for (let i = n; i > 0; i--) {
    if (dp[i][w] !== dp[i - 1][w]) {
      selected.push(tasks[i - 1]);
      w -= tasks[i - 1].Duration;
    }
  }

  selected.reverse();

  const totalImpact = dp[n][capacity];
  const totalDuration = selected.reduce((sum, t) => sum + t.Duration, 0);

  return { selectedTasks: selected, totalImpact, totalDuration };
};
