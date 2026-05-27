"use client";

import type { ComponentProps } from "react";
import { TimeEntryInlineActions } from "@/features/time-tracking/time-entry-inline-actions";
import { TaskCompletionAction } from "@/features/time-tracking/task-progress-actions";

type TimeEntryInlineActionsProps = ComponentProps<typeof TimeEntryInlineActions>;

export function TaskProgressActionsPanel({
  timeEntry,
  taskId,
  isCompleted,
  canManageCompletion,
}: {
  timeEntry: TimeEntryInlineActionsProps;
  taskId: string;
  isCompleted: boolean;
  canManageCompletion: boolean;
}) {
  return (
    <TimeEntryInlineActions
      {...timeEntry}
      trailingActions={
        <TaskCompletionAction
          taskId={taskId}
          isCompleted={isCompleted}
          canManage={canManageCompletion}
        />
      }
    />
  );
}
