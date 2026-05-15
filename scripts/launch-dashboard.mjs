import { spawn } from "node:child_process";

const port = process.env.PORT ?? "3000";
const child = spawn("npm", ["run", "dev", "--", "-p", port], {
  stdio: "inherit",
  shell: true,
});

console.log(`Dashboard starting at http://localhost:${port}`);

child.on("exit", (code) => {
  process.exit(code ?? 0);
});
