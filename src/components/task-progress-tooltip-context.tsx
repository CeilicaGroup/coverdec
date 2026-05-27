"use client";

import { createContext, useContext } from "react";

interface TaskProgressTooltipContextValue {
  pinTooltip: () => void;
  unpinTooltip: () => void;
}

const TaskProgressTooltipContext = createContext<TaskProgressTooltipContextValue | null>(
  null,
);

export function useTaskProgressTooltipPin(): TaskProgressTooltipContextValue {
  const ctx = useContext(TaskProgressTooltipContext);
  return ctx ?? { pinTooltip: () => {}, unpinTooltip: () => {} };
}

export { TaskProgressTooltipContext };
