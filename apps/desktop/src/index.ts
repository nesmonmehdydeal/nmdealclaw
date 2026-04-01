import { EventBus, RuntimeRegistry, TaskService, TaskStore } from "@nmdealclaw/core";
import { NullClawAdapter } from "@nmdealclaw/adapter-nullclaw";

async function main(): Promise<void> {
  const bus = new EventBus();
  const store = new TaskStore();
  const registry = new RuntimeRegistry();

  registry.register(
    new NullClawAdapter({
      baseUrl: process.env.NULLCLAW_BASE_URL ?? "http://127.0.0.1:3000",
      token: process.env.NULLCLAW_GATEWAY_TOKEN,
      pairingCode: process.env.NULLCLAW_PAIRING_CODE
    })
  );

  bus.subscribe((event) => {
    console.log(`[${event.type}]`, JSON.stringify(event));
  });

  const taskService = new TaskService(store, registry, bus);
  const task = store.create(
    "project_demo",
    "First nmdealclaw task",
    "Describe the purpose of nmdealclaw in one paragraph.",
    "nullclaw"
  );

  await taskService.run(task.id);

  if (process.env.NMDEALCLAW_RESUBSCRIBE === "1") {
    await taskService.resubscribe(task.id);
  }

  if (process.env.NMDEALCLAW_RECOVER === "1") {
    await taskService.recoverRemotely(task.id);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
