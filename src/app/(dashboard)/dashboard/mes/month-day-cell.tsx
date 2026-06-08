"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { PersonAvatar } from "@/components/person-avatar";
import type { DayPlanningSummary, DayProjectDetail } from "@/features/planning/queries";
import { formatCivilIsoDate } from "@/lib/civil-date";
import { formatHours } from "@/lib/format";
import { cn } from "@/lib/utils";

const HOVER_CLOSE_DELAY_MS = 220;

function hoursHeatClass(hours: number, maxHours: number): string {
  if (hours <= 0 || maxHours <= 0) return "";
  const ratio = hours / maxHours;
  if (ratio >= 0.85) return "bg-primary/20";
  if (ratio >= 0.6) return "bg-primary/12";
  if (ratio >= 0.35) return "bg-primary/8";
  return "bg-primary/4";
}

function truncateProjectName(name: string, max = 18): string {
  if (name.length <= max) return name;
  return `${name.slice(0, max - 1)}…`;
}

function weekdayLabel(iso: string): string {
  const date = new Date(`${iso}T12:00:00.000Z`);
  return date.toLocaleDateString("es-ES", { weekday: "long" });
}

function useHoverPanel() {
  const anchorRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const closeTimerRef = useRef<number | null>(null);
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState({ top: 0, left: 0 });

  const updateCoords = useCallback(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    const panelWidth = 320;
    let left = rect.right - 4;
    if (left + panelWidth > window.innerWidth - 12) {
      left = Math.max(12, rect.left - panelWidth + 4);
    }
    const top = Math.max(12, Math.min(rect.top, window.innerHeight - 320));
    setCoords({ top, left });
  }, []);

  const cancelClose = useCallback(() => {
    if (closeTimerRef.current != null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  const scheduleClose = useCallback(() => {
    cancelClose();
    closeTimerRef.current = window.setTimeout(() => setOpen(false), HOVER_CLOSE_DELAY_MS);
  }, [cancelClose]);

  const show = useCallback(() => {
    cancelClose();
    updateCoords();
    setOpen(true);
  }, [cancelClose, updateCoords]);

  useEffect(() => {
    if (!open) return;
    const onScrollOrResize = () => updateCoords();
    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);
    return () => {
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
    };
  }, [open, updateCoords]);

  useEffect(
    () => () => {
      if (closeTimerRef.current != null) {
        window.clearTimeout(closeTimerRef.current);
      }
    },
    [],
  );

  return {
    anchorRef,
    panelRef,
    open,
    coords,
    show,
    scheduleClose,
    cancelClose,
  };
}

function DetailSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div>
      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </p>
      {children}
    </div>
  );
}

function ExpandableProjectRow({ project }: { project: DayProjectDetail }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded-md border border-border/60 bg-background/60">
      <button
        type="button"
        className="flex w-full items-center gap-2 px-2 py-1.5 text-left hover:bg-accent/40"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setExpanded((value) => !value);
        }}
      >
        <ChevronRight
          className={cn(
            "size-3.5 shrink-0 text-muted-foreground transition-transform",
            expanded && "rotate-90",
          )}
        />
        <span className="min-w-0 flex-1 truncate font-medium" title={project.name}>
          {project.name}
        </span>
        <span className="shrink-0 tabular-nums text-muted-foreground">
          {formatHours(project.hours)}
        </span>
      </button>
      {expanded && project.tasks.length > 0 && (
        <ul className="space-y-1 border-t border-border/60 px-2 py-1.5">
          {project.tasks.map((task) => (
            <li
              key={`${task.taskId}-${task.personIniciales}`}
              className="flex items-center justify-between gap-3 pl-5 text-[11px]"
            >
              <span className="min-w-0 truncate">
                {task.process}
                <span className="text-muted-foreground"> · {task.personIniciales}</span>
              </span>
              <span className="shrink-0 tabular-nums">{formatHours(task.hours)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function DayDetailPanel({
  iso,
  summary,
  isHoliday,
  view,
}: {
  iso: string;
  summary?: DayPlanningSummary;
  isHoliday: boolean;
  view: "plan" | "actual";
}) {
  const hasWork = summary && summary.totalHours > 0;
  const weekday = weekdayLabel(iso);
  const dateLabel = formatCivilIsoDate(iso);

  if (isHoliday) {
    return (
      <div className="space-y-1">
        <p className="font-medium capitalize">
          {weekday} {dateLabel}
        </p>
        <p className="text-muted-foreground">Día festivo · sin carga planificable</p>
      </div>
    );
  }

  if (!hasWork || !summary) {
    return (
      <div className="space-y-1">
        <p className="font-medium capitalize">
          {weekday} {dateLabel}
        </p>
        <p className="text-muted-foreground">
          {view === "actual" ? "Sin registros de horas" : "Sin planning"}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div>
        <p className="font-medium capitalize">
          {weekday} {dateLabel}
        </p>
        <p className="text-muted-foreground">
          {formatHours(summary.totalHours)} · {summary.assignmentCount} asignación
          {summary.assignmentCount === 1 ? "" : "es"}
        </p>
      </div>

      {summary.peopleHours.length > 0 && (
        <DetailSection title="Operarios">
          <ul className="space-y-1.5">
            {summary.peopleHours.map((person) => (
              <li key={person.id} className="flex items-center justify-between gap-3">
                <span className="flex min-w-0 items-center gap-1.5">
                  <PersonAvatar
                    iniciales={person.iniciales}
                    color={person.color}
                    size={18}
                  />
                  <span className="truncate">{person.iniciales}</span>
                </span>
                <span className="shrink-0 tabular-nums">{formatHours(person.hours)}</span>
              </li>
            ))}
          </ul>
        </DetailSection>
      )}

      {summary.projects.length > 0 && (
        <DetailSection title="Proyectos">
          <div className="space-y-1.5">
            {summary.projects.map((project) => (
              <ExpandableProjectRow key={project.id} project={project} />
            ))}
          </div>
        </DetailSection>
      )}

      {summary.processHours.length > 0 && (
        <DetailSection title="Procesos">
          <ul className="space-y-1">
            {summary.processHours.map((item) => (
              <li key={item.process} className="flex items-center justify-between gap-3">
                <span className="truncate">{item.process}</span>
                <span className="shrink-0 tabular-nums">{formatHours(item.hours)}</span>
              </li>
            ))}
          </ul>
        </DetailSection>
      )}

      <p className="text-[10px] text-muted-foreground">Clic en el día para abrir la semana</p>
    </div>
  );
}

function DayHoverPanel({
  open,
  coords,
  panelRef,
  onMouseEnter,
  onMouseLeave,
  children,
}: {
  open: boolean;
  coords: { top: number; left: number };
  panelRef: RefObject<HTMLDivElement | null>;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  children: ReactNode;
}) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted || !open) return null;

  return createPortal(
    <div
      ref={panelRef}
      style={{ top: coords.top, left: coords.left }}
      className="fixed z-50 w-80 max-h-[min(70vh,28rem)] overflow-y-auto rounded-lg border bg-popover p-3 text-xs text-popover-foreground shadow-lg ring-1 ring-foreground/10"
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onClick={(event) => event.stopPropagation()}
    >
      {children}
    </div>,
    document.body,
  );
}

export function MonthDayCell({
  iso,
  dayOfMonth,
  summary,
  isHoliday,
  isToday,
  view,
  maxDayHours,
  href,
}: {
  iso: string;
  dayOfMonth: number;
  summary?: DayPlanningSummary;
  isHoliday: boolean;
  isToday: boolean;
  view: "plan" | "actual";
  maxDayHours: number;
  href: string;
}) {
  const hasWork = summary && summary.totalHours > 0;
  const { anchorRef, panelRef, open, coords, show, scheduleClose, cancelClose } =
    useHoverPanel();

  return (
    <>
      <div
        ref={anchorRef}
        className="relative"
        onMouseEnter={show}
        onMouseLeave={scheduleClose}
      >
        <Link
          href={href}
          className={cn(
            "flex min-h-[112px] flex-col gap-1.5 p-2 transition-colors hover:bg-accent/50",
            isHoliday && "bg-muted/30",
            hasWork && hoursHeatClass(summary.totalHours, maxDayHours),
            isToday && "ring-2 ring-inset ring-primary/60",
            !hasWork && !isHoliday && "text-muted-foreground",
          )}
        >
          <div className="flex items-center justify-between gap-1">
            <span
              className={cn(
                "inline-flex size-6 items-center justify-center rounded-full text-xs font-semibold tabular-nums",
                isToday && "bg-primary text-primary-foreground",
              )}
            >
              {dayOfMonth}
            </span>
            {isHoliday ? (
              <span className="text-[10px] font-medium text-muted-foreground">Festivo</span>
            ) : hasWork ? (
              <span className="text-[10px] tabular-nums text-muted-foreground">
                {summary.assignmentCount} asig.
              </span>
            ) : null}
          </div>

          {hasWork ? (
            <>
              <span className="text-sm font-semibold tabular-nums">
                {formatHours(summary.totalHours)}
              </span>

              <div className="flex flex-wrap gap-0.5">
                {summary.people.slice(0, 4).map((p) => (
                  <PersonAvatar
                    key={p.id}
                    iniciales={p.iniciales}
                    color={p.color}
                    size={20}
                  />
                ))}
                {summary.people.length > 4 && (
                  <span className="self-center text-[10px] text-muted-foreground">
                    +{summary.people.length - 4}
                  </span>
                )}
              </div>

              {summary.topProjects.length > 0 && (
                <ul className="space-y-0.5 text-[10px] leading-tight text-muted-foreground">
                  {summary.topProjects.map((project) => (
                    <li key={project.id} className="truncate" title={project.name}>
                      {truncateProjectName(project.name)}{" "}
                      <span className="tabular-nums">({formatHours(project.hours)})</span>
                    </li>
                  ))}
                  {summary.projectCount > summary.topProjects.length && (
                    <li>
                      +{summary.projectCount - summary.topProjects.length} proyecto
                      {summary.projectCount - summary.topProjects.length === 1 ? "" : "s"}
                    </li>
                  )}
                </ul>
              )}

              {summary.processes.length > 0 && (
                <span className="text-[10px] text-muted-foreground">
                  {summary.processes.length} proceso
                  {summary.processes.length === 1 ? "" : "s"}
                </span>
              )}
            </>
          ) : (
            <span className="text-[10px] text-muted-foreground">
              {isHoliday ? "Sin carga" : view === "actual" ? "Sin registros" : "Sin planning"}
            </span>
          )}
        </Link>
      </div>

      <DayHoverPanel
        open={open}
        coords={coords}
        panelRef={panelRef}
        onMouseEnter={cancelClose}
        onMouseLeave={scheduleClose}
      >
        <DayDetailPanel
          iso={iso}
          summary={summary}
          isHoliday={isHoliday}
          view={view}
        />
      </DayHoverPanel>
    </>
  );
}
