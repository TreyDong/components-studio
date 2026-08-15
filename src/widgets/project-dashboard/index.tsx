import { useCallback, useEffect, useState } from "react";
import { defineComponent } from "../../registry/defineComponent";
import type { ComponentDefinition, ComponentManifest, ComponentRendererProps } from "../../registry/definition";
import type { ComponentType, IconName, ValidationIssue, ValidationResult } from "@ocs/contracts";
import { validateAgainstSchema, type JsonObjectSchema } from "../../schema/validator";
import { DashboardPreview } from "../../preview/DashboardPreview";
import { useRuntimeServices } from "../../runtime/RuntimeContext";

export interface ProjectDashboardProps {
  readonly title: string;
  /** TaskNotes-compatible task Markdown folder. Empty string scans the Vault. */
  readonly sourcePath: string;
  /** A tag which identifies task notes. Empty string accepts every Markdown note. */
  readonly taskTag: string;
  /** TaskNotes projects value to show on this project dashboard. */
  readonly project: string;
}

export interface DashboardTask {
  readonly path: string;
  readonly text: string;
  readonly title: string;
  readonly status: string;
  readonly kind: string;
  readonly tags: readonly string[];
  readonly projects: readonly string[];
  readonly createdAt: number;
  readonly due: string | null;
}

function scalar(value: string): string | boolean | number {
  const trimmed = value.trim().replace(/^['"]|['"]$/g, "");
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  const number = Number(trimmed);
  return trimmed !== "" && Number.isFinite(number) ? number : trimmed;
}

/** Deliberately small, portable frontmatter reader for TaskNotes-compatible fields. */
function parseFrontmatter(text: string): Record<string, string | boolean | number | string[]> {
  const block = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1];
  if (!block) return {};
  const data: Record<string, string | boolean | number | string[]> = {};
  let listKey: string | null = null;
  for (const line of block.split(/\r?\n/)) {
    const listItem = /^\s+-\s+(.+)$/.exec(line);
    if (listItem && listKey) {
      const current = data[listKey];
      data[listKey] = [...(Array.isArray(current) ? current : []), String(scalar(listItem[1]!))];
      continue;
    }
    const entry = /^([^:#][^:]*):\s*(.*)$/.exec(line);
    if (!entry) continue;
    const key = entry[1]!.trim();
    const raw = entry[2]!.trim();
    listKey = raw === "" ? key : null;
    if (raw.startsWith("[") && raw.endsWith("]")) {
      try {
        const parsed = JSON.parse(raw) as unknown;
        data[key] = Array.isArray(parsed) ? parsed.map(String) : [];
      } catch {
        data[key] = raw.slice(1, -1).split(",").map((item) => String(scalar(item))).filter(Boolean);
      }
    } else if (raw !== "") {
      data[key] = scalar(raw);
    }
  }
  return data;
}

function values(value: string | boolean | number | string[] | undefined): string[] {
  return Array.isArray(value) ? value : value === undefined ? [] : [String(value)];
}

function useVaultTasks(props: ProjectDashboardProps) {
  const services = useRuntimeServices();
  const [tasks, setTasks] = useState<readonly DashboardTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [generation, setGeneration] = useState(0);
  const refresh = useCallback(() => setGeneration((value) => value + 1), []);

  useEffect(() => {
    let disposed = false;
    setLoading(true);
    void (async () => {
      const files = await services.platform.vaultRead.list({ extension: "md", ...(props.sourcePath ? { underPath: props.sourcePath } : {}) });
      if (!files.ok) {
        if (!disposed) { setError(files.error.message); setLoading(false); }
        return;
      }
      const read = await Promise.all(files.value.map((file) => services.platform.vaultRead.readText(file.path)));
      const next = read.flatMap((result, index) => {
        if (!result.ok) return [];
        const frontmatter = parseFrontmatter(result.value.text);
        const tags = values(frontmatter.tags);
        const projects = values(frontmatter.projects);
        const isTask = !props.taskTag || tags.includes(props.taskTag) || frontmatter.isTask === true;
        const belongsToProject = !props.project || projects.some((project) => project.replace(/^\[\[|\]\]$/g, "") === props.project);
        if (!isTask || !belongsToProject) return [];
        const file = files.value[index]!;
        return [{
          path: file.path,
          text: result.value.text,
          title: String(frontmatter.title ?? file.basename.replace(/\.md$/, "")),
          status: String(frontmatter.status ?? "todo").toLowerCase(),
          kind: String(frontmatter.type ?? frontmatter.kind ?? tags.find((tag) => tag !== props.taskTag) ?? "feature"),
          tags,
          projects,
          createdAt: file.ctimeMs,
          due: typeof frontmatter.due === "string" ? frontmatter.due : null,
        } satisfies DashboardTask];
      });
      if (!disposed) { setTasks(next); setError(null); setLoading(false); }
    })();
    const unsubscribe = services.platform.vaultRead.subscribe(() => refresh());
    return () => { disposed = true; unsubscribe(); };
  }, [generation, props.project, props.sourcePath, props.taskTag, refresh, services.platform.vaultRead]);

  const updateStatus = useCallback(async (task: DashboardTask, status: string) => {
    const result = await services.platform.vaultMutation.updateFrontmatter({
      path: task.path,
      expectedFileText: task.text,
      patch: { status: { op: "set", value: status } },
    });
    if (!result.ok) {
      services.platform.notices.show(`更新任务失败：${result.error.message}`, { level: "error" });
      return;
    }
    services.platform.notices.show(`已更新：${task.title}`, { level: "success" });
    refresh();
  }, [refresh, services]);

  return { tasks, loading, error, refresh, updateStatus };
}

const manifest: ComponentManifest = {
  type: "project.dashboard" as ComponentType,
  specVersion: 1,
  displayName: "项目仪表盘",
  description: "项目指标、发布记录、热力图与项目看板的聚合仪表盘",
  category: "data",
  icon: "layout-dashboard" as IconName,
  keywords: ["project", "dashboard", "看板", "指标", "热力图"],
  vendor: "components-studio",
  packageVersion: "0.1.0",
  rootAllowed: true,
  userCreatable: true,
  declaredCapabilities: ["vault:read", "vault:modify"],
};

const propsSchema: JsonObjectSchema = {
  type: "object",
  properties: {
    title: { type: "string", minLength: 1, maxLength: 120 },
    sourcePath: { type: "string", maxLength: 512 },
    taskTag: { type: "string", maxLength: 120 },
    project: { type: "string", maxLength: 120 },
  },
  required: ["title", "sourcePath", "taskTag", "project"],
  additionalProperties: false,
};

function validate(input: unknown): ValidationResult<ProjectDashboardProps> {
  const issues: ValidationIssue[] = [];
  validateAgainstSchema(input, propsSchema, {}, issues, "$");
  return issues.length > 0 ? { ok: false, issues } : { ok: true, value: input as ProjectDashboardProps, warnings: [] };
}

function Renderer({ props }: ComponentRendererProps<ProjectDashboardProps>) {
  const source = useVaultTasks(props);
  return <DashboardPreview {...source} />;
}

export const projectDashboardDefinition: ComponentDefinition<ProjectDashboardProps> = defineComponent({
  manifest,
  propsSchema,
  slots: [],
  events: [],
  bindableTargets: [],
  migrations: [],
  createCompanionDataSources: () => [],
  createDefaultProps: () => ({ title: "项目中心", sourcePath: "Tasks", taskTag: "task", project: "components" }),
  validate,
  Renderer,
  Inspector: null,
});
