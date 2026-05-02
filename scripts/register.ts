const required = [
  "REGISTER_EMAIL",
  "REGISTER_NAME",
  "REGISTER_MOBILE",
  "REGISTER_GITHUB",
  "REGISTER_ROLL_NO",
  "ACCESS_CODE",
] as const;

for (const key of required) {
  if (!process.env[key]) {
    console.error(`Missing env var: ${key}`);
    console.error("Fill in your .env file before running this script.");
    process.exit(1);
  }
}

const payload = {
  email: process.env.REGISTER_EMAIL,
  name: process.env.REGISTER_NAME,
  mobileNo: process.env.REGISTER_MOBILE,
  githubUsername: process.env.REGISTER_GITHUB,
  rollNo: process.env.REGISTER_ROLL_NO,
  accessCode: process.env.ACCESS_CODE,
};

console.log("Registering with payload:", { ...payload, accessCode: "***" });

const res = await fetch(
  "http://20.207.122.201/evaluation-service/register",
  {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }
);

const data = await res.json();

if (!res.ok) {
  console.error("Registration failed:", data);
  process.exit(1);
}

console.log("\n✓ Registration successful!\n");
console.log("clientID    :", data.clientID);
console.log("clientSecret:", data.clientSecret);
console.log("\nSave these in your .env as CLIENT_ID and CLIENT_SECRET.");
console.log("You cannot retrieve them again.");
