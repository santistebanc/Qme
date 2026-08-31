import { Qme } from "qme";

const qme = Qme.fromEnv();
qme.job.log("command-job waiting");

const command = await qme.commands.handleNext({ timeoutMs: qme.seconds(5), pollMs: 250 }, async (nextCommand) => {
  qme.job.log(`received command ${nextCommand.id}`);
  qme.job.progress(100, { command: nextCommand.payload });
});
if (!command) qme.job.fail("No command received");
