import { useMemo, useState } from "react";
import type { DashboardTask } from "../widgets/project-dashboard";

type Board = "项目看板" | "待发布" | "需求池" | "版本记录" | "全部" | "日历";

const months = ["10月", "11月", "12月", "1月", "2月", "3月", "4月", "5月", "6月", "7月", "8月", "9月"];

function ReleaseChart({ releases }: { releases: readonly number[] }) {
  return <section className="dash-panel chart-panel"><h2>发布记录</h2><div className="legend"><span className="red" />无值 <span className="blue" />feature <span className="orange" />bug <span className="green" />improvement</div><div className="bar-chart"><div className="chart-grid" />{releases.map((value, i) => <div className="bar-slot" key={i}><div className="bar green-bar" style={{ height: `${Math.max(5, value * 16)}%` }} /><div className="bar blue-bar" style={{ height: `${Math.max(4, value * 10)}%` }} /><div className="bar red-bar" style={{ height: `${Math.max(3, value * 7)}%` }} /><span>{i === releases.length - 1 ? "本周" : `${i + 1}周`}</span></div>)}</div></section>;
}

function Heatmap() {
  const [active, setActive] = useState("项目热力图");
  const cells = useMemo(() => Array.from({ length: 260 }, (_, i) => (i * 17 + i * i * 3) % 9), []);
  const options = ["项目热力图", "时间分布", "周分布", "教程总字数", "2.0 已发布"];
  return <section className="dash-panel heat-panel"><div className="panel-tabs">{options.map((option) => <button key={option} type="button" onClick={() => setActive(option)} className={active === option ? "selected" : ""}>▥ {option}</button>)}</div><h2>今年{active}</h2><div className="heat-legend"><span />0.00 - 1.25 <span />1.25 - 2.50 <span />2.50 - 3.75 <span />3.75 - 5.00 <span />&gt; 5.00</div><div className="month-row">{months.map((month) => <span key={month}>{month}</span>)}</div><div className="heat-body"><div className="week-labels">一<br />二<br />三<br />四<br />五<br />六<br />日</div><div className="heat-grid">{cells.map((level, i) => <i key={i} className={`heat level-${level}`} />)}</div></div></section>;
}

function KanbanCard({ task, updateStatus }: { task: DashboardTask; updateStatus: (task: DashboardTask, status: string) => Promise<void> }) {
  const isClosed = task.status === "done" || task.status === "completed" || task.status === "cancelled" || task.status === "canceled";
  return <article className={`kanban-card state-${isClosed ? task.status : "open"}`}><strong>{task.title}</strong><em className={task.kind}>{task.kind}</em><div>{isClosed ? <span className="card-result">{task.status === "done" || task.status === "completed" ? "已完成" : "已取消"}</span> : <><button onClick={() => void updateStatus(task, "done")}>完成</button><button onClick={() => void updateStatus(task, "cancelled")}>取消</button></>}</div><small>{task.due ? `截止 ${task.due}` : task.path}</small></article>;
}

function dateKey(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function TaskCalendar({ tasks, updateStatus }: { tasks: readonly DashboardTask[]; updateStatus: (task: DashboardTask, status: string) => Promise<void> }) {
  const firstDue = tasks.find((task) => task.due)?.due ?? new Date().toISOString().slice(0, 10);
  const firstDate = new Date(`${firstDue}T12:00:00`);
  const [cursor, setCursor] = useState(() => ({ year: firstDate.getFullYear(), month: firstDate.getMonth() }));
  const monthStart = new Date(cursor.year, cursor.month, 1);
  const leadingDays = (monthStart.getDay() + 6) % 7;
  const daysInMonth = new Date(cursor.year, cursor.month + 1, 0).getDate();
  const monthTasks = new Map<string, DashboardTask[]>();
  for (const task of tasks) {
    if (!task.due) continue;
    const existing = monthTasks.get(task.due) ?? [];
    existing.push(task);
    monthTasks.set(task.due, existing);
  }
  const cells = Array.from({ length: 42 }, (_, index) => {
    const day = index - leadingDays + 1;
    const inMonth = day >= 1 && day <= daysInMonth;
    const date = new Date(cursor.year, cursor.month, day);
    const key = dateKey(date.getFullYear(), date.getMonth(), date.getDate());
    return { key, day: date.getDate(), inMonth, tasks: monthTasks.get(key) ?? [] };
  });
  const shift = (amount: number) => setCursor((value) => {
    const next = new Date(value.year, value.month + amount, 1);
    return { year: next.getFullYear(), month: next.getMonth() };
  });
  return <section className="task-calendar" aria-label="任务日历">
    <header className="calendar-toolbar"><div><h3>{cursor.year} 年 {cursor.month + 1} 月</h3><span>{tasks.filter((task) => task.due?.startsWith(`${cursor.year}-${String(cursor.month + 1).padStart(2, "0")}`)).length} 个有截止日期的任务</span></div><nav aria-label="切换月份"><button type="button" onClick={() => shift(-1)} aria-label="上个月">‹</button><button type="button" onClick={() => setCursor({ year: firstDate.getFullYear(), month: firstDate.getMonth() })}>回到任务月份</button><button type="button" onClick={() => shift(1)} aria-label="下个月">›</button></nav></header>
    <div className="calendar-weekdays">{["一", "二", "三", "四", "五", "六", "日"].map((day) => <span key={day}>{day}</span>)}</div>
    <div className="calendar-grid">{cells.map((cell) => <div key={cell.key} className={`calendar-day${cell.inMonth ? "" : " muted"}`}><time dateTime={cell.key}>{cell.day}</time>{cell.tasks.map((task) => <button type="button" key={task.path} className={`calendar-event ${task.status}`} onClick={() => void updateStatus(task, task.status === "done" ? "todo" : "done")} title={`${task.title} · 点击切换完成`}><span>{task.title}</span></button>)}</div>)}</div>
  </section>;
}

export function DashboardPreview({ tasks, loading, error, refresh, updateStatus }: { tasks: readonly DashboardTask[]; loading: boolean; error: string | null; refresh: () => void; updateStatus: (task: DashboardTask, status: string) => Promise<void> }) {
  const [active, setActive] = useState<Board>("项目看板");
  const [workspaceArea, setWorkspaceArea] = useState("项目管理");
  const [center, setCenter] = useState("项目中心");
  const [area, setArea] = useState("[[components]]");
  const boards = useMemo(() => {
    const definitions = [
      ["TODO", "TODO", "mint", ["todo", "open", "backlog"]],
      ["DOING", "DOING", "peach", ["doing", "in-progress", "in progress"]],
      ["DONE", "DONE", "gray", ["done", "completed"]],
      ["CANCELED", "CANCELED", "gray", ["cancelled", "canceled"]],
    ] as const;
    return definitions.map(([key, title, tone, statuses]) => ({ key, title, tone, cards: tasks.filter((task) => statuses.includes(task.status as never)) }));
  }, [tasks]);
  const todo = boards[0]!.cards.length;
  const doing = boards[1]!.cards.length;
  const done = boards[2]!.cards.length;
  const cancelled = boards[3]!.cards.length;
  const completion = tasks.length ? Math.round((done / tasks.length) * 10000) / 100 : 0;
  const releases = useMemo(() => Array.from({ length: 12 }, (_, week) => tasks.filter((task) => Math.floor((Date.now() - task.createdAt) / 604800000) === 11 - week).length), [tasks]);
  const shownBoards = useMemo(() => {
    if (active === "待发布") return boards.filter((board) => ["TODO", "DOING"].includes(board.key));
    if (active === "需求池") return boards.filter((board) => board.key === "TODO");
    if (active === "版本记录") return boards.filter((board) => board.key === "DONE");
    if (active === "全部") return boards;
    return boards;
  }, [active, boards]);
  return <main className="dashboard-preview">
    <header className="top-nav"><nav>{["项目中心", "订单中心"].map((item) => <button type="button" key={item} onClick={() => setCenter(item)} className={center === item ? "active" : ""}>▦ {item}</button>)}</nav><button className="settings" type="button">⚙</button></header>
    <section className="metrics"><div className="metric"><span>已取消</span><b>{cancelled}</b></div><div className="metric"><span>进行中</span><b>{doing}</b></div><div className="metric"><span>需求池</span><b>{todo}</b></div><div className="metric completion"><span>项目完成率</span><b>{completion}%</b><div className="progress"><i style={{ width: `${completion}%` }} /></div><small>{completion}%</small></div></section>
    <section className="analytics"><ReleaseChart releases={releases} /><Heatmap /><aside className="right-stats"><div className="small-stat"><span>待发布</span><b>{todo + doing}</b></div><div className="small-stat"><span>今日完成</span><b>{done}</b></div><div className="small-stat due"><span>这次又要延期</span><b>{tasks.filter((task) => task.due && Date.parse(task.due) < Date.now() && !["done", "completed"].includes(task.status)).length}</b></div><div className="small-stat"><span>数据源任务</span><b>{tasks.length} <small>项</small></b><time>{loading ? "正在读取 Vault…" : error ?? "TaskNotes frontmatter"}</time></div></aside></section>
    <section className="workspace"><div className="workspace-head"><nav>{["项目管理", "发布记录", "内容管理"].map((item) => <button type="button" key={item} onClick={() => setWorkspaceArea(item)} className={workspaceArea === item ? "active" : ""}>▦ {item}</button>)}</nav><button type="button" onClick={refresh}>↻</button></div><div className="board-tabs"><nav>{(["项目看板", "待发布", "需求池", "版本记录", "全部", "日历"] as Board[]).map((item) => <button type="button" key={item} onClick={() => setActive(item)} className={active === item ? "active" : ""}>▥ {item}</button>)}</nav><div><button type="button">⌕</button><button type="button">☷</button><button type="button" className="new">新建⌄</button></div></div><div className="filters"><button type="button">{workspaceArea}⌄</button><button type="button" onClick={() => setArea(area === "[[components]]" ? "全部区域" : "[[components]]")}>area : {area}⌄</button><button type="button">+ 筛选</button></div>{active === "日历" ? <TaskCalendar tasks={tasks} updateStatus={updateStatus} /> : <div className="kanban">{shownBoards.map((column) => <section className={`kanban-column ${column.tone}`} key={column.key}><h3>⌄ <span>{column.title}</span> <small>{column.cards.length}</small></h3>{column.cards.map((task) => <KanbanCard key={task.path} task={task} updateStatus={updateStatus} />)}</section>)}<section className="kanban-column ungrouped"><h3>⌄ 未分类的组 <small>{tasks.length - todo - doing - done - cancelled}</small></h3><button type="button" className="add">＋ 新建</button></section></div>}</section>
  </main>;
}
