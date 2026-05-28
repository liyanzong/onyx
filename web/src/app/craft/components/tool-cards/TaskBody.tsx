"use client";

import { Text, Tag } from "@opal/components";
import { SvgBubbleText, SvgArrowRight } from "@opal/icons";
import { cn } from "@opal/utils";
import {
  useSubagents,
  useBuildSessionStore,
} from "@/app/craft/hooks/useBuildSessionStore";
import type { ToolCardBodyProps } from "@/app/craft/components/tool-cards/interfaces";

/**
 * TaskBody - Renderer for the task (subagent) tool.
 *
 * Shows the subagent type badge, the prompt, and the final output. When the
 * spawned subagent is known, the whole body becomes a clickable surface that
 * opens the subagent's transcript in the side panel.
 */
export default function TaskBody({ toolCall }: ToolCardBodyProps) {
  const subagents = useSubagents();
  const openSubagentInPanel = useBuildSessionStore(
    (s) => s.openSubagentInPanel
  );

  const subagent =
    Array.from(subagents.values()).find(
      (s) => s.parentToolCallId === toolCall.id
    ) ?? null;

  const subagentType = toolCall.subagentType;
  const prompt = toolCall.command || toolCall.rawOutput;
  const output = toolCall.taskOutput;
  const stepCount = subagent?.toolCalls.length ?? 0;

  const statusLabel = subagent
    ? subagent.status === "running"
      ? `running · ${stepCount} steps`
      : subagent.status === "done"
        ? `done · ${stepCount} steps`
        : `failed · ${stepCount} steps`
    : null;

  const content = (
    <>
      {subagentType && (
        <div className="flex items-center gap-2">
          <Tag
            icon={SvgBubbleText}
            title={subagentType}
            color="purple"
            size="sm"
          />
          {statusLabel && (
            <Text font="main-ui-muted" color="text-02">
              {statusLabel}
            </Text>
          )}
        </div>
      )}

      {prompt && (
        <div>
          <Text font="main-ui-muted" color="text-02">
            Prompt
          </Text>
          <div className="mt-1 overflow-auto max-h-[14rem] whitespace-pre-wrap wrap-break-word">
            <Text as="p" font="secondary-body" color="text-04">
              {prompt}
            </Text>
          </div>
        </div>
      )}

      {output && (
        <div>
          <Text font="main-ui-muted" color="text-02">
            Result
          </Text>
          <div className="mt-1 overflow-auto max-h-[20rem] whitespace-pre-wrap wrap-break-word">
            <Text as="p" font="main-content-body" color="text-04">
              {output}
            </Text>
          </div>
        </div>
      )}

      {subagent && (
        <div className="flex items-center gap-1">
          <Text font="main-ui-action" color="text-03">
            View transcript
          </Text>
          <SvgArrowRight className="w-3.5 h-3.5 stroke-action-link-05" />
        </div>
      )}
    </>
  );

  if (subagent) {
    return (
      <button
        type="button"
        onClick={() => openSubagentInPanel(subagent.sessionId)}
        aria-label="View subagent transcript"
        className={cn(
          "px-3 flex flex-col gap-3 w-full text-left rounded-08",
          "transition-colors hover:bg-background-tint-01"
        )}
      >
        {content}
      </button>
    );
  }

  return <div className="px-3 flex flex-col gap-3">{content}</div>;
}
