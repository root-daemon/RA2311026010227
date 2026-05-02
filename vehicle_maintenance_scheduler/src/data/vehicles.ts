export interface Vehicle {
  id: string;
  name: string;
  plateNumber: string;
  lastServiceDate: string;
  serviceIntervalDays: number;
}

export const vehicles: Vehicle[] = [];
