"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  getActivePlanningJobAction,
  getPlanningJobStatusAction,
  type PlanningJobStatusResponse,
} from "@/features/planning/actions";
import type {
  PlanningJobProgress,
  PlanningJobResult,
} from "@/features/planning/planning-job";

const POLL_INTERVAL_MS = 2_000;

interface PlanningJobContextValue {
  isGenerating: boolean;
  progressLabel: string | null;
  progress: PlanningJobProgress | null;
  status: PlanningJobStatusResponse["status"] | null;
  planningWarnings: string[];
  unscheduledHours: number;
  warningsOpen: boolean;
  setWarningsOpen: (open: boolean) => void;
  trackJob: (jobId: string) => void;
}

const PlanningJobContext = createContext<PlanningJobContextValue | null>(null);

export function usePlanningJob(): PlanningJobContextValue {
  const ctx = useContext(PlanningJobContext);
  if (!ctx) {
    throw new Error("usePlanningJob must be used within PlanningJobProvider");
  }
  return ctx;
}

export function usePlanningJobOptional(): PlanningJobContextValue | null {
  return useContext(PlanningJobContext);
}

function usePlanningJobPolling(enabled: boolean) {
  const router = useRouter();
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [progressLabel, setProgressLabel] = useState<string | null>(null);
  const [progress, setProgress] = useState<PlanningJobProgress | null>(null);
  const [status, setStatus] = useState<PlanningJobStatusResponse["status"] | null>(
    null,
  );
  const [planningWarnings, setPlanningWarnings] = useState<string[]>([]);
  const [unscheduledHours, setUnscheduledHours] = useState(0);
  const [warningsOpen, setWarningsOpen] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const handleTerminalStatus = useCallback(
    (jobStatus: PlanningJobStatusResponse) => {
      stopPolling();
      setActiveJobId(null);
      setProgressLabel(null);
      setStatus(jobStatus.status);
      setProgress(jobStatus.progress);

      if (jobStatus.status === "COMPLETED" && jobStatus.result) {
        const result: PlanningJobResult = jobStatus.result;
        setPlanningWarnings(result.warnings);
        setUnscheduledHours(result.totalUnscheduledHours);

        const weeksLabel =
          result.weeksGenerated === 1
            ? "1 semana"
            : `${result.weeksGenerated} semanas`;
        let toastMessage = `Planning generado: ${weeksLabel}, ${result.totalAssignments} asignaciones`;
        if (result.warnings.length > 0) {
          toastMessage += ` (${result.warnings.length} avisos)`;
        }

        toast.success(
          toastMessage,
          result.warnings.length > 0
            ? {
                action: {
                  label: "Ver avisos",
                  onClick: () => setWarningsOpen(true),
                },
              }
            : undefined,
        );
        router.refresh();
      } else if (jobStatus.status === "FAILED") {
        const failureWarnings = jobStatus.result?.warnings ?? [];
        const failureUnscheduled = jobStatus.result?.totalUnscheduledHours ?? 0;
        setPlanningWarnings(failureWarnings);
        setUnscheduledHours(failureUnscheduled);

        const summary = jobStatus.error ?? "Error generando planning";
        toast.error(
          summary,
          failureWarnings.length > 0
            ? {
                action: {
                  label: "Ver avisos",
                  onClick: () => setWarningsOpen(true),
                },
              }
            : undefined,
        );
        router.refresh();
      }
    },
    [router, stopPolling],
  );

  const startPolling = useCallback(
    (jobId: string) => {
      stopPolling();
      pollRef.current = setInterval(async () => {
        try {
          const jobStatus = await getPlanningJobStatusAction(jobId);
          if (!jobStatus) {
            stopPolling();
            setActiveJobId(null);
            setProgressLabel(null);
            setProgress(null);
            setStatus(null);
            return;
          }

          setStatus(jobStatus.status);
          setProgress(jobStatus.progress);

          if (
            jobStatus.status === "RUNNING" ||
            jobStatus.status === "PENDING"
          ) {
            setProgressLabel(
              jobStatus.progress?.currentWeekLabel ?? "Generando planning…",
            );
          } else {
            handleTerminalStatus(jobStatus);
          }
        } catch {
          // Network hiccup — keep polling
        }
      }, POLL_INTERVAL_MS);
    },
    [handleTerminalStatus, stopPolling],
  );

  const trackJob = useCallback(
    (jobId: string) => {
      setActiveJobId(jobId);
      setStatus("PENDING");
      setProgressLabel("Iniciando generación…");
      startPolling(jobId);
    },
    [startPolling],
  );

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    getActivePlanningJobAction().then((job) => {
      if (cancelled || !job) return;
      if (job.status === "PENDING" || job.status === "RUNNING") {
        setActiveJobId(job.jobId);
        setStatus(job.status);
        setProgress(job.progress);
        setProgressLabel(
          job.progress?.currentWeekLabel ?? "Generando planning…",
        );
        startPolling(job.jobId);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [enabled, startPolling]);

  useEffect(() => () => stopPolling(), [stopPolling]);

  const isGenerating = activeJobId !== null;

  return useMemo(
    () => ({
      isGenerating,
      progressLabel,
      progress,
      status,
      planningWarnings,
      unscheduledHours,
      warningsOpen,
      setWarningsOpen,
      trackJob,
    }),
    [
      isGenerating,
      progressLabel,
      progress,
      status,
      planningWarnings,
      unscheduledHours,
      warningsOpen,
      trackJob,
    ],
  );
}

export function PlanningJobProvider({
  enabled,
  children,
}: {
  enabled: boolean;
  children: ReactNode;
}) {
  const value = usePlanningJobPolling(enabled);

  if (!enabled) {
    return children;
  }

  return (
    <PlanningJobContext.Provider value={value}>
      {children}
    </PlanningJobContext.Provider>
  );
}
