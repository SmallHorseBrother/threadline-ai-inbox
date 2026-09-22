import { copyFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(root, "tools", "thread-sync", "codex_task_sync.py");
const destination = join(root, "public", "agent", "codex_task_sync.py");

await mkdir(dirname(destination), { recursive: true });
await copyFile(source, destination);
console.log("Prepared Threadline cloud sync agent.");
