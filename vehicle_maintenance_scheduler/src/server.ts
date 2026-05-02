import { app } from "./app.ts";

const PORT = Number(process.env.PORT ?? 3002);

app.listen(PORT, () => {
  console.log(`vehicle_maintenance_scheduler running on http://localhost:${PORT}`);
});
