export interface Notification {
  id: string;
  title: string;
  message: string;
  type: "info" | "warn" | "error";
  read: boolean;
  createdAt: string;
}
