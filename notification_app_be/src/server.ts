import { app } from "./app.ts";
import { env } from "./config/env.ts";

app.listen(env.PORT, () => {
  console.log(`notification_app_be running on http://localhost:${env.PORT}`);
});
