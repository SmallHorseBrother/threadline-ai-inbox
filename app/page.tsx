import { Taskboard } from "./taskboard";

export const metadata = {
  title: "Threadline · AI 工作驾驶舱",
  description: "把散落在 Codex、ChatGPT 和不同设备上的对话统一成可继续、可审批、可提醒的任务。",
};

export default function Home() {
  return <Taskboard />;
}
