const required = [
  "REGISTER_EMAIL",
  "REGISTER_NAME",
  "REGISTER_ROLL_NO",
  "ACCESS_CODE",
  "CLIENT_ID",
  "CLIENT_SECRET",
] as const;

for (const key of required) {
  if (!process.env[key]) {
    console.error(`Missing env var: ${key}`);
    console.error("Fill in CLIENT_ID and CLIENT_SECRET from the register step.");
    process.exit(1);
  }
}

const payload = {
  email: process.env.REGISTER_EMAIL,
  name: process.env.REGISTER_NAME,
  rollNo: process.env.REGISTER_ROLL_NO,
  accessCode: process.env.ACCESS_CODE,
  clientID: process.env.CLIENT_ID,
  clientSecret: process.env.CLIENT_SECRET,
};

const res = await fetch(
  "http://20.207.122.201/evaluation-service/auth",
  {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }
);

const data = await res.json();

if (!res.ok) {
  console.error("Auth failed:", data);
  process.exit(1);
}

console.log("\n✓ Auth successful!\n");
console.log("access_token:", data.access_token);
console.log("\nSave this in your .env as ACCESS_TOKEN=<token>");
