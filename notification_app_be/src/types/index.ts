export interface EvalNotification {
  ID: string;
  Type: "Placement" | "Result" | "Event";
  Message: string;
  Timestamp: string;
}

export interface Notification {
  id: string;
  title: string;
  message: string;
  type: "Placement" | "Result" | "Event";
  read: boolean;
  createdAt: string;
}
