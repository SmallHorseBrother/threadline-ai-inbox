import { getExecutiveSummary } from "@/lib/server/executive-summary";
import { BOARD_NAMESPACE, requireSiteViewer } from "@/lib/server/site-auth";
import { readTasks } from "@/lib/server/task-store";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const unauthorized = requireSiteViewer(request);
  if (unauthorized) return unauthorized;
  const tasks = await readTasks(BOARD_NAMESPACE);
  return Response.json(await getExecutiveSummary(BOARD_NAMESPACE, tasks));
}
