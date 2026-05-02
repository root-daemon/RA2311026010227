import { Database } from "bun:sqlite";
import { mkdirSync } from "fs";

export interface Vehicle {
  id: string;
  name: string;
  plateNumber: string;
  lastServiceDate: string;
  serviceIntervalDays: number;
}

mkdirSync("data", { recursive: true });

export const db = new Database("data/vehicles.db");

db.run("PRAGMA journal_mode = WAL");
db.run("PRAGMA synchronous = NORMAL");
db.run("PRAGMA foreign_keys = ON");

db.run(`
  CREATE TABLE IF NOT EXISTS vehicles (
    id                  TEXT    PRIMARY KEY,
    name                TEXT    NOT NULL,
    plateNumber         TEXT    NOT NULL UNIQUE,
    lastServiceDate     TEXT    NOT NULL,
    serviceIntervalDays INTEGER NOT NULL CHECK(serviceIntervalDays >= 1)
  )
`);

export const stmts = {
  insert:        db.prepare("INSERT INTO vehicles (id,name,plateNumber,lastServiceDate,serviceIntervalDays) VALUES (?,?,?,?,?)"),
  findAll:       db.prepare<Vehicle, []>("SELECT * FROM vehicles"),
  findById:      db.prepare<Vehicle, [string]>("SELECT * FROM vehicles WHERE id = ?"),
  updateService: db.prepare("UPDATE vehicles SET lastServiceDate = ? WHERE id = ?"),
  findDue:       db.prepare<Vehicle, [string]>(
    "SELECT * FROM vehicles WHERE julianday(lastServiceDate) + serviceIntervalDays <= julianday(?) + 7"
  ),
};
