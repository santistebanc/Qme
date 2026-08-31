import path from "node:path";
import { fileURLToPath } from "node:url";
import { Qme } from "qme";

const here = path.dirname(fileURLToPath(import.meta.url));
const qme = Qme.connect();

const job = await qme.jobs.create("scraping", {
  script: qme.scripts.node(path.join(here, "scrape-job.ts"), {
    args: ["https://example.com"],
    cwd: here,
    originApp: "example-node-scraper"
  }),
  priority: 10
});

console.log("Created job", job);

const socket = qme.events.subscribe({
  queue: "scraping",
  onEvent(event) {
    console.log("event", event);
  }
});

setTimeout(() => socket.close(), 12_000);
