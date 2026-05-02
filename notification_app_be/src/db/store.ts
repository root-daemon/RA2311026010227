import { Database } from "bun:sqlite";
import { mkdirSync } from "fs";
import type { Notification } from "../types/index.ts";

interface NotificationRow {
  id: string;
  title: string;
  message: string;
  type: "Placement" | "Result" | "Event";
  read: number;
  createdAt: string;
}

mkdirSync("data", { recursive: true });

export const db = new Database("data/notifications.db");

db.run("PRAGMA journal_mode = WAL");
db.run("PRAGMA synchronous = NORMAL");
db.run("PRAGMA foreign_keys = ON");

db.run(`
  CREATE TABLE IF NOT EXISTS notifications (
    id        TEXT    PRIMARY KEY,
    title     TEXT    NOT NULL,
    message   TEXT    NOT NULL,
    type      TEXT    NOT NULL CHECK(type IN ('Placement','Result','Event')),
    read      INTEGER NOT NULL DEFAULT 0 CHECK(read IN (0, 1)),
    createdAt TEXT    NOT NULL
  )
`);

db.run(`
  CREATE INDEX IF NOT EXISTS idx_notifications_read ON notifications(read)
`);

export const stmts = {
  insert:     db.prepare("INSERT INTO notifications (id,title,message,type,read,createdAt) VALUES (?,?,?,?,?,?)"),
  findById:   db.prepare<NotificationRow, [string]>("SELECT * FROM notifications WHERE id = ?"),
  findAll:    db.prepare<NotificationRow, []>("SELECT * FROM notifications ORDER BY rowid"),
  findByRead: db.prepare<NotificationRow, [number]>("SELECT * FROM notifications WHERE read = ? ORDER BY rowid"),
  markRead:   db.prepare("UPDATE notifications SET read = 1 WHERE id = ?"),
  deleteById: db.prepare("DELETE FROM notifications WHERE id = ?"),
};

export const toNotification = (row: NotificationRow): Notification => ({
  ...row,
  read: row.read === 1,
});
