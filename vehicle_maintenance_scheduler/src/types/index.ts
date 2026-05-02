export interface Depot {
  ID: number;
  MechanicHours: number;
}

export interface Task {
  TaskID: string;
  Duration: number;
  Impact: number;
}

export interface ScheduleResult {
  depotId: number;
  mechanicHours: number;
  totalImpact: number;
  totalDuration: number;
  selectedTasks: Task[];
}
